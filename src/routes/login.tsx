import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Eye, EyeOff, LoaderCircle, MailCheck, Shield } from "lucide-react";
import { authClient, signOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { ensureMyProfile, getSetupState } from "@/lib/ehs/server";
import { ThemeToggle } from "@/components/theme-provider";
import { PageBackground } from "@/components/page-background";
import { homePath } from "@/lib/ehs/access";
import { Field, inputClass, primaryBtn } from "@/components/app-shell";
import { Notice } from "@/components/ui-kit";

export const Route = createFileRoute("/login")({ component: LoginPage });

export function LoginPage() {
  const navigate = useNavigate();
  const { user, isPending } = useCurrentUserState();
  const [needsSetup, setNeedsSetup] = useState(false);
  const [verificationPending, setVerificationPending] = useState(false);
  const [verificationSuccess, setVerificationSuccess] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpNotice, setOtpNotice] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  // One attempt per signed-in user, so a failure shows its message instead of retrying forever.
  const attemptedFor = useRef<string | null>(null);

  useEffect(() => {
    getSetupState().then((s) => { setNeedsSetup(s.needsSetup); setEmailEnabled(s.emailEnabled); }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (isPending || !user || attemptedFor.current === user.id) return;
    attemptedFor.current = user.id;
    setOpening(true);
    void (async () => {
      try {
        const profile = await ensureMyProfile({ data: { fullName: user.displayName ?? undefined } });
        await navigate({ to: homePath(profile) });
      } catch (err) {
        setOpening(false);
        setErrorMsg(err instanceof Error ? err.message : "Your account could not be loaded.");
      }
    })();
  }, [isPending, user, navigate]);

  const handleAuth = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");
    try {
      if (forgot) {
        const { error } = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: `${window.location.origin}/reset-password` });
        if (error) throw new Error(error.message || "Could not send the email");
        setSent(true);
        return;
      }
      if (needsSetup) {
        if (verificationPending) {
          const { error } = await authClient.emailOtp.verifyEmail({ email: email.trim(), otp: otp.trim() });
          if (error) throw new Error(error.message || "That verification code is invalid or expired");
          setVerificationSuccess(true);
          return;
        }
        const { error } = await authClient.signUp.email({ email: email.trim(), password, name: fullName.trim() || email.split("@")[0] });
        if (error) throw new Error(error.message);
        setVerificationPending(true);
        setOtpNotice(`A 6-digit code was sent to ${email.trim()}. It expires in 5 minutes.`);
      } else {
        const { error } = await authClient.signIn.email({ email: email.trim(), password });
        if (error) throw new Error(error.message || "Wrong email or password");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const resendVerificationCode = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const { error } = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: "email-verification" });
      if (error) throw new Error(error.message || "Could not send a new code");
      setOtpNotice(`A new code was sent to ${email.trim()}. It expires in 5 minutes.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not send a new code");
    } finally {
      setLoading(false);
    }
  };

  const continueAfterVerification = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const { error } = await authClient.signIn.email({ email: email.trim(), password });
      if (error) throw new Error(error.message || "Email verified. Sign in with your new password to continue.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Email verified. Sign in to continue.");
      setVerificationSuccess(false);
      setVerificationPending(false);
    } finally {
      setLoading(false);
    }
  };

  const stuck = Boolean(user) && !opening && Boolean(errorMsg);

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <PageBackground />
      <div className="absolute right-4 top-4 z-20 sm:right-6 sm:top-6"><ThemeToggle /></div>

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-bg-elevated p-7 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-xl bg-accent text-accent-fg shadow-[0_8px_24px_rgba(15,118,110,0.35)]">
            <Shield className="size-7" strokeWidth={2} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Smart Hub</h1>
          <p className="mt-1 text-sm text-fg-muted">{needsSetup ? "Create the administrator account for this installation" : "Sign in to your company workspace"}</p>
        </div>

        <Notice msg={errorMsg} tone="danger" />
        {opening && !errorMsg ? <Notice msg="Opening your workspace…" tone="info" /> : null}
        {needsSetup && !emailEnabled ? <Notice msg="Administrator setup needs email delivery for the verification code. Ask your administrator to finish email setup before creating the account." tone="warn" /> : null}

        {verificationSuccess ? (
          <section className="otp-step-enter space-y-5 text-center" aria-live="polite">
            <div className="mx-auto grid size-20 place-items-center rounded-full border border-emerald-400/30 bg-emerald-400/10 text-emerald-300 shadow-[0_0_48px_rgba(52,211,153,0.16)]">
              <span className="otp-success-mark grid size-12 place-items-center rounded-full bg-emerald-400 text-slate-950">
                <Check className="size-7" strokeWidth={3} />
              </span>
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold">Email verified</h2>
              <p className="text-sm text-fg-muted">Your administrator account is ready. We’re opening your workspace.</p>
            </div>
            <button type="button" onClick={() => void continueAfterVerification()} disabled={loading} className={primaryBtn}>
              {loading ? <><LoaderCircle className="mr-2 inline size-4 animate-spin" />Signing in…</> : "Continue to Smart Hub"}
            </button>
          </section>
        ) : verificationPending ? (
          <form onSubmit={handleAuth} className="otp-step-enter space-y-4">
            <Notice msg={otpNotice} tone="info" />
            <div className="rounded-xl border border-border bg-bg/60 p-4 text-center">
              <div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-accent/15 text-accent-bright"><MailCheck className="size-5" /></div>
              <p className="text-sm text-fg-muted">Enter the 6-digit code sent to <span className="font-medium text-fg">{email.trim()}</span> to verify your administrator account.</p>
              <div className="mt-3 flex items-center justify-center gap-1.5" aria-label="Verification step 2 of 2">
                <span className="h-1 w-8 rounded-full bg-accent-bright" /><span className="h-1 w-8 rounded-full bg-accent-bright" />
                <span className="ml-1 text-xs text-fg-subtle">Step 2 of 2</span>
              </div>
            </div>
            <Field label="6-digit verification code"><input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} className={`${inputClass} text-center text-2xl font-semibold tracking-[0.55em] transition focus:scale-[1.01]`} /></Field>
            <button type="submit" disabled={loading || opening || otp.length !== 6} className={primaryBtn}>
              {loading ? <><LoaderCircle className="mr-2 inline size-4 animate-spin" />Checking code…</> : "Verify email"}
            </button>
            <button type="button" disabled={loading} onClick={() => void resendVerificationCode()} className="w-full text-center text-sm text-accent hover:underline disabled:opacity-60">Resend code</button>
          </form>
        ) : forgot ? (
          sent ? (
            <div className="space-y-4 text-center">
              <Notice msg="If that email has an account, a reset link is on its way. It works for one hour." tone="ok" />
              <button type="button" className={primaryBtn} onClick={() => { setForgot(false); setSent(false); }}>Back to sign in</button>
            </div>
          ) : (
            <form onSubmit={handleAuth} className="space-y-3.5">
              <p className="text-sm text-fg-muted">Enter your email and we will send you a link to choose a new password.</p>
              <Field label="Email"><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} autoComplete="email" /></Field>
              <button type="submit" disabled={loading} className={primaryBtn}>{loading ? "Sending…" : "Send reset link"}</button>
              <button type="button" onClick={() => setForgot(false)} className="w-full text-center text-sm text-fg-muted hover:text-fg">Back to sign in</button>
            </form>
          )
        ) : stuck ? (
          <button type="button" className={primaryBtn} onClick={() => { attemptedFor.current = null; void signOut(); }}>
            Sign out and try another account
          </button>
        ) : (
          <form onSubmit={handleAuth} className="space-y-3.5">
            {needsSetup ? (
              <Field label="Full name"><input required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Amina Juma" className={inputClass} autoComplete="name" /></Field>
            ) : null}
            <Field label="Email"><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className={inputClass} autoComplete="email" /></Field>
            <Field label="Password">
              <div className="relative">
                <input type={showPassword ? "text" : "password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" className={`${inputClass} pr-11`} autoComplete={needsSetup ? "new-password" : "current-password"} />
                <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-fg-muted hover:bg-bg-subtle hover:text-fg">
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>
            <button type="submit" disabled={loading || opening || (needsSetup && !emailEnabled)} className={primaryBtn}>
              {loading ? "Signing in…" : opening ? "Opening workspace…" : needsSetup && !emailEnabled ? "Email verification unavailable" : needsSetup ? "Create administrator" : "Sign in"}
            </button>
            {!needsSetup && emailEnabled ? <button type="button" onClick={() => { setForgot(true); setErrorMsg(""); }} className="w-full text-center text-sm text-accent hover:underline">Forgot your password?</button> : null}
          </form>
        )}

        <p className="mt-5 text-center text-xs text-fg-subtle">
          {needsSetup ? "This account becomes the administrator. Add everyone else from Administration." : "Accounts are created by your company administrator. Forgot your password? Ask your administrator to set a new one."}
        </p>
      </div>
    </div>
  );
}
