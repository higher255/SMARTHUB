import { useCallback, useMemo, useState } from "react";
import { Plus, Stethoscope } from "lucide-react";
import { Field } from "@/components/app-shell";
import { MiniBars } from "@/components/mini-bars";
import { EmptyState, Kpi, Modal, Notice, StatusBadge, TabBar, btnGhost, btnPrimary, inputCls } from "@/components/ui-kit";
import { can } from "@/lib/ehs/access";
import {
  INJURY_TYPES, classifyIncident, createNcr, createRiskAssessment, decideSubcontractor, getSafetyMetrics, listNcrs, listRiskAssessments,
  listSubcontractors, listWorkHours, recordWorkHours, registerSubcontractor, setRiskAssessmentStatus, updateNcr,
  type Ncr, type SafetyMetrics,
} from "@/lib/ehs/hse";
import { listIncidents, listProjects, type Incident, type Profile } from "@/lib/ehs/server";
import { formatDate, formatMoney, formatNumber, todayIso } from "@/lib/ui/format";
import { errorMessage, useLive } from "@/lib/ui/use-live";
import { SafetyHubWorkspace } from "@/components/hse/safetyhub-workspace";

type Sub = "kpis" | "observations" | "ncr" | "hira" | "subs";
const th = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-fg-subtle";
const td = "px-3 py-2.5 text-sm";

export function HseWorkspace({ profile }: { profile: Profile }) {
  const [sub, setSub] = useState<Sub>("kpis");
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
  useLive(async () => setProjects((await listProjects().catch(() => [])).map((p) => ({ id: Number(p.id), name: p.name }))), 120000);
  const tabs = [
    { id: "kpis" as const, label: "Safety KPIs" },
    { id: "observations" as const, label: "Observations & wellbeing" },
    { id: "ncr" as const, label: "NCRs" },
    { id: "hira" as const, label: "Risk assessments" },
    ...(can(profile, "subcontractors.manage") ? [{ id: "subs" as const, label: "Subcontractors" }] : []),
  ];
  return (
    <div>
      <TabBar tabs={tabs} active={sub} onChange={setSub} />
      {sub === "kpis" ? <Kpis profile={profile} projects={projects} /> : null}
      {sub === "observations" ? <SafetyHubWorkspace profile={profile} /> : null}
      {sub === "ncr" ? <Ncrs profile={profile} projects={projects} /> : null}
      {sub === "hira" ? <Hira profile={profile} projects={projects} /> : null}
      {sub === "subs" ? <Subs /> : null}
    </div>
  );
}

function Kpis({ profile, projects }: { profile: Profile; projects: { id: number; name: string }[] }) {
  const [m, setM] = useState<SafetyMetrics | null>(null);
  const [hours, setHours] = useState<Awaited<ReturnType<typeof listWorkHours>>>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [msg, setMsg] = useState("");
  const [classify, setClassify] = useState<Incident | null>(null);
  const [logHours, setLogHours] = useState(false);
  const load = useCallback(async () => {
    setM(await getSafetyMetrics({}).catch(() => null));
    setHours(await listWorkHours().catch(() => []));
    setIncidents(await listIncidents().catch(() => []));
  }, []);
  useLive(load, 30000);
  if (!m) return <p className="text-sm text-fg-muted">Loading…</p>;
  return (
    <div className="space-y-6">
      <Notice msg={msg} onClose={() => setMsg("")} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="TRIFR" value={formatNumber(m.trifr, 2)} hint="Per million hours" />
        <Kpi label="LTIFR" value={formatNumber(m.ltifr, 2)} hint="Lost-time, per million hours" />
        <Kpi label="Severity rate" value={formatNumber(m.severityRate, 1)} hint={`${m.lostDays} lost days`} />
        <Kpi label="Hours worked" value={formatNumber(m.manHours)} hint="Last 12 months" />
        <Kpi label="Incident cost" value={formatMoney(m.totalCost)} hint={`${formatNumber(m.idleHours)} idle hours`} />
      </div>
      {m.manHours === 0 ? <Notice tone="warn" msg="No hours recorded yet. Rates stay blank until team leaders record hours worked." /> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-bg-elevated p-5">
          <p className="mb-3 text-sm font-semibold">Recordable injuries by month</p>
          <MiniBars label="Recordable injuries by month" data={m.monthly.map((x) => ({ label: x.month, value: x.recordable }))} />
        </div>
        <div className="rounded-xl border border-border bg-bg-elevated p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold">Hours worked</p>
            {can(profile, "hours.record") ? <button type="button" className={btnGhost} onClick={() => setLogHours(true)}><Plus className="size-4" /> Record</button> : null}
          </div>
          {hours.length === 0 ? <p className="text-sm text-fg-muted">Nothing recorded.</p> : (
            <ul className="max-h-40 divide-y divide-border overflow-y-auto text-sm">
              {hours.slice(0, 12).map((h) => (<li key={h.id} className="flex justify-between py-1.5"><span>{formatDate(h.workDate)} · {h.projectName ?? "General"}</span><span className="tabular-nums text-fg-muted">{h.workers} x {h.hoursPerWorker}h = {h.manHours}</span></li>))}
            </ul>
          )}
        </div>
      </div>
      <div className="rounded-xl border border-border bg-bg-elevated">
        <p className="border-b border-border px-4 py-3 text-sm font-semibold">Classify incidents</p>
        {incidents.length === 0 ? <div className="p-4"><EmptyState title="No incidents reported" /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]"><thead className="border-b border-border"><tr><th className={th}>Incident</th><th className={th}>Date</th><th className={th}>Severity</th><th className="w-24" /></tr></thead>
              <tbody className="divide-y divide-border">
                {incidents.slice(0, 30).map((i) => (<tr key={i.id}><td className={td}><p className="font-medium">{i.title}</p><p className="text-xs text-fg-muted">{i.location}</p></td><td className={td}>{formatDate(i.createdAt)}</td><td className={td}><StatusBadge status={i.severity} /></td>
                  <td className="px-2">{can(profile, "ehs.manage") ? <button type="button" className={btnGhost} onClick={() => setClassify(i)}><Stethoscope className="size-4" /> Classify</button> : null}</td></tr>))}
              </tbody></table>
          </div>
        )}
      </div>
      {classify ? <ClassifyDialog incident={classify} onClose={() => setClassify(null)} onDone={(t) => { setClassify(null); setMsg(t); void load(); }} /> : null}
      {logHours ? <HoursDialog projects={projects} onClose={() => setLogHours(false)} onDone={() => { setLogHours(false); setMsg("Hours recorded"); void load(); }} /> : null}
    </div>
  );
}

function ClassifyDialog({ incident, onClose, onDone }: { incident: Incident; onClose: () => void; onDone: (m: string) => void }) {
  const [injury, setInjury] = useState<(typeof INJURY_TYPES)[number]>("None");
  const [lost, setLost] = useState("0");
  const [cost, setCost] = useState("0");
  const [idle, setIdle] = useState("0");
  const [err, setErr] = useState("");
  return (
    <Modal title={`Classify: ${incident.title}`} onClose={onClose}>
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try { await classifyIncident({ data: { id: incident.id, injuryType: injury, lostDays: Number(lost) || 0, costEstimate: Number(cost) || 0, idleHours: Number(idle) || 0 } }); onDone("Incident classified"); } catch (x) { setErr(errorMessage(x)); } }}>
        <Notice msg={err} tone="danger" />
        <Field label="Injury outcome"><select value={injury} onChange={(e) => setInjury(e.target.value as typeof injury)} className={inputCls}>{INJURY_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <p className="text-xs text-fg-muted">Medical treatment, restricted work, lost time and fatality count as recordable in TRIFR.</p>
        {injury === "Lost Time" || injury === "Fatality" ? <Field label="Days lost"><input inputMode="numeric" value={lost} onChange={(e) => setLost(e.target.value.replace(/\D/g, ""))} className={inputCls} /></Field> : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cost estimate"><input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^0-9.]/g, ""))} className={inputCls} /></Field>
          <Field label="Idle hours"><input inputMode="decimal" value={idle} onChange={(e) => setIdle(e.target.value.replace(/[^0-9.]/g, ""))} className={inputCls} /></Field>
        </div>
        <button type="submit" className={`${btnPrimary} w-full`}>Save classification</button>
      </form>
    </Modal>
  );
}

function HoursDialog({ projects, onClose, onDone }: { projects: { id: number; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [projectId, setProjectId] = useState<number | "">("");
  const [workers, setWorkers] = useState("");
  const [hrs, setHrs] = useState("8");
  const [date, setDate] = useState(todayIso());
  const [err, setErr] = useState("");
  return (
    <Modal title="Record hours worked" onClose={onClose}>
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try { await recordWorkHours({ data: { projectId: projectId ? Number(projectId) : undefined, workDate: date, workers: Number(workers), hoursPerWorker: Number(hrs) } }); onDone(); } catch (x) { setErr(errorMessage(x)); } }}>
        <Notice msg={err} tone="danger" />
        <Field label="Project"><select value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : "")} className={inputCls}><option value="">General</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date"><input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
          <Field label="Workers"><input required inputMode="numeric" value={workers} onChange={(e) => setWorkers(e.target.value.replace(/\D/g, ""))} className={inputCls} /></Field>
          <Field label="Hours each"><input required inputMode="decimal" value={hrs} onChange={(e) => setHrs(e.target.value.replace(/[^0-9.]/g, ""))} className={inputCls} /></Field>
        </div>
        <button type="submit" className={`${btnPrimary} w-full`}>Save</button>
      </form>
    </Modal>
  );
}

function Ncrs({ profile, projects }: { profile: Profile; projects: { id: number; name: string }[] }) {
  const [rows, setRows] = useState<Ncr[]>([]);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: "", severity: "Minor" as Ncr["severity"], projectId: "", description: "" });
  const load = useCallback(async () => setRows(await listNcrs().catch(() => [])), []);
  useLive(load, 20000);
  const manage = can(profile, "ncr.manage");
  const act = async (fn: () => Promise<unknown>, done: string) => { try { await fn(); setMsg(done); void load(); } catch (e) { setMsg(errorMessage(e)); } };
  return (
    <div className="space-y-4">
      <Notice msg={msg} onClose={() => setMsg("")} />
      <div className="flex items-center justify-between">
        <p className="text-sm text-fg-muted">Open Critical NCRs mark a project as at risk of a client stop-work order.</p>
        {can(profile, "ncr.raise") ? <button type="button" className={btnPrimary} onClick={() => setOpen(true)}><Plus className="size-4" /> Raise NCR</button> : null}
      </div>
      {rows.length === 0 ? <EmptyState title="No NCRs" /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-bg-elevated">
          <table className="w-full min-w-[760px]"><thead className="border-b border-border"><tr><th className={th}>NCR</th><th className={th}>Project</th><th className={th}>Severity</th><th className={th}>Status</th><th className={th}>Assigned</th><th className="w-40" /></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((n) => (
                <tr key={n.id}>
                  <td className={td}><p className="font-medium">{n.title}</p><p className="text-xs text-fg-muted">{n.ncrNumber} · {n.raisedByName ?? "Unknown"} · {formatDate(n.createdAt)}</p></td>
                  <td className={td}>{n.projectName ?? "General"}</td><td className={td}><StatusBadge status={n.severity} /></td><td className={td}><StatusBadge status={n.status} /></td><td className={td}>{n.assignedToName ?? "Unassigned"}</td>
                  <td className="px-2 text-right">
                    {n.status === "Open" && (manage || n.assignedTo === profile.userId) ? <button type="button" className={btnGhost} onClick={() => void act(() => updateNcr({ data: { id: n.id, status: "In Progress" } }), `${n.ncrNumber} in progress`)}>Start</button> : null}
                    {n.status !== "Closed" && (manage || n.assignedTo === profile.userId) ? <button type="button" className={`${btnGhost} ml-1`} onClick={() => { const note = window.prompt("How was it closed?"); if (note) void act(() => updateNcr({ data: { id: n.id, status: "Closed", closureNote: note } }), `${n.ncrNumber} closed`); }}>Close</button> : null}
                  </td>
                </tr>
              ))}
            </tbody></table>
        </div>
      )}
      {open ? (
        <Modal title="Raise NCR" onClose={() => setOpen(false)}>
          <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try { const r = await createNcr({ data: { title: f.title, severity: f.severity, projectId: f.projectId ? Number(f.projectId) : undefined, description: f.description || undefined } }); setOpen(false); setMsg(`${r.ncrNumber} raised`); void load(); } catch (x) { setMsg(errorMessage(x)); } }}>
            <Field label="Title"><input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={inputCls} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Severity"><select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value as Ncr["severity"] })} className={inputCls}><option>Minor</option><option>Major</option><option>Critical</option></select></Field>
              <Field label="Project"><select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })} className={inputCls}><option value="">General</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            </div>
            <Field label="Details"><textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className={inputCls} /></Field>
            <button type="submit" className={`${btnPrimary} w-full`}>Raise</button>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

const scoreTone = (s: number) => (s >= 15 ? "bg-danger/15 text-danger" : s >= 8 ? "bg-warn/15 text-warn" : "bg-ok/15 text-ok");

function Hira({ profile, projects }: { profile: Profile; projects: { id: number; name: string }[] }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listRiskAssessments>>>([]);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ activity: "", hazard: "", likelihood: 3, consequence: 3, controls: "", projectId: "" });
  const load = useCallback(async () => setRows(await listRiskAssessments().catch(() => [])), []);
  useLive(load, 60000);
  const score = f.likelihood * f.consequence;
  const manage = can(profile, "hira.manage");
  const nums = useMemo(() => [1, 2, 3, 4, 5], []);
  return (
    <div className="space-y-4">
      <Notice msg={msg} onClose={() => setMsg("")} />
      <div className="flex items-center justify-between">
        <p className="text-sm text-fg-muted">Likelihood times consequence on a 5 by 5 matrix. Scores of 15 or more show as high risk on project health.</p>
        {manage ? <button type="button" className={btnPrimary} onClick={() => setOpen(true)}><Plus className="size-4" /> New assessment</button> : null}
      </div>
      {rows.length === 0 ? <EmptyState title="No risk assessments" hint="Record the hazards of each activity before work starts. Auditors ask for these." /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-bg-elevated">
          <table className="w-full min-w-[700px]"><thead className="border-b border-border"><tr><th className={th}>Activity and hazard</th><th className={th}>Project</th><th className={th}>Score</th><th className={th}>Status</th><th className="w-28" /></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className={td}><p className="font-medium">{r.activity}</p><p className="text-xs text-fg-muted">{r.hazard}</p>{r.controls ? <p className="mt-1 text-xs text-fg-muted">Controls: {r.controls}</p> : null}</td>
                  <td className={td}>{r.projectName ?? "General"}</td>
                  <td className={td}><span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${scoreTone(r.riskScore)}`}>{r.riskScore}</span></td>
                  <td className={td}><StatusBadge status={r.status} /></td>
                  <td className="px-2 text-right">{manage && r.status !== "Closed" ? <button type="button" className={btnGhost} onClick={async () => { try { await setRiskAssessmentStatus({ data: { id: r.id, status: r.status === "Open" ? "Controlled" : "Closed" } }); void load(); } catch (e) { setMsg(errorMessage(e)); } }}>{r.status === "Open" ? "Controlled" : "Close"}</button> : null}</td>
                </tr>
              ))}
            </tbody></table>
        </div>
      )}
      {open ? (
        <Modal title="New risk assessment" onClose={() => setOpen(false)}>
          <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try { await createRiskAssessment({ data: { activity: f.activity, hazard: f.hazard, likelihood: f.likelihood, consequence: f.consequence, controls: f.controls || undefined, projectId: f.projectId ? Number(f.projectId) : undefined } }); setOpen(false); setMsg("Risk assessment saved"); void load(); } catch (x) { setMsg(errorMessage(x)); } }}>
            <Field label="Activity"><input required value={f.activity} onChange={(e) => setF({ ...f, activity: e.target.value })} placeholder="Tower climbing, trench digging" className={inputCls} /></Field>
            <Field label="Hazard"><input required value={f.hazard} onChange={(e) => setF({ ...f, hazard: e.target.value })} className={inputCls} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Likelihood"><select value={f.likelihood} onChange={(e) => setF({ ...f, likelihood: Number(e.target.value) })} className={inputCls}>{nums.map((n) => <option key={n}>{n}</option>)}</select></Field>
              <Field label="Consequence"><select value={f.consequence} onChange={(e) => setF({ ...f, consequence: Number(e.target.value) })} className={inputCls}>{nums.map((n) => <option key={n}>{n}</option>)}</select></Field>
              <Field label="Score"><p className={`rounded-md px-3 py-2 text-center text-sm font-semibold ${scoreTone(score)}`}>{score}</p></Field>
            </div>
            <Field label="Controls"><textarea rows={2} value={f.controls} onChange={(e) => setF({ ...f, controls: e.target.value })} className={inputCls} /></Field>
            <Field label="Project"><select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })} className={inputCls}><option value="">General</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <button type="submit" className={`${btnPrimary} w-full`}>Save</button>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

const JOB_TYPES = ["Fibre excavation", "Tower climbing and rigging", "Electrical works", "Civil and structural", "Fleet and transport", "Site survey"];

function Subs() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listSubcontractors>>>([]);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ companyName: "", contactName: "", contactPhone: "", companySize: "Small" as "Micro" | "Small" | "Medium" | "Large", jobTypes: [] as string[], docs: "" });
  const load = useCallback(async () => setRows(await listSubcontractors().catch(() => [])), []);
  useLive(load, 60000);
  return (
    <div className="space-y-4">
      <Notice msg={msg} onClose={() => setMsg("")} />
      <div className="flex items-center justify-between">
        <p className="text-sm text-fg-muted">Clear subcontractors before they set foot on site. Clearance expires on the date you set.</p>
        <button type="button" className={btnPrimary} onClick={() => setOpen(true)}><Plus className="size-4" /> Register subcontractor</button>
      </div>
      {rows.length === 0 ? <EmptyState title="No subcontractors" /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-bg-elevated">
          <table className="w-full min-w-[720px]"><thead className="border-b border-border"><tr><th className={th}>Company</th><th className={th}>Kazi</th><th className={th}>Safety files</th><th className={th}>Status</th><th className="w-40" /></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className={td}><p className="font-medium">{s.companyName}</p><p className="text-xs text-fg-muted">{s.companySize} · {s.contactName ?? ""} {s.contactPhone ?? ""}</p></td>
                  <td className={td}>{s.jobTypes.join(", ")}</td>
                  <td className={td}>{s.documents.length ? s.documents.map((d) => d.name).join(", ") : "None listed"}</td>
                  <td className={td}><StatusBadge status={s.status} />{s.validUntil ? <p className="text-xs text-fg-muted">until {formatDate(s.validUntil)}</p> : null}</td>
                  <td className="px-2 text-right">
                    {s.status === "Pending" || s.status === "Expired" ? (
                      <>
                        <button type="button" className={btnGhost} onClick={async () => { const until = window.prompt("Clearance valid until (YYYY-MM-DD)?", `${new Date().getFullYear() + 1}-${todayIso().slice(5)}`); if (!until) return; try { await decideSubcontractor({ data: { id: s.id, decision: "Approved", validUntil: until } }); void load(); } catch (e) { setMsg(errorMessage(e)); } }}>Approve</button>
                        <button type="button" className={`${btnGhost} ml-1`} onClick={async () => { const note = window.prompt("Reason for rejecting?"); if (!note) return; try { await decideSubcontractor({ data: { id: s.id, decision: "Rejected", note } }); void load(); } catch (e) { setMsg(errorMessage(e)); } }}>Reject</button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody></table>
        </div>
      )}
      {open ? (
        <Modal title="Register subcontractor" onClose={() => setOpen(false)}>
          <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try { await registerSubcontractor({ data: { companyName: f.companyName, contactName: f.contactName || undefined, contactPhone: f.contactPhone || undefined, companySize: f.companySize, jobTypes: f.jobTypes, documents: f.docs.split(",").map((d) => d.trim()).filter(Boolean).map((name) => ({ name })) } }); setOpen(false); setMsg("Subcontractor registered, waiting for pre-qualification"); void load(); } catch (x) { setMsg(errorMessage(x)); } }}>
            <Field label="Company"><input required value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} className={inputCls} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Contact"><input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} className={inputCls} /></Field>
              <Field label="Phone"><input value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} className={inputCls} /></Field>
            </div>
            <Field label="Company size"><select value={f.companySize} onChange={(e) => setF({ ...f, companySize: e.target.value as typeof f.companySize })} className={inputCls}><option>Micro</option><option>Small</option><option>Medium</option><option>Large</option></select></Field>
            <fieldset><legend className="mb-1.5 text-xs font-medium uppercase tracking-wider text-fg-subtle">Kazi</legend>
              <div className="grid grid-cols-2 gap-2">{JOB_TYPES.map((j) => (<label key={j} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.jobTypes.includes(j)} onChange={(e) => setF({ ...f, jobTypes: e.target.checked ? [...f.jobTypes, j] : f.jobTypes.filter((x) => x !== j) })} /> {j}</label>))}</div>
            </fieldset>
            <Field label="Safety files provided (comma separated)"><input value={f.docs} onChange={(e) => setF({ ...f, docs: e.target.value })} placeholder="HSE policy, insurance, method statement" className={inputCls} /></Field>
            <button type="submit" disabled={f.jobTypes.length === 0} className={`${btnPrimary} w-full`}>Register</button>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
