import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Shield, Gauge, KanbanSquare, Wallet, Users, Truck, Briefcase, HardHat, LayoutDashboard, Globe, LogOut, Menu, X, AlertTriangle, BookOpen,
  Activity, Car, FileWarning, Award, ShieldCheck, Bell, BarChart3, Settings, Receipt, Landmark, FileText,
  FolderOpen, CalendarDays, ClipboardList,
  type LucideIcon,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-provider";
import { NotificationBell } from "@/components/notification-bell";
import { signOut, authEnabled } from "@/lib/auth/client";
import { can, workspacesFor, type IconName, type Workspace, type WorkspaceGroup } from "@/lib/ehs/access";
import { ROLE_LABELS, type EhsRole } from "@/lib/ehs/roles";
import { getOrgBrand, type OrgBrand, type Profile } from "@/lib/ehs/server";
import { formatDate } from "@/lib/ui/format";
import { DailyFlowBanner } from "@/components/daily/daily";

const ICONS: Record<IconName, LucideIcon> = {
  shield: Shield, gauge: Gauge, kanban: KanbanSquare, wallet: Wallet, users: Users, truck: Truck, briefcase: Briefcase,
  hardhat: HardHat, building: Briefcase, layout: LayoutDashboard, globe: Globe,
};
const GROUP_ORDER: WorkspaceGroup[] = ["Daily", "Operations", "Money", "Safety", "People", "Company"];
const EHS_MODULES = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "fleet", label: "Fleet Management", icon: Car },
  { id: "journeys", label: "Journey management (JMP)", icon: Globe },
  { id: "ptw", label: "PTW Approvals", icon: FileWarning },
  { id: "training", label: "Training & competence", icon: Award },
  { id: "money", label: "Money requests", icon: Wallet, permission: "finance.request" as const },
  { id: "hse", label: "Observations & wellbeing", icon: ShieldCheck },
  { id: "health", label: "Health declarations", icon: Activity },
  { id: "notices", label: "Notice board", icon: Bell },
  { id: "reports", label: "Reports & CAPA", icon: BarChart3 },
  { id: "users", label: "User Management", icon: Users, adminOnly: true },
  { id: "settings", label: "Settings", icon: Settings, adminOnly: true },
] as const;
const EHS_SAFETY_MODULES = [
  { id: "kpis", label: "Safety KPIs", icon: Gauge },
  { id: "observations", label: "Observations", icon: ShieldCheck },
  { id: "ncr", label: "NCRs", icon: FileWarning },
  { id: "hira", label: "Risk assessments", icon: Activity },
  { id: "subs", label: "Subcontractors", icon: Users, permission: "subcontractors.manage" as const },
] as const;

let brandCache: OrgBrand | null = null;

/** Company logo/name for the signed-in tenant. Cached for the session. */
export function useOrgBrand(): OrgBrand | null {
  const [brand, setBrand] = useState<OrgBrand | null>(brandCache);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      if (!live) return;
      if (brandCache) { setBrand(brandCache); return; }
      getOrgBrand().then((b) => { brandCache = b; if (live) setBrand(b); }).catch(() => undefined);
    };
    refresh();
    window.addEventListener("smarthub:org-brand-changed", refresh);
    return () => { live = false; window.removeEventListener("smarthub:org-brand-changed", refresh); };
  }, []);
  return brand;
}

export function invalidateOrgBrand() {
  brandCache = null;
  if (typeof window !== "undefined") window.dispatchEvent(new Event("smarthub:org-brand-changed"));
}

function SignOutButton({ compact = false }: { compact?: boolean }) {
  const [leaving, setLeaving] = useState(false);
  if (!authEnabled) return null;
  return (
    <button
      type="button"
      disabled={leaving}
      onClick={() => { setLeaving(true); invalidateOrgBrand(); void signOut().catch(() => setLeaving(false)); }}
      aria-label="Sign out"
      className={`inline-flex items-center gap-2 rounded-lg border border-border text-sm font-medium text-fg-muted transition hover:bg-bg-subtle hover:text-fg disabled:opacity-60 ${compact ? "size-9 justify-center" : "w-full justify-center px-3 py-2"}`}
    >
      <LogOut className="size-4" /> {compact ? null : "Sign out"}
    </button>
  );
}

function Brand({ brand, fallback }: { brand: OrgBrand | null; fallback: string }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      {brand?.logoUrl ? (
        <img src={brand.logoUrl} alt="" className="size-9 rounded-lg object-contain" />
      ) : (
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-fg" style={brand?.primaryColor ? { background: brand.primaryColor } : undefined}>
          <Shield className="size-[18px]" strokeWidth={2.2} />
        </span>
      )}
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-sm font-semibold text-fg">{brand?.displayName ?? fallback}</span>
        <span className="block text-[11px] text-fg-subtle">Powered by Smart Hub</span>
      </span>
    </span>
  );
}

function NavList({ spaces, pathname, onNavigate }: { spaces: Workspace[]; pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Workspaces" className="space-y-5">
      {GROUP_ORDER.map((g) => {
        const items = spaces.filter((w) => w.group === g);
        if (items.length === 0) return null;
        return (
          <div key={g}>
            <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{g}</p>
            <ul className="space-y-0.5">
              {items.map((w) => {
                const Icon = ICONS[w.icon];
                const active = pathname === w.path || pathname.startsWith(`${w.path}/`);
                return (
                  <li key={w.path}>
                    <Link
                      to={w.path}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${active ? "bg-accent/10 font-semibold text-accent" : "font-medium text-fg-muted hover:bg-bg-subtle hover:text-fg"}`}
                    >
                      <Icon className="size-[18px] shrink-0" /> {w.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function EhsModuleNav({ profile, pathname, onNavigate }: { profile: Profile; pathname: string; onNavigate?: () => void }) {
  const search = useRouterState({ select: (s) => s.location.search as { tab?: string; safety?: string } });
  const activeTab = search.tab ?? "overview";
  if (pathname !== "/ehs") return null;
  const modules = EHS_MODULES.filter((item) =>
    (!("permission" in item) || can(profile, item.permission)) && (!("adminOnly" in item) || profile.role === "Admin"),
  );
  return (
    <div className="ml-5 mt-1 space-y-0.5 border-l border-border pl-2" aria-label="EHS workspace">
      {modules.map((item) => {
        const Icon = item.icon;
        const active = activeTab === item.id;
        return (
          <Link
            key={item.id}
            to="/ehs"
            search={{ tab: item.id }}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 text-xs transition ${active ? "bg-accent/10 font-semibold text-accent" : "font-medium text-fg-muted hover:bg-bg-subtle hover:text-fg"}`}
          >
            <Icon className="size-4 shrink-0" />
            <span className="min-w-0">{item.label}</span>
          </Link>
        );
      })}
      {activeTab === "hse" ? <div className="ml-4 mt-1 space-y-0.5 border-l border-border pl-2" aria-label="Safety workspace">
        {EHS_SAFETY_MODULES.filter((item) => !("permission" in item) || can(profile, item.permission)).map((item) => {
          const Icon = item.icon;
          const active = (search.safety ?? "kpis") === item.id;
          return <Link key={item.id} to="/ehs" search={{ tab: "hse", safety: item.id }} onClick={onNavigate} aria-current={active ? "page" : undefined} className={`flex min-h-8 items-center gap-2 rounded-md px-2 py-1 text-xs transition ${active ? "bg-accent/10 font-semibold text-accent" : "font-medium text-fg-muted hover:bg-bg-subtle hover:text-fg"}`}><Icon className="size-3.5 shrink-0" />{item.label}</Link>;
        })}
      </div> : null}
    </div>
  );
}

function FinanceModuleNav({ profile, pathname, onNavigate }: { profile: Profile; pathname: string; onNavigate?: () => void }) {
  const search = useRouterState({ select: (s) => s.location.search as { section?: string; ledger?: string } });
  if (pathname !== "/finance") return null;
  const selectedSection = search.section ?? (can(profile, "finance.view") ? "overview" : can(profile, "accounts.view") ? "accounting" : "requests");
  const sections = [
    ...(can(profile, "finance.view") ? [{ id: "overview" as const, label: "Overview", icon: Gauge }] : []),
    ...(can(profile, "finance.view") || can(profile, "finance.approve") || can(profile, "finance.pay") ? [{ id: "requests" as const, label: "Requests", icon: Wallet }] : []),
    ...(can(profile, "finance.view") ? [{ id: "budgets" as const, label: "Project budgets", icon: BarChart3 }] : []),
    ...(can(profile, "accounts.view") ? [{ id: "accounting" as const, label: "Accounting", icon: BookOpen }] : []),
  ];
  const ledgerSections = [
    { id: "invoices" as const, label: "Invoices", icon: Receipt },
    { id: "bills" as const, label: "Bills & Payables", icon: FileText },
    { id: "banking" as const, label: "Bank reconciliation", icon: Landmark },
    ...(can(profile, "accounts.reports") ? [{ id: "tax" as const, label: "VAT", icon: FileText }] : []),
    { id: "journal" as const, label: "Journal", icon: BookOpen },
    ...(can(profile, "accounts.reports") ? [{ id: "reports" as const, label: "Reports", icon: BarChart3 }] : []),
    { id: "accounts" as const, label: "Chart of accounts", icon: BookOpen },
    { id: "orders" as const, label: "Purchase orders", icon: FileText },
  ];
  return (
    <div className="mt-5 border-t border-border pt-4">
      <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Finance workspace</p>
      <nav aria-label="Finance sections" className="space-y-0.5">
        {sections.map((item) => {
          const Icon = item.icon;
          const active = selectedSection === item.id;
          return <Link key={item.id} to="/finance" search={{ section: item.id }} onClick={onNavigate} aria-current={active ? "page" : undefined} className={`flex min-h-9 items-center gap-2 rounded-md px-3 py-1.5 text-sm transition ${active ? "bg-accent/10 font-semibold text-accent" : "font-medium text-fg-muted hover:bg-bg-subtle hover:text-fg"}`}><Icon className="size-4 shrink-0" />{item.label}</Link>;
        })}
      </nav>
      {search.section === "accounting" ? <div className="ml-5 mt-1 space-y-0.5 border-l border-border pl-2" aria-label="Accounting sections">
        {ledgerSections.map((item) => {
          const Icon = item.icon;
          const active = (search.ledger ?? "invoices") === item.id;
          return <Link key={item.id} to="/finance" search={{ section: "accounting", ledger: item.id }} onClick={onNavigate} aria-current={active ? "page" : undefined} className={`flex min-h-8 items-center gap-2 rounded-md px-2 py-1 text-xs transition ${active ? "bg-accent/10 font-semibold text-accent" : "font-medium text-fg-muted hover:bg-bg-subtle hover:text-fg"}`}><Icon className="size-3.5 shrink-0" />{item.label}</Link>;
        })}
      </div> : null}
    </div>
  );
}

function ProjectManagerModuleNav({ profile, pathname, onNavigate }: { profile: Profile; pathname: string; onNavigate?: () => void }) {
  const section = useRouterState({ select: (s) => (s.location.search as { section?: string }).section ?? "projects" });
  if (pathname !== "/projectmanager" || !can(profile, "projects.manage")) return null;
  const items = [
    { id: "projects" as const, label: "Projects", icon: FolderOpen },
    { id: "tasks" as const, label: "Tasks & milestones", icon: KanbanSquare },
    { id: "reports" as const, label: "Reports", icon: BarChart3 },
    { id: "team" as const, label: "Team", icon: Users },
  ];
  return <ModuleNavGroup title="Project workspace" items={items} active={section} renderLink={(item, children, active) => <Link to="/projectmanager" search={{ section: item.id }} onClick={onNavigate} aria-current={active ? "page" : undefined} className={moduleLinkClass(active)}>{children}</Link>} />;
}

function HrModuleNav({ profile, pathname, onNavigate }: { profile: Profile; pathname: string; onNavigate?: () => void }) {
  const requestedSection = useRouterState({ select: (s) => (s.location.search as { section?: string }).section });
  if (pathname !== "/hr") return null;
  const section = requestedSection ?? (can(profile, "hr.manage") ? "people" : profile.role === "HR" ? "health" : can(profile, "leave.approve") ? "leave" : "attendance");
  const items = [
    ...(can(profile, "hr.manage") ? [{ id: "people" as const, label: "People & certificates", icon: Users }] : []),
    ...(profile.role === "HR" ? [{ id: "health" as const, label: "Health declarations", icon: Activity }] : []),
    ...(can(profile, "leave.approve") ? [{ id: "leave" as const, label: "Leave requests", icon: CalendarDays }] : []),
    ...(can(profile, "attendance.view") ? [{ id: "attendance" as const, label: "Attendance", icon: ClipboardList }] : []),
  ];
  return <ModuleNavGroup title="HR workspace" items={items} active={section} renderLink={(item, children, active) => <Link to="/hr" search={{ section: item.id }} onClick={onNavigate} aria-current={active ? "page" : undefined} className={moduleLinkClass(active)}>{children}</Link>} />;
}

function AdminModuleNav({ profile, pathname, onNavigate }: { profile: Profile; pathname: string; onNavigate?: () => void }) {
  const section = useRouterState({ select: (s) => (s.location.search as { section?: string }).section ?? "overview" });
  if (pathname !== "/admin" || profile.role !== "Admin") return null;
  const items = [
    { id: "overview" as const, label: "Overview", icon: Gauge },
    { id: "incidents" as const, label: "Incident register", icon: ShieldCheck },
    { id: "fleet" as const, label: "Fleet management", icon: Car },
    { id: "ptw" as const, label: "PTW approvals", icon: FileWarning },
    { id: "users" as const, label: "User management", icon: Users },
    { id: "reports" as const, label: "Reports & CAPA", icon: BarChart3 },
    { id: "company" as const, label: "Company", icon: Briefcase },
    { id: "settings" as const, label: "System settings", icon: Settings },
  ];
  return <ModuleNavGroup title="Admin workspace" items={items} active={section} renderLink={(item, children, active) => <Link to="/admin" search={{ section: item.id }} onClick={onNavigate} aria-current={active ? "page" : undefined} className={moduleLinkClass(active)}>{children}</Link>} />;
}

function ModuleNavGroup<T extends string>({
  title, items, active, renderLink,
}: {
  title: string;
  items: { id: T; label: string; icon: LucideIcon }[];
  active: string;
  renderLink: (item: { id: T; label: string; icon: LucideIcon }, children: ReactNode, active: boolean) => ReactNode;
}) {
  if (!items.length) return null;
  return <div className="mt-5 border-t border-border pt-4"><p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{title}</p><nav aria-label={title} className="space-y-0.5">{items.map((item) => { const Icon = item.icon; const selected = active === item.id; return <div key={item.id}>{renderLink(item, <><Icon className="size-4 shrink-0" />{item.label}</>, selected)}</div>; })}</nav></div>;
}

function moduleLinkClass(active: boolean) {
  return `flex min-h-9 items-center gap-2 rounded-md px-3 py-1.5 text-sm transition ${active ? "bg-accent/10 font-semibold text-accent" : "font-medium text-fg-muted hover:bg-bg-subtle hover:text-fg"}`;
}

function SubscriptionBanner({ profile, brand }: { profile: Profile; brand: OrgBrand | null }) {
  if (!brand?.paidUntil || !can(profile, "org.users")) return null;
  const days = Math.floor((new Date(brand.paidUntil).getTime() - Date.now()) / 86400000);
  if (days > 7) return null;
  return (
    <div role="status" className={`flex items-center gap-2 px-4 py-2 text-sm ${days < 0 ? "bg-danger/15 text-danger" : "bg-warn/15 text-warn"}`}>
      <AlertTriangle className="size-4 shrink-0" />
      {days < 0 ? `Your Smart Hub subscription ended on ${formatDate(brand.paidUntil)}. Contact Smart Hub to keep access.` : `Your Smart Hub subscription ends on ${formatDate(brand.paidUntil)}.`}
    </div>
  );
}

/** Layout for a company's people: sidebar of their workspaces, company branding, notifications. */
export function TenantShell({ profile, children }: { profile: Profile; children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const brand = useOrgBrand();
  const [open, setOpen] = useState(false);
  const ehsDepartment = /\behs\b|health\s*,?\s*safety/i.test(profile.department ?? "");
  const spaces = workspacesFor(profile).filter((workspace) => workspace.path !== "/hr" && !(ehsDepartment && workspace.path === "/projectmanager"));
  const roleLabel = ROLE_LABELS[profile.role as EhsRole] ?? profile.role;

  useEffect(() => setOpen(false), [pathname]);

  const userCard = (
    <div className="space-y-3">
      <div className="min-w-0 px-1">
        <p className="truncate text-sm font-semibold text-fg">{profile.fullName}</p>
        <p className="truncate text-xs text-fg-muted">{roleLabel}{profile.department ? ` · ${profile.department}` : ""}</p>
      </div>
      <SignOutButton />
    </div>
  );

  return (
    <div className="min-h-screen bg-bg text-fg lg:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r border-border bg-bg-elevated p-4 print:hidden lg:flex">
        <Link to="/" aria-label="Home"><Brand brand={brand} fallback={profile.organizationName ?? "Smart Hub"} /></Link>
        <div className="flex-1">
          <NavList spaces={spaces} pathname={pathname} />
          <EhsModuleNav profile={profile} pathname={pathname} />
          <FinanceModuleNav profile={profile} pathname={pathname} />
          <ProjectManagerModuleNav profile={profile} pathname={pathname} />
          <HrModuleNav profile={profile} pathname={pathname} />
          <AdminModuleNav profile={profile} pathname={pathname} />
        </div>
        {userCard}
      </aside>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden print:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-6 overflow-y-auto bg-bg-elevated p-4 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <Brand brand={brand} fallback={profile.organizationName ?? "Smart Hub"} />
              <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="rounded-md p-1.5 text-fg-muted hover:bg-bg-subtle"><X className="size-5" /></button>
            </div>
            <div className="flex-1">
              <NavList spaces={spaces} pathname={pathname} onNavigate={() => setOpen(false)} />
              <EhsModuleNav profile={profile} pathname={pathname} onNavigate={() => setOpen(false)} />
              <FinanceModuleNav profile={profile} pathname={pathname} onNavigate={() => setOpen(false)} />
              <ProjectManagerModuleNav profile={profile} pathname={pathname} onNavigate={() => setOpen(false)} />
              <HrModuleNav profile={profile} pathname={pathname} onNavigate={() => setOpen(false)} />
              <AdminModuleNav profile={profile} pathname={pathname} onNavigate={() => setOpen(false)} />
            </div>
            {userCard}
          </aside>
        </div>
      ) : null}

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-bg-elevated px-4 print:hidden sm:px-6">
          <button type="button" aria-label="Open menu" onClick={() => setOpen(true)} className="grid size-9 place-items-center rounded-lg border border-border text-fg-muted lg:hidden"><Menu className="size-5" /></button>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold lg:hidden">{brand?.displayName ?? profile.organizationName ?? "Smart Hub"}</p>
          <span className="hidden flex-1 lg:block" />
          <NotificationBell />
          <ThemeToggle />
        </header>
        <SubscriptionBanner profile={profile} brand={brand} />
        <DailyFlowBanner profile={profile} />
        {children}
      </div>
    </div>
  );
}

/** Layout for the platform owner (landlord): no company workspaces, only the platform console. */
export function PlatformShell({ profile, children }: { profile: Profile; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="sticky top-0 z-30 border-b border-border bg-bg-elevated print:hidden">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <span className="grid size-9 place-items-center rounded-lg bg-accent text-accent-fg"><Globe className="size-[18px]" /></span>
          <span className="leading-tight">
            <span className="block text-sm font-semibold">Smart Hub Platform</span>
            <span className="block text-[11px] text-fg-subtle">Owner console</span>
          </span>
          <span className="flex-1" />
          <ThemeToggle />
          <span className="hidden text-right leading-tight sm:block">
            <span className="block text-sm font-medium">{profile.fullName}</span>
            <span className="block text-[11px] text-fg-subtle">Platform owner</span>
          </span>
          <SignOutButton compact />
        </div>
      </header>
      {children}
    </div>
  );
}
