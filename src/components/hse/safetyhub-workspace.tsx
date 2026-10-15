import { useCallback, useState } from "react";
import { Activity, ClipboardPlus, Footprints, Plus, ShieldCheck } from "lucide-react";
import { Field, Panel } from "@/components/app-shell";
import { EmptyState, Modal, Notice, StatusBadge, btnGhost, btnPrimary, inputCls } from "@/components/ui-kit";
import { Kpi } from "@/components/ui-kit";
import { MiniBars } from "@/components/mini-bars";
import { can } from "@/lib/ehs/access";
import { createSafetyObservation, createWellbeingChallenge, getObservationSummary, listSafetyAssignees, listSafetyObservations, listWellbeingChallenges, logWellbeingSteps, setWellbeingChallengeStatus, updateSafetyObservation, type ObservationSummary, type SafetyObservation, type WellbeingChallenge } from "@/lib/ehs/safetyhub";
import type { Profile } from "@/lib/ehs/server";
import { listProjects } from "@/lib/ehs/server";
import { errorMessage, useLive } from "@/lib/ui/use-live";

type Project = { id: number; name: string };
const today = () => new Date().toISOString().slice(0, 10);

export function SafetyHubWorkspace({ profile, compact = false, onActionComplete }: { profile: Profile; compact?: boolean; onActionComplete?: () => void }) {
  const [observations, setObservations] = useState<SafetyObservation[]>([]);
  const [challenges, setChallenges] = useState<WellbeingChallenge[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [dialog, setDialog] = useState<"observation" | "challenge" | null>(null);
  const [message, setMessage] = useState("");
  const [steps, setSteps] = useState<Record<number, string>>({});
  const [assignees, setAssignees] = useState<{ userId: string; fullName: string; role: string }[]>([]);
  const [assigned, setAssigned] = useState<Record<number, string>>({});
  const [dueDates, setDueDates] = useState<Record<number, string>>({});
  const [summary, setSummary] = useState<ObservationSummary | null>(null);
  const manage = can(profile, "ehs.manage");
  const canChallenge = can(profile, "wellbeing.manage");
  const load = useCallback(async () => {
    const [o, c, p] = await Promise.all([
      listSafetyObservations().catch(() => []), listWellbeingChallenges().catch(() => []),
      listProjects().catch(() => []),
    ]);
    setObservations(o); setChallenges(c); setProjects(p.map((x) => ({ id: Number(x.id), name: x.name })));
    if (manage) setAssignees(await listSafetyAssignees().catch(() => []));
    if (can(profile, "ehs.view_org") || manage) setSummary(await getObservationSummary().catch(() => null));
  }, [manage, profile]);
  useLive(load, 30000);
  const complete = (msg: string) => { setDialog(null); setMessage(msg); onActionComplete?.(); void load(); };

  return <div className="space-y-5">
    <Notice msg={message} onClose={() => setMessage("")} />
    {summary ? <div className="space-y-3"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Kpi label="Observations" value={summary.total} /><Kpi label="Open actions" value={summary.open} tone={summary.open ? "warn" : "ok"} /><Kpi label="High / critical open" value={summary.critical} tone={summary.critical ? "danger" : "ok"} /><Kpi label="Closed this month" value={summary.closedThisMonth} tone="ok" /></div><div className="grid gap-4 lg:grid-cols-2"><div className="rounded-xl border border-border bg-bg-elevated p-4"><p className="mb-3 text-sm font-semibold">Observation trend · 6 months</p><MiniBars label="Safety observations per month" data={summary.monthly.map((x) => ({ label: x.month, value: x.count }))} /></div><div className="rounded-xl border border-border bg-bg-elevated p-4"><p className="mb-3 text-sm font-semibold">Observation types · 90 days</p><MiniBars label="Observation counts by type" data={summary.byCategory.map((x) => ({ label: x.category, value: x.count }))} /></div></div></div> : null}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={btnPrimary} onClick={() => setDialog("observation")}><ClipboardPlus className="size-4" /> Report safety observation</button>
      {canChallenge ? <button type="button" className={btnGhost} onClick={() => setDialog("challenge")}><Plus className="size-4" /> New wellbeing challenge</button> : null}
    </div>
    <div className={`grid gap-5 ${compact ? "" : "xl:grid-cols-2"}`}>
      <Panel title="Safety observations">
        <p className="mb-3 text-xs text-fg-muted">Staff report hazards, near misses and good practice here; EHS reviews reports and tracks actions to closure.</p>
        {observations.length === 0 ? <EmptyState title="No observations yet" hint={manage ? "Remind staff to report site hazards or good practice here." : "Report a site hazard, near miss or good practice here. EHS will follow up."} /> : <ul className="divide-y divide-border">
          {observations.map((o) => <li key={o.id} className="py-3">
            <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="font-medium">{o.title}</p><p className="mt-0.5 text-xs text-fg-muted">{o.category} · {o.location}{o.projectName ? ` · ${o.projectName}` : ""} · {o.reporterLabel}</p></div><div className="flex gap-2"><StatusBadge status={o.severity} /><StatusBadge status={o.status} /></div></div>
            <p className="mt-2 text-sm text-fg-muted">{o.description}</p>
            {o.immediateAction ? <p className="mt-1 text-xs"><span className="font-medium">Immediate action:</span> {o.immediateAction}</p> : null}
            {o.closureNote ? <p className="mt-1 text-xs text-fg-muted">Closure: {o.closureNote}</p> : null}
            {manage && o.status !== "Closed" ? <div className="mt-2 flex flex-wrap gap-2">
              {o.status === "Submitted" ? <button type="button" className={btnGhost} onClick={() => void updateSafetyObservation({ data: { id: o.id, status: "Under Review" } }).then(() => { setMessage("Observation moved to review"); void load(); }).catch((e) => setMessage(errorMessage(e)))}>Start review</button> : null}
              {o.status !== "Action Required" ? <button type="button" className={btnGhost} onClick={() => void updateSafetyObservation({ data: { id: o.id, status: "Action Required" } }).then(() => { setMessage("Corrective action requested"); void load(); }).catch((e) => setMessage(errorMessage(e)))}>Request action</button> : null}
              <button type="button" className={btnGhost} onClick={() => { const note = window.prompt("What was done to close this observation?"); if (!note?.trim()) return; void updateSafetyObservation({ data: { id: o.id, status: "Closed", closureNote: note.trim() } }).then(() => { setMessage("Observation closed"); void load(); }).catch((e) => setMessage(errorMessage(e))); }}>Close with note</button>
            </div> : null}
            {manage && o.status !== "Closed" ? <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_180px_auto]">
              <select aria-label={`Assign ${o.title}`} className={inputCls} value={assigned[o.id] ?? o.assignedTo ?? ""} onChange={(e) => setAssigned((s) => ({ ...s, [o.id]: e.target.value }))}><option value="">Choose action owner</option>{assignees.map((u) => <option key={u.userId} value={u.userId}>{u.fullName} · {u.role}</option>)}</select>
              <input aria-label="Action due date" type="date" min={today()} className={inputCls} value={dueDates[o.id] ?? o.dueDate ?? ""} onChange={(e) => setDueDates((s) => ({ ...s, [o.id]: e.target.value }))} />
              <button type="button" disabled={!assigned[o.id] && !o.assignedTo} className={btnGhost} onClick={() => void updateSafetyObservation({ data: { id: o.id, status: "Action Required", ...(assigned[o.id] || o.assignedTo ? { assignedTo: assigned[o.id] || o.assignedTo! } : {}), ...(dueDates[o.id] || o.dueDate ? { dueDate: dueDates[o.id] || o.dueDate! } : {}) } }).then(() => { setMessage("Owner and due date saved"); void load(); }).catch((e) => setMessage(errorMessage(e)))}>Assign action</button>
            </div> : null}
          </li>)}
        </ul>}
      </Panel>

      <Panel title="Wellbeing step challenges">
        <p className="mb-3 text-xs text-fg-muted">Voluntary activity challenge. Members see their own entries; the team sees only totals.</p>
        {challenges.length === 0 ? <EmptyState title="No challenges right now" hint={canChallenge ? "Create a step challenge to launch it for your team." : "Ask your EHS lead to start a step challenge."} /> : <ul className="space-y-3">
          {challenges.map((c) => <li key={c.id} className="rounded-lg border border-border p-3">
            <div className="flex items-start justify-between gap-3"><div><p className="font-medium">{c.title}</p><p className="text-xs text-fg-muted">{c.startsOn} – {c.endsOn} · {c.dailyStepGoal.toLocaleString()} steps/day</p></div><StatusBadge status={c.status} /></div>
            {c.description ? <p className="mt-2 text-sm text-fg-muted">{c.description}</p> : null}
            <div className="mt-3 grid grid-cols-3 gap-2 text-center"><Metric label="Members" value={c.participantCount} /><Metric label="Team steps" value={c.totalSteps.toLocaleString()} /><Metric label="Your steps" value={c.mySteps.toLocaleString()} /></div>
            {c.status === "Active" ? <div className="mt-3 flex items-end gap-2"><Field label="Your steps today"><input type="number" min="0" max="100000" inputMode="numeric" className={inputCls} value={steps[c.id] ?? ""} onChange={(e) => setSteps((s) => ({ ...s, [c.id]: e.target.value }))} placeholder={String(c.myTodaySteps || "e.g. 6400")} /></Field><button type="button" className={btnPrimary} disabled={steps[c.id] === undefined || steps[c.id] === ""} onClick={() => void logWellbeingSteps({ data: { challengeId: c.id, entryDate: today(), steps: Number(steps[c.id]) } }).then(() => { setMessage("Your steps were saved"); onActionComplete?.(); void load(); }).catch((e) => setMessage(errorMessage(e)))}><Footprints className="size-4" /> Save</button></div> : null}
            {canChallenge && c.status === "Active" ? <button type="button" className={`${btnGhost} mt-2`} onClick={() => void setWellbeingChallengeStatus({ data: { id: c.id, status: "Completed" } }).then(() => { setMessage("Challenge completed"); void load(); }).catch((e) => setMessage(errorMessage(e)))}>Complete challenge</button> : null}
          </li>)}
        </ul>}
      </Panel>
    </div>

    {dialog === "observation" ? <ObservationDialog projects={projects} onClose={() => setDialog(null)} onDone={complete} /> : null}
    {dialog === "challenge" ? <ChallengeDialog onClose={() => setDialog(null)} onDone={complete} /> : null}
  </div>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div className="rounded-md bg-bg-subtle px-2 py-2"><p className="text-sm font-semibold tabular-nums">{value}</p><p className="text-[11px] text-fg-muted">{label}</p></div>; }

function ObservationDialog({ projects, onClose, onDone }: { projects: Project[]; onClose: () => void; onDone: (message: string) => void }) {
  const [projectId, setProjectId] = useState(""); const [category, setCategory] = useState("Unsafe condition"); const [severity, setSeverity] = useState("Medium");
  const [title, setTitle] = useState(""); const [description, setDescription] = useState(""); const [location, setLocation] = useState(""); const [immediateAction, setImmediateAction] = useState(""); const [anonymous, setAnonymous] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <Modal title="Report a safety observation" onClose={onClose}><form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(""); try { await createSafetyObservation({ data: { ...(projectId ? { projectId: Number(projectId) } : {}), category: category as "Unsafe act", severity: severity as "Low", title, description, location, immediateAction: immediateAction || undefined, anonymous } }); onDone("Observation sent to your company EHS team"); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); } }}>
    <Notice tone="danger" msg={error} />
    <Field label="Type"><select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}><option>Unsafe condition</option><option>Unsafe act</option><option>Near miss</option><option>Good practice</option><option>Environmental</option></select></Field>
    <div className="grid grid-cols-2 gap-3"><Field label="Risk"><select className={inputCls} value={severity} onChange={(e) => setSeverity(e.target.value)}><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select></Field><Field label="Project (optional)"><select className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">Select project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field></div>
    <Field label="Short title"><input required minLength={3} maxLength={160} className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What did you notice?" /></Field>
    <Field label="Location"><input required maxLength={160} className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Site, area or vehicle" /></Field>
    <Field label="Details"><textarea required minLength={3} maxLength={2000} rows={3} className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
    <Field label="Immediate action taken (optional)"><input maxLength={1000} className={inputCls} value={immediateAction} onChange={(e) => setImmediateAction(e.target.value)} /></Field>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} /> Hide my name from other users</label>
    <button disabled={busy} className={`${btnPrimary} w-full`}><ShieldCheck className="size-4" /> {busy ? "Sending…" : "Submit observation"}</button>
  </form></Modal>;
}

function ChallengeDialog({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const [title, setTitle] = useState(""); const [description, setDescription] = useState(""); const [startsOn, setStartsOn] = useState(today()); const [endsOn, setEndsOn] = useState(today()); const [goal, setGoal] = useState("6000"); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  return <Modal title="Create a wellbeing challenge" onClose={onClose}><form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(""); try { await createWellbeingChallenge({ data: { title, description, startsOn, endsOn, dailyStepGoal: Number(goal) } }); onDone("Wellbeing challenge created"); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); } }}>
    <Notice tone="danger" msg={error} /><Field label="Challenge name"><input required minLength={3} maxLength={100} className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
    <Field label="Description (optional)"><textarea maxLength={500} rows={2} className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
    <div className="grid grid-cols-2 gap-3"><Field label="Starts"><input required type="date" className={inputCls} value={startsOn} onChange={(e) => setStartsOn(e.target.value)} /></Field><Field label="Ends"><input required type="date" min={startsOn} className={inputCls} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} /></Field></div>
    <Field label="Daily step goal"><input required type="number" min="1000" max="50000" step="500" className={inputCls} value={goal} onChange={(e) => setGoal(e.target.value)} /></Field>
    <button disabled={busy} className={`${btnPrimary} w-full`}><Activity className="size-4" /> {busy ? "Creating…" : "Create challenge"}</button>
  </form></Modal>;
}
