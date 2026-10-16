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

type WorkFeatureKey = "attendance" | "health" | "notices";
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
  const brand = useOrgBrand();
  const [health, setHealth] = useState<HealthRow[]>([]);
  const [notices, setNotices] = useState<Announcement[]>([]);
  const [attendance, setAttendance] = useState<Awaited<ReturnType<typeof getMyAttendance>> | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [dashboardLoaded, setDashboardLoaded] = useState(false);
  const [expandedFeatures, setExpandedFeatures] = useState<Record<WorkFeatureKey, boolean>>({ attendance: false, health: false, notices: false });
  const [msg, setMsg] = useState("");
  const [clockNow, setClockNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    const [h, n, a, alerts] = await Promise.all([
      listHealth().catch(() => []),
      listAnnouncements().catch(() => []),
      getMyAttendance().catch(() => null),
      listNotifications().catch(() => []),
    ]);
    setHealth(h);
    setNotices(n.slice(0, 4));
    setAttendance(a);
    setNotifications(alerts);
    setDashboardLoaded(true);
  }, []);
  useLive(load, 20000);

  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" }).format(clockNow);
  const todayHealth = health.find((row) => {
    const date = new Date(String(row.createdAt));
    return !Number.isNaN(date.getTime()) && new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" }).format(date) === todayKey;
  });
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
        "attendance", "health", "notices",
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
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", hour: "2-digit", hourCycle: "h23" }).format(clockNow));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const timeLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(clockNow);
  const checkInTime = attendance?.today?.checkIn ? new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(attendance.today.checkIn)) : null;
  const welcome = checkInTime ? `${greeting}. You checked in at ${checkInTime} — have a focused and productive day. It’s ${timeLabel}.` : `${greeting}. Karibu kazini leo. It’s ${timeLabel}; start by checking in when you’re ready.`;
  const attendanceDetail = attendance?.today
    ? attendance.today.checkOut
      ? `In ${new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", hour: "2-digit", minute: "2-digit" }).format(new Date(attendance.today.checkIn))} · out ${new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", hour: "2-digit", minute: "2-digit" }).format(new Date(attendance.today.checkOut))}`
      : `Checked in ${new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", hour: "2-digit", minute: "2-digit" }).format(new Date(attendance.today.checkIn))} · checkout pending`
    : "Not checked in";
  const workFeatures: WorkFeatureConfig[] = [
    { key: "attendance", title: "Attendance", Icon: ClipboardCheck, unread: unreadCount("attendance"), detail: attendanceDetail },
    { key: "health", title: "Fitness", Icon: Activity, unread: unreadCount("health"), detail: todayHealth?.fitness ?? "Not declared" },
    { key: "notices", title: "Notice board", Icon: Bell, unread: unreadCount("message"), detail: notices.length ? `${notices.length} updates` : "No updates" },
  ];

  return (
    <AppShell title={`Hello, ${profile.fullName.split(" ")[0] || "team"} · Karibu kazini leo`} subtitle={welcome} coverImage={brand?.dashboardCoverUrl ?? ""} role={profile.role}>
      <Notice msg={msg} onClose={() => setMsg("")} />

      <div className="space-y-6">
          <WorkFeatureRail features={workFeatures} expanded={expandedFeatures} onToggle={toggleFeature} />
          {!Object.values(expandedFeatures).some(Boolean) ? <p className="text-sm text-fg-muted">Select a card or click to view its details.</p> : null}
          {expandedFeatures.attendance ? <AttendanceCard projects={[]} onActionComplete={() => collapseFeature("attendance")} /> : null}
          {expandedFeatures.health ? <HealthCard current={todayHealth} onSaved={(m) => { setMsg(m); if (m === "Declaration saved") collapseFeature("health"); void load(); }} /> : null}
          {expandedFeatures.notices ? <Panel title="Notice board">
            {notices.length === 0 ? <p className="text-sm text-fg-muted">No announcements.</p> : (
              <ul className="space-y-3">
                {notices.map((n) => (
                  <li key={n.id}><p className="text-sm font-medium">{n.title}</p><p className="line-clamp-2 text-xs text-fg-muted">{n.message}</p></li>
                ))}
              </ul>
            )}
          </Panel> : null}
          <SafetyHubWorkspace profile={profile} compact showChallenges={false} />
      </div>
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

function RequestDialog({ projects, currency, onClose, onDone }: { projects: Project[]; currency: string; onClose: () => void; onDone: (m: string) => void }) {
  const [projectId, setProjectId] = useState<number | "">("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<"Material" | "Equipment" | "Labor" | "Transport" | "Other">("Material");
  const [amount, setAmount] = useState("");
  const [priority, setPriority] = useState<"Low" | "Medium" | "High" | "Critical">("Medium");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const value = Number(amount);

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
            onDone(`${r.requestNumber} sent directly to Finance`);
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
