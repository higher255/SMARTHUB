/**
 * Shared server-side helpers: profile loading, tenant scoping, notifications, audit.
 * Only imported by server functions (their handlers are stripped from the browser bundle).
 */
import { getSql, sqlFragment, type SqlFragment } from "@/lib/db.server";
import { isEhsRole, type EhsRole } from "./roles";
import { can, permissionsOf, type Permission } from "./access";
import { emailConfigured, sendEmail } from "./email";

export type Sql = Awaited<ReturnType<typeof getSql>>;

export type Profile = {
  userId: string;
  fullName: string;
  role: EhsRole;
  department: string;
  organizationId: string | null;
  clientAccountId: string | null;
  /** Extra permissions granted on top of the role's defaults. */
  permissions: string[];
  status: string;
  isPlatformAdmin: boolean;
  organizationName: string | null;
};

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

/** Ids are interpolated into SQL fragments below; refuse anything that is not a plain id. */
export function assertSafeId(id: string): string {
  if (!SAFE_ID.test(id)) throw new Error("Invalid identifier");
  return id;
}

export function getUserFullName(profile: Profile | null): string {
  return profile?.fullName || "Unknown User";
}

export async function loadProfile(userId: string): Promise<Profile | null> {
  const sql = await getSql();
  const rows = await sql<{
    user_id: string;
    full_name: string;
    role: string;
    department: string;
    organization_id: string | null;
    client_account_id: string | null;
    permissions: string[] | null;
    status: string | null;
    is_platform_admin: boolean | null;
    org_name: string | null;
    org_status: string | null;
  }>`select p.user_id, p.full_name, p.role, p.department, p.organization_id, p.client_account_id,
            p.permissions, p.status, p.is_platform_admin, coalesce(o.display_name, o.name) as org_name, o.status as org_status
       from profiles p
       left join organizations o on o.id = p.organization_id
      where p.user_id = ${userId}`;
  const row = rows[0];
  if (!row) return null;
  const userStatus = row.status ?? "active";
  const status = userStatus !== "active" ? userStatus : row.org_status === "suspended" ? "company_suspended" : "active";
  const active = status === "active";
  return {
    userId: row.user_id,
    fullName: row.full_name,
    role: isEhsRole(row.role) ? row.role : "Employee",
    department: row.department || "Operations",
    organizationId: row.organization_id,
    clientAccountId: row.client_account_id,
    permissions: active ? (row.permissions ?? []) : [],
    status,
    isPlatformAdmin: active && Boolean(row.is_platform_admin),
    organizationName: row.org_name,
  };
}

/** Profile of an active user that belongs to a company; throws otherwise. */
export async function requireProfile(userId: string): Promise<Profile & { organizationId: string }> {
  const profile = await loadProfile(userId);
  if (!profile) throw new Error("Profile not found");
  if (profile.status !== "active") throw new Error("This account is suspended");
  if (!profile.organizationId) throw new Error("This account is not linked to a company");
  return profile as Profile & { organizationId: string };
}

export async function requirePermission(userId: string, permission: Permission, message?: string) {
  const profile = await requireProfile(userId);
  if (!can(profile, permission)) throw new Error(message ?? "You do not have permission to do this");
  return profile;
}

export async function requirePlatformAdmin(userId: string): Promise<Profile> {
  const profile = await loadProfile(userId);
  if (!profile?.isPlatformAdmin) throw new Error("Only the platform owner can manage companies");
  return profile;
}

/** EHS administration (company Admin and EHS Administrator by default). */
export function isEhsAdmin(profile: Profile | null): boolean {
  return Boolean(profile) && can(profile, "ehs.manage");
}

/**
 * Row filter for tables that carry organization_id AND user_id.
 * People holding `permission` see the whole company; everyone else sees only their own rows.
 * The tenant is always taken from the verified profile, never from the client.
 */
export function getOrgWhereClause(
  profile: Profile | null,
  userId: string,
  permission: Permission = "data.view_org",
): { clause: SqlFragment; orgId: string | null } {
  if (profile?.organizationId && can(profile, permission)) {
    return { clause: sqlFragment(`organization_id = '${assertSafeId(profile.organizationId)}'`), orgId: profile.organizationId };
  }
  const uid = assertSafeId(userId);
  if (profile?.organizationId) {
    return { clause: sqlFragment(`(organization_id = '${assertSafeId(profile.organizationId)}' and user_id = '${uid}')`), orgId: null };
  }
  return { clause: sqlFragment(`user_id = '${uid}'`), orgId: null };
}

/** Tenant filter only, for tables without user_id (invoices, ledger, ...). */
export function orgClause(profile: { organizationId: string | null }): SqlFragment {
  if (!profile.organizationId) throw new Error("This account is not linked to a company");
  return sqlFragment(`organization_id = '${assertSafeId(profile.organizationId)}'`);
}

export async function executeQuery(sql: Sql, query: string, values: unknown[]): Promise<void> {
  await sql.query(query, values);
}

/** User ids in a company whose effective permissions include `permission`. */
export async function usersWithPermission(sql: Sql, organizationId: string, permission: Permission): Promise<string[]> {
  const rows = await sql<{ user_id: string; role: string; permissions: string[] | null; status: string | null; is_platform_admin: boolean | null }>`
    select user_id, role, permissions, status, is_platform_admin from profiles where organization_id = ${organizationId}`;
  return rows
    .filter((r) => permissionsOf({ role: r.role, permissions: r.permissions, status: r.status ?? "active", isPlatformAdmin: false }).has(permission))
    .map((r) => r.user_id);
}

export type NotifyInput = {
  organizationId: string | null;
  userIds: string[];
  title: string;
  message: string;
  type?: string;
  link?: string;
  entityType?: string;
  entityId?: string | number;
};

/** Deliver the same notification to the in-app bell and each intended user's email. */
export async function notify(sql: Sql, n: NotifyInput): Promise<void> {
  const ids = [...new Set(n.userIds)].filter(Boolean);
  if (ids.length === 0) return;
  try {
    await sql`insert into notifications (user_id, organization_id, title, message, type, link, entity_type, entity_id)
      select u, ${n.organizationId}, ${n.title}, ${n.message}, ${n.type ?? "info"}, ${n.link ?? null}, ${n.entityType ?? null}, ${n.entityId == null ? null : String(n.entityId)}
      from unnest(${ids}::text[]) as u`;
    if (emailConfigured()) {
      const recipients = await sql<{ email: string }>`select distinct lower(u.email) as email from "user" u
        join profiles p on p.user_id = u.id
        where p.user_id = any(${ids}::text[]) and p.status = 'active' and u.email <> ''
          and ((${n.organizationId}::text is null and p.organization_id is null)
            or p.organization_id::text = ${n.organizationId})`;
      const safe = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
      const origin = process.env.APP_URL || process.env.BETTER_AUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
      const href = n.link && origin ? `${origin.replace(/\/$/, "")}${n.link.startsWith("/") ? n.link : `/${n.link}`}` : "";
      const results = await Promise.allSettled(recipients.map(({ email }) => sendEmail({
        to: email,
        subject: n.title.slice(0, 180),
        text: `${n.title}\n\n${n.message}${href ? `\n\nOpen: ${href}` : ""}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#17212b"><h2>${safe(n.title)}</h2><p>${safe(n.message).replace(/\n/g, "<br>")}</p>${href ? `<p><a href="${safe(href)}">Open in Smart Hub</a></p>` : ""}<hr><small>Smart Hub notification</small></div>`,
      })));
      if (results.some((result) => result.status === "rejected")) console.error("[notify] one or more email deliveries failed");
    }
  } catch (error) {
    console.error("[notify] delivery failed");
  }
}

export async function audit(
  sql: Sql,
  organizationId: string | null,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string | number | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await sql`insert into audit_log (organization_id, actor_id, action, entity_type, entity_id, metadata)
      values (${organizationId}, ${actorId}, ${action}, ${entityType}, ${entityId == null ? null : String(entityId)}, ${JSON.stringify(metadata)}::jsonb)`;
  } catch (error) {
    console.error("[audit] failed", error);
  }
}
