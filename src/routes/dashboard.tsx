import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Bell, CalendarDays, Car, ChevronDown, ClipboardCheck, ClockIcon, EyeOff, FileText, HardHat, Send, Wallet, AlertTriangle, Flag, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { RoleGate } from "@/components/role-gate";
import { AppShell, Field, Panel } from "@/components/app-shell";
import { EmptyState, Kpi, Notice, StatusBadge, btnGhost, btnPrimary, inputCls, Modal } from "@/components/ui-kit";
import { RequestTimeline } from "@/components/request-timeline";
import { AfterHoursVehiclePanel } from "@/components/requests/after-hours-vehicle";
import { AttendanceCard, LeaveDialog, MyLeave, SiteReportDialog } from "@/components/daily/daily";
import { useOrgBrand } from "@/components/workspace-bar";
import { can } from "@/lib/ehs/access";
import { getMyAttendance } from "@/lib/ehs/daily";
import { cancelFinanceRequest, createFinanceRequest, listFinanceRequests, listProjectsForRequests, type FinanceRequest } from "@/lib/ehs/finance";
import { createNcr, recordWorkHours, reportAnonymousHazard } from "@/lib/ehs/hse";
import { listAnnouncements, listHealth, listNotifications, reportIncident, submitHealth, type Announcement, type AppNotification, type HealthRow, type Profile } from "@/lib/ehs/server";
import { formatDate, formatMoney, todayIso } from "@/lib/ui/format";
import { errorMessage, useLive } from "@/lib/ui/use-live";
import { emailDeliveryNote } from "@/lib/ui/email-status";
import { SafetyHubWorkspace } from "@/components/hse/safetyhub-workspace";
import { MoneyInput } from "@/components/finance/money-input";

export const Route = createFileRoute("/dashboard")({
  validateSearch: (search: Record<string, unknown>) => {
    const id = Number(search.request);
    return Number.isInteger(id) && id > 0 ? { request: id } : {};
  },
  component: DashboardPage,
});

function DashboardPage() {
  return <RoleGate path="/dashboard">{(profile) => <MyWork profile={profile} />}</RoleGate>;
}

type Project = { id: number; name: string };

type WorkFeatureKey = "vehicle" | "attendance" | "health" | "leave" | "notices" | "safety";
type WorkFeatureConfig = { key: WorkFeatureKey; title: string; Icon: LucideIcon; unread: number; detail?: string };

function WorkFeatureRail({ features, expanded, onToggle }: { features: WorkFeatureConfig[]; expanded: Record<WorkFeatureKey, boolean>; onToggle: (key: WorkFeatureKey) => void }) {
  return <div className="flex flex-wrap gap-2" aria-label="My work cards">
    {features.map(({ key, title, Icon, unread, detail }) => (
      <button key={key} type="button" onClick={() => onToggle(key)} aria-expanded={expanded[key]} aria-label={`${expanded[key] ? "Collapse" : "Open"} ${title}${unread ? `, ${unread} notifications` : ""}`} className={`relative inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors ${expanded[key] ? "border-accent bg-accent/10 text-fg" : "border-border bg-bg-elevated text-fg-muted hover:bg-bg-subtle hover:text-fg"}`}>
        <Icon className="size-4 shrink-0" />
        <span>{title}</span>
        {detail && !expanded[key] ? <span className="hidden text-xs font-normal text-fg-subtle sm:inline">{detail}</span> : null}
        {unread > 0 ? <span className="grid min-w-5 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-5 text-white">{unread > 99 ? "99+" : unread}</span> : null}
        {expanded[key] ? <ChevronDown className="size-3.5" /> : null}
      </button>
    ))}
  </div>;
}

function MyWork({ profile }: { profile: Profile }) {
  const { request: requestId } = Route.useSearch();
  const brand = useOrgBrand();
  const canRequest = can(profile, "finance.request");
  // Finance staff process requests for the company; don't let department-only
  // Finance accounts submit requests if their role grants the generic staff permission.
  const isFinanceStaff = profile.role === "Finance" || profile.department.trim().toLowerCase() === "finance";
  const canRequestMoney = canRequest && !isFinanceStaff;
  const canHours = can(profile, "hours.record");
  const canNcr = can(profile, "ncr.raise");

  const [requests, setRequests] = useState<FinanceRequest[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [health, setHealth] = useState<HealthRow[]>([]);
  const [notices, setNotices] = useState<Announcement[]>([]);
  const [attendance, setAttendance] = useState<Awaited<ReturnType<typeof getMyAttendance>> | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [vehicleDone, setVehicleDone] = useState(false);
  const [safetyDone, setSafetyDone] = useState(false);
  const [dashboardLoaded, setDashboardLoaded] = useState(false);
  const [expandedFeatures, setExpandedFeatures] = useState<Record<WorkFeatureKey, boolean>>({ vehicle: true, attendance: true, health: true, leave: true, notices: true, safety: true });
  const [msg, setMsg] = useState("");
  const [detail, setDetail] = useState<FinanceRequest | null>(null);
  const [dialog, setDialog] = useState<null | "request" | "hazard" | "hours" | "ncr" | "leave" | "report">(null);
  const [leaveKey, setLeaveKey] = useState(0);
  const openedLinkedRequest = useRef<number | null>(null);
  const [clockNow, setClockNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    const [r, h, n, a, alerts] = await Promise.all([
      canRequestMoney ? listFinanceRequests({ data: { mine: true } }).catch(() => []) : Promise.resolve([]),
      listHealth().catch(() => []),
      listAnnouncements().catch(() => []),
      getMyAttendance().catch(() => null),
      listNotifications().catch(() => []),
    ]);
    setRequests(r);
    setHealth(h);
    setNotices(n.slice(0, 4));
    setAttendance(a);
    setNotifications(alerts);
    setDashboardLoaded(true);
    setDetail((cur) => (cur ? r.find((x) => x.id === cur.id) ?? cur : cur));
  }, [canRequestMoney]);
  useLive(load, 20000);

  const todayHealth = health.find((row) => new Date(row.createdAt).toDateString() === new Date().toDateString());
  const unreadCount = (...types: string[]) => notifications.filter((item) => !item.read_at && types.includes(item.type)).length;
  const featureStorageKey = (key: WorkFeatureKey) => `smarthub:mywork:${profile.userId}:${todayIso()}:${key}`;
  const toggleFeature = (key: WorkFeatureKey) => setExpandedFeatures((current) => {
    const next = { ...current, [key]: !current[key] };
    try { localStorage.setItem(featureStorageKey(key), next[key] ? "open" : "closed"); } catch { /* private browsing */ }
    return next;
  });
  const collapseFeature = (key: WorkFeatureKey) => setExpandedFeatures((current) => {
    try { localStorage.setItem(featureStorageKey(key), "closed"); } catch { /* private browsing */ }
    return { ...current, [key]: false };
  });
  useEffect(() => {
    try {
      const saved = Object.fromEntries(([
        "vehicle", "attendance", "health", "leave", "notices", "safety",
      ] as WorkFeatureKey[]).flatMap((key) => {
        const value = localStorage.getItem(featureStorageKey(key));
        return value === null ? [] : [[key, value === "open"]];
      })) as Partial<Record<WorkFeatureKey, boolean>>;
      setExpandedFeatures((current) => ({ ...current, ...saved }));
    } catch { /* private browsing */ }
  }, [profile.userId]);
  useEffect(() => {
    const collapseIfUnchanged = (key: WorkFeatureKey, completed: boolean) => {
      if (!completed) return;
      try { if (localStorage.getItem(featureStorageKey(key)) !== null) return; } catch { /* private browsing */ }
      setExpandedFeatures((current) => ({ ...current, [key]: false }));
    };
    collapseIfUnchanged("attendance", Boolean(attendance?.today));
    collapseIfUnchanged("health", Boolean(todayHealth));
    collapseIfUnchanged("notices", dashboardLoaded && notices.length === 0);
  }, [attendance?.today, todayHealth, dashboardLoaded, notices.length, profile.userId]);
  useEffect(() => {
    if (!requestId || requestId === openedLinkedRequest.current) return;
    const request = requests.find((item) => item.id === requestId);
    if (request) {
      setDetail(request);
      openedLinkedRequest.current = requestId;
    }
  }, [requestId, requests]);
  useLive(async () => {
    if (canRequest) setProjects(await listProjectsForRequests().catch(() => []));
  }, 120000);

  const open = requests.filter((r) => ["Submitted", "Under Review", "Approved"].includes(r.status));
  const paidThisMonth = requests.filter((r) => r.status === "Paid" && r.paidAt && new Date(r.paidAt).getMonth() === new Date().getMonth()).reduce((s, r) => s + r.amount, 0);
  const currency = brand?.currency ?? "TZS";
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", hour: "2-digit", hourCycle: "h23" }).format(clockNow));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const timeLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(clockNow);
  const checkInTime = attendance?.today?.checkIn ? new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(attendance.today.checkIn)) : null;
  const welcome = checkInTime ? `${greeting}. You checked in at ${checkInTime} — have a focused and productive day. It’s ${timeLabel}.` : `${greeting}. Karibu kazini leo. It’s ${timeLabel}; start by checking in when you’re ready.`;
  const attendanceDetail = attendance?.today
    ? attendance.today.checkOut
      ? `In ${new Date(attendance.today.checkIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · out ${new Date(attendance.today.checkOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : `Checked in ${new Date(attendance.today.checkIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · checkout pending`
    : "Not checked in";
  const workFeatures: WorkFeatureConfig[] = [
    ...(canRequest ? [{ key: "vehicle" as const, title: "Vehicle", Icon: Car, unread: unreadCount("after_hours_vehicle"), detail: vehicleDone ? "Plan saved" : "Today" }] : []),
    { key: "attendance", title: "Attendance", Icon: ClipboardCheck, unread: unreadCount("attendance"), detail: attendanceDetail },
    { key: "health", title: "Fitness", Icon: Activity, unread: unreadCount("health"), detail: todayHealth?.fitness ?? "Not declared" },
    { key: "leave", title: "Leave", Icon: CalendarDays, unread: unreadCount("leave"), detail: "Requests and decisions" },
    { key: "notices", title: "Notice board", Icon: Bell, unread: unreadCount("message"), detail: notices.length ? `${notices.length} updates` : "No updates" },
    { key: "safety", title: "Safety & wellbeing", Icon: ShieldCheck, unread: unreadCount("safety_observation", "wellbeing", "incident"), detail: safetyDone ? "Updated" : "Reports and challenges" },
  ];

  return (
    <AppShell title={`Hello, ${profile.fullName.split(" ")[0] || "team"} · Karibu kazini leo`} subtitle={welcome} coverImage={brand?.dashboardCoverUrl ?? ""} role={profile.role}>
      <Notice msg={msg} onClose={() => setMsg("")} />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {canRequestMoney ? <Kpi label="Open requests" value={open.length} hint={open.length ? formatMoney(open.reduce((s, r) => s + r.amount, 0), currency) : "Nothing waiting"} /> : null}
        {canRequestMoney ? <Kpi label="Paid this month" value={formatMoney(paidThisMonth, currency)} tone="ok" /> : null}
        <Kpi label="Today's fitness" value={health[0] && new Date(health[0].createdAt).toDateString() === new Date().toDateString() ? health[0].fitness : "Not declared"} tone={health[0]?.fitness === "Unfit" ? "danger" : undefined} />
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {canRequestMoney ? <button type="button" className={btnPrimary} onClick={() => setDialog("request")}><Wallet className="size-4" /> Request money</button> : null}
        <button type="button" className={btnGhost} onClick={() => setDialog("hazard")}><AlertTriangle className="size-4" /> Report hazard or incident</button>
        <button type="button" className={btnGhost} onClick={() => setDialog("leave")}><CalendarDays className="size-4" /> Request leave</button>
        {canHours ? <button type="button" className={btnGhost} onClick={() => setDialog("report")}><FileText className="size-4" /> Daily site report</button> : null}
        {canHours ? <button type="button" className={btnGhost} onClick={() => setDialog("hours")}><ClockIcon className="size-4" /> Record crew hours</button> : null}
        {canNcr ? <button type="button" className={btnGhost} onClick={() => setDialog("ncr")}><Flag className="size-4" /> Raise NCR</button> : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {canRequestMoney ? (
          <div className="lg:col-span-3">
            <Panel title="My requests">
              {requests.length === 0 ? (
                <EmptyState title="No requests yet" hint="Need money for materials, transport or labour on site? Send a request and it goes straight to the right approver." />
              ) : (
                <ul className="divide-y divide-border">
                  {requests.map((r) => (
                    <li key={r.id}>
                      <button type="button" onClick={() => setDetail(r)} className="flex w-full items-center gap-3 py-3 text-left transition hover:bg-bg-subtle/60">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{r.title}</span>
                          <span className="block text-xs text-fg-muted">{r.requestNumber} · {formatDate(r.createdAt)}</span>
                        </span>
                        <span className="text-right">
                          <span className="block text-sm font-semibold tabular-nums">{formatMoney(r.amount, r.currency)}</span>
                          <StatusBadge status={r.status} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        ) : null}

        <div className={`space-y-5 ${canRequestMoney ? "lg:col-span-2" : "lg:col-span-5"}`}>
          <WorkFeatureRail features={workFeatures} expanded={expandedFeatures} onToggle={toggleFeature} />
          {canRequest && expandedFeatures.vehicle ? <AfterHoursVehiclePanel profile={profile} mode="mine" onCompleted={() => { setVehicleDone(true); collapseFeature("vehicle"); }} /> : null}
          {expandedFeatures.attendance ? <AttendanceCard projects={projects} onActionComplete={() => collapseFeature("attendance")} /> : null}
          {expandedFeatures.health ? <HealthCard current={todayHealth} onSaved={(m) => { setMsg(m); if (m === "Declaration saved") collapseFeature("health"); void load(); }} /> : null}
          {expandedFeatures.leave ? <MyLeave userId={profile.userId} refreshKey={leaveKey} /> : null}
          {expandedFeatures.notices ? <Panel title="Notice board">
            {notices.length === 0 ? <p className="text-sm text-fg-muted">No announcements.</p> : (
              <ul className="space-y-3">
                {notices.map((n) => (
                  <li key={n.id}><p className="text-sm font-medium">{n.title}</p><p className="line-clamp-2 text-xs text-fg-muted">{n.message}</p></li>
                ))}
              </ul>
            )}
          </Panel> : null}
          {expandedFeatures.safety ? <SafetyHubWorkspace profile={profile} compact onActionComplete={() => { setSafetyDone(true); collapseFeature("safety"); }} /> : null}
        </div>
      </div>

      {dialog === "request" && canRequestMoney ? (
        <RequestDialog projects={projects} limit={brand?.managerApprovalLimit ?? 0} currency={currency} onClose={() => setDialog(null)} onDone={(m) => { setDialog(null); setMsg(m); void load(); }} />
      ) : null}
      {dialog === "hazard" ? <HazardDialog projects={projects} onClose={() => setDialog(null)} onDone={(m) => { setDialog(null); setMsg(m); }} /> : null}
      {dialog === "leave" ? <LeaveDialog onClose={() => setDialog(null)} onDone={(m) => { setDialog(null); setMsg(m); setLeaveKey((k) => k + 1); collapseFeature("leave"); }} /> : null}
      {dialog === "report" ? <SiteReportDialog projects={projects} onClose={() => setDialog(null)} onDone={(m) => { setDialog(null); setMsg(m); }} /> : null}
      {dialog === "hours" ? <HoursDialog projects={projects} onClose={() => setDialog(null)} onDone={(m) => { setDialog(null); setMsg(m); }} /> : null}
      {dialog === "ncr" ? <NcrDialog projects={projects} onClose={() => setDialog(null)} onDone={(m) => { setDialog(null); setMsg(m); }} /> : null}

      {detail ? (
        <Modal title={`${detail.requestNumber} · ${detail.title}`} onClose={() => setDetail(null)}>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-lg font-semibold tabular-nums">{formatMoney(detail.amount, detail.currency)}</p>
            <StatusBadge status={detail.status} />
          </div>
          {detail.description ? <p className="mb-4 text-sm text-fg-muted">{detail.description}</p> : null}
          <RequestTimeline request={detail} />
          {["Submitted"].includes(detail.status) ? (
            <button
              type="button"
              className={`${btnGhost} mt-5`}
              onClick={async () => {
                try { await cancelFinanceRequest({ data: detail.id }); setDetail(null); setMsg("Request cancelled"); void load(); } catch (e) { setMsg(errorMessage(e)); }
              }}
            >
              Cancel this request
            </button>
          ) : null}
        </Modal>
      ) : null}
    </AppShell>
  );
}

function HealthCard({ current, onSaved }: { current?: HealthRow; onSaved: (m: string) => void }) {
  const [fitness, setFitness] = useState<"Fit for Duty" | "Restricted" | "Unfit">((current?.fitness as "Fit for Duty" | "Restricted" | "Unfit") ?? "Fit for Duty");
  const [temp, setTemp] = useState(current?.temperature == null ? "36.6" : String(current.temperature));
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(!current);
  const [savedFitness, setSavedFitness] = useState(current?.fitness ?? "");
  useEffect(() => {
    if (current) {
      setFitness(current.fitness as typeof fitness);
      setTemp(current.temperature == null ? "36.6" : String(current.temperature));
      setSavedFitness(current.fitness);
      setEditing(false);
    }
  }, [current?.id]);
  const hint = useMemo(
    () => ({ "Fit for Duty": "You are fit to proceed with your duties.", Restricted: "You are restricted. Tell your supervisor.", Unfit: "Do not start work. Tell your supervisor now." })[fitness],
    [fitness],
  );
  return (
    <Panel title="Daily health declaration">
      {savedFitness && !editing ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><StatusBadge status={savedFitness} /><p className="mt-2 text-sm text-fg-muted">Your fitness status is saved for today.</p></div>
          <button type="button" className={btnGhost} onClick={() => setEditing(true)}>Update status</button>
        </div>
      ) : (
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try { await submitHealth({ data: { fitness, temperature: Number(temp), notes: "" } }); setSavedFitness(fitness); setEditing(false); onSaved("Declaration saved"); } catch (err) { onSaved(errorMessage(err, "Could not save the declaration")); } finally { setBusy(false); }
        }}
      >
        <Field label="Fitness">
          <select value={fitness} onChange={(e) => setFitness(e.target.value as typeof fitness)} className={inputCls}>
            <option>Fit for Duty</option><option>Restricted</option><option>Unfit</option>
          </select>
        </Field>
        <p className="text-xs text-fg-muted">{hint}</p>
        <Field label="Temperature (°C)"><input value={temp} onChange={(e) => setTemp(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}><ClipboardCheck className="size-4" /> Save declaration</button>
      </form>
      )}
    </Panel>
  );
}

function RequestDialog({ projects, limit, currency, onClose, onDone }: { projects: Project[]; limit: number; currency: string; onClose: () => void; onDone: (m: string) => void }) {
  const [projectId, setProjectId] = useState<number | "">("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<"Material" | "Equipment" | "Labor" | "Transport" | "Other">("Material");
  const [amount, setAmount] = useState("");
  const [priority, setPriority] = useState<"Low" | "Medium" | "High" | "Critical">("Medium");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const value = Number(amount);
  const needsManager = limit > 0 && value > limit;

  return (
    <Modal title="Request money" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!(value > 0)) return setErr("Please enter an amount greater than zero");
          setBusy(true);
          try {
            const r = await createFinanceRequest({ data: { projectId: projectId === "" ? null : Number(projectId), title, category, amount: value, priority, description: description || undefined } });
            onDone((r.requiresManager ? `${r.requestNumber} sent to a manager first, then finance` : `${r.requestNumber} sent to finance`) + emailDeliveryNote(r.emailStatus));
          } catch (e2) { setErr(errorMessage(e2)); } finally { setBusy(false); }
        }}
      >
        <Notice msg={err} tone="danger" />
        <Field label="Project (optional)">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : "")} className={inputCls}>
            <option value="">Company / office request</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="What is the request for"><input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Fuel for generator" className={inputCls} /></Field>
        {!projectId ? <p className="-mt-2 text-xs text-fg-muted">No project selected. Describe the work or office activity this money will support.</p> : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className={inputCls}>
              <option value="Material">Materials</option><option value="Equipment">Equipment</option><option value="Labor">Labour</option><option value="Transport">Transport</option><option value="Other">Other</option>
            </select>
          </Field>
          <Field label="Priority">
            <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className={inputCls}>
              <option>Low</option><option>Medium</option><option>High</option><option>Critical</option>
            </select>
          </Field>
        </div>
        <Field label={`Amount (${currency})`}><MoneyInput required value={amount} onChange={setAmount} className={inputCls} /></Field>
        {needsManager ? <p className="text-xs text-warn">Above {formatMoney(limit, currency)}: a manager endorses this before finance approves.</p> : null}
        <Field label={projectId ? "Details (optional)" : "Work / purpose details (required)"}><textarea required={!projectId} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder={!projectId ? "Explain what work this supports and why the money is needed" : "Add useful details for the approver"} className={inputCls} /></Field>
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}><Send className="size-4" /> {busy ? "Sending…" : "Send request"}</button>
      </form>
    </Modal>
  );
}

function HazardDialog({ projects, onClose, onDone }: { projects: Project[]; onClose: () => void; onDone: (m: string) => void }) {
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [severity, setSeverity] = useState<"Low" | "Medium" | "High">("Low");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<number | "">("");
  const [anonymous, setAnonymous] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Report a hazard, near miss or incident" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const payload = { title, location, severity, description: description || undefined, projectId: projectId ? Number(projectId) : undefined };
            if (anonymous) await reportAnonymousHazard({ data: payload }); else await reportIncident({ data: payload });
            onDone(anonymous ? "Anonymous report sent to the EHS team" : "Report sent to the EHS team");
          } catch (e2) { setErr(errorMessage(e2)); } finally { setBusy(false); }
        }}
      >
        <Notice msg={err} tone="danger" />
        <Field label="What happened or what is the hazard"><input required value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} /></Field>
        <Field label="Where"><input required value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Site, tower or road" className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Severity"><select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)} className={inputCls}><option>Low</option><option>Medium</option><option>High</option></select></Field>
          <Field label="Project (optional)">
            <select value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : "")} className={inputCls}>
              <option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Details"><textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} /></Field>
        <label className="flex items-start gap-2.5 rounded-lg border border-border p-3 text-sm">
          <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} className="mt-0.5" />
          <span><span className="flex items-center gap-1.5 font-medium"><EyeOff className="size-4" /> Report anonymously</span><span className="text-xs text-fg-muted">Your name is hidden from everyone, including managers.</span></span>
        </label>
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}><HardHat className="size-4" /> Send report</button>
      </form>
    </Modal>
  );
}

function HoursDialog({ projects, onClose, onDone }: { projects: Project[]; onClose: () => void; onDone: (m: string) => void }) {
  const [projectId, setProjectId] = useState<number | "">("");
  const [date, setDate] = useState(todayIso());
  const [workers, setWorkers] = useState("");
  const [hours, setHours] = useState("8");
  const [err, setErr] = useState("");
  return (
    <Modal title="Record crew hours worked" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          try { await recordWorkHours({ data: { projectId: projectId ? Number(projectId) : undefined, workDate: date, workers: Number(workers), hoursPerWorker: Number(hours) } }); onDone("Hours recorded"); } catch (e2) { setErr(errorMessage(e2)); }
        }}
      >
        <Notice msg={err} tone="danger" />
        <p className="text-xs text-fg-muted">These hours are the base of the injury frequency rates (TRIFR, LTIFR) that clients such as Vodacom and Airtel ask for.</p>
        <Field label="Project"><select value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : "")} className={inputCls}><option value="">All / general</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date"><input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
          <Field label="Workers"><input required inputMode="numeric" value={workers} onChange={(e) => setWorkers(e.target.value.replace(/\D/g, ""))} className={inputCls} /></Field>
          <Field label="Hours each"><input required inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value.replace(/[^0-9.]/g, ""))} className={inputCls} /></Field>
        </div>
        <button type="submit" className={`${btnPrimary} w-full`}>Save hours</button>
      </form>
    </Modal>
  );
}

function NcrDialog({ projects, onClose, onDone }: { projects: Project[]; onClose: () => void; onDone: (m: string) => void }) {
  const [projectId, setProjectId] = useState<number | "">("");
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<"Minor" | "Major" | "Critical">("Minor");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState("");
  return (
    <Modal title="Raise a non-conformance report" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          try { const r = await createNcr({ data: { projectId: projectId ? Number(projectId) : undefined, title, severity, description: description || undefined } }); onDone(`${r.ncrNumber} raised`); } catch (e2) { setErr(errorMessage(e2)); }
        }}
      >
        <Notice msg={err} tone="danger" />
        <Field label="Project"><select value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : "")} className={inputCls}><option value="">General</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="What is not conforming"><input required value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} /></Field>
        <Field label="Severity"><select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)} className={inputCls}><option>Minor</option><option>Major</option><option>Critical</option></select></Field>
        <p className="text-xs text-fg-muted">Critical NCRs alert EHS and the project owner immediately because a client may stop work on the site.</p>
        <Field label="Details"><textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} /></Field>
        <button type="submit" className={`${btnPrimary} w-full`}>Raise NCR</button>
      </form>
    </Modal>
  );
}
