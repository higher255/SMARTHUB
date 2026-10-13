import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { PageBackground } from "@/components/page-background";
import { ThemeToggle } from "@/components/theme-provider";
import { Field, inputClass, primaryBtn } from "@/components/app-shell";
import { Notice } from "@/components/ui-kit";

export const Route = createFileRoute("/reset-password")({ component: ResetPassword });

function ResetPassword() {
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get("token"));
    if (params.get("error")) setMsg("This reset link is invalid or has expired. Ask for a new one from the sign-in page.");
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setMsg("Please use at least 8 characters");
    if (password !== again) return setMsg("Please make sure the two passwords match");
    if (!token) return setMsg("This reset link is invalid. Ask for a new one from the sign-in page.");
    setBusy(true); setMsg("");
    try {
      const { error } = await authClient.resetPassword({ newPassword: password, token });
      if (error) throw new Error(error.message || "This reset link is invalid or has expired");
      setDone(true);
      setTimeout(() => void navigate({ to: "/login" }), 1800);
    } catch (x) { setMsg(x instanceof Error ? x.message : "Could not reset the password"); } finally { setBusy(false); }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <PageBackground />
      <div className="absolute right-4 top-4 z-20"><ThemeToggle /></div>
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-bg-elevated p-7 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-xl bg-accent text-accent-fg"><KeyRound className="size-7" /></div>
          <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
        </div>
        <Notice msg={msg} tone="danger" />
        {done ? <Notice msg="Password changed. Taking you to sign in…" tone="ok" /> : (
          <form onSubmit={submit} className="space-y-3.5">
            <Field label="New password">
              <div className="relative">
                <input type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} className={`${inputClass} pr-11`} autoComplete="new-password" />
                <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-fg-muted hover:bg-bg-subtle">{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
              </div>
            </Field>
            <Field label="Repeat new password"><input type={show ? "text" : "password"} value={again} onChange={(e) => setAgain(e.target.value)} className={inputClass} autoComplete="new-password" /></Field>
            <button type="submit" disabled={busy} className={primaryBtn}>{busy ? "Saving…" : "Save new password"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
