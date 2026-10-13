import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo, type ReactNode } from "react";
import { RoleGate } from "@/components/role-gate";
import { Notice } from "@/components/ui-kit";
import { useLive } from "@/lib/ui/use-live";
import { HseWorkspace } from "@/components/hse/hse-workspace";
import { AfterHoursVehiclePanel } from "@/components/requests/after-hours-vehicle";
import { AnnouncementComposer } from "@/components/announcement-composer";
import { AppShell, Panel, StatCard, primaryBtn, inputClass, Field, LogoutButton } from "@/components/app-shell";
import type { EhsRole } from "@/lib/ehs/roles";
import { ThemeToggle } from "@/components/theme-provider";
import { DEPARTMENTS } from "@/lib/ehs/roles";
import {
  listHealth,
  listIncidents,
  listProjects,
  listVehicles,
  listPermits,
  listCAPAs,
  listAllUsers,
  getDashboardStats,
  createUser,
  updateUserRole,
  suspendUser,
  activateUser,
  deleteUser,
  type Incident,
  type Project,
  type HealthDeclaration,
  type Vehicle,
  type Permit,
  type CAPA,
} from "@/lib/ehs/server";
import type { Profile } from "@/lib/ehs/server";
import {
  ShieldAlert,
  Users,
  Car,
  FileWarning,
  Activity,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Calendar,
  Clock,
  MapPin,
  FileText,
  BarChart3,
  Settings,
  Bell,
  Search,
  Filter,
  Download,
  Eye,
  Edit,
  Trash2,
  Plus,
  ChevronDown,
  Truck,
  Wrench,
  UserX,
  UserPlus,
  RefreshCw,
  Mail,
  Building2,
  Layers,
  Fuel,
  ClipboardCheck,
  Award,
  TrendingUp,
  TrendingDown,
  Globe,
  Phone,
  UserCheck,
  Lock,
  Unlock,
  Shield,
  PieChart,
  Printer, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/ehs")({ component: AdminPage });

// ============================================
// DATE HELPER FUNCTIONS
// ============================================

function safeFormatDate(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return "N/A";
  try {
    const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
    if (isNaN(date.getTime())) return "Invalid Date";
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "Invalid Date";
  }
}

function safeFormatDateTime(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return "N/A";
  try {
    const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
    if (isNaN(date.getTime())) return "Invalid Date";
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Invalid Date";
  }
}

function isToday(dateInput: string | Date | null | undefined): boolean {
  if (!dateInput) return false;
  try {
    const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
    if (isNaN(date.getTime())) return false;
    const today = new Date();
    return date.toDateString() === today.toDateString();
  } catch {
    return false;
  }
}

// ============================================
// STATUS HELPER FUNCTIONS
// ============================================

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    Open: "bg-red-500/10 text-red-500 border-red-500/30",
    "In Progress": "bg-yellow-500/10 text-yellow-500 border-yellow-500/30",
    Resolved: "bg-green-500/10 text-green-500 border-green-500/30",
    Closed: "bg-gray-500/10 text-gray-500 border-gray-500/30",
    "Under Investigation": "bg-blue-500/10 text-blue-500 border-blue-500/30",
    Active: "bg-green-500/10 text-green-500 border-green-500/30",
    Pending: "bg-yellow-500/10 text-yellow-500 border-yellow-500/30",
    Approved: "bg-green-500/10 text-green-500 border-green-500/30",
    Rejected: "bg-red-500/10 text-red-500 border-red-500/30",
    Maintenance: "bg-yellow-500/10 text-yellow-500 border-yellow-500/30",
    Grounded: "bg-red-500/10 text-red-500 border-red-500/30",
    Suspended: "bg-red-500/10 text-red-500 border-red-500/30",
    Reported: "bg-red-500/10 text-red-500 border-red-500/30",
  };
  return colors[status] || "bg-gray-100 text-gray-600 border-gray-200";
}

function getSeverityIcon(severity: string) {
  const icons: Record<string, ReactNode> = {
    Critical: <AlertTriangle className="size-4 text-red-500" />,
    High: <AlertTriangle className="size-4 text-yellow-500" />,
    Medium: <AlertTriangle className="size-4 text-blue-500" />,
    Low: <AlertTriangle className="size-4 text-green-500" />,
  };
  return icons[severity] || <AlertTriangle className="size-4 text-gray-500" />;
}

function getSeverityBadge(severity: string): string {
  const badges: Record<string, string> = {
    Critical: "bg-red-500/20 text-red-500",
    High: "bg-yellow-500/20 text-yellow-500",
    Medium: "bg-blue-500/20 text-blue-500",
    Low: "bg-green-500/20 text-green-500",
  };
  return badges[severity] || "bg-gray-500/20 text-gray-500";
}

function getProjectStatusBadge(status: string): string {
  const badges: Record<string, string> = {
    Active: "bg-green-500/20 text-green-500",
    "In Progress": "bg-blue-500/20 text-blue-500",
    "On Hold": "bg-yellow-500/20 text-yellow-500",
    Completed: "bg-purple-500/20 text-purple-500",
    Cancelled: "bg-red-500/20 text-red-500",
  };
  return badges[status] || "bg-gray-500/20 text-gray-500";
}

function getVehicleStatusBadge(status: string): string {
  const badges: Record<string, string> = {
    Active: "bg-green-500/20 text-green-500",
    Maintenance: "bg-yellow-500/20 text-yellow-500",
    Grounded: "bg-red-500/20 text-red-500",
    Retired: "bg-gray-500/20 text-gray-500",
  };
  return badges[status] || "bg-gray-500/20 text-gray-500";
}

function getRoleBadge(role: string): string {
  const map: Record<string, string> = {
    Admin: "bg-purple-500/20 text-purple-500",
    EHS_Officer: "bg-blue-500/20 text-blue-500",
    Manager: "bg-cyan-500/20 text-cyan-500",
    Project_Manager: "bg-indigo-500/20 text-indigo-500",
    Finance: "bg-emerald-500/20 text-emerald-500",
    Driver: "bg-orange-500/20 text-orange-500",
    Employee: "bg-gray-500/20 text-gray-500",
    Suspended: "bg-red-500/20 text-red-500",
  };
  return map[role] || "bg-gray-500/20 text-gray-500";
}

// ============================================
// COMPONENT
// ============================================

function AdminPage() {
  return (
    <RoleGate path="/ehs">
      {(profile) => <AdminDash name={profile.fullName} role={profile.role} profile={profile} />}
    </RoleGate>
  );
}

// ============================================
// MAIN DASHBOARD
// ============================================

function AdminDash({ name, role, profile }: { name: string; role: EhsRole; profile: Profile }) {
  // ========== STATE ==========
  const [projects, setProjects] = useState<Project[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [healthRecords, setHealthRecords] = useState<HealthDeclaration[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [permits, setPermits] = useState<Permit[]>([]);
  const [capaList, setCapaList] = useState<CAPA[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "overview" | "fleet" | "ptw" | "hse" | "users" | "reports" | "settings"
  >("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [reportPeriod, setReportPeriod] = useState<"daily" | "weekly" | "monthly">("weekly");

  // User Management State
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUser, setNewUser] = useState({
    fullName: "",
    email: "",
    password: "",
    role: "Employee" as EhsRole,
    department: "",
  });

  // Notification State
  // ========== DATA FETCHING ==========
  const fetchData = async () => {
    setRefreshing(true);
    try {
      const [projectsData, incidentsData, healthData, vehiclesData, permitsData, capaData, usersData] = await Promise.all([
        listProjects(),
        listIncidents(),
        listHealth(),
        listVehicles().catch(() => []),
        listPermits().catch(() => []),
        listCAPAs().catch(() => []),
        listAllUsers().catch(() => []),
      ]);
      setProjects(projectsData || []);
      setIncidents(incidentsData || []);
      setHealthRecords(healthData || []);
      setVehicles(vehiclesData || []);
      setPermits(permitsData || []);
      setCapaList(capaData || []);
      setUsers(usersData || []);
    } catch (error) {
      console.error("Error fetching admin data:", error);
      setMsg("Failed to load data. Please refresh.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useLive(fetchData, 30000);

  // ========== COMPUTED VALUES ==========
  const stats = useMemo(
    () => ({
      openIncidents: incidents.filter((i) => i.status !== "Closed" && i.status !== "Resolved").length,
      criticalIncidents: incidents.filter((i) => i.severity === "Critical" || i.severity === "High").length,
      totalProjects: projects.length,
      activeProjects: projects.filter((p) => p.status === "Active" || p.status === "In Progress").length,
      healthToday: healthRecords.filter((h) => isToday(h.createdAt)).length,
      completionRate:
        projects.length > 0
          ? Math.round((projects.filter((p) => p.status === "Completed").length / projects.length) * 100)
          : 0,
      totalIncidents: incidents.length,
      resolvedIncidents: incidents.filter((i) => i.status === "Resolved" || i.status === "Closed").length,
      totalVehicles: vehicles.length,
      activeVehicles: vehicles.filter((v) => v.status === "Active").length,
      pendingPermits: permits.filter((p) => p.status === "Pending").length,
      openCAPA: capaList.filter((c) => c.status === "Open" || c.status === "Under Investigation").length,
      totalUsers: users.length,
      activeUsers: users.filter((u) => u.role !== "Suspended").length,
      admins: users.filter((u) => u.role === "Admin").length,
      drivers: users.filter((u) => u.role === "Driver").length,
      finance: users.filter((u) => u.role === "Finance").length,
      employees: users.filter((u) => u.role === "Employee").length,
    }),
    [incidents, projects, healthRecords, vehicles, permits, capaList, users]
  );

  // ========== FILTERED DATA ==========
  const filteredIncidents = useMemo(() => {
    if (!searchQuery) return incidents;
    return incidents.filter(
      (i) =>
        i.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        i.location?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        i.status?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        i.severity?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [incidents, searchQuery]);

  const filteredUsers = useMemo(() => {
    if (!searchQuery) return users;
    return users.filter(
      (u) =>
        u.fullName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.role?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [users, searchQuery]);

  // ========== HANDLERS ==========
  const handleRefresh = async () => {
    await fetchData();
  };

  const handleExportData = () => {
    const data = {
      incidents,
      projects,
      healthRecords,
      vehicles,
      permits,
      capaList,
      users,
      exportedAt: new Date().toISOString(),
      totalRecords: {
        incidents: incidents.length,
        projects: projects.length,
        healthRecords: healthRecords.length,
        vehicles: vehicles.length,
        permits: permits.length,
        capa: capaList.length,
        users: users.length,
      },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ehs-export-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg("Data exported successfully!");
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      await createUser({
        data: {
          email: newUser.email,
          password: newUser.password,
          fullName: newUser.fullName,
          role: newUser.role,
          department: newUser.department || undefined,
        },
      });
      setMsg(`User ${newUser.fullName} created successfully!`);
      setShowAddUserModal(false);
      setNewUser({ fullName: "", email: "", password: "", role: "Employee", department: "" });
      await fetchData();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateRole = async (userId: string, newRole: string) => {
    if (!confirm(`Change this user's role to ${newRole}?`)) return;
    setBusy(true);
    try {
      await updateUserRole({ data: { userId, role: newRole as any } });
      setMsg(`Role updated successfully`);
      await fetchData();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to update role");
    } finally {
      setBusy(false);
    }
  };

  const handleSuspendUser = async (userId: string) => {
    if (!confirm("Suspend this user? They will not be able to log in.")) return;
    setBusy(true);
    try {
      await suspendUser({ data: userId });
      setMsg(`User suspended`);
      await fetchData();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to suspend user");
    } finally {
      setBusy(false);
    }
  };

  const handleActivateUser = async (userId: string) => {
    if (!confirm("Activate this user? They will be able to log in again.")) return;
    setBusy(true);
    try {
      await activateUser({ data: userId });
      setMsg(`User activated`);
      await fetchData();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to activate user");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm("Permanently delete this user? This cannot be undone.")) return;
    setBusy(true);
    try {
      await deleteUser({ data: userId });
      setMsg(`User deleted`);
      await fetchData();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to delete user");
    } finally {
      setBusy(false);
    }
  };

  // ========== TABS ==========
  const tabs = [
    { id: "overview", label: "Overview", icon: <Activity className="size-4" /> },
    { id: "fleet", label: "Fleet Management", icon: <Car className="size-4" />, badge: stats.totalVehicles },
    { id: "ptw", label: "PTW Approvals", icon: <FileWarning className="size-4" />, badge: stats.pendingPermits },
    { id: "hse", label: "Safety and compliance", icon: <ShieldCheck className="size-4" /> },
    ...(role === "Admin" ? [{ id: "users", label: "User Management", icon: <Users className="size-4" />, badge: stats.totalUsers }] : []),
    { id: "reports", label: "Reports & CAPA", icon: <BarChart3 className="size-4" />, badge: stats.openCAPA },
    ...(role === "Admin" ? [{ id: "settings", label: "Settings", icon: <Settings className="size-4" /> }] : []),
  ];

  // ========== LOADING ==========
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg">
        <div className="text-center">
          <div className="size-12 border-4 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-fg-muted font-medium">Loading admin dashboard...</p>
        </div>
      </div>
    );
  }

  // ========== RENDER ==========
  return (
    <div className="min-h-screen bg-bg text-fg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* ======================================== */}
        {/* HEADER */}
        {/* ======================================== */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-fg flex items-center gap-2">
              <ShieldAlert className="size-5 text-accent-bright" />
              {role === "EHS_Officer" ? "EHS Officer Command Center" : "Admin & EHS Command Center"}
            </h2>
            <p className="text-fg-muted mt-1">
              Welcome back, <span className="font-semibold text-fg">{name}</span>.
              {role === "EHS_Officer"
                ? " Manage day-to-day safety compliance."
                : " You have full system authority."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-2 border border-border rounded-lg hover:bg-bg-subtle transition-colors disabled:opacity-50"
              title="Refresh data"
            >
              <RefreshCw className={`size-4 text-fg-muted ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        <div className="mb-6">
          <AnnouncementComposer />
        </div>

        {/* ======================================== */}
        {/* NOTIFICATION DROPDOWN */}
        {/* ======================================== */}
        {/* ======================================== */}
        {/* MESSAGE */}
        {/* ======================================== */}
        {msg && <Notice msg={msg} onClose={() => setMsg("")} />}

        {/* ======================================== */}
        {/* SEARCH BAR */}
        {/* ======================================== */}
        <div className="mb-6 bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-fg-subtle" />
              <input
                type="text"
                placeholder="Search incidents, projects, users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-bg-subtle border border-border rounded-lg text-sm text-fg placeholder-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all"
              />
            </div>
            <button className="flex items-center gap-2 px-4 py-2 bg-accent text-accent-fg rounded-lg text-sm font-medium hover:bg-accent-bright transition-colors whitespace-nowrap">
              <Filter className="size-4" /> Filter
            </button>
            <button
              onClick={handleExportData}
              className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-bg-subtle transition-colors text-fg-muted whitespace-nowrap"
            >
              <Download className="size-4" /> Export
            </button>
          </div>
        </div>

        {/* ======================================== */}
        {/* QUICK STATS */}
        {/* ======================================== */}
        <div className="mb-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-fg-muted font-medium uppercase tracking-wider">Open Incidents</p>
                <p className="text-2xl font-bold text-fg mt-1">{stats.openIncidents}</p>
              </div>
              <div className="size-10 rounded-lg bg-danger/10 flex items-center justify-center">
                <AlertTriangle className="size-5 text-danger" />
              </div>
            </div>
            {stats.criticalIncidents > 0 && (
              <p className="text-xs text-danger mt-2 font-medium">{stats.criticalIncidents} critical</p>
            )}
          </div>

          <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-fg-muted font-medium uppercase tracking-wider">Active Projects</p>
                <p className="text-2xl font-bold text-fg mt-1">{stats.activeProjects}</p>
              </div>
              <div className="size-10 rounded-lg bg-accent/10 flex items-center justify-center">
                <Layers className="size-5 text-accent" />
              </div>
            </div>
            <p className="text-xs text-fg-muted mt-2">{stats.completionRate}% completion</p>
          </div>

          <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-fg-muted font-medium uppercase tracking-wider">Active Users</p>
                <p className="text-2xl font-bold text-fg mt-1">{stats.activeUsers}</p>
              </div>
              <div className="size-10 rounded-lg bg-ok/10 flex items-center justify-center">
                <Users className="size-5 text-ok" />
              </div>
            </div>
            <p className="text-xs text-fg-muted mt-2">{stats.drivers} drivers · {stats.finance} finance</p>
          </div>

          <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-fg-muted font-medium uppercase tracking-wider">PTW Pending</p>
                <p className="text-2xl font-bold text-warn mt-1">{stats.pendingPermits}</p>
              </div>
              <div className="size-10 rounded-lg bg-warn/10 flex items-center justify-center">
                <FileWarning className="size-5 text-warn" />
              </div>
            </div>
            <p className="text-xs text-fg-muted mt-2">{permits.length} total permits</p>
          </div>
        </div>

        {/* ======================================== */}
        {/* TABS */}
        {/* ======================================== */}
        <div className="mb-6">
          <div className="lg:hidden mb-4">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="w-full flex items-center justify-between px-4 py-2 bg-bg-elevated border border-border rounded-lg text-fg"
            >
              <span className="flex items-center gap-2">
                {tabs.find((t) => t.id === activeTab)?.icon}
                {tabs.find((t) => t.id === activeTab)?.label}
              </span>
              <ChevronDown className={`size-4 transition-transform ${mobileMenuOpen ? "rotate-180" : ""}`} />
            </button>
            {mobileMenuOpen && (
              <div className="mt-2 bg-bg-elevated border border-border rounded-lg shadow-lg overflow-hidden">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setActiveTab(tab.id as any);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${
                      activeTab === tab.id ? "bg-accent/10 text-accent" : "text-fg-muted hover:bg-bg-subtle"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {tab.icon}
                      {tab.label}
                    </span>
                    {tab.badge !== undefined && tab.badge > 0 && (
                      <span className="px-2 py-0.5 text-xs font-bold bg-danger text-white rounded-full">
                        {tab.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="hidden lg:flex flex-wrap gap-1 border-b border-border">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all border-b-2 ${
                  activeTab === tab.id
                    ? "border-accent text-accent bg-accent/5"
                    : "border-transparent text-fg-muted hover:text-fg hover:bg-bg-subtle"
                }`}
              >
                {tab.icon}
                {tab.label}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="ml-1 px-2 py-0.5 text-[10px] font-bold bg-danger text-white rounded-full">
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ======================================== */}
        {/* TAB: OVERVIEW */}
        {/* ======================================== */}
        {activeTab === "overview" && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="bg-bg-elevated rounded-xl border border-border p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-fg">Incident Register</h3>
                <button
                  onClick={() => setActiveTab("reports" as any)}
                  className="text-sm text-accent hover:underline flex items-center gap-1"
                >
                  <Eye className="size-3" /> View All
                </button>
              </div>
              {filteredIncidents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-fg-muted">
                  <CheckCircle className="size-12 mb-3 text-ok/40" />
                  <p className="text-sm font-medium">No incidents reported</p>
                  <p className="text-xs">All clear!</p>
                </div>
              ) : (
                <ul className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                  {filteredIncidents.slice(0, 10).map((incident) => (
                    <li
                      key={incident.id}
                      className="group rounded-lg border border-border bg-bg p-4 hover:border-accent hover:shadow-md transition-all cursor-pointer"
                      onClick={() => {
                        setSelectedIncident(incident);
                        setShowIncidentModal(true);
                      }}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {getSeverityIcon(incident.severity)}
                            <p className="text-sm font-semibold text-fg truncate">{incident.title}</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
                            <span className="flex items-center gap-1">
                              <MapPin className="size-3" /> {incident.location || "Unknown"}
                            </span>
                            <span className="flex items-center gap-1">
                              <Calendar className="size-3" /> {safeFormatDate(incident.createdAt)}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="size-3" /> {safeFormatDateTime(incident.createdAt)}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2 flex-shrink-0">
                          <span
                            className={`text-[10px] uppercase font-bold tracking-wider px-3 py-1 rounded-full border ${getStatusColor(
                              incident.status
                            )}`}
                          >
                            {incident.status}
                          </span>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded ${getSeverityBadge(
                              incident.severity
                            )}`}
                          >
                            {incident.severity}
                          </span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-6">
              <div className="bg-bg-elevated rounded-xl border border-border p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-fg mb-4">Quick Actions</h3>
                <div className="grid grid-cols-2 gap-3">
                  <button className="flex flex-col items-center gap-2 p-4 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all">
                    <Plus className="size-5 text-accent" />
                    <span className="text-xs font-medium text-fg-muted">Report Incident</span>
                  </button>
                  <button className="flex flex-col items-center gap-2 p-4 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all">
                    <FileText className="size-5 text-accent" />
                    <span className="text-xs font-medium text-fg-muted">Create PTW</span>
                  </button>
                  <button className="flex flex-col items-center gap-2 p-4 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all">
                    <Car className="size-5 text-accent" />
                    <span className="text-xs font-medium text-fg-muted">Add Vehicle</span>
                  </button>
                  <button
                    onClick={() => setActiveTab("reports")}
                    className="flex flex-col items-center gap-2 p-4 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all"
                  >
                    <UserPlus className="size-5 text-accent" />
                    <span className="text-xs font-medium text-fg-muted">Add User</span>
                  </button>
                </div>
              </div>

              <div className="bg-bg-elevated rounded-xl border border-border p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-fg">Active Projects</h3>
                  <button className="text-sm text-accent hover:underline flex items-center gap-1">
                    <Eye className="size-3" /> View All
                  </button>
                </div>
                {projects.filter((p) => p.status !== "Completed").slice(0, 5).length === 0 ? (
                  <p className="text-sm text-fg-muted text-center py-4">No active projects</p>
                ) : (
                  <ul className="space-y-3">
                    {projects
                      .filter((p) => p.status !== "Completed")
                      .slice(0, 5)
                      .map((project) => (
                        <li key={project.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-fg truncate">{project.name}</p>
                            <div className="flex flex-wrap items-center gap-4 text-xs text-fg-muted">
                              <span>Budget: ${project.budget?.toLocaleString() || "0"}</span>
                              <span>Deadline: {safeFormatDate(project.deadline)}</span>
                            </div>
                          </div>
                          <span
                            className={`text-[10px] font-semibold px-2 py-1 rounded ${getProjectStatusBadge(
                              project.status
                            )}`}
                          >
                            {project.status}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ======================================== */}
        {/* TAB: FLEET MANAGEMENT */}
        {/* ======================================== */}
        {activeTab === "fleet" && (
          <div className="space-y-6">
            <AfterHoursVehiclePanel profile={profile} mode="review" />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-fg-muted font-medium uppercase tracking-wider">Total Vehicles</p>
                    <p className="text-2xl font-bold text-fg mt-1">{vehicles.length}</p>
                  </div>
                  <div className="size-10 rounded-lg bg-accent/10 flex items-center justify-center">
                    <Truck className="size-5 text-accent" />
                  </div>
                </div>
                <p className="text-xs text-fg-muted mt-2">{vehicles.filter((v) => v.status === "Active").length} active</p>
              </div>

              <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-fg-muted font-medium uppercase tracking-wider">In Maintenance</p>
                    <p className="text-2xl font-bold text-warn mt-1">
                      {vehicles.filter((v) => v.status === "Maintenance").length}
                    </p>
                  </div>
                  <div className="size-10 rounded-lg bg-warn/10 flex items-center justify-center">
                    <Wrench className="size-5 text-warn" />
                  </div>
                </div>
                <p className="text-xs text-fg-muted mt-2">Due for service</p>
              </div>

              <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-fg-muted font-medium uppercase tracking-wider">Grounded</p>
                    <p className="text-2xl font-bold text-danger mt-1">
                      {vehicles.filter((v) => v.status === "Grounded").length}
                    </p>
                  </div>
                  <div className="size-10 rounded-lg bg-danger/10 flex items-center justify-center">
                    <XCircle className="size-5 text-danger" />
                  </div>
                </div>
                <p className="text-xs text-fg-muted mt-2">Out of service</p>
              </div>

              <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-fg-muted font-medium uppercase tracking-wider">Avg Mileage</p>
                    <p className="text-2xl font-bold text-ok mt-1">
                      {Math.round(
                        vehicles.reduce((acc, v) => acc + (v.mileage || 0), 0) / (vehicles.length || 1)
                      )}
                    </p>
                  </div>
                  <div className="size-10 rounded-lg bg-ok/10 flex items-center justify-center">
                    <Fuel className="size-5 text-ok" />
                  </div>
                </div>
                <p className="text-xs text-fg-muted mt-2">km per vehicle</p>
              </div>
            </div>

            <div className="bg-bg-elevated rounded-xl border border-border p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-fg">Fleet Overview</h3>
                <button className="flex items-center gap-2 px-3 py-1.5 bg-accent text-accent-fg text-sm rounded-lg hover:bg-accent-bright transition-colors">
                  <Plus className="size-4" /> Add Vehicle
                </button>
              </div>
              {vehicles.length === 0 ? (
                <div className="text-center py-8 text-fg-muted">
                  <Car className="size-12 mx-auto mb-3 text-fg-subtle" />
                  <p className="text-sm font-medium">No vehicles registered</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-bg-subtle border-b border-border">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-fg-muted">Vehicle</th>
                        <th className="px-4 py-3 text-left font-medium text-fg-muted">Registration</th>
                        <th className="px-4 py-3 text-left font-medium text-fg-muted">Status</th>
                        <th className="px-4 py-3 text-left font-medium text-fg-muted">Mileage</th>
                        <th className="px-4 py-3 text-left font-medium text-fg-muted">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {vehicles.map((vehicle) => (
                        <tr key={vehicle.id} className="hover:bg-bg-subtle transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <Car className="size-4 text-fg-subtle" />
                              <span className="font-medium text-fg">
                                {vehicle.make} {vehicle.model}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-fg-muted">{vehicle.registration}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-1 rounded-full ${
                                vehicle.status === "Active"
                                  ? "bg-ok/20 text-ok"
                                  : vehicle.status === "Maintenance"
                                  ? "bg-warn/20 text-warn"
                                  : vehicle.status === "Grounded"
                                  ? "bg-danger/20 text-danger"
                                  : "bg-gray-500/20 text-gray-500"
                              }`}
                            >
                              {vehicle.status === "Active" && <CheckCircle className="size-3" />}
                              {vehicle.status === "Maintenance" && <Wrench className="size-3" />}
                              {vehicle.status === "Grounded" && <XCircle className="size-3" />}
                              {vehicle.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-fg-muted">{vehicle.mileage?.toLocaleString() || "0"} km</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button className="p-1 hover:bg-accent/10 rounded transition-colors" title="View">
                                <Eye className="size-4 text-fg-subtle" />
                              </button>
                              <button className="p-1 hover:bg-accent/10 rounded transition-colors" title="Edit">
                                <Edit className="size-4 text-fg-subtle" />
                              </button>
                              <button className="p-1 hover:bg-danger/10 rounded transition-colors" title="Delete">
                                <Trash2 className="size-4 text-fg-subtle" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ======================================== */}
        {/* TAB: PTW */}
        {/* ======================================== */}
        {activeTab === "ptw" && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-bg-elevated rounded-xl border border-border p-4 text-center shadow-sm">
                <p className="text-2xl font-bold text-warn">
                  {permits.filter((p) => p.status === "Pending").length}
                </p>
                <p className="text-xs text-fg-muted">Pending</p>
              </div>
              <div className="bg-bg-elevated rounded-xl border border-border p-4 text-center shadow-sm">
                <p className="text-2xl font-bold text-ok">
                  {permits.filter((p) => p.status === "Approved").length}
                </p>
                <p className="text-xs text-fg-muted">Approved</p>
              </div>
              <div className="bg-bg-elevated rounded-xl border border-border p-4 text-center shadow-sm">
                <p className="text-2xl font-bold text-danger">
                  {permits.filter((p) => p.status === "Rejected").length}
                </p>
                <p className="text-xs text-fg-muted">Rejected</p>
              </div>
            </div>

            <div className="bg-bg-elevated rounded-xl border border-border p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-fg">Permit To Work (PTW)</h3>
                <button className="flex items-center gap-2 px-3 py-1.5 bg-accent text-accent-fg text-sm rounded-lg hover:bg-accent-bright transition-colors">
                  <Plus className="size-4" /> New PTW
                </button>
              </div>
              {permits.length === 0 ? (
                <div className="text-center py-8 text-fg-muted">
                  <FileWarning className="size-12 mx-auto mb-3 text-fg-subtle" />
                  <p className="text-sm font-medium">No permits found</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {permits.map((permit) => (
                    <div
                      key={permit.id}
                      className="rounded-lg border border-border bg-bg p-4 hover:border-accent transition-all"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span
                              className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                                permit.type === "Hot Work"
                                  ? "bg-danger/20 text-danger"
                                  : permit.type === "Confined Space"
                                  ? "bg-warn/20 text-warn"
                                  : permit.type === "Working at Height"
                                  ? "bg-accent/20 text-accent"
                                  : "bg-gray-500/20 text-gray-500"
                              }`}
                            >
                              {permit.type}
                            </span>
                            <span
                              className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${getStatusColor(
                                permit.status
                              )}`}
                            >
                              {permit.status}
                            </span>
                            <span className="text-[10px] font-medium text-fg-subtle">{permit.permitNumber}</span>
                          </div>
                          <h4 className="text-sm font-semibold text-fg">{permit.title}</h4>
                          <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-fg-muted">
                            <span className="flex items-center gap-1">
                              <MapPin className="size-3" /> {permit.location}
                            </span>
                            <span className="flex items-center gap-1">
                              <Building2 className="size-3" /> {permit.department || "N/A"}
                            </span>
                            {permit.endDate && (
                              <span className="flex items-center gap-1">
                                <Clock className="size-3" /> Valid till: {safeFormatDate(permit.endDate)}
                              </span>
                            )}
                          </div>
                        </div>
                        {permit.status === "Pending" && (
                          <div className="flex gap-2">
                            <button className="px-4 py-2 text-sm font-medium rounded-lg bg-danger/10 text-danger hover:bg-danger/20 transition-colors border border-danger/30 flex items-center gap-1">
                              <XCircle className="size-4" /> Reject
                            </button>
                            <button className="px-4 py-2 text-sm font-medium rounded-lg bg-ok text-white hover:bg-ok/90 transition-colors flex items-center gap-1 shadow-sm">
                              <CheckCircle className="size-4" /> Approve
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ======================================== */}
        {/* TAB: USER MANAGEMENT */}
        {/* ======================================== */}
        {role === "Admin" && activeTab === "users" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
                <p className="text-xs text-fg-muted">Total Users</p>
                <p className="text-2xl font-bold text-fg">{stats.totalUsers}</p>
              </div>
              <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
                <p className="text-xs text-fg-muted">Active</p>
                <p className="text-2xl font-bold text-ok">{stats.activeUsers}</p>
              </div>
              <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
                <p className="text-xs text-fg-muted">Admins</p>
                <p className="text-2xl font-bold text-purple-500">{stats.admins}</p>
              </div>
              <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
                <p className="text-xs text-fg-muted">Drivers</p>
                <p className="text-2xl font-bold text-orange-500">{stats.drivers}</p>
              </div>
              <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
                <p className="text-xs text-fg-muted">Finance</p>
                <p className="text-2xl font-bold text-emerald-500">{stats.finance}</p>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-fg">All Users</h3>
              <button
                onClick={() => setShowAddUserModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-accent text-accent-fg rounded-lg text-sm font-medium hover:bg-accent-bright transition-colors"
              >
                <UserPlus className="size-4" /> Add User
              </button>
            </div>

            <div className="bg-bg-elevated rounded-xl border border-border p-6 shadow-sm">
              {filteredUsers.length === 0 ? (
                <div className="text-center py-12 text-fg-muted">
                  <Users className="size-12 mx-auto mb-3 text-fg-subtle" />
                  <p className="text-sm font-medium">No users found</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-bg-subtle border-b border-border">
                      <tr>
                        <th className="px-4 py-3 text-left text-fg-muted font-medium">User</th>
                        <th className="px-4 py-3 text-left text-fg-muted font-medium">Email</th>
                        <th className="px-4 py-3 text-left text-fg-muted font-medium">Role</th>
                        <th className="px-4 py-3 text-center text-fg-muted font-medium">Status</th>
                        <th className="px-4 py-3 text-center text-fg-muted font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredUsers.map((u) => {
                        const isCurrentUser = u.userId === "current-user-id"; // Placeholder
                        const isAdmin = u.role === "Admin";
                        return (
                          <tr key={u.userId} className="hover:bg-bg-subtle transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="size-8 rounded-full bg-accent/10 flex items-center justify-center text-accent font-medium text-sm">
                                  {u.fullName?.charAt(0) || "U"}
                                </div>
                                <span className="font-medium text-fg">{u.fullName}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-fg-muted">{u.email || "No email"}</td>
                            <td className="px-4 py-3">
                              {isCurrentUser ? (
                                <span className="text-xs text-fg-subtle">(You)</span>
                              ) : (
                                <select
                                  value={u.role}
                                  onChange={(e) => handleUpdateRole(u.userId, e.target.value)}
                                  className="bg-bg border border-border rounded-lg text-xs px-3 py-1.5 text-fg focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-colors"
                                  disabled={busy}
                                >
                                  <option value="Admin">Admin</option>
                                  <option value="EHS_Officer">EHS Officer</option>
                                  <option value="Manager">Manager</option>
                                  <option value="Project_Manager">Project Manager</option>
                                  <option value="Finance">Finance</option>
                                  <option value="Driver">Driver</option>
                                  <option value="Employee">Employee</option>
                                </select>
                              )}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span
                                className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-1 rounded-full ${
                                  u.role !== "Suspended"
                                    ? "bg-ok/20 text-ok"
                                    : "bg-danger/20 text-danger"
                                }`}
                              >
                                {u.role !== "Suspended" ? (
                                  <CheckCircle className="size-3" />
                                ) : (
                                  <XCircle className="size-3" />
                                )}
                                {u.role !== "Suspended" ? "Active" : "Suspended"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex items-center justify-center gap-2">
                                <button className="p-1 hover:bg-accent/10 rounded transition-colors" title="Edit">
                                  <Edit className="size-4 text-fg-subtle" />
                                </button>
                                {!isCurrentUser && !isAdmin && (
                                  <>
                                    {u.role === "Suspended" ? (
                                      <button
                                        onClick={() => handleActivateUser(u.userId)}
                                        className="p-1 hover:bg-ok/10 rounded transition-colors"
                                        title="Activate"
                                      >
                                        <UserCheck className="size-4 text-ok" />
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => handleSuspendUser(u.userId)}
                                        className="p-1 hover:bg-danger/10 rounded transition-colors"
                                        title="Suspend"
                                      >
                                        <UserX className="size-4 text-danger" />
                                      </button>
                                    )}
                                    <button
                                      onClick={() => handleDeleteUser(u.userId)}
                                      className="p-1 hover:bg-danger/10 rounded transition-colors"
                                      title="Delete"
                                    >
                                      <Trash2 className="size-4 text-danger" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ======================================== */}
        {/* TAB: REPORTS & CAPA */}
        {/* ======================================== */}
        {activeTab === "hse" && <HseWorkspace profile={profile} />}

        {activeTab === "reports" && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-bg-elevated rounded-xl border border-border p-4 text-center shadow-sm">
                <p className="text-2xl font-bold text-fg">{capaList.length}</p>
                <p className="text-xs text-fg-muted">Total CAPA Cases</p>
              </div>
              <div className="bg-bg-elevated rounded-xl border border-border p-4 text-center shadow-sm">
                <p className="text-2xl font-bold text-warn">
                  {capaList.filter((c) => c.status === "Under Investigation").length}
                </p>
                <p className="text-xs text-fg-muted">Under Investigation</p>
              </div>
              <div className="bg-bg-elevated rounded-xl border border-border p-4 text-center shadow-sm">
                <p className="text-2xl font-bold text-ok">
                  {capaList.filter((c) => c.status === "Resolved" || c.status === "Closed").length}
                </p>
                <p className="text-xs text-fg-muted">Closed/Resolved</p>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="bg-bg-elevated rounded-xl border border-border p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-fg">CAPA Management</h3>
                  <button className="flex items-center gap-2 px-3 py-1.5 bg-accent text-accent-fg text-sm rounded-lg hover:bg-accent-bright transition-colors">
                    <Plus className="size-4" /> Create CAPA
                  </button>
                </div>
                {capaList.length === 0 ? (
                  <div className="text-center py-8 text-fg-muted">
                    <ShieldAlert className="size-12 mx-auto mb-3 text-fg-subtle" />
                    <p className="text-sm font-medium">No CAPA actions found</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {capaList.map((capa) => (
                      <div key={capa.id} className="flex items-center justify-between p-3 rounded-lg border border-border hover:border-accent transition-all">
                        <div>
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span
                              className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                                capa.type === "Corrective"
                                  ? "bg-danger/20 text-danger"
                                  : capa.type === "Preventive"
                                  ? "bg-accent/20 text-accent"
                                  : "bg-warn/20 text-warn"
                              }`}
                            >
                              {capa.type}
                            </span>
                            <span
                              className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                                capa.severity === "Critical"
                                  ? "bg-danger/20 text-danger"
                                  : capa.severity === "High"
                                  ? "bg-warn/20 text-warn"
                                  : capa.severity === "Medium"
                                  ? "bg-accent/20 text-accent"
                                  : "bg-ok/20 text-ok"
                              }`}
                            >
                              {capa.severity}
                            </span>
                            <span
                              className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${getStatusColor(
                                capa.status
                              )}`}
                            >
                              {capa.status}
                            </span>
                            <span className="text-[10px] font-medium text-fg-subtle">{capa.capaNumber}</span>
                          </div>
                          <p className="text-sm font-medium text-fg">{capa.title}</p>
                          <p className="text-xs text-fg-muted">
                            {capa.category} • {safeFormatDate(capa.createdAt)}
                          </p>
                        </div>
                        <button className="text-accent hover:underline text-sm flex items-center gap-1">
                          <Eye className="size-4" /> View
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-bg-elevated rounded-xl border border-border p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-fg mb-4">Report Generation</h3>
                <p className="text-sm text-fg-muted mb-4">
                  Generate reports for incidents, fleet, PTW, health, and CAPA.
                </p>

                <div className="space-y-2">
                  <div className="flex items-center gap-4 mb-3">
                    <label className="text-sm font-medium text-fg">Period:</label>
                    <select
                      value={reportPeriod}
                      onChange={(e) => setReportPeriod(e.target.value as any)}
                      className="bg-bg border border-border rounded-lg text-xs px-3 py-1.5 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>

                  {[
                    { label: "Incident Report", icon: <AlertTriangle className="size-4" />, count: incidents.length },
                    { label: "Fleet Performance", icon: <Car className="size-4" />, count: vehicles.length },
                    { label: "PTW Summary", icon: <FileWarning className="size-4" />, count: permits.length },
                    { label: "Health & Safety Metrics", icon: <Activity className="size-4" />, count: healthRecords.length },
                    { label: "CAPA Analysis", icon: <ShieldAlert className="size-4" />, count: capaList.length },
                    { label: "Driver Performance", icon: <Users className="size-4" />, count: stats.drivers },
                    { label: "Employee Compliance", icon: <UserCheck className="size-4" />, count: stats.employees },
                  ].map((report) => (
                    <button
                      key={report.label}
                      className="w-full flex items-center justify-between p-3 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all"
                      onClick={() => {
                        setMsg(`Generating ${report.label} for ${reportPeriod} period...`);
                        // Actual report generation would happen here
                      }}
                    >
                      <span className="flex items-center gap-2 text-sm text-fg">
                        {report.icon}
                        {report.label}
                        <span className="text-xs text-fg-subtle">({report.count})</span>
                      </span>
                      <div className="flex items-center gap-2">
                        <Download className="size-4 text-fg-subtle" />
                        <Printer className="size-4 text-fg-subtle" />
                      </div>
                    </button>
                  ))}
                </div>

                <button
                  className="w-full mt-4 py-2 bg-accent text-accent-fg rounded-lg text-sm font-medium hover:bg-accent-bright transition-colors flex items-center justify-center gap-2"
                  onClick={() => {
                    setMsg(`Generating comprehensive ${reportPeriod} report...`);
                    // Full report generation
                  }}
                >
                  <BarChart3 className="size-4" /> Generate Comprehensive Report
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ======================================== */}
        {/* TAB: SETTINGS */}
        {/* ======================================== */}
        {role === "Admin" && activeTab === "settings" && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="bg-bg-elevated rounded-xl border border-border p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-fg mb-4">System Configuration</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <p className="text-sm font-medium text-fg">Maintenance Mode</p>
                    <p className="text-xs text-fg-muted">Temporarily disable system access</p>
                  </div>
                  <button className="px-4 py-2 text-sm font-medium rounded-lg bg-ok/10 text-ok border border-ok/30 hover:bg-ok/20 transition-colors">
                    Enabled
                  </button>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <p className="text-sm font-medium text-fg">Email Notifications</p>
                    <p className="text-xs text-fg-muted">Send alerts to all users</p>
                  </div>
                  <button className="px-4 py-2 text-sm font-medium rounded-lg bg-ok/10 text-ok border border-ok/30 hover:bg-ok/20 transition-colors">
                    Active
                  </button>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <p className="text-sm font-medium text-fg">Backup Schedule</p>
                    <p className="text-xs text-fg-muted">Automatic database backup</p>
                  </div>
                  <span className="text-sm font-medium text-fg-muted">Daily at 02:00</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <p className="text-sm font-medium text-fg">Two-Factor Auth</p>
                    <p className="text-xs text-fg-muted">2FA for admin accounts</p>
                  </div>
                  <button className="px-4 py-2 text-sm font-medium rounded-lg bg-warn/10 text-warn border border-warn/30 hover:bg-warn/20 transition-colors">
                    Disabled
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-bg-elevated rounded-xl border border-border p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-fg mb-4">System Status</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <span className="text-sm text-fg">Database Status</span>
                  <span className="flex items-center gap-1 text-sm font-medium text-ok">
                    <CheckCircle className="size-4" /> Connected
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <span className="text-sm text-fg">API Status</span>
                  <span className="flex items-center gap-1 text-sm font-medium text-ok">
                    <CheckCircle className="size-4" /> Operational
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <span className="text-sm text-fg">Total Users</span>
                  <span className="text-sm font-medium text-fg">{stats.totalUsers}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <span className="text-sm text-fg">Total Records</span>
                  <span className="text-sm font-medium text-fg">
                    {incidents.length + projects.length + healthRecords.length + vehicles.length + permits.length + capaList.length}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <span className="text-sm text-fg">API Version</span>
                  <span className="text-sm font-medium text-fg">v2.4.1</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ======================================== */}
        {/* ADD USER MODAL */}
        {/* ======================================== */}
        {showAddUserModal && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowAddUserModal(false)}
          >
            <div
              className="bg-bg-elevated rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 border border-border shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-fg">Add New User</h3>
                <button
                  onClick={() => setShowAddUserModal(false)}
                  className="p-1 hover:bg-bg-subtle rounded transition-colors"
                >
                  <XCircle className="size-5 text-fg-muted" />
                </button>
              </div>

              <form onSubmit={handleAddUser} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-fg">Full Name *</label>
                  <input
                    required
                    value={newUser.fullName}
                    onChange={(e) => setNewUser({ ...newUser, fullName: e.target.value })}
                    placeholder="Amina Juma"
                    className={inputClass}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-fg">Email *</label>
                  <input
                    type="email"
                    required
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    placeholder="user@company.com"
                    className={inputClass}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-fg">Password *</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    placeholder="Min 8 characters"
                    className={inputClass}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-fg">Role *</label>
                    <select
                      required
                      value={newUser.role}
                      onChange={(e) => setNewUser({ ...newUser, role: e.target.value as any })}
                      className={inputClass}
                    >
                      <option value="Admin">Admin</option>
                      <option value="EHS_Officer">EHS Officer</option>
                      <option value="Manager">Manager</option>
                      <option value="Project_Manager">Project Manager</option>
                      <option value="Finance">Finance</option>
                      <option value="Driver">Driver</option>
                      <option value="Employee">Employee</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-fg">Department</label>
                    <select
                      value={newUser.department || ""}
                      onChange={(e) => setNewUser({ ...newUser, department: e.target.value })}
                      className={inputClass}
                    >
                      <option value="">None</option>
                      {DEPARTMENTS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex gap-2 pt-2 border-t border-border">
                  <button type="submit" disabled={busy} className={`${primaryBtn} flex-1`}>
                    {busy ? "Creating..." : "Create User"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddUserModal(false)}
                    className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-bg-subtle transition-colors text-fg-muted"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ======================================== */}
        {/* INCIDENT DETAIL MODAL */}
        {/* ======================================== */}
        {showIncidentModal && selectedIncident && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowIncidentModal(false)}
          >
            <div
              className="bg-bg-elevated rounded-xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-6 border border-border shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-fg">{selectedIncident.title}</h3>
                <button
                  onClick={() => setShowIncidentModal(false)}
                  className="p-1 hover:bg-bg-subtle rounded transition-colors"
                >
                  <XCircle className="size-5 text-fg-muted" />
                </button>
              </div>
              <div className="space-y-4">
                <div className="flex gap-2 flex-wrap">
                  <span
                    className={`text-xs font-semibold px-3 py-1 rounded-full border ${getStatusColor(
                      selectedIncident.status
                    )}`}
                  >
                    {selectedIncident.status}
                  </span>
                  <span
                    className={`text-xs font-semibold px-3 py-1 rounded-full ${getSeverityBadge(
                      selectedIncident.severity
                    )}`}
                  >
                    {selectedIncident.severity}
                  </span>
                  <span className="text-xs font-semibold px-3 py-1 rounded-full bg-bg-subtle text-fg-muted">
                    ID: {selectedIncident.id}
                  </span>
                </div>
                <div className="space-y-2 text-sm text-fg">
                  <p>
                    <span className="text-fg-muted">Location:</span>{" "}
                    {selectedIncident.location || "N/A"}
                  </p>
                  <p>
                    <span className="text-fg-muted">Reported:</span>{" "}
                    {safeFormatDateTime(selectedIncident.createdAt)}
                  </p>
                  <p>
                    <span className="text-fg-muted">Last Updated:</span>{" "}
                    {safeFormatDateTime(selectedIncident.updatedAt)}
                  </p>
                  <p>
                    <span className="text-fg-muted">Description:</span>
                  </p>
                  <p className="bg-bg-subtle p-3 rounded-lg border border-border">
                    {selectedIncident.description || "No description provided"}
                  </p>
                </div>
                <div className="flex gap-2 pt-4 border-t border-border">
                  <button className="flex-1 px-4 py-2 bg-accent text-accent-fg rounded-lg text-sm font-medium hover:bg-accent-bright transition-colors">
                    View Full Details
                  </button>
                  <button
                    onClick={() => setShowIncidentModal(false)}
                    className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-bg-subtle transition-colors text-fg-muted"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}