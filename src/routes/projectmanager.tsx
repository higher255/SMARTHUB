import { createFileRoute } from "@tanstack/react-router";
import { MoneyInput } from "@/components/finance/money-input";
import { useEffect, useState, useMemo } from "react";
import { RoleGate } from "@/components/role-gate";
import { Notice } from "@/components/ui-kit";
import { errorMessage, useLive } from "@/lib/ui/use-live";
import { ProjectHealth } from "@/components/project-health";
import { SiteReportsPanel } from "@/components/daily/daily";
import { AppShell, Field, Panel, StatCard, inputClass, primaryBtn, LogoutButton } from "@/components/app-shell";
import {
  createProject,
  createTask,
  deleteProject,
  listProjects,
  listTasks,
  listIncidents,
  listHealth,
  listVehicles,
  listAllUsers,
  listProjectMembers,
  assignProjectMember,
  listProjectMilestones,
  createProjectMilestone,
  requestProjectApproval,
  addProjectAttachment,
  type Project,
  type ProjectTask,
  type Incident,
  type HealthDeclaration,
  type Vehicle,
} from "@/lib/ehs/server";
import type { EhsRole } from "@/lib/ehs/roles";
import { ThemeToggle } from "@/components/theme-provider";
import { 
  Trash2, 
  Layers, 
  CheckCircle, 
  XCircle,        // ← ADDED
  Clock, 
  Users,
  Calendar,
  DollarSign,
  Plus,
  FolderOpen,
  ListTodo,
  ArrowRight,
  RefreshCw,
  Bell,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Download,
  FileText,
  PieChart,
  BarChart3,
  User,
  UserCheck,
  Car,
  Activity,
  Eye,
  Edit,
  Mail,
  Phone,
  Building2,
  MapPin,
  CalendarDays,
  Clock4,
  AlertTriangle,
  Shield,
  Printer,
  ChevronDown,
  Filter,
  Search
} from "lucide-react";

export const Route = createFileRoute("/projectmanager")({
  component: PmPage,
});

function PmPage() {
  return (
    <RoleGate path="/projectmanager">
      {(profile) => <PmDash name={profile.fullName} role={profile.role} />}
    </RoleGate>
  );
}

function PmDash({ name, role }: { name: string; role: EhsRole }) {
  // ========== STATE ==========
  const [tab, setTab] = useState<"projects" | "tasks" | "reports" | "team">("projects");
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [healthRecords, setHealthRecords] = useState<HealthDeclaration[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [reportPeriod, setReportPeriod] = useState<"weekly" | "monthly" | "quarterly">("weekly");
  const [reportType, setReportType] = useState<"summary" | "detailed" | "financial">("summary");
  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState<any[]>([]);
  const [milestones, setMilestones] = useState<any[]>([]);
  const [memberToAdd, setMemberToAdd] = useState("");
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [milestoneDueDate, setMilestoneDueDate] = useState("");
  const [approvalApprover, setApprovalApprover] = useState("");
  const [attachmentName, setAttachmentName] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");

  // ========== FORM STATES ==========
  const [projectName, setProjectName] = useState("");
  const [budget, setBudget] = useState("");
  const [deadline, setDeadline] = useState("");
  const [status, setStatus] = useState<"Planning" | "Active" | "Completed" | "On Hold">("Planning");
  const [taskTitle, setTaskTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState<"Low" | "Normal" | "High">("Normal");

  const fetchData = async () => {
    try {
      const [projectsData, tasksData, incidentsData, healthData, vehiclesData, usersData] = await Promise.all([
        listProjects(),
        listTasks(),
        listIncidents().catch(() => []),
        listHealth().catch(() => []),
        listVehicles().catch(() => []),
        listAllUsers().catch(() => [])
      ]);
      setProjects(projectsData || []);
      setTasks(tasksData || []);
      setIncidents(incidentsData || []);
      setHealthRecords(healthData || []);
      setVehicles(vehiclesData || []);
      setUsers(usersData || []);
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useLive(fetchData, 30000);

  useEffect(() => {
    if (!selectedProject) { setMembers([]); setMilestones([]); return; }
    void Promise.all([listProjectMembers({ data: selectedProject }), listProjectMilestones({ data: selectedProject })])
      .then(([memberRows, milestoneRows]) => { setMembers(memberRows); setMilestones(milestoneRows); })
      .catch(() => { setMembers([]); setMilestones([]); });
  }, [selectedProject]);

  // ========== COMPUTED VALUES ==========
  const stats = useMemo(() => ({
    totalProjects: projects.length,
    activeProjects: projects.filter(p => p.status === "Active").length,
    completedProjects: projects.filter(p => p.status === "Completed").length,
    onHoldProjects: projects.filter(p => p.status === "On Hold").length,
    totalBudget: projects.reduce((acc, p) => acc + p.budget, 0),
    totalTasks: tasks.length,
    pendingTasks: tasks.filter(t => t.status === "Pending").length,
    completedTasks: tasks.filter(t => t.status === "Completed").length,
    totalIncidents: incidents.length,
    openIncidents: incidents.filter(i => i.status !== "Closed" && i.status !== "Resolved").length,
    totalUsers: users.length,
    activeDrivers: users.filter(u => u.role === "Driver").length,
    activeVehicles: vehicles.filter(v => v.status === "Active").length,
    healthCompliance: healthRecords.length > 0 ? Math.round((healthRecords.filter(h => h.fitness === "Fit for Duty").length / healthRecords.length) * 100) : 0,
    completionRate: projects.length > 0 ? Math.round((projects.filter(p => p.status === "Completed").length / projects.length) * 100) : 0
  }), [projects, tasks, incidents, users, vehicles, healthRecords]);

  // ========== FILTERED DATA ==========
  const filteredProjects = useMemo(() => {
    if (!searchQuery) return projects;
    return projects.filter(p => 
      p.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.status?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [projects, searchQuery]);

  const filteredTasks = useMemo(() => {
    if (!searchQuery) return tasks;
    return tasks.filter(t => 
      t.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.assignee?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.status?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [tasks, searchQuery]);

  // ========== HANDLERS ==========
  const refresh = async () => {
    await fetchData();
  };

  const handleAssignMember = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedProject || !memberToAdd) return;
    setBusy(true);
    try {
      await assignProjectMember({ data: { projectId: selectedProject, userId: memberToAdd, role: "Contributor" } });
      setMemberToAdd("");
      setMembers(await listProjectMembers({ data: selectedProject }));
      setMsg("Assignment sent for acceptance.");
    } catch (error) { setMsg(errorMessage(error, "Could not assign member")); }
    finally { setBusy(false); }
  };

  const handleAddMilestone = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedProject || !milestoneTitle) return;
    setBusy(true);
    try {
      await createProjectMilestone({ data: { projectId: selectedProject, title: milestoneTitle, dueDate: milestoneDueDate || undefined } });
      setMilestoneTitle(""); setMilestoneDueDate("");
      setMilestones(await listProjectMilestones({ data: selectedProject }));
      setMsg("Milestone added to the project.");
    } catch (error) { setMsg(errorMessage(error, "Could not add milestone")); }
    finally { setBusy(false); }
  };

  const handleExportReport = () => {
    const data = {
      generatedAt: new Date().toISOString(),
      period: reportPeriod,
      type: reportType,
      summary: {
        totalProjects: stats.totalProjects,
        activeProjects: stats.activeProjects,
        completionRate: stats.completionRate,
        totalBudget: stats.totalBudget,
        totalTasks: stats.totalTasks,
        totalUsers: stats.totalUsers,
        totalIncidents: stats.totalIncidents
      },
      projects: projects.map(p => ({
        ...p,
        taskCount: tasks.filter(t => (t as any).projectId === p.id || !(t as any).projectId).length,
        completedTasks: tasks.filter(t => ((t as any).projectId === p.id || !(t as any).projectId) && t.status === "Completed").length,
      })),
      team: users.map(u => ({
        ...u,
        taskCount: tasks.filter(t => t.assignee === u.fullName || t.assignee === u.userId).length,
      }))
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `project-report-${reportPeriod}-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg("Report exported successfully!");
  };

  const handleExportCsv = () => {
    const headers = ["Project", "Status", "Budget", "Deadline", "Tasks", "Completed tasks"];
    const rows = projects.map((project) => {
      const projectTasks = tasks.filter((task) => (task as any).projectId === project.id);
      return [project.name, project.status, project.budget, project.deadline ?? "", projectTasks.length, projectTasks.filter((task) => task.status === "Completed").length];
    });
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `smart-ehs-projects-${reportPeriod}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setMsg("Project spreadsheet exported.");
  };

  // ========== BADGE HELPERS ==========
  function getStatusBadge(status: string): string {
    const map: Record<string, string> = {
      'Active': 'bg-ok/20 text-ok',
      'Planning': 'bg-blue-500/20 text-blue-500',
      'Completed': 'bg-purple-500/20 text-purple-500',
      'On Hold': 'bg-warn/20 text-warn',
      'Pending': 'bg-warn/20 text-warn',
      'In Progress': 'bg-accent/20 text-accent',
      'Open': 'bg-danger/20 text-danger',
      'Closed': 'bg-gray-500/20 text-gray-500',
      'Resolved': 'bg-ok/20 text-ok',
    };
    return map[status] || 'bg-gray-500/20 text-gray-500';
  }

  // ========== LOADING ==========
  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-center">
          <div className="size-12 border-4 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-fg-muted font-medium">Loading project manager workspace...</p>
        </div>
      </div>
    );
  }

  // ============================================
  // RENDER
  // ============================================
  return (
    <div className="min-h-screen bg-bg text-fg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        
        {/* ======================================== */}
        {/* HEADER */}
        {/* ======================================== */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-fg flex items-center gap-2">
              <Layers className="size-5 text-accent-bright" />
              Project Manager EHS Control
            </h2>
            <p className="text-fg-muted mt-1">
              Welcome back, <span className="font-semibold text-fg">{name}</span> — 
              timelines, budgets, teams, and safety compliance
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={refresh}
              disabled={refreshing}
              className="p-2 border border-border rounded-lg hover:bg-bg-subtle transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`size-4 text-fg-muted ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* ======================================== */}
        {/* SEARCH BAR */}
        {/* ======================================== */}
        <div className="mb-6 bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-fg-subtle" />
              <input
                type="text"
                placeholder="Search projects, tasks, assignees..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-bg-subtle border border-border rounded-lg text-sm text-fg placeholder-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all"
              />
            </div>
            <button className="flex items-center gap-2 px-4 py-2 bg-accent text-accent-fg rounded-lg text-sm font-medium hover:bg-accent-bright transition-colors whitespace-nowrap">
              <Filter className="size-4" />
              Filter
            </button>
          </div>
        </div>

        {/* ======================================== */}
        {/* NOTIFICATIONS */}
        {/* ======================================== */}
        {/* ======================================== */}
        {/* STATS CARDS */}
        {/* ======================================== */}
        <div className="mb-6 grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-fg-muted font-medium uppercase tracking-wider">Total Projects</p>
                <p className="text-2xl font-bold text-fg mt-1">{stats.totalProjects}</p>
              </div>
              <div className="size-10 rounded-lg bg-accent/10 flex items-center justify-center">
                <FolderOpen className="size-5 text-accent" />
              </div>
            </div>
            <p className="text-xs text-fg-muted mt-2">{stats.activeProjects} active · {stats.completedProjects} done</p>
          </div>

          <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-fg-muted font-medium uppercase tracking-wider">Budget</p>
                <p className="text-2xl font-bold text-fg mt-1">TZS {(stats.totalBudget / 1000000).toFixed(1)}M</p>
              </div>
              <div className="size-10 rounded-lg bg-ok/10 flex items-center justify-center">
                <DollarSign className="size-5 text-ok" />
              </div>
            </div>
            <p className="text-xs text-fg-muted mt-2">Across {stats.totalProjects} projects</p>
          </div>

          <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-fg-muted font-medium uppercase tracking-wider">Tasks</p>
                <p className="text-2xl font-bold text-fg mt-1">{stats.totalTasks}</p>
              </div>
              <div className="size-10 rounded-lg bg-warn/10 flex items-center justify-center">
                <ListTodo className="size-5 text-warn" />
              </div>
            </div>
            <p className="text-xs text-fg-muted mt-2">{stats.pendingTasks} pending</p>
          </div>

          <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-fg-muted font-medium uppercase tracking-wider">Team</p>
                <p className="text-2xl font-bold text-fg mt-1">{stats.totalUsers}</p>
              </div>
              <div className="size-10 rounded-lg bg-accent/10 flex items-center justify-center">
                <Users className="size-5 text-accent" />
              </div>
            </div>
            <p className="text-xs text-fg-muted mt-2">{stats.activeDrivers} drivers</p>
          </div>

          <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-fg-muted font-medium uppercase tracking-wider">Completion</p>
                <p className="text-2xl font-bold text-ok mt-1">{stats.completionRate}%</p>
              </div>
              <div className="size-10 rounded-lg bg-ok/10 flex items-center justify-center">
                <TrendingUp className="size-5 text-ok" />
              </div>
            </div>
            <p className="text-xs text-fg-muted mt-2">Project progress</p>
          </div>
        </div>

        {/* ======================================== */}
        {/* TABS */}
        {/* ======================================== */}
        <div className="mb-6 overflow-x-auto">
          <div className="flex gap-1 border-b border-border min-w-max">
            <button
              onClick={() => setTab("projects")}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all border-b-2 whitespace-nowrap ${
                tab === "projects" ? 'border-accent text-accent bg-accent/5' : 'border-transparent text-fg-muted hover:text-fg hover:bg-bg-subtle'
              }`}
            >
              <FolderOpen className="size-4" /> Projects
            </button>
            <button
              onClick={() => setTab("tasks")}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all border-b-2 whitespace-nowrap ${
                tab === "tasks" ? 'border-accent text-accent bg-accent/5' : 'border-transparent text-fg-muted hover:text-fg hover:bg-bg-subtle'
              }`}
            >
              <ListTodo className="size-4" /> Tasks & Milestones
            </button>
            <button
              onClick={() => setTab("reports")}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all border-b-2 whitespace-nowrap ${
                tab === "reports" ? 'border-accent text-accent bg-accent/5' : 'border-transparent text-fg-muted hover:text-fg hover:bg-bg-subtle'
              }`}
            >
              <BarChart3 className="size-4" /> Reports
            </button>
            <button
              onClick={() => setTab("team")}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all border-b-2 whitespace-nowrap ${
                tab === "team" ? 'border-accent text-accent bg-accent/5' : 'border-transparent text-fg-muted hover:text-fg hover:bg-bg-subtle'
              }`}
            >
              <Users className="size-4" /> Team
            </button>
          </div>
        </div>

        {/* ======================================== */}
        {/* MESSAGES */}
        {/* ======================================== */}
        {msg && <Notice msg={msg} onClose={() => setMsg("")} />}

        {/* ======================================== */}
        {/* TAB: PROJECTS */}
        {/* ======================================== */}
        <ProjectHealth />
        <SiteReportsPanel />

        {tab === "projects" && (
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Create Project Form */}
            <div className="bg-bg-elevated rounded-xl border border-border p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-fg mb-4 flex items-center gap-2">
                <Plus className="size-5 text-accent" />
                New Project
              </h3>
              <form className="space-y-4" onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setMsg("");
                try {
                  await createProject({
                    data: { name: projectName, budget: Number(budget) || 0, deadline, status },
                  });
                  setProjectName(""); setBudget(""); setDeadline(""); setStatus("Planning");
                  setMsg("Project created successfully!");
                  await refresh();
                } catch (err) {
                  setMsg(errorMessage(err, "Could not create project"));
                } finally { setBusy(false); }
              }}>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-fg">Project Name</label>
                  <input required value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Plant safety upgrade" className={inputClass} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-fg">Budget (TZS)</label>
                  <MoneyInput required value={budget} onChange={setBudget} placeholder="1,000,000" className={inputClass} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-fg">Deadline</label>
                  <input required type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={inputClass} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-fg">Status</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={inputClass}>
                    <option value="Planning">Planning</option>
                    <option value="Active">Active</option>
                    <option value="On Hold">On Hold</option>
                    <option value="Completed">Completed</option>
                  </select>
                </div>
                <button disabled={busy} className={primaryBtn} type="submit">{busy ? "Saving…" : "Create Project"}</button>
              </form>
            </div>

            {/* Project List */}
            <div className="bg-bg-elevated rounded-xl border border-border p-6 shadow-sm lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-fg">All Projects ({filteredProjects.length})</h3>
                <span className="text-xs text-fg-muted bg-bg-subtle px-2 py-1 rounded">{stats.activeProjects} active</span>
              </div>
              {filteredProjects.length === 0 ? (
                <div className="text-center py-12 text-fg-muted">
                  <FolderOpen className="size-12 mx-auto mb-3 text-fg-subtle" />
                  <p className="text-sm font-medium">No projects found</p>
                  <p className="text-xs">Create your first project to get started</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                  {filteredProjects.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg p-4 hover:border-accent transition-all">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-fg">{p.name}</span>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${getStatusBadge(p.status)}`}>{p.status}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-4 mt-1 text-xs text-fg-muted">
                          <span className="flex items-center gap-1"><DollarSign className="size-3" /> TZS {p.budget.toLocaleString()}</span>
                          {p.deadline && <span className="flex items-center gap-1"><Calendar className="size-3" /> {new Date(p.deadline).toLocaleDateString()}</span>}
                          <span className="flex items-center gap-1"><Clock className="size-3" /> {new Date(p.createdAt).toLocaleDateString()}</span>
                          <span className="flex items-center gap-1">
                            <ListTodo className="size-3" /> {tasks.filter(t => (t as any).projectId === p.id || !(t as any).projectId).length} tasks
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setSelectedProject(p.id)} className="p-2 rounded-lg text-accent hover:bg-accent/10 transition-colors" title="Open project workspace">
                          <Eye className="size-4" />
                        </button>
                        <button className="p-2 rounded-lg text-danger hover:bg-danger/10 transition-colors" onClick={async () => {
                          if (!confirm(`Delete "${p.name}"?`)) return;
                          await deleteProject({ data: p.id });
                          await refresh();
                          setMsg("Project deleted");
                        }}>
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          {selectedProject ? (
            <div className="mt-6 grid gap-6 lg:grid-cols-3">
              <div className="rounded-xl border border-border bg-bg-elevated p-6">
                <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold"><Users className="size-5 text-accent" /> Team assignment</h3>
                <form onSubmit={handleAssignMember} className="space-y-3">
                  <select required value={memberToAdd} onChange={(event) => setMemberToAdd(event.target.value)} className={inputClass}>
                    <option value="">Select a team member</option>
                    {users.map((user) => <option key={user.userId} value={user.userId}>{user.fullName} · {user.role}</option>)}
                  </select>
                  <button disabled={busy} className={primaryBtn} type="submit">Send assignment</button>
                </form>
                <ul className="mt-4 space-y-2 text-sm">
                  {members.map((member) => <li key={member.id} className="flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2"><span>{member.fullName}</span><span className="text-xs text-fg-muted">{member.status}</span></li>)}
                </ul>
                <div className="mt-4 flex gap-2">
                  <select value={approvalApprover} onChange={(event) => setApprovalApprover(event.target.value)} className={inputClass}>
                    <option value="">Select approver</option>
                    {users.filter((user) => user.role === "Manager" || user.role === "Admin" || user.role === "EHS_Officer").map((user) => <option key={user.userId} value={user.userId}>{user.fullName} · {user.role}</option>)}
                  </select>
                  <button disabled={!approvalApprover || busy} onClick={async () => { try { await requestProjectApproval({ data: { projectId: selectedProject, approverId: approvalApprover } }); setMsg("Approval requested."); } catch (error) { setMsg(errorMessage(error, "Could not request approval")); } }} className="whitespace-nowrap rounded-md border border-accent/40 px-3 py-2 text-sm text-accent hover:bg-accent/10">Request approval</button>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-bg-elevated p-6 lg:col-span-2">
                <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold"><ListTodo className="size-5 text-accent" /> Milestones</h3>
                <form onSubmit={handleAddMilestone} className="mb-4 flex flex-col gap-2 sm:flex-row">
                  <input required value={milestoneTitle} onChange={(event) => setMilestoneTitle(event.target.value)} placeholder="Milestone name" className={inputClass} />
                  <input type="date" value={milestoneDueDate} onChange={(event) => setMilestoneDueDate(event.target.value)} className={inputClass} />
                  <button disabled={busy} className={`${primaryBtn} sm:max-w-40`} type="submit"><Plus className="size-4" /> Add</button>
                </form>
                <ul className="space-y-2">
                  {milestones.length === 0 ? <li className="text-sm text-fg-subtle">No milestones yet.</li> : milestones.map((milestone) => <li key={milestone.id} className="flex items-center justify-between rounded-md border border-border bg-bg px-3 py-3"><span><span className="block text-sm font-medium">{milestone.title}</span><span className="text-xs text-fg-muted">Due {milestone.dueDate || "not set"}</span></span><span className="text-xs text-fg-muted">{milestone.status}</span></li>)}
                </ul>
                <form onSubmit={async (event) => { event.preventDefault(); if (!selectedProject) return; try { await addProjectAttachment({ data: { projectId: selectedProject, fileName: attachmentName, fileUrl: attachmentUrl, attachmentType: "project-document" } }); setAttachmentName(""); setAttachmentUrl(""); setMsg("Attachment linked to the project."); } catch (error) { setMsg(errorMessage(error, "Could not link attachment")); } }} className="mt-5 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row">
                  <input required value={attachmentName} onChange={(event) => setAttachmentName(event.target.value)} placeholder="Attachment name" className={inputClass} />
                  <input required type="url" value={attachmentUrl} onChange={(event) => setAttachmentUrl(event.target.value)} placeholder="https://..." className={inputClass} />
                  <button disabled={busy} className={`${primaryBtn} sm:max-w-40`} type="submit">Link file</button>
                </form>
              </div>
            </div>
          ) : null}
          </div>
        )}

        {/* ======================================== */}
        {/* TAB: TASKS */}
        {/* ======================================== */}
        {tab === "tasks" && (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="bg-bg-elevated rounded-xl border border-border p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-fg mb-4 flex items-center gap-2">
                <Plus className="size-5 text-accent" /> New Task
              </h3>
              <form className="space-y-4" onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await createTask({ data: { title: taskTitle, assignee, priority, projectId: selectedProject ?? undefined } });
                  setTaskTitle(""); setAssignee(""); setPriority("Normal");
                  setMsg("Task added successfully!");
                  await refresh();
                } catch (err) {
                  setMsg(errorMessage(err, "Could not add task"));
                }
              }}>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-fg">Task Title</label>
                  <input required value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Complete safety audit" className={inputClass} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-fg">Assignee</label>
                  <input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="John Doe" className={inputClass} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-fg">Priority</label>
                  <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className={inputClass}>
                    <option value="Low">Low</option>
                    <option value="Normal">Normal</option>
                    <option value="High">High</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-fg">Project</label>
                  <select value={selectedProject || ""} onChange={(event) => setSelectedProject(event.target.value ? Number(event.target.value) : null)} className={inputClass}>
                    <option value="">Select project</option>
                    {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </select>
                </div>
                <button className={primaryBtn} type="submit">Add Task</button>
              </form>
            </div>

            <div className="bg-bg-elevated rounded-xl border border-border p-6 shadow-sm lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-fg">Task List ({filteredTasks.length})</h3>
                <span className="text-xs text-fg-muted bg-bg-subtle px-2 py-1 rounded">{stats.pendingTasks} pending</span>
              </div>
              {filteredTasks.length === 0 ? (
                <div className="text-center py-12 text-fg-muted">
                  <ListTodo className="size-12 mx-auto mb-3 text-fg-subtle" />
                  <p className="text-sm font-medium">No tasks found</p>
                  <p className="text-xs">Add your first task to track progress</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
                  {filteredTasks.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg p-4 hover:border-accent transition-all">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-fg">{t.title}</span>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${getStatusBadge(t.priority)}`}>{t.priority}</span>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${getStatusBadge(t.status)}`}>{t.status}</span>
                        </div>
                        <p className="text-xs text-fg-muted mt-1">
                          {t.assignee || "Unassigned"} · {new Date(t.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <button className="p-2 rounded-lg text-ok hover:bg-ok/10 transition-colors" onClick={() => setMsg("Task marked complete")}>
                        <CheckCircle className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ======================================== */}
        {/* TAB: REPORTS */}
        {/* ======================================== */}
        {tab === "reports" && (
          <div className="space-y-6">
            {/* Report Controls */}
            <div className="bg-bg-elevated rounded-xl border border-border p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-fg mb-4 flex items-center gap-2">
                <BarChart3 className="size-5 text-accent" />
                Project Reports
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-fg">Period</label>
                  <select value={reportPeriod} onChange={(e) => setReportPeriod(e.target.value as any)} className={inputClass}>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-fg">Report Type</label>
                  <select value={reportType} onChange={(e) => setReportType(e.target.value as any)} className={inputClass}>
                    <option value="summary">Summary</option>
                    <option value="detailed">Detailed</option>
                    <option value="financial">Financial</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-fg">Project</label>
                  <select value={selectedProject || ""} onChange={(e) => setSelectedProject(e.target.value ? Number(e.target.value) : null)} className={inputClass}>
                    <option value="">All Projects</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="flex items-end gap-2">
                  <button onClick={handleExportReport} className={`${primaryBtn} flex-1 flex items-center justify-center gap-2`}><Download className="size-4" /> Report JSON</button>
                  <button onClick={handleExportCsv} className={`${primaryBtn} flex items-center justify-center gap-2 bg-ok text-white hover:bg-ok/90`} title="Export spreadsheet"><FileText className="size-4" /></button>
                  <button className={`${primaryBtn} flex items-center justify-center gap-2 bg-accent/20 text-accent hover:bg-accent/30`}>
                    <Printer className="size-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Report Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
                <p className="text-xs text-fg-muted">Total Projects</p>
                <p className="text-2xl font-bold text-fg">{stats.totalProjects}</p>
                <p className="text-xs text-ok">{stats.completionRate}% complete</p>
              </div>
              <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
                <p className="text-xs text-fg-muted">Total Budget</p>
                <p className="text-2xl font-bold text-fg">TZS {(stats.totalBudget / 1000000).toFixed(1)}M</p>
                <p className="text-xs text-fg-muted">Across all projects</p>
              </div>
              <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
                <p className="text-xs text-fg-muted">Team Members</p>
                <p className="text-2xl font-bold text-fg">{stats.totalUsers}</p>
                <p className="text-xs text-fg-muted">{stats.activeDrivers} drivers</p>
              </div>
              <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
                <p className="text-xs text-fg-muted">Incidents</p>
                <p className="text-2xl font-bold text-warn">{stats.totalIncidents}</p>
                <p className="text-xs text-danger">{stats.openIncidents} open</p>
              </div>
            </div>

            {/* Report Details */}
            <div className="bg-bg-elevated rounded-xl border border-border p-6 shadow-sm">
              <h4 className="text-md font-semibold text-fg mb-4">Project Details</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-bg-subtle border-b border-border">
                    <tr>
                      <th className="px-4 py-2 text-left text-fg-muted font-medium">Project</th>
                      <th className="px-4 py-2 text-left text-fg-muted font-medium">Status</th>
                      <th className="px-4 py-2 text-right text-fg-muted font-medium">Budget</th>
                      <th className="px-4 py-2 text-center text-fg-muted font-medium">Tasks</th>
                      <th className="px-4 py-2 text-center text-fg-muted font-medium">Progress</th>
                      <th className="px-4 py-2 text-center text-fg-muted font-medium">Team</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {projects.map((p) => {
                      // FIXED: Use (t as any).projectId
                      const projectTasks = tasks.filter(t => (t as any).projectId === p.id || !(t as any).projectId);
                      const completed = projectTasks.filter(t => t.status === "Completed").length;
                      const progress = projectTasks.length > 0 ? Math.round((completed / projectTasks.length) * 100) : 0;
                      return (
                        <tr key={p.id} className="hover:bg-bg-subtle transition-colors">
                          <td className="px-4 py-3 font-medium text-fg">{p.name}</td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${getStatusBadge(p.status)}`}>
                              {p.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-fg-muted">TZS {p.budget.toLocaleString()}</td>
                          <td className="px-4 py-3 text-center text-fg-muted">{completed}/{projectTasks.length}</td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <div className="w-20 h-2 bg-bg-subtle rounded-full overflow-hidden">
                                <div className="h-full bg-ok rounded-full" style={{ width: `${progress}%` }} />
                              </div>
                              <span className="text-xs text-fg-muted">{progress}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center text-fg-muted">
                            {users.filter(u => u.role === "Driver" || u.role === "Employee").slice(0, 2).map(u => u.fullName).join(", ")}
                            {users.filter(u => u.role === "Driver" || u.role === "Employee").length > 2 && " +..."}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ======================================== */}
        {/* TAB: TEAM */}
        {/* ======================================== */}
        {tab === "team" && (
          <div className="bg-bg-elevated rounded-xl border border-border p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-fg flex items-center gap-2">
                <Users className="size-5 text-accent" />
                Team Overview ({stats.totalUsers} members)
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-fg-muted bg-bg-subtle px-2 py-1 rounded">{stats.activeDrivers} Drivers</span>
                <span className="text-xs text-fg-muted bg-bg-subtle px-2 py-1 rounded">{users.filter(u => u.role === "Employee").length} Employees</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-bg-subtle border-b border-border">
                  <tr>
                    <th className="px-4 py-3 text-left text-fg-muted font-medium">Name</th>
                    <th className="px-4 py-3 text-left text-fg-muted font-medium">Role</th>
                    <th className="px-4 py-3 text-left text-fg-muted font-medium">Department</th>
                    <th className="px-4 py-3 text-center text-fg-muted font-medium">Tasks</th>
                    <th className="px-4 py-3 text-center text-fg-muted font-medium">Health Status</th>
                    <th className="px-4 py-3 text-center text-fg-muted font-medium">Status</th>
                    <th className="px-4 py-3 text-center text-fg-muted font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {users.map((u) => {
                    const userTasks = tasks.filter(t => t.assignee === u.fullName || t.assignee === u.userId);
                    const completedTasks = userTasks.filter(t => t.status === "Completed").length;
                    const health = healthRecords.filter(h => h.userId === u.userId);
                    const latestHealth = health[0]?.fitness || "N/A";
                    return (
                      <tr key={u.userId} className="hover:bg-bg-subtle transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="size-8 rounded-full bg-accent/10 flex items-center justify-center text-accent font-medium text-sm">
                              {u.fullName?.charAt(0) || 'U'}
                            </div>
                            <span className="font-medium text-fg">{u.fullName}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${getStatusBadge(u.role)}`}>
                            {u.role}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-fg-muted">{u.department || "N/A"}</td>
                        <td className="px-4 py-3 text-center text-fg-muted">
                          {completedTasks}/{userTasks.length}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${getStatusBadge(latestHealth)}`}>
                            {latestHealth}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded ${u.role !== 'Suspended' ? 'bg-ok/20 text-ok' : 'bg-danger/20 text-danger'}`}>
                            {u.role !== 'Suspended' ? <CheckCircle className="size-3" /> : <XCircle className="size-3" />}
                            {u.role !== 'Suspended' ? 'Active' : 'Suspended'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button className="p-1 hover:bg-accent/10 rounded transition-colors" title="View">
                              <Eye className="size-4 text-fg-subtle" />
                            </button>
                            <button className="p-1 hover:bg-accent/10 rounded transition-colors" title="Email">
                              <Mail className="size-4 text-fg-subtle" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
