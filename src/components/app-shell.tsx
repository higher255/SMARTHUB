import { useState } from "react";
import { authEnabled, signOut } from "@/lib/auth/client";
import { PageBackground } from "@/components/page-background";
import type { EhsRole } from "@/lib/ehs/roles";
import { LogOut } from "lucide-react";
import type { ReactNode } from "react";

export function AppShell({
  title,
  subtitle,
  coverImage,
  children,
}: {
  title: string;
  subtitle: string;
  coverImage?: string | null;
  /** Kept for compatibility with older pages; the workspace bar now shows the role. */
  role?: EhsRole;
  children: ReactNode;
}) {
  return (
    <div className="relative min-h-[calc(100vh-3.5rem)] text-fg">
      <PageBackground variant="subtle" />
      <main className="relative z-10 mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className={`relative isolate mb-8 min-h-36 overflow-hidden rounded-2xl border border-border px-5 py-6 stagger-in sm:px-8 sm:py-8 ${coverImage !== undefined ? "bg-bg-elevated" : "border-transparent bg-transparent px-0 py-0"}`}>
          {coverImage !== undefined ? <><img src={coverImage || "/hero.jpg"} alt="" aria-hidden="true" className="absolute inset-0 -z-10 size-full object-cover opacity-[0.18]" onError={(e) => { e.currentTarget.style.display = "none"; }} /><div className="absolute inset-0 -z-10 bg-gradient-to-r from-bg-elevated/95 via-bg-elevated/80 to-bg-elevated/45" /></> : null}
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm text-fg-muted sm:text-base">{subtitle}</p>
        </div>
        {children}
      </main>
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-elevated p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">{label}</p>
      <p className="mt-2 font-semibold tabular-nums text-3xl tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-fg-muted">{hint}</p> : null}
    </div>
  );
}

export function Panel({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border bg-bg-elevated p-5 ${className}`}>
      <h2 className="mb-4 text-sm font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-fg-subtle">
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * Standalone sign-out icon button — used in page headers alongside
 * <ThemeToggle /> where the full <UserButton /> identity chip isn't shown.
 * Mirrors the same signOut() flow as <UserButton />.
 */
export function LogoutButton() {
  const [signingOut, setSigningOut] = useState(false);
  if (!authEnabled) return null;
  return (
    <button
      type="button"
      disabled={signingOut}
      onClick={() => {
        setSigningOut(true);
        void signOut().catch(() => setSigningOut(false));
      }}
      title="Sign out"
      aria-label="Sign out"
      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-2 text-sm text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg disabled:cursor-wait disabled:opacity-60"
    >
      <LogOut className="size-4" strokeWidth={2} />
      <span className="hidden sm:inline">{signingOut ? "Signing out…" : "Sign out"}</span>
    </button>
  );
}

export const inputClass =
  "w-full rounded-md border border-border-strong bg-bg px-3 py-2.5 text-sm text-fg placeholder:text-fg-subtle outline-none transition-[border-color,box-shadow] duration-150 focus:border-accent-bright focus:ring-2 focus:ring-accent/30";

export const primaryBtn =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg transition-[transform,background-color] duration-150 hover:bg-accent-bright active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-60";

export const ghostBtn =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border-strong bg-transparent px-4 py-2.5 text-sm font-medium text-fg transition-colors duration-150 hover:bg-bg-subtle";
