import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, Panel, StatCard } from "@/components/app-shell";
import { AnnouncementComposer } from "@/components/announcement-composer";
import { RoleGate } from "@/components/role-gate";
import { useLive } from "@/lib/ui/use-live";
import { TabBar } from "@/components/ui-kit";
import { AttendanceBoard, LeaveApprovals } from "@/components/daily/daily";
import { can } from "@/lib/ehs/access";
import { deleteAnnouncement, listAnnouncements, listCertificates, listAllUsersForManager, type Announcement, type Certificate } from "@/lib/ehs/server";
import type { EhsRole } from "@/lib/ehs/roles";
import { Award, Users } from "lucide-react";

export const Route = createFileRoute("/hr")({ component: HrPage });

function HrPage() {
  return <RoleGate path="/hr">{(profile) => <HrDashboard name={profile.fullName} role={profile.role} userId={profile.userId} canLeave={can(profile, "leave.approve")} canAttendance={can(profile, "attendance.view")} canHr={can(profile, "hr.manage")} />}</RoleGate>;
}

function HrDashboard({ name, role, userId, canLeave, canAttendance, canHr }: { name: string; role: EhsRole; userId: string; canLeave: boolean; canAttendance: boolean; canHr: boolean }) {
  const [tab, setTab] = useState<"people" | "leave" | "attendance">(canHr ? "people" : canLeave ? "leave" : "attendance");
  const tabs = [...(canHr ? [{ id: "people" as const, label: "People and certificates" }] : []), ...(canLeave ? [{ id: "leave" as const, label: "Leave requests" }] : []), ...(canAttendance ? [{ id: "attendance" as const, label: "Attendance" }] : [])];
  const [users, setUsers] = useState<Array<{ userId: string; fullName: string; role: string; department: string }>>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [feedback, setFeedback] = useState("");

  const refresh = () => void Promise.all([listAllUsersForManager(), listCertificates(), listAnnouncements()]).then(([people, certs, notices]) => {
    setUsers(people); setCertificates(certs); setAnnouncements(notices);
  }).catch(() => setFeedback("Could not load HR records."));
  useLive(refresh, 30000);

  const expiring = certificates.filter((certificate) => new Date(certificate.expiresAt).getTime() <= Date.now() + 7 * 86400000).length;

  return <AppShell title={`HR workspace · ${name}`} subtitle="Manage people readiness, certificates, and announcements across Smart Hub." role={role}>
    <TabBar tabs={tabs} active={tab} onChange={setTab} />
    {tab === "leave" ? <LeaveApprovals userId={userId} /> : null}
    {tab === "attendance" ? <AttendanceBoard /> : null}
    {tab === "people" ? <>
    <div className="mb-6 grid gap-4 sm:grid-cols-3"><StatCard label="Employees" value={users.length} hint="Organization team" /><StatCard label="Certificates" value={certificates.length} hint="Readiness records" /><StatCard label="Expiry alerts" value={expiring} hint="Due within 7 days" /></div>
    <div className="grid gap-6 lg:grid-cols-2">
      <AnnouncementComposer onPublished={refresh} />
      <Panel title="Certificate readiness"><ul className="space-y-2">{certificates.length ? certificates.slice(0, 8).map((certificate) => <li key={certificate.id} className="flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2 text-sm"><span className="flex items-center gap-2"><Award className="size-4 text-accent" />{certificate.certificateType}</span><span className={certificate.status === "Valid" ? "text-ok" : "text-danger"}>{certificate.status} · {certificate.expiresAt}</span></li>) : <li className="text-sm text-fg-subtle">No certificates recorded.</li>}</ul></Panel>
      <Panel title="Team directory"><ul className="space-y-2">{users.slice(0, 10).map((user) => <li key={user.userId} className="flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2 text-sm"><span className="flex items-center gap-2"><Users className="size-4 text-accent" />{user.fullName}</span><span className="text-xs text-fg-muted">{user.role} · {user.department}</span></li>)}</ul></Panel>
      <Panel title="Recent announcements"><ul className="space-y-2">{announcements.length ? announcements.map((announcement) => <li key={announcement.id} className="flex items-start justify-between gap-3 rounded-md border border-border bg-bg px-3 py-2"><span><p className="text-sm font-medium">{announcement.title}</p><p className="text-sm text-fg-muted">{announcement.message}</p></span><button type="button" title="Delete announcement" onClick={async () => { if (!window.confirm("Delete this announcement?")) return; await deleteAnnouncement({ data: announcement.id }); refresh(); }} className="text-xs text-danger hover:underline">Delete</button></li>) : <li className="text-sm text-fg-subtle">No announcements yet.</li>}</ul></Panel>
    </div>
    </> : null}
  </AppShell>;
}
