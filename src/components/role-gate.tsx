import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";
import { LogOut, ShieldAlert } from "lucide-react";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { authEnabled, signOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { ensureMyProfile, type Profile } from "@/lib/ehs/server";
import { canAccessPath, homePath } from "@/lib/ehs/access";
import { PlatformShell, TenantShell } from "@/components/workspace-bar";

function Blocked({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-bg px-6 text-fg">
      <div className="max-w-md text-center">
        <span className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-warn/15 text-warn"><ShieldAlert className="size-6" /></span>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-fg-muted">{body}</p>
        {authEnabled ? (
          <button type="button" onClick={() => void signOut()} className="mt-5 inline-flex items-center gap-2 rounded-md border border-border-strong px-4 py-2 text-sm font-medium hover:bg-bg-subtle">
            <LogOut className="size-4" /> Sign out
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function RoleGate({ path, children }: { path: string; children: (profile: Profile) => ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (isPending) return;
    if (!user) { setReady(true); return; }
    let cancelled = false;
    ensureMyProfile({ data: { fullName: user.displayName ?? user.primaryEmail ?? undefined } })
      .then((p) => { if (!cancelled) setProfile(p); })
      .catch((e: unknown) => { if (!cancelled) setProblem(e instanceof Error ? e.message : "Your account could not be loaded."); })
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [isPending, user]);

  if (isPending || !ready) {
    return <div className="grid min-h-screen place-items-center bg-bg text-fg-muted"><p className="text-sm">Loading workspace…</p></div>;
  }
  if (!user) return <RedirectToSignIn />;
  if (problem === "Unauthorized") {
    return <Blocked
      title="Your sign-in session could not be verified"
      body="Sign out and sign in again. If this keeps happening, ask your administrator to check the production sign-in URL and authentication settings."
    />;
  }
  if (problem || !profile) return <Blocked title="Your account is not set up" body={problem ?? "Ask your administrator to add you to the company."} />;
  if (profile.status === "suspended") return <Blocked title="Account suspended" body="Your access has been suspended. Contact your company administrator." />;
  if (profile.status === "company_suspended") return <Blocked title="Company suspended" body="Access for this company is paused. Contact the Smart Hub owner." />;

  if (!canAccessPath(profile, path)) {
    const home = homePath(profile);
    if (home !== path && canAccessPath(profile, home)) return <Navigate to={home} />;
    if (path !== "/dashboard" && canAccessPath(profile, "/dashboard")) return <Navigate to="/dashboard" />;
    return <Blocked title="No access" body="Your role does not include this workspace." />;
  }
  const Shell = profile.isPlatformAdmin ? PlatformShell : TenantShell;
  return <Shell profile={profile}>{children(profile)}</Shell>;
}
