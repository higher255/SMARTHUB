import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RoleGate } from "@/components/role-gate";
import { useLive } from "@/lib/ui/use-live";
import { AppShell, Field, Panel, StatCard, inputClass, primaryBtn } from "@/components/app-shell";
import { createJobOrder, listAnnouncements, listCertificates, listPermits, listProjects, type Announcement, type Certificate, type Permit, type Project } from "@/lib/ehs/server";
import type { EhsRole } from "@/lib/ehs/roles";
import { AlertTriangle, ClipboardCheck, FileBadge, FolderOpen, Megaphone, Plus } from "lucide-react";

export const Route = createFileRoute("/client")({ component: ClientPage });

function ClientPage() {
  return <RoleGate path="/client">{(profile) => <ClientDashboard name={profile.fullName} role={profile.role} />}</RoleGate>;
}

function ClientDashboard({ name, role }: { name: string; role: EhsRole }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [permits, setPermits] = useState<Permit[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementIndex, setAnnouncementIndex] = useState(0);
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [message, setMessage] = useState("");

  const refresh = () => void Promise.all([listProjects(), listPermits(), listCertificates(), listAnnouncements()]).then(([projectRows, permitRows, certificateRows, announcementRows]) => {
    setProjects(projectRows); setPermits(permitRows); setCertificates(certificateRows); setAnnouncements(announcementRows);
  }).catch(() => undefined);
  useLive(refresh, 30000);
  useEffect(() => { if (announcements.length < 2) return; const timer = window.setInterval(() => setAnnouncementIndex((index) => (index + 1) % announcements.length), 5000); return () => window.clearInterval(timer); }, [announcements.length]);

  const submitJobOrder = async (event: React.FormEvent) => { event.preventDefault(); try { await createJobOrder({ data: { title, location } }); setTitle(""); setLocation(""); setMessage("Job order submitted for review."); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not submit job order"); } };
  const expiring = certificates.filter((certificate) => certificate.status !== "Valid" || new Date(certificate.expiresAt).getTime() < Date.now() + 7 * 86400000).length;

  return <AppShell title={`Client workspace · ${name}`} subtitle="See your projects, site readiness, permits, and team compliance in one place." role={role}>
    {announcements.length > 0 ? <section className="mb-6 rounded-xl border border-accent/30 bg-accent/5 p-5"><div className="flex items-center gap-2 text-sm font-semibold"><Megaphone className="size-4 text-accent" /> Announcement</div><p className="mt-2 text-lg font-semibold">{announcements[announcementIndex]?.title}</p><p className="text-sm text-fg-muted">{announcements[announcementIndex]?.message}</p><div className="mt-3 flex gap-1">{announcements.map((announcement, index) => <button type="button" aria-label={`Show announcement ${index + 1}`} key={announcement.id} onClick={() => setAnnouncementIndex(index)} className={`size-2 rounded-full ${index === announcementIndex ? "bg-accent" : "bg-border-strong"}`} />)}</div></section> : null}
    <div className="mb-6 grid gap-4 sm:grid-cols-4"><StatCard label="Projects" value={projects.length} hint="Your active portfolio" /><StatCard label="Open PTW" value={permits.filter((permit) => permit.status === "Pending").length} hint="Awaiting approval" /><StatCard label="Certificate alerts" value={expiring} hint="Expiring or invalid" /><StatCard label="Readiness" value={expiring === 0 ? "Ready" : "Review"} hint="Team compliance" /></div>
    <div className="grid gap-6 lg:grid-cols-3"><Panel title="Submit job order"><form onSubmit={submitJobOrder} className="space-y-3"><Field label="Job title"><input required value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} placeholder="Site installation request" /></Field><Field label="Site / location"><input required value={location} onChange={(event) => setLocation(event.target.value)} className={inputClass} placeholder="Site location" /></Field><button className={primaryBtn} type="submit"><Plus className="size-4" /> Submit order</button>{message ? <p className="text-sm text-fg-muted">{message}</p> : null}</form></Panel><Panel title="Your projects"><ul className="space-y-2">{projects.length ? projects.map((project) => <li key={project.id} className="rounded-md border border-border bg-bg px-3 py-3"><div className="flex items-center gap-2"><FolderOpen className="size-4 text-accent" /><span className="text-sm font-medium">{project.name}</span></div><p className="mt-1 text-xs text-fg-muted">{project.status} · Deadline {project.deadline || "not set"}</p></li>) : <li className="text-sm text-fg-subtle">No projects assigned yet.</li>}</ul></Panel><Panel title="Safety readiness"><div className="space-y-3"><p className="text-sm text-fg-muted">Certificates are checked against their expiry date before work begins.</p>{expiring ? <p className="flex items-center gap-2 text-sm text-danger"><AlertTriangle className="size-4" /> {expiring} certificate alert{expiring === 1 ? "" : "s"}</p> : <p className="flex items-center gap-2 text-sm text-ok"><FileBadge className="size-4" /> Team certificates are current</p>}<p className="flex items-center gap-2 text-sm text-fg-muted"><ClipboardCheck className="size-4" /> {permits.length} permits on record</p></div></Panel></div>
  </AppShell>;
}