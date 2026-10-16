import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { ClipboardList, Users } from "lucide-react";
import { RoleGate } from "@/components/role-gate";
import { Panel } from "@/components/app-shell";
import { EmptyState, Kpi, Notice, StatusBadge, btnPrimary } from "@/components/ui-kit";
import { SafetyHubWorkspace } from "@/components/hse/safetyhub-workspace";
import { SiteReportDialog } from "@/components/daily/daily";
import { listAttendance, listSiteReports, type AttendanceRow, type SiteReport } from "@/lib/ehs/daily";
import { listProjects } from "@/lib/ehs/server";
import { formatDate, todayIso } from "@/lib/ui/format";
import { useLive } from "@/lib/ui/use-live";

export const Route = createFileRoute("/teamleader")({ component: TeamLeaderPage });

function TeamLeaderPage() {
  return <RoleGate path="/teamleader">{(profile) => <TeamWorkspace profile={profile} />}</RoleGate>;
}

function TeamWorkspace({ profile }: { profile: import("@/lib/ehs/server").Profile }) {
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [reports, setReports] = useState<SiteReport[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const [p, a, r] = await Promise.all([listProjects().catch(() => []), listAttendance({ data: todayIso() }).catch(() => []), listSiteReports().catch(() => [])]);
    setProjects(p.map((x) => ({ id: Number(x.id), name: x.name })));
    setAttendance(a);
    setReports(r);
  }, []);
  useLive(load, 30000);
  const onSite = attendance.filter((x) => !x.checkOut).length;
  return <main className="mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold">Team & site</h1><p className="mt-1 text-sm text-fg-muted">Team leaders file one site report at the end of each working day.</p></div><button type="button" className={btnPrimary} disabled={!projects.length} onClick={() => setReportOpen(true)}>Submit daily site report</button></div>
    <Notice msg={message} onClose={() => setMessage("")} />
    <div className="grid gap-3 sm:grid-cols-3"><Kpi label="Assigned projects" value={projects.length} /><Kpi label="Checked in today" value={onSite} hint="For your assigned projects" /><Kpi label="Recent site reports" value={reports.length} /></div>
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Today’s team attendance">
        <p className="mb-3 text-xs text-fg-muted">Only attendance from your assigned projects is shown.</p>
        {attendance.length === 0 ? <EmptyState title="No attendance recorded today" hint="Team members’ check-ins appear here when they select an assigned project." /> : <ul className="divide-y divide-border">{attendance.map((a) => <li key={a.id} className="flex items-center gap-3 py-3"><span className="grid size-9 place-items-center rounded-full bg-accent/10 text-accent"><Users className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{a.name ?? "Team member"}</span><span className="block text-xs text-fg-muted">{a.projectName ?? "Project"} · {a.location ?? "Site"}</span></span><span className="text-right text-xs text-fg-muted">{new Date(a.checkIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}<span className="block"><StatusBadge status={a.checkOut ? "Complete" : "On site"} /></span></span></li>)}</ul>}
      </Panel>
      <Panel title="Site progress">
        <p className="mb-3 text-xs text-fg-muted">Daily reports and issues submitted by your assigned site team.</p>
        {reports.length === 0 ? <EmptyState title="No site reports yet" hint="Submit the team’s end-of-day report here. Reports from your assigned projects will appear in this list." /> : <ul className="divide-y divide-border">{reports.slice(0, 10).map((r) => <li key={r.id} className="py-3"><div className="flex justify-between gap-3"><p className="text-sm font-medium">{r.projectName ?? "Project"}</p><span className="text-xs text-fg-muted">{formatDate(r.reportDate)}</span></div><p className="mt-1 text-sm text-fg-muted">{r.summary}</p>{r.issues ? <p className="mt-1 text-sm text-warn">Issue: {r.issues}</p> : null}<p className="mt-1 text-xs text-fg-muted">{r.workers} workers · {r.hoursPerWorker} hours each · {r.author ?? "Team member"}</p></li>)}</ul>}
      </Panel>
    </div>
    <section><h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><ClipboardList className="size-5" /> Safety actions & wellbeing</h2><SafetyHubWorkspace profile={profile} compact /></section>
    {reportOpen ? <SiteReportDialog projects={projects} onClose={() => setReportOpen(false)} onDone={(m) => { setReportOpen(false); setMessage(m); void load(); }} /> : null}
  </main>;
}
