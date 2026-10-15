import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { RoleGate } from "@/components/role-gate";
import { useLive } from "@/lib/ui/use-live";
import { AnnouncementComposer } from "@/components/announcement-composer";
import { AppShell, Panel, StatCard, primaryBtn, inputClass, Field, LogoutButton } from "@/components/app-shell";
import { EHS_ROLES, ROLE_LABELS, type EhsRole } from "@/lib/ehs/roles";
import { PermissionsDialog } from "@/components/admin/permissions-dialog";
import { CompanySettings } from "@/components/admin/company-settings";
import { ThemeToggle } from "@/components/theme-provider";
import { 
  listHealth, 
  listIncidents, 
  listProjects, 
  listVehicles,
  listPermits,
  listCAPAs,
  listAllUsers,
  createUser,
  deleteUser,
  updateUserRole,
  suspendUser,
  setUserPassword,
  sendNotification,
  listNotifications,
  resetVehicleMileage,
  markAllNotificationsRead,
  reportIncident,
  type Incident, 
  type Project,
  type HealthDeclaration,
  type Vehicle,
  type Permit,
  type CAPA
} from "@/lib/ehs/server";
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
  PieChart
} from "lucide-react";

export const Route = createFileRoute("/admin")({ component: AdminPage });

// ============================================
// DATE HELPER FUNCTIONS
// ============================================

function safeFormatDate(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return 'N/A';
  try {
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (isNaN(date.getTime())) return 'Invalid Date';
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch {
    return 'Invalid Date';
  }
}

function safeFormatDateTime(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return 'N/A';
  try {
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (isNaN(date.getTime())) return 'Invalid Date';
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return 'Invalid Date';
  }
}

function isToday(dateInput: string | Date | null | undefined): boolean {
  if (!dateInput) return false;
  try {
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
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
    'Open': 'bg-red-500/10 text-red-500 border-red-500/30',
    'In Progress': 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30',
    'Resolved': 'bg-green-500/10 text-green-500 border-green-500/30',
    'Closed': 'bg-gray-500/10 text-gray-500 border-gray-500/30',
    'Under Investigation': 'bg-blue-500/10 text-blue-500 border-blue-500/30',
    'Active': 'bg-green-500/10 text-green-500 border-green-500/30',
    'Pending': 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30',
    'Approved': 'bg-green-500/10 text-green-500 border-green-500/30',
    'Rejected': 'bg-red-500/10 text-red-500 border-red-500/30',
    'Maintenance': 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30',
    'Grounded': 'bg-red-500/10 text-red-500 border-red-500/30',
    'Suspended': 'bg-red-500/10 text-red-500 border-red-500/30',
    'Reported': 'bg-red-500/10 text-red-500 border-red-500/30'
  };
  return colors[status] || 'bg-gray-100 text-gray-600 border-gray-200';
}
// ============================================
// FIXED - Using React.ReactNode (SAHIHI)
// ============================================

import { ReactNode } from 'react';

function getSeverityIcon(severity: string): ReactNode {
  const icons: Record<string, ReactNode> = {
    'Critical': <AlertTriangle className="size-4 text-red-500" />,
    'High': <AlertTriangle className="size-4 text-yellow-500" />,
    'Medium': <AlertTriangle className="size-4 text-blue-500" />,
    'Low': <AlertTriangle className="size-4 text-green-500" />
  };
  return icons[severity] || <AlertTriangle className="size-4 text-gray-500" />;
}

function getSeverityBadge(severity: string): string {
  const badges: Record<string, string> = {
    'Critical': 'bg-red-500/20 text-red-500',
    'High': 'bg-yellow-500/20 text-yellow-500',
    'Medium': 'bg-blue-500/20 text-blue-500',
    'Low': 'bg-green-500/20 text-green-500'
  };
  return badges[severity] || 'bg-gray-500/20 text-gray-500';
}

function getProjectStatusBadge(status: string): string {
  const badges: Record<string, string> = {
    'Active': 'bg-green-500/20 text-green-500',
    'In Progress': 'bg-blue-500/20 text-blue-500',
    'On Hold': 'bg-yellow-500/20 text-yellow-500',
    'Completed': 'bg-purple-500/20 text-purple-500',
    'Cancelled': 'bg-red-500/20 text-red-500'
  };
  return badges[status] || 'bg-gray-500/20 text-gray-500';
}

function getVehicleStatusBadge(status: string): string {
  const badges: Record<string, string> = {
    'Active': 'bg-green-500/20 text-green-500',
    'Maintenance': 'bg-yellow-500/20 text-yellow-500',
    'Grounded': 'bg-red-500/20 text-red-500',
    'Retired': 'bg-gray-500/20 text-gray-500'
  };
  return badges[status] || 'bg-gray-500/20 text-gray-500';
}

// ============================================
// COMPONENTS
// ============================================

function AdminPage() {
  return (
    <RoleGate path="/admin">
      {(profile) => <AdminDash name={profile.fullName} role={profile.role} userId={profile.userId} />}
    </RoleGate>
  );
}

// ============================================
// MAIN DASHBOARD
// ============================================

function AdminDash({ name, role, userId }: { name: string; role: EhsRole; userId: string }) {
  // ========== STATE ==========
  const [projects, setProjects] = useState<Project[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [healthRecords, setHealthRecords] = useState<HealthDeclaration[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [permits, setPermits] = useState<Permit[]>([]);
  const [capaList, setCapaList] = useState<CAPA[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [permUser, setPermUser] = useState<{ userId: string; fullName: string; baseRole: string; permissions: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "fleet" | "ptw" | "users" | "reports" | "company" | "settings">("overview");
  const [acknowledgedTabs, setAcknowledgedTabs] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const [incidentForm, setIncidentForm] = useState({ title: "", location: "", severity: "Low" as "Low" | "Medium" | "High" | "Critical" });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUser, setNewUser] = useState({ fullName: "", email: "", role: "Employee" as EhsRole, department: "Operations", projectId: undefined as number | undefined, dualRole: false });
  const [noticeForm, setNoticeForm] = useState({ title: "", message: "", userId: "all" });

  // ========== DATA FETCHING ==========
  const fetchData = async () => {
    setRefreshing(true);
    try {
      const [projectsData, incidentsData, healthData, vehiclesData, permitsData, capaData, usersData, notificationData] = await Promise.all([
        listProjects(),
        listIncidents(),
        listHealth(),
        listVehicles().catch(() => []),
        listPermits().catch(() => []),
        listCAPAs().catch(() => []),
        listAllUsers().catch(() => []),
        listNotifications().catch(() => [])
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
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useLive(fetchData, 30000);

  // ========== COMPUTED VALUES ==========
  const stats = useMemo(() => ({
    openIncidents: incidents.filter(i => i.status !== "Closed" && i.status !== "Resolved").length,
    criticalIncidents: incidents.filter(i => i.severity === "Critical" || i.severity === "High").length,
    totalProjects: projects.length,
    activeProjects: projects.filter(p => p.status === "Active" || p.status === "In Progress").length,
    healthToday: healthRecords.filter(h => isToday(h.createdAt)).length,
    completionRate: projects.length > 0 
      ? Math.round((projects.filter(p => p.status === "Completed").length / projects.length) * 100) 
      : 0,
    totalIncidents: incidents.length,
    resolvedIncidents: incidents.filter(i => i.status === "Resolved" || i.status === "Closed").length,
    totalVehicles: vehicles.length,
    activeVehicles: vehicles.filter(v => v.status === "Active").length,
    pendingPermits: permits.filter(p => p.status === "Pending").length,
    openCAPA: capaList.filter(c => c.status === "Open" || c.status === "Under Investigation").length
  }), [incidents, projects, healthRecords, vehicles, permits, capaList]);

  // ========== FILTERED DATA ==========
  const filteredIncidents = useMemo(() => {
    if (!searchQuery) return incidents;
    return incidents.filter(i => 
      i.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.location?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.status?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.severity?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [incidents, searchQuery]);

  // ========== HANDLERS ==========
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
        users: users.length
      }
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ehs-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRefresh = async () => {
    await fetchData();
  };

  const handleResetMileage = async (vehicleId: string) => {
    const value = window.prompt("Reset vehicle mileage to (km):", "0");
    if (value === null) return;
    const mileage = Number(value);
    if (!Number.isFinite(mileage) || mileage < 0) { setMsg("Enter a valid mileage value."); return; }
    try {
      await resetVehicleMileage({ data: { vehicleId, mileage } });
      setMsg("Vehicle mileage reset successfully.");
      await fetchData();
    } catch (error) { setMsg(error instanceof Error ? error.message : "Could not reset mileage"); }
  };

  const handleReportIncident = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await reportIncident({ data: incidentForm });
      setIncidentForm({ title: "", location: "", severity: "Low" });
      setShowIncidentForm(false);
      setMsg("Incident reported successfully.");
      await fetchData();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Could not report incident");
    } finally { setBusy(false); }
  };

  const handleAddUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const permissions = newUser.dualRole ? (newUser.role === "Team_Leader" ? ["fleet.driver_dashboard"] : newUser.role === "Driver" ? ["teamleader.dashboard", "attendance.view", "hours.record", "ncr.raise"] : []) : [];
      const result = await createUser({ data: { fullName: newUser.fullName, email: newUser.email, role: newUser.role, department: newUser.department, projectId: newUser.projectId, permissions } });
      setMsg(result.inviteSent ? `User added. A password setup link was emailed to ${newUser.email}.` : "User added, but the invitation email could not be sent. Check email settings and send a password reset.");
      setNewUser({ fullName: "", email: "", role: "Employee", department: "Operations", projectId: undefined, dualRole: false });
      await fetchData();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Could not create user");
    } finally { setBusy(false); }
  };

  const handlePromptAddUser = () => {
    setShowAddUserModal(true);
  };

  const handleCreateUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const permissions = newUser.dualRole ? (newUser.role === "Team_Leader" ? ["fleet.driver_dashboard"] : newUser.role === "Driver" ? ["teamleader.dashboard", "attendance.view", "hours.record", "ncr.raise"] : []) : [];
      const result = await createUser({ data: { fullName: newUser.fullName, email: newUser.email, role: newUser.role, department: newUser.department, projectId: newUser.projectId, permissions } });
      setMsg(result.inviteSent ? `User ${newUser.fullName} added. A password setup link was emailed to ${newUser.email}.` : `User ${newUser.fullName} added, but the invitation email could not be sent. Check email settings and send a password reset.`);
      setShowAddUserModal(false);
      setNewUser({ fullName: "", email: "", role: "Employee", department: "Operations", projectId: undefined, dualRole: false });
      await fetchData();
    } catch (error) { setMsg(error instanceof Error ? error.message : "Could not create user"); }
    finally { setBusy(false); }
  };

  const handleDeleteUser = async (user: { userId: string; fullName: string }) => {
    if (!window.confirm(`Remove ${user.fullName} from this company? Their access will end immediately and the audit record will be retained.`)) return;
    try {
      await deleteUser({ data: user.userId });
      setMsg(`${user.fullName} was removed from the company.`);
      await fetchData();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Could not remove user");
    }
  };

  const handleSendNotification = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const userIds = noticeForm.userId === "all" ? users.map((user) => user.userId) : [noticeForm.userId];
      await sendNotification({ data: { ...noticeForm, userIds } });
      setMsg("Notification sent to the selected users.");
      setNoticeForm({ title: "", message: "", userId: "all" });
    } catch (error) { setMsg(error instanceof Error ? error.message : "Could not send notification"); }
    finally { setBusy(false); }
  };

  // ========== TABS CONFIGURATION ==========
  const tabs = [
    { id: 'overview', label: 'Overview', icon: <Activity className="size-4" /> },
    { id: 'fleet', label: 'Fleet Management', icon: <Car className="size-4" />, badge: stats.totalVehicles, hasNew: !acknowledgedTabs.fleet && vehicles.some((vehicle) => isToday(vehicle.createdAt) || isToday(vehicle.updatedAt)) },
    { id: 'ptw', label: 'PTW Approvals', icon: <FileWarning className="size-4" />, badge: stats.pendingPermits, hasNew: !acknowledgedTabs.ptw && permits.some((permit) => isToday(permit.createdAt) || isToday(permit.updatedAt)) },
    { id: 'users', label: 'User Management', icon: <Users className="size-4" />, badge: users.length, hasNew: !acknowledgedTabs.users && users.some((user) => isToday(user.createdAt)) },
    { id: 'reports', label: 'Reports & CAPA', icon: <ShieldAlert className="size-4" />, badge: stats.openCAPA, hasNew: !acknowledgedTabs.reports && capaList.some((capa) => isToday(capa.createdAt) || isToday(capa.updatedAt)) },
    { id: 'company', label: 'Company', icon: <Building2 className="size-4" /> },
    { id: 'settings', label: 'System Settings', icon: <Settings className="size-4" /> }
  ];

  // ========== LOADING STATE ==========
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg">
        <div className="text-center">
          <div className="size-12 border-4 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-fg-muted font-medium">Loading admin dashboard...</p>
          <p className="text-sm text-fg-subtle mt-1">Please wait while we fetch your data</p>
        </div>
      </div>
    );
  }

  // ========== RENDER ==========
  return (
    <div className="min-h-screen bg-bg text-fg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        
        {/* ======================================== */}
        {/* HEADER SECTION - WITH THEME TOGGLE */}
        {/* ======================================== */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-fg flex items-center gap-2">
              <ShieldAlert className="size-5 text-accent-bright" />
              Admin & EHS Command Center
            </h2>
            <p className="text-fg-muted mt-1">
              Welcome back, <span className="font-semibold text-fg">{name}</span>. 
              You have full system authority.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-2 border border-border rounded-lg hover:bg-bg-subtle transition-colors disabled:opacity-50"
              title="Refresh data"
            >
              <RefreshCw className={`size-4 text-fg-muted ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            {/* THEME TOGGLE - ADDED HERE */}
          </div>
        </div>

        <div className="mb-6">
          <AnnouncementComposer onPublished={() => void fetchData()} />
        </div>

        {/* ======================================== */}
        {/* NOTIFICATION DROPDOWN */}
        {/* ======================================== */}
        {/* ======================================== */}
        {/* SEARCH & FILTER BAR */}
        {/* ======================================== */}
        <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-fg-subtle" />
              <input
                type="text"
                placeholder="Search incidents, projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-bg-subtle border border-border rounded-lg text-sm text-fg placeholder-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all"
              />
            </div>
            <button className="p-2 border border-border rounded-lg hover:bg-bg-subtle transition-colors">
              <Filter className="size-4 text-fg-muted" />
            </button>
          </div>
          
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button 
              onClick={handleExportData}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-accent text-accent-fg rounded-lg text-sm font-medium hover:bg-accent-bright transition-colors shadow-sm"
            >
              <Download className="size-4" />
              Export Data
            </button>
            <button className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-bg-subtle transition-colors text-fg-muted">
              <FileText className="size-4" />
              Generate Report
            </button>
          </div>
        </div>

        {/* ======================================== */}
        {/* QUICK STATS CARDS - USING THEME COLORS */}
        {/* ======================================== */}
        <div className="mb-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm hover:shadow-md transition-shadow">
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

          <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-fg-muted font-medium uppercase tracking-wider">Active Projects</p>
                <p className="text-2xl font-bold text-fg mt-1">{stats.activeProjects}</p>
              </div>
              <div className="size-10 rounded-lg bg-accent/10 flex items-center justify-center">
                <Layers className="size-5 text-accent" />
              </div>
            </div>
            <p className="text-xs text-fg-muted mt-2">{stats.completionRate}% completion rate</p>
          </div>

          <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-fg-muted font-medium uppercase tracking-wider">Vehicles</p>
                <p className="text-2xl font-bold text-fg mt-1">{stats.totalVehicles}</p>
              </div>
              <div className="size-10 rounded-lg bg-ok/10 flex items-center justify-center">
                <Car className="size-5 text-ok" />
              </div>
            </div>
            <p className="text-xs text-fg-muted mt-2">{stats.activeVehicles} active</p>
          </div>

          <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm hover:shadow-md transition-shadow">
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
        {/* NAVIGATION TABS - USING THEME COLORS */}
        {/* ======================================== */}
        <div className="mb-6">
          {/* Mobile Dropdown */}
          <div className="lg:hidden mb-4">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="w-full flex items-center justify-between px-4 py-2 bg-bg-elevated border border-border rounded-lg text-fg"
            >
              <span className="flex items-center gap-2">
                {tabs.find(t => t.id === activeTab)?.icon}
                {tabs.find(t => t.id === activeTab)?.label}
              </span>
              <ChevronDown className={`size-4 transition-transform ${mobileMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            
            {mobileMenuOpen && (
              <div className="mt-2 bg-bg-elevated border border-border rounded-lg shadow-lg overflow-hidden">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setActiveTab(tab.id as any);
                      setAcknowledgedTabs((current) => ({ ...current, [tab.id]: true }));
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${
                      activeTab === tab.id
                        ? 'bg-accent/10 text-accent'
                        : 'text-fg-muted hover:bg-bg-subtle'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {tab.icon}
                      {tab.label}
                    </span>
                    {tab.badge !== undefined && tab.badge > 0 && (
                      <span className={`px-2 py-0.5 text-xs font-bold ${tab.hasNew ? 'bg-danger' : 'bg-ok'} text-white rounded-full`}>
                        {tab.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Desktop Tabs */}
          <div className="hidden lg:flex flex-wrap gap-1 border-b border-border">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id as any);
                  setAcknowledgedTabs((current) => ({ ...current, [tab.id]: true }));
                }}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all border-b-2 ${
                  activeTab === tab.id
                    ? 'border-accent text-accent bg-accent/5'
                    : 'border-transparent text-fg-muted hover:text-fg hover:bg-bg-subtle'
                }`}
              >
                {tab.icon}
                {tab.label}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className={`ml-1 px-2 py-0.5 text-[10px] font-bold ${tab.hasNew ? 'bg-danger' : 'bg-ok'} text-white rounded-full`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ======================================== */}
        {/* TAB 1: OVERVIEW - USING THEME COLORS */}
        {/* ======================================== */}
        {activeTab === "overview" && (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Incidents Panel */}
            <div className="bg-bg-elevated rounded-xl border border-border p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-fg">Incident Register</h3>
                <button 
                  onClick={() => setActiveTab("incidents" as any)}
                  className="text-sm text-accent hover:underline flex items-center gap-1"
                >
                  <Eye className="size-3" /> View All
                </button>
              </div>
              
              {filteredIncidents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-fg-muted">
                  <CheckCircle className="size-12 mb-3 text-ok/40" />
                  <p className="text-sm font-medium">No incidents reported</p>
                  <p className="text-xs">All clear! Keep up the good work.</p>
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
                            <p className="text-sm font-semibold text-fg truncate">
                              {incident.title}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
                            <span className="flex items-center gap-1">
                              <MapPin className="size-3" /> {incident.location || 'Unknown'}
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
                          <span className={`text-[10px] uppercase font-bold tracking-wider px-3 py-1 rounded-full border ${getStatusColor(incident.status)}`}>
                            {incident.status}
                          </span>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${getSeverityBadge(incident.severity)}`}>
                            {incident.severity}
                          </span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Quick Actions & Projects */}
            <div className="space-y-6">
              <div className="bg-bg-elevated rounded-xl border border-border p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-fg mb-4">Quick Actions</h3>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => setShowIncidentForm(true)} className="flex flex-col items-center gap-2 p-4 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all">
                    <Plus className="size-5 text-accent" />
                    <span className="text-xs font-medium text-fg-muted">Report Incident</span>
                  </button>
                  <button onClick={() => setActiveTab("ptw")} className="flex flex-col items-center gap-2 p-4 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all">
                    <FileText className="size-5 text-accent" />
                    <span className="text-xs font-medium text-fg-muted">Create PTW</span>
                  </button>
                  <button onClick={() => setActiveTab("fleet")} className="flex flex-col items-center gap-2 p-4 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all">
                    <Car className="size-5 text-accent" />
                    <span className="text-xs font-medium text-fg-muted">Add Vehicle</span>
                  </button>
                  <button onClick={() => setActiveTab("users")} className="flex flex-col items-center gap-2 p-4 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all">
                    <UserPlus className="size-5 text-accent" />
                    <span className="text-xs font-medium text-fg-muted">Add User</span>
                  </button>
                </div>
              </div>

              <div className="bg-bg-elevated rounded-xl border border-border p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-fg">Active Projects</h3>
                  <button 
                    onClick={() => setActiveTab("overview")}
                    className="text-sm text-accent hover:underline flex items-center gap-1"
                  >
                    <Eye className="size-3" /> View All
                  </button>
                </div>
                {projects.filter(p => p.status !== 'Completed').slice(0, 5).length === 0 ? (
                  <p className="text-sm text-fg-muted text-center py-4">No active projects</p>
                ) : (
                  <ul className="space-y-3">
                    {projects.filter(p => p.status !== 'Completed').slice(0, 5).map((project) => (
                      <li key={project.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-fg truncate">{project.name}</p>
                          <div className="flex flex-wrap items-center gap-4 text-xs text-fg-muted">
                            <span>Budget: ${project.budget?.toLocaleString() || '0'}</span>
                            <span>Deadline: {safeFormatDate(project.deadline)}</span>
                          </div>
                        </div>
                        <span className={`text-[10px] font-semibold px-2 py-1 rounded ${getProjectStatusBadge(project.status)}`}>
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
        {/* TAB 2: FLEET MANAGEMENT - USING THEME COLORS */}
        {/* ======================================== */}
        {activeTab === "fleet" && (
          <div className="space-y-6">
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
                <p className="text-xs text-fg-muted mt-2">{vehicles.filter(v => v.status === 'Active').length} active</p>
              </div>

              <div className="bg-bg-elevated rounded-xl border border-border p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-fg-muted font-medium uppercase tracking-wider">In Maintenance</p>
                    <p className="text-2xl font-bold text-warn mt-1">{vehicles.filter(v => v.status === 'Maintenance').length}</p>
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
                    <p className="text-2xl font-bold text-danger mt-1">{vehicles.filter(v => v.status === 'Grounded').length}</p>
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
                      {Math.round(vehicles.reduce((acc, v) => acc + (v.mileage || 0), 0) / (vehicles.length || 1))}
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
                  <p className="text-xs">Add your first vehicle to get started</p>
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
                            <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-1 rounded-full ${
                              vehicle.status === 'Active' ? 'bg-ok/20 text-ok' :
                              vehicle.status === 'Maintenance' ? 'bg-warn/20 text-warn' :
                              vehicle.status === 'Grounded' ? 'bg-danger/20 text-danger' :
                              'bg-gray-500/20 text-gray-500'
                            }`}>
                              {vehicle.status === 'Active' && <CheckCircle className="size-3" />}
                              {vehicle.status === 'Maintenance' && <Wrench className="size-3" />}
                              {vehicle.status === 'Grounded' && <XCircle className="size-3" />}
                              {vehicle.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-fg-muted">{vehicle.mileage?.toLocaleString() || '0'} km</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button className="p-1 hover:bg-accent/10 rounded transition-colors" title="View">
                                <Eye className="size-4 text-fg-subtle" />
                              </button>
                              <button className="p-1 hover:bg-accent/10 rounded transition-colors" title="Edit">
                                <Edit className="size-4 text-fg-subtle" />
                              </button>
                              <button onClick={() => void handleResetMileage(vehicle.id)} className="p-1 hover:bg-warn/10 rounded transition-colors" title="Reset mileage">
                                <RefreshCw className="size-4 text-warn" />
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
        {/* TAB 3: PTW APPROVALS - USING THEME COLORS */}
        {/* ======================================== */}
        {activeTab === "ptw" && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-bg-elevated rounded-xl border border-border p-4 text-center shadow-sm">
                <p className="text-2xl font-bold text-warn">{permits.filter(p => p.status === 'Pending').length}</p>
                <p className="text-xs text-fg-muted">Pending Approvals</p>
              </div>
              <div className="bg-bg-elevated rounded-xl border border-border p-4 text-center shadow-sm">
                <p className="text-2xl font-bold text-ok">{permits.filter(p => p.status === 'Approved').length}</p>
                <p className="text-xs text-fg-muted">Approved</p>
              </div>
              <div className="bg-bg-elevated rounded-xl border border-border p-4 text-center shadow-sm">
                <p className="text-2xl font-bold text-danger">{permits.filter(p => p.status === 'Rejected').length}</p>
                <p className="text-xs text-fg-muted">Rejected</p>
              </div>
            </div>

            <div className="bg-bg-elevated rounded-xl border border-border p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-fg">Permit to Work (PTW) Management</h3>
                <button className="flex items-center gap-2 px-3 py-1.5 bg-accent text-accent-fg text-sm rounded-lg hover:bg-accent-bright transition-colors">
                  <Plus className="size-4" /> New PTW
                </button>
              </div>
              
              {permits.length === 0 ? (
                <div className="text-center py-8 text-fg-muted">
                  <FileWarning className="size-12 mx-auto mb-3 text-fg-subtle" />
                  <p className="text-sm font-medium">No permits found</p>
                  <p className="text-xs">Create your first permit to get started</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {permits.map((permit) => (
                    <div key={permit.id} className="rounded-lg border border-border bg-bg p-4 hover:border-accent transition-all">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                              permit.type === 'Hot Work' ? 'bg-danger/20 text-danger' :
                              permit.type === 'Confined Space' ? 'bg-warn/20 text-warn' :
                              permit.type === 'Working at Height' ? 'bg-accent/20 text-accent' :
                              'bg-gray-500/20 text-gray-500'
                            }`}>
                              {permit.type}
                            </span>
                            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${getStatusColor(permit.status)}`}>
                              {permit.status}
                            </span>
                            <span className="text-[10px] font-medium text-fg-subtle">
                              {permit.permitNumber}
                            </span>
                          </div>
                          <h4 className="text-sm font-semibold text-fg">{permit.title}</h4>
                          <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-fg-muted">
                            <span className="flex items-center gap-1">
                              <MapPin className="size-3" /> {permit.location}
                            </span>
                            <span className="flex items-center gap-1">
                              <Building2 className="size-3" /> {permit.department || 'N/A'}
                            </span>
                            {permit.endDate && (
                              <span className="flex items-center gap-1">
                                <Clock className="size-3" /> Valid till: {safeFormatDate(permit.endDate)}
                              </span>
                            )}
                          </div>
                        </div>
                        {permit.status === 'Pending' && (
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
        {/* TAB 4: USER MANAGEMENT - USING THEME COLORS */}
        {/* ======================================== */}
        {activeTab === "users" && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-semibold text-fg">User Management</h3>
                <span className="text-xs text-fg-muted bg-bg-subtle px-2 py-1 rounded">{users.length} total users</span>
              </div>
              <button onClick={handlePromptAddUser} className="flex items-center gap-2 px-4 py-2 bg-accent text-accent-fg rounded-lg text-sm font-medium hover:bg-accent-bright transition-colors">
                <UserPlus className="size-4" /> Add User
              </button>
            </div>

            <div className="bg-bg-elevated rounded-xl border border-border p-6 shadow-sm">
              {users.length === 0 ? (
                <div className="text-center py-8 text-fg-muted">
                  <Users className="size-12 mx-auto mb-3 text-fg-subtle" />
                  <p className="text-sm font-medium">No users found</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-bg-subtle border-b border-border">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-fg-muted">User</th>
                        <th className="px-4 py-3 text-left font-medium text-fg-muted">Email</th>
                        <th className="px-4 py-3 text-left font-medium text-fg-muted">Role</th>
                        <th className="px-4 py-3 text-left font-medium text-fg-muted">Status</th>
                        <th className="px-4 py-3 text-left font-medium text-fg-muted">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {users.map((user) => (
                        <tr key={user.userId} className="hover:bg-bg-subtle transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="size-8 rounded-full bg-accent/10 flex items-center justify-center text-accent font-medium text-sm">
                                {user.fullName?.charAt(0) || 'U'}
                              </div>
                              <span className="font-medium text-fg">{user.fullName}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-fg-muted">{user.email || 'No email'}</td>
                          <td className="px-4 py-3">
                            <select 
                              className="bg-bg border border-border rounded-lg text-xs px-3 py-1.5 text-fg focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-colors"
                              value={user.baseRole}
                              onChange={async (event) => {
                                try {
                                  await updateUserRole({ data: { userId: user.userId, role: event.target.value as EhsRole } });
                                  setMsg("Role updated successfully.");
                                  await fetchData();
                                } catch (error) { setMsg(error instanceof Error ? error.message : "Could not update role"); }
                              }}
                            >
                              {EHS_ROLES.map((roleOption) => <option key={roleOption} value={roleOption}>{ROLE_LABELS[roleOption]}</option>)}
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-1 rounded-full ${
                              user.role !== 'Suspended' ? 'bg-ok/20 text-ok' : 'bg-danger/20 text-danger'
                            }`}>
                              {user.role !== 'Suspended' ? <CheckCircle className="size-3" /> : <XCircle className="size-3" />}
                              {user.role !== 'Suspended' ? 'Active' : 'Suspended'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button onClick={() => setPermUser(user)} className="p-1 hover:bg-accent/10 rounded transition-colors" title="Edit access" aria-label="Edit access">
                                <Edit className="size-4 text-fg-subtle" />
                              </button>
                              <button onClick={async () => { try { await suspendUser({ data: user.userId }); setMsg("User suspended."); await fetchData(); } catch (error) { setMsg(error instanceof Error ? error.message : "Could not suspend user"); } }} className="p-1 hover:bg-danger/10 rounded transition-colors" title="Suspend">
                                <UserX className="size-4 text-fg-subtle" />
                              </button>
                              <button onClick={async () => { const password = window.prompt("Enter a new password (minimum 8 characters):"); if (!password) return; try { await setUserPassword({ data: { userId: user.userId, password } }); setMsg("Password updated."); } catch (error) { setMsg(error instanceof Error ? error.message : "Could not update password"); } }} className="p-1 hover:bg-accent/10 rounded transition-colors" title="Reset password">
                                <Lock className="size-4 text-fg-subtle" />
                              </button>
                              {user.baseRole !== "Admin" && user.userId !== userId ? (
                                <button onClick={() => void handleDeleteUser(user)} className="p-1 hover:bg-danger/10 rounded transition-colors" title="Remove user from company" aria-label={`Remove ${user.fullName} from company`}>
                                  <Trash2 className="size-4 text-danger" />
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-bg-elevated rounded-xl border border-border p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-fg">Send dashboard notification</h3>
              <form onSubmit={handleSendNotification} className="mt-4 grid gap-3 md:grid-cols-3">
                <input required placeholder="Title" value={noticeForm.title} onChange={(event) => setNoticeForm({ ...noticeForm, title: event.target.value })} className={inputClass} />
                <input required placeholder="Message" value={noticeForm.message} onChange={(event) => setNoticeForm({ ...noticeForm, message: event.target.value })} className={inputClass} />
                <div className="flex gap-2">
                  <select value={noticeForm.userId} onChange={(event) => setNoticeForm({ ...noticeForm, userId: event.target.value })} className={inputClass}>
                    <option value="all">All users</option>
                    {users.map((user) => <option key={user.userId} value={user.userId}>{user.fullName}</option>)}
                  </select>
                  <button disabled={busy} className={`${primaryBtn} max-w-40`} type="submit"><Bell className="size-4" /> Send</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ======================================== */}
        {/* TAB 5: REPORTS & CAPA - USING THEME COLORS */}
        {/* ======================================== */}
        {activeTab === "reports" && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-bg-elevated rounded-xl border border-border p-4 text-center shadow-sm">
                <p className="text-2xl font-bold text-fg">{capaList.length}</p>
                <p className="text-xs text-fg-muted">Total CAPA Cases</p>
              </div>
              <div className="bg-bg-elevated rounded-xl border border-border p-4 text-center shadow-sm">
                <p className="text-2xl font-bold text-warn">{capaList.filter(c => c.status === 'Under Investigation').length}</p>
                <p className="text-xs text-fg-muted">Under Investigation</p>
              </div>
              <div className="bg-bg-elevated rounded-xl border border-border p-4 text-center shadow-sm">
                <p className="text-2xl font-bold text-ok">{capaList.filter(c => c.status === 'Resolved' || c.status === 'Closed').length}</p>
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
                            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                              capa.type === 'Corrective' ? 'bg-danger/20 text-danger' : 
                              capa.type === 'Preventive' ? 'bg-accent/20 text-accent' :
                              'bg-warn/20 text-warn'
                            }`}>
                              {capa.type}
                            </span>
                            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                              capa.severity === 'Critical' ? 'bg-danger/20 text-danger' :
                              capa.severity === 'High' ? 'bg-warn/20 text-warn' :
                              capa.severity === 'Medium' ? 'bg-accent/20 text-accent' :
                              'bg-ok/20 text-ok'
                            }`}>
                              {capa.severity}
                            </span>
                            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${getStatusColor(capa.status)}`}>
                              {capa.status}
                            </span>
                            <span className="text-[10px] font-medium text-fg-subtle">
                              {capa.capaNumber}
                            </span>
                          </div>
                          <p className="text-sm font-medium text-fg">{capa.title}</p>
                          <p className="text-xs text-fg-muted">{capa.category} • {safeFormatDate(capa.createdAt)}</p>
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
                <p className="text-sm text-fg-muted mb-4">Generate comprehensive reports for auditing and compliance.</p>
                
                <div className="space-y-2">
                  {[
                    { label: 'Incident Report', icon: <AlertTriangle className="size-4" />, count: incidents.length },
                    { label: 'Fleet Performance', icon: <Car className="size-4" />, count: vehicles.length },
                    { label: 'PTW Summary', icon: <FileWarning className="size-4" />, count: permits.length },
                    { label: 'Health & Safety Metrics', icon: <Activity className="size-4" />, count: healthRecords.length },
                    { label: 'CAPA Analysis', icon: <ShieldAlert className="size-4" />, count: capaList.length },
                  ].map((report) => (
                    <button key={report.label} className="w-full flex items-center justify-between p-3 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all">
                      <span className="flex items-center gap-2 text-sm text-fg">
                        {report.icon}
                        {report.label}
                        <span className="text-xs text-fg-subtle">({report.count})</span>
                      </span>
                      <Download className="size-4 text-fg-subtle" />
                    </button>
                  ))}
                </div>

                <button className="w-full mt-4 py-2 bg-accent text-accent-fg rounded-lg text-sm font-medium hover:bg-accent-bright transition-colors flex items-center justify-center gap-2">
                  <BarChart3 className="size-4" /> Generate Comprehensive Report
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ======================================== */}
        {/* TAB 6: SETTINGS - USING THEME COLORS */}
        {/* ======================================== */}
        {activeTab === "company" && <CompanySettings />}

        {activeTab === "settings" && (
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
                  <span className="text-sm font-medium text-fg">{users.length}</span>
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
        {/* INCIDENT DETAIL MODAL */}
        {/* ======================================== */}
        {showAddUserModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowAddUserModal(false)}>
            <form className="w-full max-w-lg space-y-4 rounded-xl border border-border bg-bg-elevated p-6 shadow-2xl" onClick={(event) => event.stopPropagation()} onSubmit={handleCreateUser}>
              <div className="flex items-center justify-between"><h3 className="text-xl font-bold text-fg">Create User Account</h3><button type="button" onClick={() => setShowAddUserModal(false)} className="p-1 text-fg-muted hover:bg-bg-subtle" title="Close"><XCircle className="size-5" /></button></div>
              <Field label="Full name"><input required value={newUser.fullName} onChange={(event) => setNewUser({ ...newUser, fullName: event.target.value })} className={inputClass} placeholder="Amina Juma" /></Field>
              <Field label="Email address"><input required type="email" value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} className={inputClass} placeholder="user@company.com" /></Field>
              <p className="text-xs text-fg-muted">We’ll email this user a secure link to choose their own password.</p>
              <div className="grid gap-3 sm:grid-cols-2"><Field label="Role"><select value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value as EhsRole })} className={inputClass}>{EHS_ROLES.map((roleOption) => <option key={roleOption} value={roleOption}>{roleOption}</option>)}</select></Field><Field label="Department"><select value={newUser.department} onChange={(event) => setNewUser({ ...newUser, department: event.target.value })} className={inputClass}>{["Operations", "Health, Safety & Environment", "Finance", "Human Resources", "Administration"].map((department) => <option key={department}>{department}</option>)}</select></Field></div>
              {newUser.role === "Driver" || newUser.role === "Team_Leader" ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={newUser.dualRole} onChange={(event) => setNewUser({ ...newUser, dualRole: event.target.checked })} className="mt-0.5 accent-accent" /><span>{newUser.role === "Driver" ? "This user is also a team leader" : "This user is also a driver"}<span className="block text-xs text-fg-muted">They will see both relevant workspaces with the matching permissions.</span></span></label> : null}
              <Field label="Project assignment (optional)"><select value={newUser.projectId ?? ""} onChange={(event) => setNewUser({ ...newUser, projectId: event.target.value ? Number(event.target.value) : undefined })} className={inputClass}><option value="">No project yet</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field>
              <button disabled={busy} className={primaryBtn} type="submit">{busy ? "Creating..." : "Create account"}</button>
            </form>
          </div>
        )}

        {showIncidentForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowIncidentForm(false)}>
            <form className="w-full max-w-lg space-y-4 rounded-xl border border-border bg-bg-elevated p-6 shadow-2xl" onClick={(event) => event.stopPropagation()} onSubmit={handleReportIncident}>
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-fg">Report Incident</h3>
                <button type="button" onClick={() => setShowIncidentForm(false)} className="p-1 text-fg-muted hover:bg-bg-subtle" title="Close"><XCircle className="size-5" /></button>
              </div>
              <Field label="What happened"><input required value={incidentForm.title} onChange={(event) => setIncidentForm({ ...incidentForm, title: event.target.value })} className={inputClass} placeholder="Describe the incident" /></Field>
              <Field label="Location"><input required value={incidentForm.location} onChange={(event) => setIncidentForm({ ...incidentForm, location: event.target.value })} className={inputClass} placeholder="Site or project location" /></Field>
              <Field label="Severity"><select value={incidentForm.severity} onChange={(event) => setIncidentForm({ ...incidentForm, severity: event.target.value as typeof incidentForm.severity })} className={inputClass}><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select></Field>
              <button disabled={busy} className={primaryBtn} type="submit">{busy ? "Submitting..." : "Submit incident"}</button>
            </form>
          </div>
        )}

        {showIncidentModal && selectedIncident && (
          <div 
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" 
            onClick={() => setShowIncidentModal(false)}
          >
            <div 
              className="bg-bg-elevated rounded-xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-6 border border-border shadow-2xl" 
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-start mb-4">
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
                  <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${getStatusColor(selectedIncident.status)}`}>
                    {selectedIncident.status}
                  </span>
                  <span className={`text-xs font-semibold px-3 py-1 rounded-full ${getSeverityBadge(selectedIncident.severity)}`}>
                    {selectedIncident.severity}
                  </span>
                  <span className="text-xs font-semibold px-3 py-1 rounded-full bg-bg-subtle text-fg-muted">
                    ID: {selectedIncident.id}
                  </span>
                </div>
                <div className="space-y-2 text-sm text-fg">
                  <p>
                    <span className="text-fg-muted">Location:</span> 
                    {' '}{selectedIncident.location || 'N/A'}
                  </p>
                  <p>
                    <span className="text-fg-muted">Reported:</span> 
                    {' '}{safeFormatDateTime(selectedIncident.createdAt)}
                  </p>
                  <p>
                    <span className="text-fg-muted">Last Updated:</span> 
                    {' '}{safeFormatDateTime(selectedIncident.updatedAt)}
                  </p>
                  <p>
                    <span className="text-fg-muted">Description:</span>
                  </p>
                  <p className="bg-bg-subtle p-3 rounded-lg border border-border">
                    {selectedIncident.description || 'No description provided'}
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
      {permUser ? <PermissionsDialog user={permUser} onClose={() => setPermUser(null)} onSaved={() => { setMsg("Access updated"); void fetchData(); }} /> : null}
    </div>
  );
}
