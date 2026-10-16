export const EHS_ROLES = [
  "Admin",
  "EHS_Officer",
  "Manager",
  "Project_Manager",
  "Finance",
  "HR",
  "Team_Leader",
  "Team_Member",
  "Client",
  "Driver",
  "Employee",
] as const;

export type EhsRole = (typeof EHS_ROLES)[number];

export const ROLE_LABELS: Record<EhsRole, string> = {
  Admin: "Administrator",
  EHS_Officer: "EHS Administrator",
  Manager: "Manager",
  Project_Manager: "Project Manager",
  Finance: "Finance Officer",
  HR: "Human Resources",
  Team_Leader: "Team Leader",
  Team_Member: "Team Member",
  Client: "Client",
  Driver: "Driver",
  Employee: "Employee",
};

export const DEPARTMENTS = [
  "Operations",
  "Health, Safety & Environment",
  "Engineering",
  "Logistics & Transport",
  "Human Resources",
  "Administration",
  "Procurement",
  "Finance",
  "Management",
] as const;

export function isEhsRole(value: string): value is EhsRole {
  return (EHS_ROLES as readonly string[]).includes(value);
}

/** Where a role lands after sign-in. */
export function pathForRole(role: string): string {
  switch (role) {
    case "Admin":
      return "/admin";
    case "EHS_Officer":
      return "/ehs";
    case "Team_Leader":
      return "/teamleader";
    case "Manager":
      return "/management";
    case "Project_Manager":
      return "/projectmanager";
    case "Finance":
      return "/finance";
    case "HR":
      return "/hr";
    case "Client":
      return "/client";
    default:
      return "/dashboard";
  }
}
