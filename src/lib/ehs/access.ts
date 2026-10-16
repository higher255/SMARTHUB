/**
 * Permission model. A user's effective permissions are the defaults of their
 * role PLUS any extra permissions an administrator granted on their profile.
 * That is how a Project Manager can also approve finance requests without
 * being given a second role or a second login.
 *
 * Pure module: no server or React imports, so it is shared by server functions
 * (the real gate) and the UI (navigation and button visibility).
 */
import { pathForRole, type EhsRole } from "./roles.ts";

export const PERMISSION_LABELS = {
  "org.users": "Manage users and permissions",
  "org.settings": "Change company settings",
  "people.view": "View the staff directory",
  "data.view_org": "See company-wide projects, incidents and tasks",
  "projects.manage": "Create and manage projects",
  "management.view": "Open the management dashboard",
  "ehs.manage": "Manage EHS records (incidents, CAPA, HIRA)",
  "ehs.view_org": "View company-wide EHS data",
  "ehs.report": "Report incidents and hazards",
  "wellbeing.manage": "Manage company wellbeing challenges",
  "permits.approve": "Approve permits to work",
  "fleet.manage": "Manage vehicles and fleet",
  "fleet.driver_dashboard": "Use the personal driver workspace",
  "teamleader.dashboard": "Use the team leader workspace",
  "hr.manage": "Manage HR records",
  "announce.post": "Post announcements",
  "finance.request": "Submit finance requests",
  "finance.view": "View all finance requests and budgets",
  "finance.endorse": "Endorse high-value finance requests",
  "finance.approve": "Approve or reject finance requests",
  "finance.pay": "Record payments",
  "accounts.view": "View the books of account",
  "accounts.post": "Post journal vouchers",
  "accounts.invoices": "Create and issue invoices and receipts",
  "accounts.payables": "Create, post and pay supplier bills",
  "accounts.reports": "Run financial statements",
  "hours.record": "Record crew hours worked",
  "ncr.raise": "Raise non-conformance reports",
  "ncr.manage": "Assign and close non-conformance reports",
  "hira.manage": "Manage risk assessments",
  "budgets.manage": "Set project budgets by category",
  "leave.approve": "Approve leave requests",
  "attendance.view": "See who is on site and attendance records",
  "subcontractors.manage": "Pre-qualify subcontractors",
} as const;

export type Permission = keyof typeof PERMISSION_LABELS;
export const ALL_PERMISSIONS = Object.keys(PERMISSION_LABELS) as Permission[];

const STAFF: Permission[] = ["finance.request", "ehs.report"];

export const ROLE_PERMISSIONS: Record<EhsRole, Permission[]> = {
  Admin: ALL_PERMISSIONS,
  EHS_Officer: [
    ...STAFF, "data.view_org", "ehs.manage", "ehs.view_org", "wellbeing.manage", "permits.approve", "fleet.manage", "projects.manage",
    "announce.post", "hours.record", "ncr.raise", "ncr.manage", "hira.manage", "subcontractors.manage", "people.view",
    "attendance.view",
  ],
  Manager: [
    ...STAFF, "data.view_org", "projects.manage", "management.view", "ehs.view_org", "finance.view",
    "accounts.view", "accounts.reports", "announce.post", "ncr.raise", "hours.record", "people.view",
    "budgets.manage", "leave.approve", "attendance.view",
  ],
  Project_Manager: [
    ...STAFF, "data.view_org", "projects.manage", "ehs.view_org", "announce.post", "hours.record", "ncr.raise", "people.view",
    "budgets.manage", "attendance.view",
  ],
  Finance: [
    "finance.request", "finance.view", "finance.approve", "finance.pay", "accounts.view", "accounts.post",
    "accounts.invoices", "accounts.payables", "accounts.reports", "announce.post", "data.view_org", "people.view", "budgets.manage",
  ],
  HR: [...STAFF, "hr.manage", "announce.post", "people.view", "leave.approve", "attendance.view"],
  Team_Leader: [...STAFF, "hours.record", "ncr.raise", "attendance.view", "teamleader.dashboard"],
  Team_Member: [...STAFF],
  Employee: [...STAFF],
  Driver: [...STAFF],
  Client: ["data.view_org"],
};

export type AccessSubject = {
  role: string;
  permissions?: readonly string[] | null;
  status?: string | null;
  isPlatformAdmin?: boolean;
};

export function permissionsOf(subject: AccessSubject): Set<string> {
  if (subject.status && subject.status !== "active") return new Set();
  // The platform owner is the landlord: no access to any tenant's data, only to the platform console.
  if (subject.isPlatformAdmin) return new Set();
  const base = ROLE_PERMISSIONS[subject.role as EhsRole] ?? [];
  return new Set<string>([...base, ...(subject.permissions ?? [])]);
}

export function can(subject: AccessSubject | null | undefined, permission: Permission): boolean {
  if (!subject) return false;
  return permissionsOf(subject).has(permission);
}

export function canAny(subject: AccessSubject | null | undefined, permissions: Permission[]): boolean {
  return permissions.some((p) => can(subject, p));
}

export function canUseOwnerGoogleAuth(isPlatformAdmin: boolean, isFirstAccount: boolean): boolean {
  return isPlatformAdmin || isFirstAccount;
}

/** Throws with a stable message; server functions call this before touching data. */
export function assertCan(subject: AccessSubject | null | undefined, permission: Permission, message?: string): void {
  if (!can(subject, permission)) throw new Error(message ?? "You do not have permission to do this");
}

export type IconName =
  | "shield" | "gauge" | "kanban" | "wallet" | "users" | "truck" | "briefcase" | "hardhat" | "building" | "layout" | "globe";

export type WorkspaceGroup = "Daily" | "Operations" | "Money" | "Safety" | "People" | "Company";

export type Workspace = {
  path: string;
  label: string;
  icon: IconName;
  group: WorkspaceGroup;
  /** Allowed when the subject has ANY of these, or has one of `roles`. */
  anyOf?: Permission[];
  roles?: EhsRole[];
  platformOnly?: boolean;
};

export const WORKSPACES: Workspace[] = [
  { path: "/dashboard", label: "My work", icon: "layout", group: "Daily" },
  { path: "/teamleader", label: "Team & site", icon: "users", group: "Operations", anyOf: ["teamleader.dashboard"] },
  { path: "/management", label: "Management", icon: "gauge", group: "Company", anyOf: ["management.view"] },
  { path: "/projectmanager", label: "Projects", icon: "kanban", group: "Operations", anyOf: ["projects.manage"] },
  { path: "/finance", label: "Finance", icon: "wallet", group: "Money", anyOf: ["finance.view", "finance.approve", "accounts.view"] },
  { path: "/requests", label: "Requests", icon: "wallet", group: "Money", anyOf: ["finance.request"] },
  { path: "/ehs", label: "Safety (EHS)", icon: "hardhat", group: "Safety", anyOf: ["ehs.manage", "ehs.view_org"] },
  { path: "/hr", label: "People", icon: "users", group: "People", anyOf: ["hr.manage", "leave.approve", "attendance.view"] },
  { path: "/client", label: "Client view", icon: "briefcase", group: "Company", roles: ["Client"] },
  { path: "/admin", label: "Administration", icon: "shield", group: "Company", anyOf: ["org.users"] },
  { path: "/platform", label: "Platform", icon: "globe", group: "Company", platformOnly: true },
];

export function workspacesFor(subject: AccessSubject): Workspace[] {
  if (subject.status && subject.status !== "active") return [];
  if (subject.isPlatformAdmin) return WORKSPACES.filter((w) => w.platformOnly);
  return WORKSPACES.filter((w) => {
    if (w.platformOnly) return false;
    if (w.path === "/dashboard") return subject.role !== "Client";
    if (w.roles?.includes(subject.role as EhsRole)) return true;
    return w.anyOf ? w.anyOf.some((p) => can(subject, p)) : false;
  });
}

/** Where a person lands after sign-in: the landlord gets the platform console, everyone else their workspace. */
export function homePath(subject: AccessSubject): string {
  return subject.isPlatformAdmin ? "/platform" : pathForRole(subject.role);
}

export function canAccessPath(subject: AccessSubject, path: string): boolean {
  return workspacesFor(subject).some((w) => path === w.path || path.startsWith(`${w.path}/`));
}

/** Roles that the administrator may assign to users. */
export const ASSIGNABLE_ROLES: EhsRole[] = [
  "Admin", "EHS_Officer", "Manager", "Project_Manager", "Finance", "HR", "Team_Leader", "Team_Member", "Employee", "Client",
];
