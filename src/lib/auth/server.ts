/**
 * Self-hosted Better Auth for THIS app (server-only).
 *
 * Direct Google OAuth is reserved for the platform owner. Company users use
 * administrator-provisioned email/password accounts.
 *
 * The app runs its own Better Auth at `/api/auth/*`, so the session cookie stays
 * on this app's own origin. The first administrator is created through the
 * email-and-OTP setup flow; Google cannot bootstrap a fresh installation.
 *
 * Tri-mode:
 *   - Google sign-in uses Google's OAuth endpoints when credentials are set.
 *   - Sessions and identities persist in Postgres or embedded PGLite. Live-
 *     preview iframe clients use a bearer token because cookies are partitioned.
 *   - Off (`VITE_AUTH_ENABLED=false`, the shipped default): no providers;
 *     `requireUserId` resolves a dev user with no database configured, and
 *     throws fail-closed once `DATABASE_URL` is set (see `verify.server.ts`).
 *
 * NEVER import this from client code — it pulls in `pg` + the preview secret +
 * server-only Better Auth internals. The client uses `@/lib/auth/client`;
 * components read the user via `@/lib/auth/use-current-user`; server functions get
 * a verified id via `@/lib/auth/middleware`.
 */
import { betterAuth } from "better-auth";
import { bearer, emailOTP } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { getCookie } from "@tanstack/react-start/server";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { ensureDbReady, getPglite, getSql } from "../db.server";
import { isInitialAdminEmail, isNewUserAllowed } from "./user-gate";
import { emailConfigured, sendEmail } from "../ehs/email";
import { emailAndPasswordEnabled } from "./email-password";
import { GATE_PROVIDER_ID, gateIdentitySessions } from "./gate-session.server";
import { pgliteDialect } from "./pglite-dialect";
import { PREVIEW_ALLOWED_HOSTS } from "./preview";

// Kick (and share) PGLite bootstrap as soon as the auth server module loads.
void ensureDbReady();

/**
 * Preview secret must outlive module reloads: PGLite (and its session rows) is
 * stored on `globalThis`, so an HMR re-eval of this file must NOT mint a new
 * signing secret or every existing session becomes invalid mid-dev. Process
 * restart clears both the secret and PGLite together.
 */
const globalAuthRef = globalThis as typeof globalThis & {
  __grokAuthPreviewSecret__?: string;
};
function previewAuthSecret(): string {
  globalAuthRef.__grokAuthPreviewSecret__ ??= randomBytes(32).toString("hex");
  return globalAuthRef.__grokAuthPreviewSecret__;
}

/** Read an env var, treating empty/whitespace as unset. */
const env = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]!);
}

// Explicit off-switch. The deployer sets `VITE_AUTH_ENABLED=true` when it
// provisions auth; set it to "false" to force auth off everywhere (dev user).
const authDisabled = env("VITE_AUTH_ENABLED") === "false";

const googleClientId = env("GOOGLE_CLIENT_ID");
const googleClientSecret = env("GOOGLE_CLIENT_SECRET");

/** True when direct Google OAuth is ready to start. */
export const googleOAuthConfigured =
  !authDisabled && Boolean(googleClientId && googleClientSecret);

/** Email/password or Google sessions use verified authentication. */
export const authConfigured = !authDisabled && (emailAndPasswordEnabled || googleOAuthConfigured);

// In live preview, Better Auth derives its base URL from the dynamic request host
// after validating it against the preview allowlist.
const explicitBaseURL = env("BETTER_AUTH_URL");
// Explicit `string[]` (not a readonly tuple) — Better Auth's DynamicBaseURLConfig
// requires a mutable `allowedHosts: string[]`.
const previewAllowedHosts: string[] = [...PREVIEW_ALLOWED_HOSTS];
// Local `npm run dev` (port 8080 contract). Browsers may send Origin as any of
// these for the same server — trusting only `localhost` rejects `127.0.0.1` and
// breaks email/password with "Invalid origin".
const LOCAL_DEV_ORIGINS: string[] = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://[::1]:8080",
  "http://localhost:8081",
  "http://127.0.0.1:8081",
  "http://[::1]:8081",
];
// The production site is served on both the apex domain and www. Keep both
// trusted even when BETTER_AUTH_URL is set to only the canonical www origin.
const PRODUCTION_ORIGINS = [
  "https://codiqtech.co.tz",
  "https://www.codiqtech.co.tz",
];
const baseURL = explicitBaseURL ?? {
  // Include loopback hosts so dynamic baseURL resolves for local email/password
  // (not only the preview wildcard).
  allowedHosts: [...previewAllowedHosts, "localhost", "127.0.0.1", "[::1]"],
  // `auto` → trust both http:// and https:// expansions of allowedHosts
  // (preview is https; local dev is http).
  protocol: "auto" as const,
  fallback: "http://localhost:8080",
};

// Origins Better Auth accepts on credentialed POSTs (sign-up/sign-in, etc.).
// Missing entries here surface as FORBIDDEN "Invalid origin".
const trustedOrigins: string[] = [
  ...PRODUCTION_ORIGINS,
  ...(explicitBaseURL
    ? [explicitBaseURL]
    : [
        // Host wildcards (matched against Origin's host)
        ...previewAllowedHosts,
        // Full-origin wildcards (matched against Origin)
        ...previewAllowedHosts.flatMap((host) => [`https://${host}`, `http://${host}`]),
      ]),
  ...LOCAL_DEV_ORIGINS,
];

const databaseUrl = env("DATABASE_URL");
const configuredAuthSecret = env("BETTER_AUTH_SECRET");

// Vercel may serve requests from different serverless instances. A random
// per-process fallback secret makes signed auth cookies appear valid on one
// request and invalid on the next, which surfaces as a client session followed
// by server-side `Unauthorized`. Require stable production auth configuration.
if (process.env.NODE_ENV === "production" && databaseUrl && !authDisabled) {
  const missing = [
    ...(!configuredAuthSecret ? ["BETTER_AUTH_SECRET"] : []),
    ...(!explicitBaseURL ? ["BETTER_AUTH_URL"] : []),
  ];
  if (missing.length) {
    throw new Error(`[auth] Missing required production environment variable(s): ${missing.join(", ")}`);
  }
}

// Real Postgres when `DATABASE_URL` is set (deployed apps), else the app's
// embedded PGLite (preview) via a Kysely dialect — so Better Auth persists to the
// SAME DB as app data, including email/password users. Both use the Better Auth
// schema from `migrations/auth/0001_auth.sql`, copied into `migrations/` when
// the app turns sign-in on.
const database = databaseUrl
  ? new Pool({ connectionString: databaseUrl })
  : { dialect: pgliteDialect(() => getPglite()), type: "postgres" as const };

/** Session token cookie name — also read by the live-preview popup completion page. */
export const SESSION_TOKEN_COOKIE = "__Host-grok-auth.session_token";

export const auth = betterAuth({
  baseURL,
  // Deployed apps inject BETTER_AUTH_SECRET. Preview: process-stable secret on
  // globalThis so HMR doesn't invalidate PGLite-backed sessions (see above).
  secret: configuredAuthSecret ?? previewAuthSecret(),
  database,
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 300,
  },

  // Better Auth disables its limiter outside production unless enabled
  // explicitly. Keep credential endpoints protected in previews too, with
  // tighter limits than the framework-wide default.
  rateLimit: {
    enabled: true,
    window: 10,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 3 },
      "/request-password-reset": { window: 300, max: 3 },
    },
  },

  // CSRF / origin check for credentialed auth POSTs (email sign-up/sign-in, …).
  // See `trustedOrigins` construction above — must cover live preview hosts AND
  // local loopback variants, or clients get "Invalid origin".
  trustedOrigins,

  // A previously provisioned company user may link the Google identity with the
  // same email. New accounts are still constrained by the user-create gate below.
  account: {
    encryptOAuthTokens: true,
    accountLinking: {
      enabled: true,
      trustedProviders: ["google", GATE_PROVIDER_ID],
      requireLocalEmailVerified: false,
    },
  },

  ...(googleOAuthConfigured ? {
    socialProviders: {
      google: {
        clientId: googleClientId!,
        clientSecret: googleClientSecret!,
        prompt: "select_account",
      },
    },
  } : {}),

  // Cache the session in the short-lived signed `session_data` cookie so reads
  // (incl. the client's `/get-session`) skip the DB — this shrinks the "loading"
  // window and reduces auth flicker. See the `auth` skill for the full
  // flicker-prevention guidance (gate on `isPending`; SSR the session).
  session: { cookieCache: { enabled: true, maxAge: 300 } },

  // Local email/password — toggled only via `./email-password` (not a plugin).
  ...(emailAndPasswordEnabled
    ? {
        emailAndPassword: {
          enabled: true,
          requireEmailVerification: true,
          resetPasswordTokenExpiresIn: 3600,
          // Only offered when email is configured (see getSetupState.emailEnabled).
          ...(emailConfigured()
            ? {
                sendResetPassword: async ({ user, url }: { user: { email: string; name?: string }; url: string }) => {
                  const sql = await getSql();
                  const rows = await sql<{ company_name: string | null; role: string | null }>`
                    select coalesce(o.display_name, o.name) as company_name, p.role
                    from profiles p left join organizations o on o.id = p.organization_id
                    where p.user_id = (select id from "user" where lower(email) = lower(${user.email}) limit 1)
                    limit 1`;
                  const companyName = rows[0]?.company_name;
                  const isCompanyAdmin = rows[0]?.role === "Admin";
                  const subject = companyName ? `Smart Hub access for ${companyName}` : "Reset your Smart Hub password";
                  const intro = companyName
                    ? `Your account has been created as ${isCompanyAdmin ? "an administrator" : "a team member"} for <strong>${escapeHtml(companyName)}</strong>. Use this secure link to choose your password and activate sign-in.`
                    : "Use this secure link to choose a new password.";
                  await sendEmail({
                    to: user.email,
                    subject,
                    html: `<p>Hello ${escapeHtml(user.name ?? "")},</p><p>${intro}</p><p>This secure link expires in one hour:</p><p><a href="${escapeHtml(url)}">Choose your password</a></p><p>After setting it, sign in at Smart Hub with this email address. If you did not expect this account, contact your company administrator.</p>`,
                    text: `Hello ${user.name ?? ""}. ${companyName ? `Your account has been created as ${isCompanyAdmin ? "an administrator" : "a team member"} for ${companyName}. ` : ""}Choose your password using this secure link (valid for one hour): ${url}. Then sign in to Smart Hub with this email address.`,
                  });
                },
              }
            : {}),
          // A password chosen through the reset link ends the temporary-password countdown.
          onPasswordReset: async ({ user }: { user: { id: string } }) => {
            const sql = await getSql();
            await sql`update profiles set password_temp_until = null where user_id = ${user.id}`;
          },
        },
      }
    : {}),

  // Self-registration is closed. Accounts are created by a company administrator or by the
  // platform owner (server code opts the email in via allowNewUser). The only open door is the
  // very first account of a fresh installation, which becomes its administrator.
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (isNewUserAllowed(user.email)) return;
          const sql = await getSql();
          const rows = await sql<{ c: number }>`select count(*)::int as c from "user"`;
          if ((rows[0]?.c ?? 0) === 0 && isInitialAdminEmail(user.email)) return;
          return false;
        },
      },
    },
    account: {
      create: {
        before: async (account) => {
          if (account.providerId !== "google") return;
          const sql = await getSql();
          const profiles = await sql<{ is_platform_admin: boolean | null }>`
            select is_platform_admin from profiles where user_id = ${account.userId}`;
          // OAuth may only be linked to an already provisioned platform admin.
          // A fresh system's first administrator must use email + OTP.
          if (!Boolean(profiles[0]?.is_platform_admin)) return false;
        },
      },
    },
  },

  // `__Host-` prefixed cookies: the browser REFUSES any same-named cookie that
  // carries a `Domain` attribute, so a sibling `*.grok.me` app cannot "toss" a
  // `Domain=.grok.me` session cookie onto this app. `__Host-` requires Secure +
  // Path=/ + no Domain; Better Auth otherwise uses `__Secure-` (which permits
  // Domain), so we drop its auto prefix (`useSecureCookies: false`) and set
  // Secure + the names ourselves. (Browsers allow Secure cookies on
  // `http://localhost`, so local dev still works.)
  advanced: {
    useSecureCookies: false,
    defaultCookieAttributes: { secure: true, sameSite: "lax", path: "/" },
    cookies: {
      session_token: { name: SESSION_TOKEN_COOKIE },
      session_data: { name: "__Host-grok-auth.session_data" },
      account_data: { name: "__Host-grok-auth.account_data" },
      dont_remember: { name: "__Host-grok-auth.dont_remember" },
    },
  },

  plugins: [
    emailOTP({
      overrideDefaultEmailVerification: true,
      sendVerificationOTP: async ({ email, otp, type }) => {
        const purpose = type === "email-verification" ? "verify your Smart Hub email" : "complete your Smart Hub sign-in";
        await sendEmail({
          to: email,
          subject: "Your Smart Hub verification code",
          html: `<p>Use this one-time code to ${purpose}:</p><p style="font-size:24px;font-weight:700;letter-spacing:0.2em">${escapeHtml(otp)}</p><p>It expires in five minutes. If you did not request it, ignore this email.</p>`,
          text: `Your Smart Hub verification code is ${otp}. It expires in five minutes. If you did not request it, ignore this email.`,
        });
      },
      expiresIn: 300,
      allowedAttempts: 3,
      storeOTP: "hashed",
      disableSignUp: true,
    }),
    gateIdentitySessions(),

    // Accept `Authorization: Bearer <session-token>` as an alternative to the
    // cookie. Needed for the LIVE PREVIEW: the app runs in an embedded iframe
    // where cookies are partitioned, so after popup sign-in it authenticates with
    // a bearer token instead (see `client.ts` / the `auth` skill). The hook only
    // fires when an Authorization header is present, so the cookie path
    // (deployed apps) is unaffected.
    bearer(),

    // Bridges Better Auth's Set-Cookie into TanStack Start responses. MUST be
    // last so it runs after every other plugin's hooks.
    tanstackStartCookies(),
  ],
});

export function readSessionToken(): string | null {
  return getCookie(SESSION_TOKEN_COOKIE) ?? null;
}

