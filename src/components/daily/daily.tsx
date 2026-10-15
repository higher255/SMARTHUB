import { useCallback, useState } from "react";
import { CalendarDays, Clock, LogIn, LogOut, MapPin } from "lucide-react";
import { Field, Panel } from "@/components/app-shell";
import { EmptyState, Modal, Notice, StatusBadge, btnGhost, btnPrimary, inputCls } from "@/components/ui-kit";
import {
  cancelLeave, checkIn, checkOut, createSiteReport, decideLeave, getMyAttendance, listAttendance, listLeave, listSiteReports, requestLeave,
  type AttendanceRow, type LeaveRow, type SiteReport,
} from "@/lib/ehs/daily";
import { formatDate, todayIso } from "@/lib/ui/format";
import { errorMessage, useLive } from "@/lib/ui/use-live";

const time = (v: string | null) => (v ? new Date(v).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "-");

// ------------------------------------------------------------ attendance

export function AttendanceCard({ projects }: { projects: { id: number; name: string }[] }) {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMyAttendance>> | null>(null);
  const [location, setLocation] = useState("");
  const [workplace, setWorkplace] = useState<"office" | "other" | "">("");
  const [projectId, setProjectId] = useState<number | "">("");
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => setMe(await getMyAttendance().catch(() => null)), []);
  useLive(load, 60000);
  const today = me?.today;
  const run = async (fn: () => Promise<unknown>, done: string) => { try { await fn(); setMsg(done); await load(); } catch (e) { setMsg(errorMessage(e)); } };
  return (
    <Panel title="Attendance">
      <Notice msg={msg} onClose={() => setMsg("")} />
      {!today ? (
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">You have not checked in today.</p>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Are you working from the office today?</legend>
            <div className="flex gap-2">
              <button type="button" aria-pressed={workplace === "office"} className={workplace === "office" ? btnPrimary : btnGhost} onClick={() => { setWorkplace("office"); setLocation("Office"); }}>Yes, office</button>
              <button type="button" aria-pressed={workplace === "other"} className={workplace === "other" ? btnPrimary : btnGhost} onClick={() => { setWorkplace("other"); setLocation(""); }}>No</button>
            </div>
          </fieldset>
          {workplace === "other" ? <Field label="Where are you working today?"><input required value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Site, client office or remote location" className={inputCls} /></Field> : null}
          {projects.length ? <Field label="Project (optional)"><select value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : "")} className={inputCls}><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field> : null}
          <button type="button" disabled={!workplace || (workplace === "other" && !location.trim())} className={`${btnPrimary} w-full`} onClick={() => void run(() => checkIn({ data: { location: location.trim(), projectId: projectId ? Number(projectId) : undefined } }), "Checked in")}><LogIn className="size-4" /> Check in</button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">Checked in at <span className="font-semibold">{time(today.checkIn)}</span>{today.location ? <span className="text-fg-muted"> · {today.location}</span> : null}</p>
          {today.checkOut ? <p className="text-sm text-fg-muted">Checked out at {time(today.checkOut)}. Good work today.</p> : (
            <button type="button" className={`${btnGhost} w-full`} onClick={() => void run(() => checkOut(), "Checked out")}><LogOut className="size-4" /> Check out</button>
          )}
        </div>
      )}
    </Panel>
  );
}

export function AttendanceBoard() {
  const [date, setDate] = useState(todayIso());
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const load = useCallback(async () => setRows(await listAttendance({ data: date }).catch(() => [])), [date]);
  useLive(load, 30000);
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3"><Field label="Date"><input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field><p className="pb-2 text-sm text-fg-muted">{rows.length} checked in · {rows.filter((r) => !r.checkOut).length} still on duty</p></div>
      {rows.length === 0 ? <EmptyState title="Nobody checked in" hint="People check in from My work when they start." /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-bg-elevated">
          <table className="w-full min-w-[520px]"><thead className="border-b border-border"><tr>{["Name", "In", "Out", "Where"].map((h) => <th key={h} className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">{rows.map((r) => (<tr key={r.id}><td className="px-3 py-2.5 text-sm font-medium">{r.name ?? "Unknown"}</td><td className="px-3 py-2.5 text-sm">{time(r.checkIn)}</td><td className="px-3 py-2.5 text-sm">{time(r.checkOut)}</td><td className="px-3 py-2.5 text-sm text-fg-muted">{[r.projectName, r.location].filter(Boolean).join(" · ") || "-"}</td></tr>))}</tbody></table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ leave

export function LeaveDialog({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const [type, setType] = useState<"Annual" | "Sick" | "Compassionate" | "Unpaid" | "Permission" | "Other">("Annual");
  const [start, setStart] = useState(todayIso());
  const [end, setEnd] = useState(todayIso());
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  return (
    <Modal title="Request leave or permission" onClose={onClose}>
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try { const r = await requestLeave({ data: { leaveType: type, startDate: start, endDate: end, reason: reason || undefined } }); onDone(`${type === "Permission" ? "Permission" : "Leave"} request for ${r.days} day(s) sent to HR for approval`); } catch (x) { setErr(errorMessage(x)); } }}>
        <Notice msg={err} tone="danger" />
        <Field label="Type"><select value={type} onChange={(e) => setType(e.target.value as typeof type)} className={inputCls}><option>Annual</option><option>Sick</option><option>Compassionate</option><option>Unpaid</option><option>Permission</option><option>Other</option></select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><input type="date" value={start} min={todayIso()} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} className={inputCls} /></Field>
          <Field label="To"><input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className={inputCls} /></Field>
        </div>
        <Field label={type === "Permission" ? "Reason for permission (required)" : "Reason (optional)"}><textarea rows={2} required={type === "Permission"} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} /></Field>
        <button type="submit" className={`${btnPrimary} w-full`}>Send request</button>
      </form>
    </Modal>
  );
}

export function MyLeave({ userId, refreshKey }: { userId: string; refreshKey: number }) {
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => setRows((await listLeave().catch(() => [])).filter((l) => l.userId === userId)), [userId, refreshKey]);
  useLive(load, 30000);
  if (rows.length === 0) return null;
  return (
    <Panel title="My leave">
      <Notice msg={msg} onClose={() => setMsg("")} />
      <ul className="divide-y divide-border">
        {rows.slice(0, 5).map((l) => (
          <li key={l.id} className="flex items-center gap-3 py-2.5 text-sm">
            <CalendarDays className="size-4 shrink-0 text-fg-subtle" />
            <span className="min-w-0 flex-1">{l.leaveType} · {formatDate(l.startDate)} to {formatDate(l.endDate)} ({l.days}d){l.decisionNote ? <span className="block text-xs text-fg-muted">{l.decisionNote}</span> : null}</span>
            <StatusBadge status={l.status} />
            {["Pending", "Approved"].includes(l.status) && l.endDate >= todayIso() ? <button type="button" className="text-xs text-accent hover:underline" onClick={async () => { try { await cancelLeave({ data: l.id }); void load(); } catch (e) { setMsg(errorMessage(e)); } }}>Cancel</button> : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function LeaveApprovals({ userId }: { userId: string }) {
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => setRows(await listLeave().catch(() => [])), []);
  useLive(load, 20000);
  const decide = async (l: LeaveRow, decision: "Approved" | "Rejected") => {
    const note = decision === "Rejected" ? window.prompt("Reason for rejecting?") : undefined;
    if (decision === "Rejected" && !note) return;
    try { await decideLeave({ data: { id: l.id, decision, note: note || undefined } }); setMsg(`Leave ${decision.toLowerCase()}`); void load(); } catch (e) { setMsg(errorMessage(e)); }
  };
  return (
    <div className="space-y-4">
      <Notice msg={msg} onClose={() => setMsg("")} />
      {rows.length === 0 ? <EmptyState title="No leave requests" /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-bg-elevated">
          <table className="w-full min-w-[640px]"><thead className="border-b border-border"><tr>{["Person", "Leave", "Dates", "Status", ""].map((h, i) => <th key={i} className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-3 text-sm font-medium">{l.name ?? "Unknown"}</td>
                  <td className="px-3 py-3 text-sm">{l.leaveType}{l.reason ? <span className="block text-xs text-fg-muted">{l.reason}</span> : null}</td>
                  <td className="px-3 py-3 text-sm">{formatDate(l.startDate)} to {formatDate(l.endDate)} <span className="text-fg-muted">({l.days}d)</span></td>
                  <td className="px-3 py-3"><StatusBadge status={l.status} /></td>
                  <td className="px-3 py-3 text-right">{l.status === "Pending" && l.userId !== userId ? (<><button type="button" className={btnPrimary} onClick={() => void decide(l, "Approved")}>Approve</button><button type="button" className={`${btnGhost} ml-1.5`} onClick={() => void decide(l, "Rejected")}>Reject</button></>) : null}</td>
                </tr>
              ))}
            </tbody></table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ daily site reports

export function SiteReportDialog({ projects, onClose, onDone }: { projects: { id: number; name: string }[]; onClose: () => void; onDone: (m: string) => void }) {
  const [f, setF] = useState({ projectId: projects[0]?.id ? String(projects[0].id) : "", date: todayIso(), summary: "", workDone: "", issues: "", weather: "", workers: "", hours: "8" });
  const [err, setErr] = useState("");
  return (
    <Modal title="Daily site report" onClose={onClose} wide>
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        if (!f.projectId) return setErr("Please choose a project");
        try { await createSiteReport({ data: { projectId: Number(f.projectId), reportDate: f.date, summary: f.summary, workDone: f.workDone || undefined, issues: f.issues || undefined, weather: f.weather || undefined, workers: Number(f.workers) || 0, hoursPerWorker: Number(f.hours) || 0 } }); onDone("Site report filed. Hours worked were added to the safety statistics."); } catch (x) { setErr(errorMessage(x)); }
      }}>
        <Notice msg={err} tone="danger" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Project"><select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })} className={inputCls} required><option value="">Choose</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Date"><input type="date" value={f.date} max={todayIso()} onChange={(e) => setF({ ...f, date: e.target.value })} className={inputCls} /></Field>
          <Field label="Weather"><input value={f.weather} onChange={(e) => setF({ ...f, weather: e.target.value })} placeholder="Sunny, rain..." className={inputCls} /></Field>
        </div>
        <Field label="Summary of the day"><input required value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} className={inputCls} /></Field>
        <Field label="Work done"><textarea rows={3} value={f.workDone} onChange={(e) => setF({ ...f, workDone: e.target.value })} className={inputCls} /></Field>
        <Field label="Problems or delays (the project owner is told)"><textarea rows={2} value={f.issues} onChange={(e) => setF({ ...f, issues: e.target.value })} className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Workers on site"><input inputMode="numeric" value={f.workers} onChange={(e) => setF({ ...f, workers: e.target.value.replace(/\D/g, "") })} className={inputCls} /></Field>
          <Field label="Hours each"><input inputMode="decimal" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value.replace(/[^0-9.]/g, "") })} className={inputCls} /></Field>
        </div>
        <button type="submit" className={`${btnPrimary} w-full`}>File report</button>
      </form>
    </Modal>
  );
}

export function SiteReportsPanel() {
  const [rows, setRows] = useState<SiteReport[]>([]);
  useLive(async () => setRows(await listSiteReports().catch(() => [])), 30000);
  return (
    <section aria-label="Site reports" className="mb-6">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><MapPin className="size-4 text-accent" /> Recent site reports</h2>
      {rows.length === 0 ? <EmptyState title="No site reports yet" hint="Team leaders file one at the end of each working day." /> : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {rows.slice(0, 6).map((r) => (
            <li key={r.id} className="rounded-xl border border-border bg-bg-elevated p-4">
              <div className="mb-1 flex items-start justify-between gap-2"><p className="text-sm font-medium">{r.summary}</p><span className="shrink-0 text-xs text-fg-subtle">{formatDate(r.reportDate)}</span></div>
              <p className="text-xs text-fg-muted">{r.projectName ?? "General"} · {r.author ?? "Unknown"} · {r.workers} workers{r.weather ? ` · ${r.weather}` : ""}</p>
              {r.issues ? <p className="mt-2 rounded-md bg-warn/10 px-2.5 py-1.5 text-xs text-warn"><Clock className="mr-1 inline size-3.5" />{r.issues}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
