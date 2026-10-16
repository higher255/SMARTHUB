import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { workdayMiddleware } from "@/lib/auth/workday-middleware";
import { getSql, sqlFragment } from "@/lib/db.server";
import { isEhsRole, ROLE_LABELS, type EhsRole } from "./roles";
import { can, ALL_PERMISSIONS, ASSIGNABLE_ROLES, type Permission } from "./access";
import {
  assertSafeId,
  audit,
  executeQuery,
  getOrgWhereClause,
  getUserFullName,
  isEhsAdmin,
  loadProfile,
  notify,
  notifyInApp,
  orgClause,
  requirePermission,
  requirePlatformAdmin,
  requireProfile,
  usersWithPermission,
  type Profile,
  type Sql,
} from "./core";
import { allowNewUser, releaseNewUser } from "@/lib/auth/user-gate";
import { auth } from "@/lib/auth/server";
import { emailConfigured } from "./email";
import { randomBytes } from "node:crypto";

export type { Profile } from "./core";
// ============================================
// TYPES (Complete)
// ============================================


export type Project = {
  id: number;
  name: string;
  budget: number;
  deadline: string | null;
  status: string;
  createdAt: string;
  userId: string;
  organizationId: string | null;
};

export type ProjectTask = {
  id: number;
  title: string;
  assignee: string | null;
  priority: string;
  status: string;
  userId: string;
  organizationId: string | null;
  createdAt: string;
};

export type ProjectMember = {
  id: number;
  projectId: number;
  userId: string;
  fullName: string;
  role: string;
  status: string;
  responseReason: string | null;
  createdAt: string;
};

export type ProjectMilestone = {
  id: number;
  projectId: number;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: string;
  ownerId: string | null;
  createdAt: string;
};

export type Certificate = {
  id: number;
  userId: string;
  certificateType: string;
  certificateNumber: string | null;
  fileUrl: string | null;
  expiresAt: string;
  status: string;
  clientAccountId: string | null;
};

export type Announcement = {
  id: number;
  title: string;
  message: string;
  audienceRole: string | null;
  createdAt: string;
  startsAt?: string;
  endsAt?: string | null;
};

export type Incident = {
  id: number;
  title: string;
  location: string;
  severity: string;
  status: string;
  description: string | null;
  userId: string;
  organizationId: string | null;
  createdAt: string;
  updatedAt: string;
  projectId: number | null;
};

export type HealthRow = {
  id: number;
  fitness: string;
  temperature: number | null;
  notes: string | null;
  userId: string;
  userName: string;
  organizationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HealthDeclaration = HealthRow;

export type Vehicle = {
  id: string;
  organizationId: string;
  userId: string;
  registration: string;
  make: string;
  model: string;
  year: number | null;
  color: string | null;
  status: 'Active' | 'Maintenance' | 'Grounded' | 'Retired';
  lastInspectionDate: string | null;
  nextInspectionDate: string | null;
  fuelType: string | null;
  mileage: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VehicleInspection = {
  id: string;
  vehicleId: string;
  organizationId: string;
  inspectorId: string;
  inspectionDate: string;
  type: 'Daily' | 'Weekly' | 'Monthly' | 'Pre-trip';
  result: 'Pass' | 'Fail' | 'Pending';
  defects: string[] | null;
  notes: string | null;
  photos: string[] | null;
  createdAt: string;
  updatedAt: string;
};

export type Permit = {
  id: string;
  organizationId: string;
  userId: string;
  permitNumber: string;
  type: string;
  title: string;
  description: string | null;
  location: string;
  department: string | null;
  supervisor: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  riskLevel: string | null;
  controlMeasures: string[] | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CAPA = {
  id: string;
  organizationId: string;
  userId: string;
  capaNumber: string;
  title: string;
  description: string | null;
  type: string;
  category: string;
  severity: string;
  status: string;
  assignedTo: string | null;
  dueDate: string | null;
  rootCause: string | null;
  actionPlan: string | null;
  resolution: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  closedBy: string | null;
  closedAt: string | null;
  relatedIncidentId: number | null;
  createdAt: string;
  updatedAt: string;
};

// ============================================
// PROFILE FUNCTIONS
// ============================================

/** Public: tells the sign-in page whether this installation still needs its first administrator. */
export const getSetupState = createServerFn({ method: "GET" }).handler(async () => {
  const sql = await getSql();
  const rows = await sql<{ c: number }>`select count(*)::int as c from "user"`;
  return { needsSetup: (rows[0]?.c ?? 0) === 0, emailEnabled: emailConfigured() };
});

/**
 * Returns the caller's profile. Accounts are created by an administrator (or by the platform
 * owner for a new company), so a missing profile is an error, never something to auto-create.
 * The single exception is first run: the very first account becomes administrator of the
 * first company. The role is NEVER taken from the client.
 */
export const ensureMyProfile = createServerFn({ method: "POST" })
  .validator((input: { fullName?: string } | undefined) => ({ fullName: input?.fullName?.trim() || undefined }))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const existing = await loadProfile(context.userId);
    if (existing) {
      if (data.fullName && (existing.fullName === "" || existing.fullName === "Team member")) {
        await sql`update profiles set full_name = ${data.fullName}, updated_at = now() where user_id = ${context.userId}`;
        return { ...existing, fullName: data.fullName };
      }
      return existing;
    }

    const counts = await sql<{ c: number }>`select count(*)::int as c from profiles`;
    if ((counts[0]?.c ?? 0) > 0) {
      throw new Error("Your account has not been set up yet. Ask your administrator to add you.");
    }
    const org = await sql<{ id: string }>`insert into organizations (name, slug) values ('My Company', 'my-company')
      on conflict (slug) do update set name = organizations.name returning id`;
    await sql`insert into profiles (user_id, full_name, role, department, organization_id, is_platform_admin)
      values (${context.userId}, ${data.fullName || "Administrator"}, 'Admin', null, ${org[0]!.id}, true)
      on conflict (user_id) do nothing`;
    return (await loadProfile(context.userId))!;
  });

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const existing = await loadProfile(context.userId);
    if (!existing) throw new Error("Profile not found");
    return existing;
  });

export const getProfileByUserId = createServerFn({ method: "GET" })
  .validator((userId: string) => userId)
  .middleware([authMiddleware])
  .handler(async ({ context, data: userId }) => {
    const me = await requireProfile(context.userId);
    const target = await loadProfile(userId);
    if (!target || target.organizationId !== me.organizationId) return null;
    return target;
  });

/** Self-service profile edit. Role, permissions and company can never be changed here. */
export const updateProfile = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      fullName: z.string().min(1).max(120).optional(),
      department: z.string().max(80).optional(),
      phone: z.string().max(40).optional(),
    }).parse(input),
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await requireProfile(context.userId);
    await sql`update profiles set
        full_name = coalesce(${data.fullName ?? null}::text, full_name),
        department = coalesce(${data.department ?? null}::text, department),
        phone = coalesce(${data.phone ?? null}::text, phone),
        updated_at = now()
      where user_id = ${context.userId}`;
    return await loadProfile(context.userId);
  });

// ============================================
// PROJECT FUNCTIONS
// ============================================

const projectInput = z.object({
  name: z.string().min(1).max(120),
  budget: z.number().nonnegative(),
  deadline: z.string().min(1),
  status: z.enum(["Planning", "Active", "Completed", "On Hold"]),
});

async function notifyUser(sql: Awaited<ReturnType<typeof getSql>>, organizationId: string, userId: string, title: string, message: string, link: string) {
  await notify(sql, { organizationId, userIds: [userId], title, message, type: "project", link });
}

async function requireProjectAccess(sql: Awaited<ReturnType<typeof getSql>>, projectId: number, userId: string) {
  const profile = await loadProfile(userId);
  const project = await sql<{ id: number; user_id: string; organization_id: string | null }>`select id, user_id, organization_id from projects where id = ${projectId}`;
  if (!project[0] || !profile?.organizationId || project[0].organization_id !== profile.organizationId) throw new Error("Project not found");
  const member = await sql<{ id: number }>`select id from project_members where project_id = ${projectId} and user_id = ${userId} and status = 'Accepted'`;
  const canManage = can(profile, "projects.manage");
  if (project[0].user_id !== userId && !member[0] && !canManage) throw new Error("You are not assigned to this project");
  return { profile, project: project[0], canManage };
}

export const listProjects = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const { clause } = getOrgWhereClause(profile, context.userId);
    const projectClause = profile?.role === "Client"
      ? sqlFragment(`exists (select 1 from project_members pm where pm.project_id = projects.id and pm.user_id = '${context.userId.replace(/'/g, "''")}' and pm.status in ('Accepted', 'Pending'))`)
      : profile?.role === "Team_Leader" || can(profile, "teamleader.dashboard")
        ? sqlFragment(`exists (select 1 from project_members pm where pm.project_id = projects.id and pm.user_id = '${context.userId.replace(/'/g, "''")}' and pm.status = 'Accepted')`)
      : clause;
    
    const rows = await sql<{
      id: number;
      name: string;
      budget: string | number;
      deadline: string | null;
      status: string;
      user_id: string;
      organization_id: string | null;
      created_at: string;
    }>`select id, name, budget, deadline, status, user_id, organization_id, created_at 
      from projects 
      where ${projectClause}
      order by created_at desc`;
      
    return rows.map((r): Project => ({
      id: r.id,
      name: r.name,
      budget: Number(r.budget) || 0,
      deadline: r.deadline,
      status: r.status,
      createdAt: r.created_at,
      userId: r.user_id,
      organizationId: r.organization_id,
    }));
  });

export const listCertificates = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "ehs.view_org", "You cannot view the training matrix");
    const rows = await sql<{ id: number; user_id: string; certificate_type: string; certificate_number: string | null; file_url: string | null; expires_at: string; status: string; client_account_id: string | null }>`select id, user_id, certificate_type, certificate_number, file_url, expires_at, status, client_account_id from certificates where organization_id = ${profile?.organizationId} order by expires_at asc`;
    return rows.map((row): Certificate => ({ id: row.id, userId: row.user_id, certificateType: row.certificate_type, certificateNumber: row.certificate_number, fileUrl: row.file_url, expiresAt: row.expires_at, status: row.status, clientAccountId: row.client_account_id }));
  });

export const createCertificate = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ userId: z.string().min(1), certificateType: z.string().trim().min(2).max(100), certificateNumber: z.string().trim().max(100).optional(), expiresAt: z.string().date(), fileUrl: z.string().url().optional() }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "ehs.manage", "Only EHS can manage training records");
    const person = await sql<{ user_id: string }>`select user_id from profiles where user_id = ${data.userId} and organization_id = ${profile.organizationId} and status = 'active' limit 1`;
    if (!person[0]) throw new Error("Choose an active staff member in your organization");
    await sql`insert into certificates (user_id, organization_id, certificate_type, certificate_number, file_url, expires_at)
      values (${data.userId}, ${profile.organizationId}, ${data.certificateType}, ${data.certificateNumber || null}, ${data.fileUrl || null}, ${data.expiresAt})`;
    await audit(sql, profile.organizationId, context.userId, "training.certificate_created", "certificates", null, { userId: data.userId, certificateType: data.certificateType, expiresAt: data.expiresAt });
    return { success: true };
  });

export const listAnnouncements = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    return sql<Announcement>`select id, title, message, audience_role as "audienceRole", created_at as "createdAt", starts_at as "startsAt", ends_at as "endsAt" from announcements where (organization_id = ${profile?.organizationId} or organization_id is null) and starts_at <= now() and (ends_at is null or ends_at >= now()) order by created_at desc limit 10`;
  });

export const createAnnouncement = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ title: z.string().min(1).max(120), message: z.string().min(1).max(500), audienceRole: z.string().optional(), startsAt: z.string().datetime().optional(), endsAt: z.string().datetime().optional(), durationDays: z.number().int().min(1).max(20).default(20) }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const allowed = can(profile, "announce.post");
    if (!allowed) throw new Error("Only management, PM, and EHS can post announcements");
    const startsAt = data.startsAt ? new Date(data.startsAt) : new Date();
    const endsAt = data.endsAt ? new Date(data.endsAt) : new Date(startsAt.getTime() + data.durationDays * 24 * 60 * 60 * 1000);
    if (endsAt <= startsAt) throw new Error("Announcement end time must be after its start time");
    await sql`insert into announcements (organization_id, posted_by, audience_role, title, message, starts_at, ends_at) values (${profile?.organizationId}, ${context.userId}, ${data.audienceRole || null}, ${data.title}, ${data.message}, ${startsAt}, ${endsAt})`;
    return { success: true };
  });

export const deleteAnnouncement = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const allowed = can(profile, "announce.post");
    if (!allowed) throw new Error("You are not allowed to delete announcements");
    await sql`delete from announcements where id = ${id} and organization_id = ${profile?.organizationId}`;
    return { success: true };
  });

export const createJobOrder = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ title: z.string().min(1).max(160), description: z.string().max(1000).optional(), location: z.string().max(160).optional(), projectId: z.number().optional() }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    if (profile?.role !== "Client") throw new Error("Only client users can create job orders");
    await sql`insert into job_orders (organization_id, client_account_id, project_id, created_by, title, description, location) values (${profile.organizationId}, ${profile.clientAccountId}, ${data.projectId || null}, ${context.userId}, ${data.title}, ${data.description || null}, ${data.location || null})`;
    return { success: true };
  });

export const createProject = createServerFn({ method: "POST" })
  .validator((input: unknown) => projectInput.parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    await requirePermission(context.userId, "projects.manage");
    const sql = await getSql();
    const profile = await requireProfile(context.userId);
    const orgId = profile.organizationId;
    
    await sql`insert into projects (user_id, name, budget, deadline, status, organization_id)
      values (${context.userId}, ${data.name}, ${data.budget}, ${data.deadline}, ${data.status}, ${orgId})`;
  });

export const listProjectMembers = createServerFn({ method: "GET" })
  .validator((projectId: number) => projectId)
  .middleware([authMiddleware])
  .handler(async ({ context, data: projectId }) => {
    const sql = await getSql();
    await requireProjectAccess(sql, projectId, context.userId);
    const rows = await sql<{ id: number; project_id: number; user_id: string; full_name: string; role: string; status: string; response_reason: string | null; created_at: string }>`select m.id, m.project_id, m.user_id, p.full_name, p.role, m.status, m.response_reason, m.created_at from project_members m join profiles p on p.user_id = m.user_id where m.project_id = ${projectId} order by m.created_at desc`;
    return rows.map((row): ProjectMember => ({ id: row.id, projectId: row.project_id, userId: row.user_id, fullName: row.full_name, role: row.role, status: row.status, responseReason: row.response_reason, createdAt: row.created_at }));
  });

export const assignProjectMember = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ projectId: z.number(), userId: z.string(), role: z.string().max(60).default("Contributor") }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const access = await requireProjectAccess(sql, data.projectId, context.userId);
    if (!access.canManage && access.project.user_id !== context.userId) throw new Error("Only project leaders can assign members");
    const target = await sql<{ user_id: string }>`select user_id from profiles where user_id = ${data.userId} and organization_id = ${access.project.organization_id}`;
    if (!target[0]) throw new Error("User is outside this project organization");
    await sql`insert into project_members (project_id, user_id, role, invited_by) values (${data.projectId}, ${data.userId}, ${data.role}, ${context.userId}) on conflict (project_id, user_id) do update set role = excluded.role, status = 'Pending', response_reason = null, invited_by = excluded.invited_by`;
    await notifyUser(sql, access.project.organization_id!, data.userId, "Project assignment", `You have been invited to join project #${data.projectId}. Review the assignment in your dashboard.`, "/projects");
    return { success: true };
  });

export const respondToProjectAssignment = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ projectId: z.number(), status: z.enum(["Accepted", "Rejected"]), reason: z.string().max(500).optional() }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    if (data.status === "Rejected" && !data.reason?.trim()) throw new Error("A rejection reason is required");
    const sql = await getSql();
    const result = await sql<{ id: number }>`update project_members set status = ${data.status}, response_reason = ${data.reason?.trim() || null}, responded_at = now() where project_id = ${data.projectId} and user_id = ${context.userId} and status = 'Pending' returning id`;
    if (!result[0]) throw new Error("Pending assignment not found");
    const project = await sql<{ user_id: string; name: string; organization_id: string }>`select user_id, name, organization_id::text from projects where id = ${data.projectId}`;
    if (project[0]) await notifyUser(sql, project[0].organization_id, project[0].user_id, `Project assignment ${data.status.toLowerCase()}`, `A team member has ${data.status.toLowerCase()} the assignment for ${project[0].name}.`, "/projects");
    return { success: true };
  });

export const listProjectMilestones = createServerFn({ method: "GET" })
  .validator((projectId: number) => projectId)
  .middleware([authMiddleware])
  .handler(async ({ context, data: projectId }) => {
    const sql = await getSql();
    await requireProjectAccess(sql, projectId, context.userId);
    const rows = await sql<{ id: number; project_id: number; title: string; description: string | null; due_date: string | null; status: string; owner_id: string | null; created_at: string }>`select id, project_id, title, description, due_date, status, owner_id, created_at from project_milestones where project_id = ${projectId} order by due_date nulls last, created_at`;
    return rows.map((row): ProjectMilestone => ({ id: row.id, projectId: row.project_id, title: row.title, description: row.description, dueDate: row.due_date, status: row.status, ownerId: row.owner_id, createdAt: row.created_at }));
  });

export const createProjectMilestone = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ projectId: z.number(), title: z.string().min(1).max(160), description: z.string().max(500).optional(), dueDate: z.string().optional(), ownerId: z.string().optional() }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const access = await requireProjectAccess(sql, data.projectId, context.userId);
    if (!access.canManage && access.project.user_id !== context.userId) throw new Error("Only project leaders can create milestones");
    await sql`insert into project_milestones (project_id, title, description, due_date, owner_id, created_by) values (${data.projectId}, ${data.title}, ${data.description || null}, ${data.dueDate || null}, ${data.ownerId || null}, ${context.userId})`;
    if (data.ownerId) await notifyUser(sql, access.project.organization_id!, data.ownerId, "Milestone assigned", `${data.title} was assigned to you on project #${data.projectId}.`, "/projects");
    return { success: true };
  });

export const updateProjectMilestone = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.number(), status: z.enum(["Pending", "In Progress", "Completed", "Blocked"]) }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const milestone = await sql<{ project_id: number }>`select project_id from project_milestones where id = ${data.id}`;
    if (!milestone[0]) throw new Error("Milestone not found");
    const access = await requireProjectAccess(sql, milestone[0].project_id, context.userId);
    if (!access.canManage && access.project.user_id !== context.userId) throw new Error("Only project leaders can update milestones");
    await sql`update project_milestones set status = ${data.status}, updated_at = now() where id = ${data.id}`;
    return { success: true };
  });

export const requestProjectApproval = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ projectId: z.number(), approverId: z.string() }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const access = await requireProjectAccess(sql, data.projectId, context.userId);
    if (!access.canManage && access.project.user_id !== context.userId) throw new Error("Only project leaders can request approval");
    await sql`insert into project_approvals (project_id, approver_id) values (${data.projectId}, ${data.approverId}) on conflict (project_id, approver_id) do update set status = 'Pending', reason = null, decided_at = null`;
    await notifyUser(sql, access.project.organization_id!, data.approverId, "Project approval requested", `Project #${data.projectId} is waiting for your approval.`, "/projects");
    return { success: true };
  });

export const listMyProjectAssignments = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    return sql<{ project_id: number; project_name: string; project_status: string; assignment_status: string; role: string; response_reason: string | null }>`select m.project_id, p.name as project_name, p.status as project_status, m.status as assignment_status, m.role, m.response_reason from project_members m join projects p on p.id = m.project_id where m.user_id = ${context.userId} order by m.created_at desc`;
  });

export const decideProjectApproval = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ projectId: z.number(), status: z.enum(["Approved", "Rejected"]), reason: z.string().max(500).optional() }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    if (data.status === "Rejected" && !data.reason?.trim()) throw new Error("A rejection reason is required");
    const sql = await getSql();
    const access = await requireProjectAccess(sql, data.projectId, context.userId);
    if (!access.canManage) throw new Error("Only management can decide project approvals");
    await sql`update project_approvals set status = ${data.status}, reason = ${data.reason?.trim() || null}, decided_at = now() where project_id = ${data.projectId} and approver_id = ${context.userId}`;
    await notifyUser(sql, access.project.organization_id!, access.project.user_id, `Project ${data.status.toLowerCase()}`, `Project #${data.projectId} was ${data.status.toLowerCase()}${data.reason ? `: ${data.reason}` : "."}`, "/projects");
    return { success: true };
  });

export const addProjectAttachment = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ projectId: z.number(), fileName: z.string().min(1).max(200), fileUrl: z.string().url(), attachmentType: z.string().max(40).default("document") }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await requireProjectAccess(sql, data.projectId, context.userId);
    await sql`insert into project_attachments (project_id, uploaded_by, file_name, file_url, attachment_type) values (${data.projectId}, ${context.userId}, ${data.fileName}, ${data.fileUrl}, ${data.attachmentType})`;
    return { success: true };
  });

export const getProjectById = createServerFn({ method: "GET" })
  .validator((id: number) => id)
  .middleware([authMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const { clause } = getOrgWhereClause(profile, context.userId);
    
    const rows = await sql<{
      id: number;
      name: string;
      budget: string | number;
      deadline: string | null;
      status: string;
      user_id: string;
      organization_id: string | null;
      created_at: string;
    }>`select id, name, budget, deadline, status, user_id, organization_id, created_at 
      from projects 
      where id = ${id} and ${clause}`;
      
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      name: r.name,
      budget: Number(r.budget) || 0,
      deadline: r.deadline,
      status: r.status,
      createdAt: r.created_at,
      userId: r.user_id,
      organizationId: r.organization_id,
    } as Project;
  });

export const updateProject = createServerFn({ method: "POST" })
  .validator((input: unknown) => 
    z.object({
      id: z.number(),
      name: z.string().min(1).max(120).optional(),
      budget: z.number().nonnegative().optional(),
      deadline: z.string().min(1).optional(),
      status: z.enum(["Planning", "Active", "Completed", "On Hold"]).optional(),
    }).parse(input)
  )
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    await requirePermission(context.userId, "projects.manage");
    const sql = await getSql();
    const { id, ...updates } = data;
    const profile = await loadProfile(context.userId);
    const { clause } = getOrgWhereClause(profile, context.userId, "projects.manage");
    
    const filteredUpdates = Object.entries(updates)
      .filter(([_, value]) => value !== undefined);
    
    if (filteredUpdates.length === 0) return;
    
    const setClause = filteredUpdates
      .map(([key], index) => `${key} = $${index + 1}`)
      .join(', ');
    
    const values: any[] = filteredUpdates.map(([_, value]) => value);
    const query = `update projects set ${setClause}, updated_at = now() where id = $${filteredUpdates.length + 1} and ${clause}`;
    values.push(String(id));
    
    await executeQuery(sql, query, values);
  });

export const deleteProject = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data: id }) => {
    await requirePermission(context.userId, "projects.manage");
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const { clause } = getOrgWhereClause(profile, context.userId, "projects.manage");
    
    await sql`delete from projects where id = ${id} and ${clause}`;
  });

// ============================================
// TASK FUNCTIONS
// ============================================

const taskInput = z.object({
  title: z.string().min(1).max(160),
  assignee: z.string().max(80).optional(),
  priority: z.enum(["Low", "Normal", "High"]),
  projectId: z.number().optional(),
});

export const listTasks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const { clause } = getOrgWhereClause(profile, context.userId);
    
    const rows = await sql<{
      id: number;
      title: string;
      assignee: string | null;
      priority: string;
      status: string;
      user_id: string;
      organization_id: string | null;
      created_at: string;
    }>`select id, title, assignee, priority, status, user_id, organization_id, created_at 
      from project_tasks 
      where ${clause}
      order by created_at desc`;
      
    return rows.map((r): ProjectTask => ({
      id: r.id,
      title: r.title,
      assignee: r.assignee,
      priority: r.priority,
      status: r.status,
      userId: r.user_id,
      organizationId: r.organization_id,
      createdAt: r.created_at,
    }));
  });

export const createTask = createServerFn({ method: "POST" })
  .validator((input: unknown) => taskInput.parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const orgId = (await requireProfile(context.userId)).organizationId;
    
    await sql`insert into project_tasks (user_id, title, assignee, priority, status, organization_id)
      values (${context.userId}, ${data.title}, ${data.assignee ?? null}, ${data.priority}, ${"Pending"}, ${orgId})`;
  });

export const updateTaskStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      id: z.number(),
      status: z.enum(["Pending", "In Progress", "Completed", "Blocked"]),
    }).parse(input)
  )
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const { id, status } = data;
    const profile = await loadProfile(context.userId);
    const { clause } = getOrgWhereClause(profile, context.userId);
    
    await sql`update project_tasks 
      set status = ${status}, updated_at = now()
      where id = ${id} and ${clause}`;
  });

export const deleteTask = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const { clause } = getOrgWhereClause(profile, context.userId);
    
    await sql`delete from project_tasks where id = ${id} and ${clause}`;
  });

// ============================================
// INCIDENT FUNCTIONS
// ============================================

const incidentInput = z.object({
  title: z.string().min(1).max(160),
  location: z.string().min(1).max(120),
  severity: z.enum(["Low", "Medium", "High", "Critical"]),
  description: z.string().max(500).optional(),
  projectId: z.number().optional(),
});

export const listIncidents = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const { clause } = getOrgWhereClause(profile, context.userId);
    
    const rows = await sql<{
      id: number;
      title: string;
      location: string;
      severity: string;
      status: string;
      description: string | null;
      user_id: string;
      organization_id: string | null;
      created_at: string;
      updated_at: string;
      project_id: number | null;
      is_anonymous: boolean;
    }>`select id, title, location, severity, status, description, user_id, organization_id, created_at, updated_at, project_id, is_anonymous
      from incidents 
      where ${clause}
      order by created_at desc`;
      
    return rows.map((r): Incident => ({
      id: r.id,
      title: r.title,
      location: r.location,
      severity: r.severity,
      status: r.status,
      description: r.description || null,
      userId: r.is_anonymous && r.user_id !== context.userId ? "" : r.user_id,
      organizationId: r.organization_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at || r.created_at,
      projectId: r.project_id,
    }));
  });

export const reportIncident = createServerFn({ method: "POST" })
  .validator((input: unknown) => incidentInput.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const orgId = (await requireProfile(context.userId)).organizationId;
    
    await sql`insert into incidents (user_id, title, location, severity, status, description, organization_id, project_id)
      values (${context.userId}, ${data.title}, ${data.location}, ${data.severity}, ${"Reported"}, ${data.description || null}, ${orgId}, ${data.projectId || null})`;
  });

export const getIncidentById = createServerFn({ method: "GET" })
  .validator((id: number) => id)
  .middleware([authMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const { clause } = getOrgWhereClause(profile, context.userId);
    
    const rows = await sql<{
      id: number;
      title: string;
      location: string;
      severity: string;
      status: string;
      description: string | null;
      user_id: string;
      organization_id: string | null;
      created_at: string;
      updated_at: string;
      project_id: number | null;
      is_anonymous: boolean;
    }>`select id, title, location, severity, status, description, user_id, organization_id, created_at, updated_at, project_id, is_anonymous
      from incidents 
      where id = ${id} and ${clause}`;
      
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      title: r.title,
      location: r.location,
      severity: r.severity,
      status: r.status,
      description: r.description || null,
      userId: r.is_anonymous && r.user_id !== context.userId ? "" : r.user_id,
      organizationId: r.organization_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at || r.created_at,
      projectId: r.project_id,
    } as Incident;
  });

export const updateIncident = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      id: z.number(),
      title: z.string().min(1).max(160).optional(),
      location: z.string().min(1).max(120).optional(),
      severity: z.enum(["Low", "Medium", "High", "Critical"]).optional(),
      status: z.enum(["Reported", "Under Investigation", "Resolved", "Closed"]).optional(),
      description: z.string().max(500).optional(),
      projectId: z.number().nullable().optional(),
    }).parse(input)
  )
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const { id, ...updates } = data;
    const profile = await loadProfile(context.userId);
    const { clause } = getOrgWhereClause(profile, context.userId, "ehs.manage");
    
    const filteredUpdates = Object.entries(updates)
      .filter(([_, value]) => value !== undefined);
    
    if (filteredUpdates.length === 0) return;
    
    const setClause = filteredUpdates
      .map(([key], index) => `${key === "projectId" ? "project_id" : key} = $${index + 1}`)
      .join(', ');
    
    const values: any[] = filteredUpdates.map(([_, value]) => value);
    const query = `update incidents set ${setClause}, updated_at = now() where id = $${filteredUpdates.length + 1} and ${clause}`;
    values.push(String(id));
    
    await executeQuery(sql, query, values);
  });

export const updateIncidentStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      id: z.number(),
      status: z.enum(["Reported", "Under Investigation", "Resolved", "Closed"]),
    }).parse(input)
  )
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const { id, status } = data;
    const profile = await loadProfile(context.userId);
    const { clause } = getOrgWhereClause(profile, context.userId, "ehs.manage");
    
    await sql`update incidents 
      set status = ${status}, updated_at = now()
      where id = ${id} and ${clause}`;
  });

export const deleteIncident = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const { clause } = getOrgWhereClause(profile, context.userId, "ehs.manage");
    
    await sql`delete from incidents where id = ${id} and ${clause}`;
  });

// ============================================
// HEALTH FUNCTIONS
// ============================================

const healthInput = z.object({
  fitness: z.enum(["Fit for Duty", "Restricted", "Unfit"]),
  temperature: z.number().min(30).max(45),
  notes: z.string().max(240).optional(),
});

export const listHealth = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requireProfile(context.userId);
    const isHr = profile.role === "HR";
    const isEhs = can(profile, "ehs.manage");
    
    const rows = await sql<{
      id: number;
      fitness: string;
      temperature: string | number | null;
      notes: string | null;
      user_id: string;
      user_name: string;
      organization_id: string | null;
      created_at: string;
      updated_at: string;
    }>`select h.id, h.fitness, h.temperature, h.notes, h.user_id, p.full_name as user_name, h.organization_id, h.created_at, h.updated_at
      from health_declarations h join profiles p on p.user_id = h.user_id
      where h.organization_id = ${profile.organizationId}
        and (${isHr} or (${isEhs} and h.created_at::date = current_date) or h.user_id = ${context.userId})
      order by h.created_at desc limit 500`;
      
    return rows.map((r): HealthRow => ({
      id: r.id,
      fitness: r.fitness,
      temperature: isHr || r.user_id === context.userId ? (r.temperature == null ? null : Number(r.temperature)) : null,
      notes: isHr || r.user_id === context.userId ? r.notes : null,
      userId: r.user_id,
      userName: r.user_name,
      organizationId: r.organization_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at || r.created_at,
    }));
  });

export type TodayHealthStatus = { userId: string; userName: string; fitness: string | null; declaredAt: string | null };

export const listTodayHealthStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requireProfile(context.userId);
    if (!can(profile, "ehs.manage") && !can(profile, "hr.manage")) throw new Error("Only EHS or company HR can view employee health status");
    const rows = await sql<{ user_id: string; full_name: string; fitness: string | null; declared_at: string | null }>`
      select p.user_id, p.full_name,
        h.fitness,
        h.created_at::text as declared_at
      from profiles p
      left join lateral (
        select fitness, created_at from health_declarations
        where user_id = p.user_id and organization_id = p.organization_id and created_at::date = current_date
        order by created_at desc limit 1
      ) h on true
      where p.organization_id = ${profile.organizationId} and p.status = 'active'
      order by p.full_name`;
    return rows.map((r): TodayHealthStatus => ({ userId: r.user_id, userName: r.full_name, fitness: r.fitness, declaredAt: r.declared_at }));
  });

export const submitHealth = createServerFn({ method: "POST" })
  .validator((input: unknown) => healthInput.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const orgId = (await requireProfile(context.userId)).organizationId;
    if (!orgId) throw new Error("This account is not linked to a company");

    const rows = await sql<{ id: number }>`insert into health_declarations (user_id, fitness, temperature, notes, organization_id)
      values (${context.userId}, ${data.fitness}, ${data.temperature}, ${data.notes ?? null}, ${orgId}) returning id`;

    if (data.fitness !== "Fit for Duty") {
      const recipients = [...new Set([
        ...(await usersWithPermission(sql, orgId, "hr.manage")),
        ...(await usersWithPermission(sql, orgId, "ehs.manage")),
      ])].filter((id) => id !== context.userId);
      await notify(sql, {
        organizationId: orgId,
        userIds: recipients,
        title: `Health status: ${data.fitness}`,
        message: `${getUserFullName(profile)} reported ${data.fitness.toLowerCase()} for duty today. Please follow up with the employee.`,
        type: "health",
        link: "/dashboard",
        entityType: "health_declaration",
        entityId: rows[0]?.id,
      });
    }
  });

export const getHealthSummary = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requireProfile(context.userId);
    const isHr = profile.role === "HR";
    const isEhs = can(profile, "ehs.manage");
    if (!isHr && !isEhs) throw new Error("Only HR or EHS can view employee health summaries");
    const { clause } = getOrgWhereClause(profile, context.userId, isHr ? "hr.manage" : "ehs.manage");
    
    const rows = await sql<{
      total: number;
      fit: number;
      restricted: number;
      unfit: number;
    }>`select 
      count(*) as total,
      sum(case when fitness = 'Fit for Duty' then 1 else 0 end) as fit,
      sum(case when fitness = 'Restricted' then 1 else 0 end) as restricted,
      sum(case when fitness = 'Unfit' then 1 else 0 end) as unfit
    from health_declarations
    where ${clause}
    ${isEhs && !isHr ? sqlFragment("and created_at::date = current_date") : sqlFragment("and created_at >= now() - interval '7 days'")}`;
    
    return rows[0] || { total: 0, fit: 0, restricted: 0, unfit: 0 };
  });

// ============================================
// COMPANY (TENANT) FUNCTIONS
// ============================================

export type OrgBrand = {
  id: string;
  name: string;
  displayName: string;
  logoUrl: string | null;
  dashboardCoverUrl: string | null;
  primaryColor: string | null;
  currency: string;
  vatRate: number;
  businessAddress: string | null;
  businessBankName: string | null;
  businessBankAccountName: string | null;
  businessBankAccountNumber: string | null;
  businessBankSwift: string | null;
  businessTin: string | null;
  businessVrn: string | null;
  modules: string[];
  booksLockedUntil: string | null;
  plan: string;
  maxUsers: number;
  paidUntil: string | null;
  enforceBudget: boolean;
};

function mapOrg(r: {
  id: string; name: string; display_name: string | null; logo_url: string | null; dashboard_cover_url: string | null; primary_color: string | null;
  currency: string; vat_rate: string | number; business_address: string | null; business_bank_name: string | null; business_bank_account_name: string | null;
  business_bank_account_number: string | null; business_bank_swift: string | null; business_tin: string | null; business_vrn: string | null;
  manager_approval_limit: string | number; modules: string[] | null; books_locked_until: string | null;
  plan: string; max_users: number; paid_until: string | null; enforce_budget: boolean;
}): OrgBrand {
  return {
    id: r.id,
    name: r.name,
    displayName: r.display_name || r.name,
    logoUrl: r.logo_url,
    dashboardCoverUrl: r.dashboard_cover_url,
    primaryColor: r.primary_color,
    currency: r.currency,
    vatRate: Number(r.vat_rate),
    businessAddress: r.business_address,
    businessBankName: r.business_bank_name,
    businessBankAccountName: r.business_bank_account_name,
    businessBankAccountNumber: r.business_bank_account_number,
    businessBankSwift: r.business_bank_swift,
    businessTin: r.business_tin,
    businessVrn: r.business_vrn,
    modules: r.modules ?? [],
    booksLockedUntil: r.books_locked_until,
    plan: r.plan,
    maxUsers: r.max_users,
    paidUntil: r.paid_until,
    enforceBudget: r.enforce_budget,
  };
}

/** Branding and settings of the caller's own company. */
export const getOrgBrand = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requireProfile(context.userId);
    const rows = await sql<Parameters<typeof mapOrg>[0]>`select id, name, display_name, logo_url, dashboard_cover_url, primary_color, currency, vat_rate,
        business_address, business_bank_name, business_bank_account_name, business_bank_account_number, business_bank_swift, business_tin, business_vrn,
        manager_approval_limit, modules, books_locked_until::text as books_locked_until,
        plan, max_users, paid_until::text as paid_until, enforce_budget
      from organizations where id = ${profile.organizationId}`;
    if (!rows[0]) throw new Error("Company not found");
    return mapOrg(rows[0]);
  });

export const updateCompanySettings = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      displayName: z.string().min(1).max(100).optional(),
      logoUrl: z.string().url().max(500).or(z.literal("")).optional(),
      dashboardCoverUrl: z.string().url().max(1000).refine((value) => value.startsWith("https://"), "Use a public HTTPS image link").or(z.literal("")).optional(),
      primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).or(z.literal("")).optional(),
      currency: z.enum(["TZS", "USD"]).optional(),
      vatRate: z.number().min(0).max(30).optional(),
      businessAddress: z.string().max(500).optional(),
      businessBankName: z.string().max(160).optional(),
      businessBankAccountName: z.string().max(160).optional(),
      businessBankAccountNumber: z.string().max(80).optional(),
      businessBankSwift: z.string().max(40).optional(),
      businessTin: z.string().max(60).optional(),
      businessVrn: z.string().max(60).optional(),
      booksLockedUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).optional(),
      enforceBudget: z.boolean().optional(),
    }).parse(input),
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "org.settings");
    await sql`update organizations set
        display_name = coalesce(${data.displayName ?? null}::text, display_name),
        logo_url = case when ${data.logoUrl ?? null}::text is null then logo_url else nullif(${data.logoUrl ?? null}::text, '') end,
        dashboard_cover_url = case when ${data.dashboardCoverUrl ?? null}::text is null then dashboard_cover_url else nullif(${data.dashboardCoverUrl ?? null}::text, '') end,
        primary_color = case when ${data.primaryColor ?? null}::text is null then primary_color else nullif(${data.primaryColor ?? null}::text, '') end,
        currency = coalesce(${data.currency ?? null}::text, currency),
        vat_rate = coalesce(${data.vatRate ?? null}::numeric, vat_rate),
        business_address = case when ${data.businessAddress ?? null}::text is null then business_address else nullif(${data.businessAddress ?? null}::text, '') end,
        business_bank_name = case when ${data.businessBankName ?? null}::text is null then business_bank_name else nullif(${data.businessBankName ?? null}::text, '') end,
        business_bank_account_name = case when ${data.businessBankAccountName ?? null}::text is null then business_bank_account_name else nullif(${data.businessBankAccountName ?? null}::text, '') end,
        business_bank_account_number = case when ${data.businessBankAccountNumber ?? null}::text is null then business_bank_account_number else nullif(${data.businessBankAccountNumber ?? null}::text, '') end,
        business_bank_swift = case when ${data.businessBankSwift ?? null}::text is null then business_bank_swift else nullif(${data.businessBankSwift ?? null}::text, '') end,
        business_tin = case when ${data.businessTin ?? null}::text is null then business_tin else nullif(${data.businessTin ?? null}::text, '') end,
        business_vrn = case when ${data.businessVrn ?? null}::text is null then business_vrn else nullif(${data.businessVrn ?? null}::text, '') end,
        books_locked_until = case when ${data.booksLockedUntil ?? null}::text is null then books_locked_until else nullif(${data.booksLockedUntil ?? null}::text, '')::date end,
        enforce_budget = coalesce(${data.enforceBudget ?? null}::boolean, enforce_budget)
      where id = ${profile.organizationId}`;
    await audit(sql, profile.organizationId, context.userId, "update", "organization", profile.organizationId, data);
    return { success: true };
  });

// ---- Platform owner: manage tenants (only profiles flagged is_platform_admin) ----

export const createTenant = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      name: z.string().min(2).max(100),
      slug: z.string().regex(/^[a-z0-9-]{2,40}$/, "Use lowercase letters, numbers and dashes"),
      adminEmail: z.string().email(),
      adminName: z.string().min(2).max(120),
      currency: z.enum(["TZS", "USD"]).default("TZS"),
      vatRate: z.number().min(0).max(30).default(18),
      plan: z.string().max(40).default("standard"),
      maxUsers: z.number().int().min(0).max(100000).default(0),
      monthlyFee: z.number().min(0).default(0),
      planDays: z.number().int().min(0).max(3650).default(0),
    }).parse(input),
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await requirePlatformAdmin(context.userId);
    if (!emailConfigured()) throw new Error("Set RESEND_API_KEY and EMAIL_FROM in Production before creating a company admin. The admin will receive a secure password setup link by email.");
    const taken = await sql`select 1 from organizations where slug = ${data.slug}`;
    if (taken[0]) throw new Error("That company code is already used");
    const email = data.adminEmail.trim().toLowerCase();
    const emailTaken = await sql`select 1 from "user" where lower(email) = ${email}`;
    if (emailTaken[0]) throw new Error("That administrator email already has an account");
    const org = await sql<{ id: string }>`insert into organizations (name, slug, currency, vat_rate, plan, max_users, monthly_fee, paid_until, billing_exempt, contact_name, contact_email)
      values (${data.name}, ${data.slug}, ${data.currency}, ${data.vatRate}, ${data.plan}, ${data.maxUsers}, ${data.monthlyFee}, case when ${data.planDays} = 0 then null else current_date + ${data.planDays}::int end, ${data.planDays === 0}, ${data.adminName}, ${email})
      returning id::text as id`;
    const orgId = org[0]!.id;
    await sql`select acct_seed_chart(${orgId})`;
    const adminId = await provisionUser({
      // The admin chooses their own password from the one-time reset link sent below.
      email, password: randomBytes(32).toString("base64url"), fullName: data.adminName, role: "Admin",
      organizationId: orgId,
    });
    let inviteSent = false;
    try {
      const baseUrl = process.env.BETTER_AUTH_URL?.trim() || process.env.APP_URL?.trim() || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
      const result = await auth.api.requestPasswordReset({
        body: { email, ...(baseUrl ? { redirectTo: `${baseUrl.replace(/\/$/, "")}/reset-password` } : {}) },
      });
      inviteSent = Boolean(result.status);
    } catch {
      // Creation is durable; surface the mail issue so the owner can resend/reset safely.
      inviteSent = false;
    }
    await audit(sql, orgId, context.userId, "create", "tenant", orgId, { name: data.name, adminId });
    return { success: true, organizationId: orgId, inviteSent };
  });

export const setTenantStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.string(), status: z.enum(["active", "suspended"]) }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const me = await requirePlatformAdmin(context.userId);
    if (data.status === "suspended" && me.organizationId === data.id) throw new Error("You cannot suspend your own company");
    await sql`update organizations set status = ${data.status} where id = ${data.id}`;
    await audit(sql, data.id, context.userId, data.status, "tenant", data.id);
    return { success: true };
  });

// ============================================
// VEHICLE FUNCTIONS
// ============================================

const vehicleInput = z.object({
  registration: z.string().min(1).max(20),
  make: z.string().min(1).max(50),
  model: z.string().min(1).max(50),
  year: z.number().optional(),
  color: z.string().optional(),
  fuelType: z.string().optional(),
  mileage: z.number().default(0),
});

export const listVehicles = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const { clause } = getOrgWhereClause(profile, context.userId);
    
    const rows = await sql<{
      id: string;
      organization_id: string;
      user_id: string;
      registration: string;
      make: string;
      model: string;
      year: number | null;
      color: string | null;
      status: string;
      last_inspection_date: string | null;
      next_inspection_date: string | null;
      fuel_type: string | null;
      mileage: number;
      notes: string | null;
      created_at: string;
      updated_at: string;
    }>`select * from vehicles where ${clause} order by created_at desc`;
    
    return rows.map((r): Vehicle => ({
      id: r.id,
      organizationId: r.organization_id,
      userId: r.user_id,
      registration: r.registration,
      make: r.make,
      model: r.model,
      year: r.year,
      color: r.color,
      status: r.status as any,
      lastInspectionDate: r.last_inspection_date,
      nextInspectionDate: r.next_inspection_date,
      fuelType: r.fuel_type,
      mileage: r.mileage,
      notes: r.notes,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  });

export const createVehicle = createServerFn({ method: "POST" })
  .validator((input: unknown) => vehicleInput.parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const orgId = (await requireProfile(context.userId)).organizationId;
    
    const result = await sql<{ id: string }>`
      INSERT INTO vehicles (organization_id, user_id, registration, make, model, year, color, fuel_type, mileage)
      VALUES (${orgId}, ${context.userId}, ${data.registration}, ${data.make}, ${data.model}, ${data.year || null}, ${data.color || null}, ${data.fuelType || null}, ${data.mileage})
      RETURNING id
    `;
    
    return { success: true, vehicleId: result[0]?.id };
  });

export const updateVehicle = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      id: z.string(),
      registration: z.string().min(1).max(20).optional(),
      make: z.string().min(1).max(50).optional(),
      model: z.string().min(1).max(50).optional(),
      year: z.number().optional(),
      color: z.string().optional(),
      status: z.enum(['Active', 'Maintenance', 'Grounded', 'Retired']).optional(),
      fuelType: z.string().optional(),
      mileage: z.number().optional(),
      notes: z.string().optional(),
    }).parse(input)
  )
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const { id, ...updates } = data;
    const profile = await loadProfile(context.userId);
    if (updates.mileage !== undefined && !isEhsAdmin(profile)) {
      throw new Error("Only administrators and EHS officers can reset vehicle mileage");
    }
    const { clause } = getOrgWhereClause(profile, context.userId);
    
    const filteredUpdates = Object.entries(updates)
      .filter(([_, value]) => value !== undefined);
    
    if (filteredUpdates.length === 0) return;
    
    const setClause = filteredUpdates
      .map(([key], index) => `${key} = $${index + 1}`)
      .join(', ');
    
    const values: any[] = filteredUpdates.map(([_, value]) => value);
    const query = `update vehicles set ${setClause}, updated_at = now() where id = $${filteredUpdates.length + 1} and ${clause}`;
    values.push(id);
    
    await executeQuery(sql, query, values);
    return { success: true };
  });

export const submitDailyMileage = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ vehicleId: z.string(), openingMileage: z.number().nonnegative(), closingMileage: z.number().nonnegative(), notes: z.string().max(500).optional() }).refine((value) => value.closingMileage >= value.openingMileage, { message: "Closing mileage cannot be less than opening mileage" }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    if (!profile || profile.role !== "Driver") throw new Error("Only drivers can submit daily mileage");
    const vehicle = await sql<{ id: string; organization_id: string }>`select id, organization_id from vehicles where id = ${data.vehicleId} and user_id = ${context.userId} and organization_id = ${profile.organizationId}`;
    if (!vehicle[0]) throw new Error("Vehicle is not assigned to this driver");
    await sql`insert into mileage_logs (organization_id, vehicle_id, driver_id, opening_mileage, closing_mileage, notes) values (${vehicle[0].organization_id}, ${data.vehicleId}, ${context.userId}, ${data.openingMileage}, ${data.closingMileage}, ${data.notes || null})`;
    await sql`update vehicles set mileage = ${data.closingMileage}, updated_at = now() where id = ${data.vehicleId} and user_id = ${context.userId}`;
    return { success: true };
  });

const requestAttachmentSchema = z.object({
  entityType: z.enum(["finance_request", "permit", "inspection"]),
  entityId: z.string().min(1).max(80),
  files: z.array(z.object({
    fileName: z.string().trim().min(1).max(200),
    contentType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
    sizeBytes: z.number().int().min(1).max(2_621_440),
    dataUrl: z.string().max(3_600_000),
  })).min(1).max(5),
});

export const storeRequestAttachments = createServerFn({ method: "POST" })
  .validator((input: unknown) => requestAttachmentSchema.parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requirePermission(context.userId, "finance.request");
    const sql = await getSql();
    const entity = data.entityType === "finance_request" ? "finance_requests"
      : data.entityType === "permit" ? "permits" : "vehicle_inspections";
    const exists = await sql.query<{ id: string }>(
      `select id::text as id from ${entity} where id::text = $1 and organization_id::text = $2 and user_id = $3 limit 1`,
      [data.entityId, profile.organizationId, context.userId],
    );
    if (!exists[0]) throw new Error("Request not found or not owned by this account");

    const current = await sql<{ count: number }>`select count(*)::int as count from request_attachments
      where organization_id = ${profile.organizationId} and entity_type = ${data.entityType} and entity_id = ${data.entityId}`;
    if ((current[0]?.count ?? 0) + data.files.length > 5) throw new Error("A request can have at most 5 attachments");

    for (const file of data.files) {
      const prefix = `data:${file.contentType};base64,`;
      if (!file.dataUrl.startsWith(prefix)) throw new Error(`Invalid file data for ${file.fileName}`);
      await sql`insert into request_attachments (organization_id, user_id, entity_type, entity_id, file_name, content_type, data_url, size_bytes)
        values (${profile.organizationId}, ${context.userId}, ${data.entityType}, ${data.entityId}, ${file.fileName}, ${file.contentType}, ${file.dataUrl}, ${file.sizeBytes})`;
    }
    await audit(sql, profile.organizationId, context.userId, "attach", data.entityType, data.entityId, { files: data.files.length });
    return { success: true };
  });

export const resetVehicleMileage = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ vehicleId: z.string(), mileage: z.number().nonnegative().default(0), notes: z.string().max(500).optional() }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    if (!profile || !isEhsAdmin(profile) || !profile.organizationId) throw new Error("Only administrators and EHS officers can reset vehicle mileage");
    const vehicle = await sql<{ id: string; organization_id: string; user_id: string }>`select id, organization_id, user_id from vehicles where id = ${data.vehicleId} and organization_id = ${profile.organizationId}`;
    if (!vehicle[0]) throw new Error("Vehicle not found");
    await sql`update vehicles set mileage = ${data.mileage}, updated_at = now() where id = ${data.vehicleId}`;
    await sql`insert into mileage_logs (organization_id, vehicle_id, driver_id, opening_mileage, closing_mileage, reset_by, reset_at, notes) values (${vehicle[0].organization_id}, ${data.vehicleId}, ${vehicle[0].user_id}, ${data.mileage}, ${data.mileage}, ${context.userId}, now(), ${data.notes || "Mileage reset by management"})`;
    return { success: true };
  });

export const deleteVehicle = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data: id }) => {
    await requirePermission(context.userId, "fleet.manage");
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const { clause } = getOrgWhereClause(profile, context.userId, "fleet.manage");
    
    await sql`delete from vehicles where id = ${id} and ${clause}`;
    return { success: true };
  });

// ============================================
// PERMIT (PTW) FUNCTIONS
// ============================================

const permitInput = z.object({
  type: z.enum(['Hot Work', 'Confined Space', 'Working at Height', 'Excavation', 'Electrical', 'Chemical']),
  title: z.string().min(1),
  description: z.string().optional(),
  location: z.string().min(1),
  department: z.string().optional(),
  supervisor: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  riskLevel: z.enum(['Low', 'Medium', 'High', 'Critical']).optional(),
  controlMeasures: z.array(z.string()).optional(),
});

export const listPermits = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const { clause } = getOrgWhereClause(profile, context.userId);
    
    const rows = await sql<{
      id: string;
      organization_id: string;
      user_id: string;
      permit_number: string;
      type: string;
      title: string;
      description: string | null;
      location: string;
      department: string | null;
      supervisor: string | null;
      start_date: string | null;
      end_date: string | null;
      status: string;
      risk_level: string | null;
      control_measures: string[] | null;
      approved_by: string | null;
      approved_at: string | null;
      rejected_reason: string | null;
      created_at: string;
      updated_at: string;
    }>`select * from permits where ${clause} order by created_at desc`;
    
    return rows.map((r): Permit => ({
      id: r.id,
      organizationId: r.organization_id,
      userId: r.user_id,
      permitNumber: r.permit_number,
      type: r.type,
      title: r.title,
      description: r.description,
      location: r.location,
      department: r.department,
      supervisor: r.supervisor,
      startDate: r.start_date,
      endDate: r.end_date,
      status: r.status,
      riskLevel: r.risk_level,
      controlMeasures: r.control_measures,
      approvedBy: r.approved_by,
      approvedAt: r.approved_at,
      rejectedReason: r.rejected_reason,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  });

export const createPermit = createServerFn({ method: "POST" })
  .validator((input: unknown) => permitInput.parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const orgId = (await requireProfile(context.userId)).organizationId;
    
    const count = await sql<{ count: number }>`SELECT COUNT(*) as count FROM permits WHERE organization_id = ${orgId}`;
    const permitNumber = `PTW-${new Date().getFullYear()}-${String((count[0]?.count || 0) + 1).padStart(3, '0')}`;
    
    const result = await sql<{ id: string }>`
      INSERT INTO permits (organization_id, user_id, permit_number, type, title, description, location, department, supervisor, start_date, end_date, risk_level, control_measures)
      VALUES (${orgId}, ${context.userId}, ${permitNumber}, ${data.type}, ${data.title}, ${data.description || null}, ${data.location}, ${data.department || null}, ${data.supervisor || null}, ${data.startDate || null}, ${data.endDate || null}, ${data.riskLevel || null}, ${data.controlMeasures || null})
      RETURNING id
    `;
    
    return { success: true, permitId: result[0]?.id };
  });

export const approvePermit = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      id: z.string(),
      status: z.enum(['Approved', 'Rejected']),
      reason: z.string().optional(),
    }).parse(input)
  )
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "permits.approve", "Only the EHS team can approve permits");
    
    const { clause } = getOrgWhereClause(profile, context.userId);
    
    const current = await sql<{ status: string }>`select status from permits where id = ${data.id} and ${clause} limit 1`;
    if (!current[0]) throw new Error("Permit not found");
    if (current[0].status !== "Under Review" && current[0].status !== "Pending") {
      throw new Error(`This permit is ${current[0].status} and cannot be reviewed`);
    }
    if (data.status === "Rejected" && !data.reason?.trim()) throw new Error("A rejection reason is required");
    await sql`
      UPDATE permits 
      SET status = ${data.status}, 
          approved_by = ${context.userId}, 
          approved_at = NOW(),
          rejected_reason = ${data.reason || null},
          updated_at = NOW()
      WHERE id = ${data.id} AND ${clause}
    `;
    
    return { success: true, message: `Permit ${data.status}` };
  });

export const transitionPermit = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.string(), status: z.enum(["Under Review", "Active", "Closed"]) }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const permission = data.status === "Under Review" ? "permits.approve" : "ehs.manage";
    const profile = await requirePermission(context.userId, permission, "You do not have permission to change this permit stage");
    const { clause } = getOrgWhereClause(profile, context.userId);
    const current = await sql<{ status: string }>`select status from permits where id = ${data.id} and ${clause} limit 1`;
    if (!current[0]) throw new Error("Permit not found");
    const allowed: Record<string, string[]> = {
      Pending: ["Under Review"],
      Approved: ["Active"],
      Active: ["Closed"],
    };
    if (!allowed[current[0].status]?.includes(data.status)) throw new Error(`Cannot move a ${current[0].status} permit to ${data.status}`);
    await sql`update permits set status = ${data.status}, updated_at = now() where id = ${data.id} and ${clause}`;
    await audit(sql, profile.organizationId, context.userId, `permit.${data.status.toLowerCase().replaceAll(" ", "_")}`, "permits", data.id, { from: current[0].status, to: data.status });
    return { success: true, status: data.status };
  });

export const deletePermit = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const { clause } = getOrgWhereClause(profile, context.userId, "ehs.manage");
    
    await sql`delete from permits where id = ${id} and ${clause}`;
    return { success: true };
  });

// ============================================
// AFTER-HOURS VEHICLE REQUESTS
// ============================================

const afterHoursChecklist = z.object({
  fitToDrive: z.literal(true),
  licenseValid: z.literal(true),
  vehicleInspected: z.literal(true),
  seatBeltsConfirmed: z.literal(true),
  routeAndWeatherChecked: z.literal(true),
  supervisorNotified: z.literal(true),
});

const afterHoursRequestInput = z.object({
  vehicleId: z.string().min(1),
  driverName: z.string().trim().min(2).max(120),
  reason: z.string().trim().min(10).max(1000),
  origin: z.string().trim().min(1).max(200),
  destination: z.string().trim().min(1).max(200),
  departureAt: z.string().datetime(),
  returnAt: z.string().datetime(),
  passengerCount: z.number().int().min(0).max(30),
  supervisorName: z.string().trim().min(2).max(120),
  supervisorPhone: z.string().trim().min(5).max(40),
  emergencyContactName: z.string().trim().min(2).max(120),
  emergencyContactPhone: z.string().trim().min(5).max(40),
  riskControls: z.string().trim().max(2000).default(""),
  outsideWorkHoursConfirmed: z.literal(true),
  safetyChecklist: afterHoursChecklist,
});

export type AfterHoursVehicleRequest = {
  id: number;
  requesterId: string;
  requesterName: string;
  vehicleId: string;
  vehicleRegistration: string;
  driverName: string;
  reason: string;
  origin: string;
  destination: string;
  departureAt: string;
  returnAt: string;
  passengerCount: number;
  supervisorName: string;
  supervisorPhone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  riskControls: string;
  outsideWorkHoursConfirmed: boolean;
  safetyChecklist: z.infer<typeof afterHoursChecklist>;
  status: "Pending" | "Approved" | "Rejected" | "Cancelled";
  reviewerId: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
};

type AfterHoursRequestRow = {
  id: number;
  user_id: string;
  requester_name: string;
  vehicle_id: string;
  vehicle_registration: string;
  driver_name: string;
  reason: string;
  origin: string;
  destination: string;
  departure_at: string;
  return_at: string;
  passenger_count: number;
  supervisor_name: string;
  supervisor_phone: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  risk_controls: string;
  outside_work_hours_confirmed: boolean;
  safety_checklist: z.infer<typeof afterHoursChecklist>;
  status: AfterHoursVehicleRequest["status"];
  reviewer_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
};

function mapAfterHoursRequest(row: AfterHoursRequestRow): AfterHoursVehicleRequest {
  return {
    id: row.id,
    requesterId: row.user_id,
    requesterName: row.requester_name,
    vehicleId: row.vehicle_id,
    vehicleRegistration: row.vehicle_registration,
    driverName: row.driver_name,
    reason: row.reason,
    origin: row.origin,
    destination: row.destination,
    departureAt: row.departure_at,
    returnAt: row.return_at,
    passengerCount: row.passenger_count,
    supervisorName: row.supervisor_name,
    supervisorPhone: row.supervisor_phone,
    emergencyContactName: row.emergency_contact_name,
    emergencyContactPhone: row.emergency_contact_phone,
    riskControls: row.risk_controls,
    outsideWorkHoursConfirmed: row.outside_work_hours_confirmed,
    safetyChecklist: row.safety_checklist,
    status: row.status,
    reviewerId: row.reviewer_id,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    createdAt: row.created_at,
  };
}

export const listAfterHoursVehicleOptions = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const profile = await requirePermission(context.userId, "finance.request");
    const sql = await getSql();
    return sql<{ id: string; registration: string; make: string; model: string }>`
      select id, registration, make, model from vehicles
      where organization_id = ${profile.organizationId} and status = 'Active'
      order by registration`;
  });

export const listAfterHoursVehicleRequests = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const profile = await requireProfile(context.userId);
    const mayReview = can(profile, "fleet.manage") || can(profile, "ehs.manage");
    if (!mayReview && !can(profile, "finance.request")) {
      throw new Error("You cannot view after-hours vehicle requests");
    }
    const sql = await getSql();
    const query = `select r.id, r.user_id, p.full_name as requester_name, r.vehicle_id,
      r.vehicle_registration, r.driver_name, r.reason, r.origin, r.destination, r.departure_at,
        r.return_at, r.passenger_count, r.supervisor_name, r.supervisor_phone,
        r.emergency_contact_name, r.emergency_contact_phone, r.risk_controls,
        r.outside_work_hours_confirmed, r.safety_checklist, r.status, r.reviewer_id,
        r.reviewed_at, r.review_note, r.created_at
      from after_hours_vehicle_requests r
      join profiles p on p.user_id::text = r.user_id::text
        and p.organization_id::text = r.organization_id::text
      where r.organization_id = $1${mayReview ? "" : " and r.user_id = $2"}
      order by r.created_at desc limit 200`;
    const rows = await sql.query<AfterHoursRequestRow>(query, mayReview ? [profile.organizationId] : [profile.organizationId, profile.userId]);
    return rows.map(mapAfterHoursRequest);
  });

export const createAfterHoursVehicleRequest = createServerFn({ method: "POST" })
  .validator((input: unknown) => afterHoursRequestInput.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requirePermission(context.userId, "finance.request");
    const departureAt = new Date(data.departureAt);
    const returnAt = new Date(data.returnAt);
    if (departureAt.getTime() <= Date.now()) throw new Error("Departure must be in the future");
    if (returnAt.getTime() <= departureAt.getTime()) throw new Error("Return must be after departure");

    const sql = await getSql();
    const vehicles = await sql<{ id: string; registration: string }>`
      select id, registration from vehicles
      where id::text = ${data.vehicleId} and organization_id::text = ${profile.organizationId} and status = 'Active'`;
    const vehicle = vehicles[0];
    if (!vehicle) throw new Error("Choose an active vehicle from your company fleet");

    const overlaps = await sql`select 1 from after_hours_vehicle_requests
      where organization_id = ${profile.organizationId} and vehicle_id = ${data.vehicleId}
        and status in ('Pending', 'Approved')
        and departure_at < ${data.returnAt}::timestamptz
        and return_at > ${data.departureAt}::timestamptz
      limit 1`;
    if (overlaps.length) throw new Error("This vehicle already has a request during that time");

    const inserted = await sql<{ id: number }>`insert into after_hours_vehicle_requests (
      organization_id, user_id, vehicle_id, vehicle_registration, driver_name, reason, origin, destination,
      departure_at, return_at, passenger_count, supervisor_name, supervisor_phone,
      emergency_contact_name, emergency_contact_phone, risk_controls,
      outside_work_hours_confirmed, safety_checklist
    ) values (
      ${profile.organizationId}, ${profile.userId}, ${vehicle.id}, ${vehicle.registration}, ${data.driverName},
      ${data.reason}, ${data.origin}, ${data.destination}, ${data.departureAt}::timestamptz,
      ${data.returnAt}::timestamptz, ${data.passengerCount}, ${data.supervisorName},
      ${data.supervisorPhone}, ${data.emergencyContactName}, ${data.emergencyContactPhone},
      ${data.riskControls}, ${data.outsideWorkHoursConfirmed}, ${JSON.stringify(data.safetyChecklist)}::jsonb
    ) returning id`;
    const requestId = inserted[0]?.id;
    if (!requestId) throw new Error("Could not save the vehicle request");

    const reviewers = new Set([
      ...await usersWithPermission(sql, profile.organizationId, "fleet.manage"),
      ...await usersWithPermission(sql, profile.organizationId, "ehs.manage"),
    ]);
    await notify(sql, {
      organizationId: profile.organizationId,
      userIds: [...reviewers],
      title: "After-hours vehicle request needs review",
      message: `${profile.fullName} requested ${vehicle.registration} for ${data.origin} to ${data.destination}.`,
      type: "after_hours_vehicle",
      link: "/driver",
      entityType: "after_hours_vehicle_request",
      entityId: requestId,
    });
    await audit(sql, profile.organizationId, profile.userId, "submitted", "after_hours_vehicle_request", requestId);
    return { success: true, requestId };
  });

export const reviewAfterHoursVehicleRequest = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({
    id: z.number().int().positive(),
    status: z.enum(["Approved", "Rejected"]),
    note: z.string().trim().max(1000).optional(),
  }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requireProfile(context.userId);
    if (!can(profile, "fleet.manage") && !can(profile, "ehs.manage")) {
      throw new Error("Only Fleet or EHS reviewers can decide these requests");
    }
    if (data.status === "Rejected" && !data.note?.trim()) {
      throw new Error("Add a reason before rejecting this request");
    }
    const sql = await getSql();
    const updated = await sql<{ user_id: string }>`update after_hours_vehicle_requests
      set status = ${data.status}, reviewer_id = ${profile.userId}, reviewed_at = now(),
          review_note = ${data.note?.trim() || null}
      where id = ${data.id} and organization_id = ${profile.organizationId}
        and status = 'Pending' and user_id <> ${profile.userId}
        and exists (select 1 from vehicles v where v.id::text = after_hours_vehicle_requests.vehicle_id::text
          and v.organization_id::text = after_hours_vehicle_requests.organization_id::text and v.status = 'Active')
      returning user_id`;
    const request = updated[0];
    if (!request) throw new Error("This request was already decided or is unavailable");
    await notify(sql, {
      organizationId: profile.organizationId,
      userIds: [request.user_id],
      title: `After-hours vehicle request ${data.status.toLowerCase()}`,
      message: data.note?.trim() || `Your vehicle request was ${data.status.toLowerCase()}.`,
      type: "after_hours_vehicle",
      link: "/dashboard",
      entityType: "after_hours_vehicle_request",
      entityId: data.id,
    });
    await audit(sql, profile.organizationId, profile.userId, data.status.toLowerCase(), "after_hours_vehicle_request", data.id, { note: data.note?.trim() || null });
    return { success: true };
  });

// ============================================
// CAPA FUNCTIONS
// ============================================

const capaInput = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['Corrective', 'Preventive', 'Improvement']),
  category: z.enum(['Safety', 'Quality', 'Environmental', 'Compliance', 'Operational']),
  severity: z.enum(['Critical', 'High', 'Medium', 'Low']),
  assignedTo: z.string().optional(),
  dueDate: z.string().optional(),
  relatedIncidentId: z.number().optional(),
  rootCause: z.string().optional(),
  actionPlan: z.string().optional(),
});

export const listCAPAs = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const { clause } = getOrgWhereClause(profile, context.userId);
    
    const rows = await sql<{
      id: string;
      organization_id: string;
      user_id: string;
      capa_number: string;
      title: string;
      description: string | null;
      type: string;
      category: string;
      severity: string;
      status: string;
      assigned_to: string | null;
      due_date: string | null;
      root_cause: string | null;
      action_plan: string | null;
      resolution: string | null;
      verified_by: string | null;
      verified_at: string | null;
      closed_by: string | null;
      closed_at: string | null;
      related_incident_id: number | null;
      created_at: string;
      updated_at: string;
    }>`select * from capa_actions where ${clause} order by created_at desc`;
    
    return rows.map((r): CAPA => ({
      id: r.id,
      organizationId: r.organization_id,
      userId: r.user_id,
      capaNumber: r.capa_number,
      title: r.title,
      description: r.description,
      type: r.type,
      category: r.category,
      severity: r.severity,
      status: r.status,
      assignedTo: r.assigned_to,
      dueDate: r.due_date,
      rootCause: r.root_cause,
      actionPlan: r.action_plan,
      resolution: r.resolution,
      verifiedBy: r.verified_by,
      verifiedAt: r.verified_at,
      closedBy: r.closed_by,
      closedAt: r.closed_at,
      relatedIncidentId: r.related_incident_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  });

export const createCAPA = createServerFn({ method: "POST" })
  .validator((input: unknown) => capaInput.parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const orgId = (await requireProfile(context.userId)).organizationId;
    
    const count = await sql<{ count: number }>`SELECT COUNT(*) as count FROM capa_actions WHERE organization_id = ${orgId}`;
    const capaNumber = `CAPA-${new Date().getFullYear()}-${String((count[0]?.count || 0) + 1).padStart(3, '0')}`;
    
    const result = await sql<{ id: string }>`
      INSERT INTO capa_actions (organization_id, user_id, capa_number, title, description, type, category, severity, assigned_to, due_date, related_incident_id, root_cause, action_plan)
      VALUES (${orgId}, ${context.userId}, ${capaNumber}, ${data.title}, ${data.description || null}, ${data.type}, ${data.category}, ${data.severity}, ${data.assignedTo || null}, coalesce(${data.dueDate || null}::date, current_date + case ${data.severity} when 'Critical' then 1 when 'High' then 3 when 'Medium' then 7 else 14 end), ${data.relatedIncidentId || null}, ${data.rootCause || null}, ${data.actionPlan || null})
      RETURNING id
    `;
    
    return { success: true, capaId: result[0]?.id };
  });

export const updateCAPAStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      id: z.string(),
      status: z.enum(['Open', 'Under Investigation', 'In Progress', 'Resolved', 'Closed', 'Rejected']),
      resolution: z.string().optional(),
    }).parse(input)
  )
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const { id, status, resolution } = data;
    const profile = await loadProfile(context.userId);
    const { clause } = getOrgWhereClause(profile, context.userId, "ehs.manage");
    
    const updateParts: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
    
    updateParts.push(`status = $${paramIndex++}`);
    values.push(status);
    updateParts.push(`updated_at = NOW()`);
    
    if (status === 'Resolved' || status === 'Closed') {
      updateParts.push(`resolution = $${paramIndex++}`);
      values.push(resolution || null);
      updateParts.push(`closed_by = $${paramIndex++}`);
      values.push(context.userId);
      updateParts.push(`closed_at = NOW()`);
    }
    
    const query = `update capa_actions set ${updateParts.join(', ')} where id = $${paramIndex} and ${clause}`;
    values.push(id);
    
    await executeQuery(sql, query, values);
    return { success: true, message: `CAPA status updated to ${status}` };
  });

export const deleteCAPA = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const { clause } = getOrgWhereClause(profile, context.userId, "ehs.manage");
    
    await sql`delete from capa_actions where id = ${id} and ${clause}`;
    return { success: true };
  });

// ============================================
// DASHBOARD STATS
// ============================================

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const { clause } = getOrgWhereClause(profile, context.userId);
    const { clause: healthClause } = getOrgWhereClause(profile, context.userId, profile?.role === "HR" ? "hr.manage" : "ehs.manage");
    const healthDayFilter = profile && can(profile, "ehs.manage") && profile.role !== "HR" ? sqlFragment("and created_at::date = current_date") : sqlFragment("");
    
    const [incidentStats, projectStats, healthStats, vehicleStats, permitStats, capaStats] = await Promise.all([
      sql<{ total: number; open: number; critical: number }>`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status NOT IN ('Closed', 'Resolved') THEN 1 ELSE 0 END) as open,
          SUM(CASE WHEN severity = 'Critical' THEN 1 ELSE 0 END) as critical
        FROM incidents 
        WHERE ${clause}
      `,
      sql<{ total: number; active: number; completed: number }>`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status IN ('Active', 'In Progress') THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as completed
        FROM projects 
        WHERE ${clause}
      `,
      sql<{ total: number; today: number }>`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN DATE(created_at) = CURRENT_DATE THEN 1 ELSE 0 END) as today
        FROM health_declarations 
        WHERE ${healthClause} ${healthDayFilter}
      `,
      sql<{ total: number; active: number; maintenance: number }>`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN status = 'Maintenance' THEN 1 ELSE 0 END) as maintenance
        FROM vehicles 
        WHERE ${clause}
      `,
      sql<{ total: number; pending: number; approved: number }>`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END) as approved
        FROM permits 
        WHERE ${clause}
      `,
      sql<{ total: number; open: number; resolved: number }>`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status IN ('Open', 'Under Investigation', 'In Progress') THEN 1 ELSE 0 END) as open,
          SUM(CASE WHEN status IN ('Resolved', 'Closed') THEN 1 ELSE 0 END) as resolved
        FROM capa_actions 
        WHERE ${clause}
      `,
    ]);
    
    return {
      incidents: incidentStats[0] || { total: 0, open: 0, critical: 0 },
      projects: projectStats[0] || { total: 0, active: 0, completed: 0 },
      health: healthStats[0] || { total: 0, today: 0 },
      vehicles: vehicleStats[0] || { total: 0, active: 0, maintenance: 0 },
      permits: permitStats[0] || { total: 0, pending: 0, approved: 0 },
      capa: capaStats[0] || { total: 0, open: 0, resolved: 0 },
    };
  });

// ============================================
// USER MANAGEMENT
// ============================================

async function provisionUser(input: {
  email: string;
  password: string;
  fullName: string;
  role: EhsRole;
  department?: string;
  organizationId: string;
  permissions?: string[];
}): Promise<string> {
  const sql = await getSql();
  const email = input.email.trim().toLowerCase();
  const existing = await sql<{ id: string }>`select id from "user" where lower(email) = ${email}`;
  if (existing[0]) throw new Error("A user with this email already exists");

  const seats = await sql<{ max_users: number; used: number }>`select o.max_users,
      (select count(*)::int from profiles p where p.organization_id::text = o.id::text and p.status = 'active') as used
    from organizations o where o.id::text = ${input.organizationId}`;
  if (seats[0] && seats[0].max_users > 0 && seats[0].used >= seats[0].max_users) {
    throw new Error(`Your plan allows ${seats[0].max_users} users and all seats are used. Ask Smart Hub to add more seats.`);
  }

  allowNewUser(email);
  let userId: string;
  try {
    const ctx = await auth.$context;
    const created = await ctx.internalAdapter.createUser({ email, name: input.fullName.trim(), emailVerified: true });
    userId = created.id;
    await ctx.internalAdapter.createAccount({
      userId,
      providerId: "credential",
      accountId: userId,
      password: await ctx.password.hash(input.password),
    });
  } finally {
    releaseNewUser(email);
  }
  await sql`insert into profiles (user_id, full_name, role, department, organization_id, permissions)
    values (${userId}, ${input.fullName.trim()}, ${input.role}, ${input.department?.trim() || null}, ${input.organizationId}, ${input.permissions ?? []}::text[])
    on conflict (user_id) do nothing`;
  return userId;
}

const roleSchema = z.string().refine((v): v is EhsRole => isEhsRole(v) && ASSIGNABLE_ROLES.includes(v), "Unknown role");

async function activeAdminCount(sql: Sql, orgId: string, excludingUserId?: string): Promise<number> {
  const rows = await sql<{ c: number }>`select count(*)::int as c from profiles
    where organization_id = ${orgId} and role = 'Admin' and status = 'active' and user_id <> ${excludingUserId ?? ""}`;
  return rows[0]?.c ?? 0;
}

export const listAllUsers = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "people.view", "You cannot view the staff directory");
    const rows = await sql<{
      user_id: string; full_name: string; role: string; department: string; organization_id: string | null;
      email: string | null; created_at: string; permissions: string[] | null; status: string | null; phone: string | null;
    }>`select p.user_id, p.full_name, p.role, p.department, p.organization_id, p.permissions, p.status, p.phone, u.email, p.created_at
      from profiles p
      left join "user" u on u.id = p.user_id
      where p.organization_id = ${profile.organizationId}
      order by p.created_at desc`;
    return rows.map((r) => ({
      userId: r.user_id,
      fullName: r.full_name,
      // The UI shows suspension through the role label, so surface it there as well as in `status`.
      role: r.status && r.status !== "active" ? "Suspended" : r.role,
      baseRole: r.role,
      status: r.status ?? "active",
      permissions: r.permissions ?? [],
      department: r.department,
      phone: r.phone,
      organizationId: r.organization_id,
      email: r.email,
      createdAt: r.created_at,
    }));
  });

export const createUser = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      email: z.string().email(),
      fullName: z.string().min(1),
      role: roleSchema,
      department: z.string().optional(),
      projectId: z.number().optional(),
      permissions: z.array(z.string()).optional(),
    }).parse(input),
  )
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "org.users", "Only administrators can create users");
    if (!emailConfigured()) throw new Error("Email invitations are not configured. Contact the Smart Hub owner before adding users.");
    const extra = (data.permissions ?? []).filter((p): p is Permission => (ALL_PERMISSIONS as string[]).includes(p));
    const userId = await provisionUser({
      email: data.email, password: randomBytes(32).toString("base64url"), fullName: data.fullName, role: data.role as EhsRole,
      department: data.department, organizationId: profile.organizationId, permissions: extra,
    });
    let inviteSent = false;
    try {
      const baseUrl = process.env.BETTER_AUTH_URL?.trim() || process.env.APP_URL?.trim() || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
      const result = await auth.api.requestPasswordReset({
        body: { email: data.email.trim().toLowerCase(), ...(baseUrl ? { redirectTo: `${baseUrl.replace(/\/$/, "")}/reset-password` } : {}) },
      });
      inviteSent = Boolean(result.status);
    } catch {
      inviteSent = false;
    }
    await notifyInApp(sql, { organizationId: profile.organizationId, userIds: (await usersWithPermission(sql, profile.organizationId, "org.users")).filter((id) => id !== context.userId), title: "New team member added", message: `${data.fullName} joined as ${ROLE_LABELS[data.role as EhsRole]}.`, type: "account", link: "/admin" });
    if (data.projectId) {
      await sql`insert into project_members (project_id, user_id, role, status, invited_by)
        select ${data.projectId}, ${userId}, ${data.role}, 'Pending', ${context.userId}
        where exists (select 1 from projects where id = ${data.projectId} and organization_id = ${profile.organizationId})
        on conflict (project_id, user_id) do nothing`;
    }
    await audit(sql, profile.organizationId, context.userId, "create", "user", userId, { role: data.role, email: data.email });
    return { success: true, userId, inviteSent };
  });

export const updateUserRole = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ userId: z.string(), role: roleSchema }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "org.users", "Only administrators can change roles");
    if (data.userId === context.userId) throw new Error("You cannot change your own role");
    const target = await loadProfile(data.userId);
    if (!target || target.organizationId !== profile.organizationId) throw new Error("User not found");
    if (target.role === "Admin" && data.role !== "Admin" && (await activeAdminCount(sql, profile.organizationId, data.userId)) === 0) {
      throw new Error("The company must keep at least one administrator");
    }
    await sql`update profiles set role = ${data.role}, updated_at = now() where user_id = ${data.userId} and organization_id = ${profile.organizationId}`;
    await audit(sql, profile.organizationId, context.userId, "role", "user", data.userId, { from: target.role, to: data.role });
    await notify(sql, { organizationId: profile.organizationId, userIds: [data.userId], title: "Your role changed", message: `You are now ${ROLE_LABELS[data.role as EhsRole]}.`, type: "account" });
    return { success: true };
  });

/** Extra permissions on top of the role (e.g. a Project Manager who may also approve finance requests). */
export const setUserPermissions = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ userId: z.string(), permissions: z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])) }).parse(input),
  )
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "org.users", "Only administrators can grant permissions");
    const target = await loadProfile(data.userId);
    if (!target || target.organizationId !== profile.organizationId) throw new Error("User not found");
    const unique = [...new Set(data.permissions)];
    await sql`update profiles set permissions = ${unique}::text[], updated_at = now() where user_id = ${data.userId} and organization_id = ${profile.organizationId}`;
    await audit(sql, profile.organizationId, context.userId, "permissions", "user", data.userId, { permissions: unique });
    await notify(sql, { organizationId: profile.organizationId, userIds: [data.userId], title: "Your access was updated", message: "An administrator changed your permissions. Reload to see your new menus.", type: "account" });
    return { success: true };
  });

export const setUserPassword = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ userId: z.string(), password: z.string().min(8) }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requirePermission(context.userId, "org.users", "Only administrators can reset passwords");
    const target = await loadProfile(data.userId);
    if (!target || target.organizationId !== profile.organizationId) throw new Error("User not found");
    const authContext = await auth.$context;
    const hashedPassword = await authContext.password.hash(data.password);
    const accounts = await authContext.internalAdapter.findAccounts(data.userId);
    if (accounts.some((account) => account.providerId === "credential")) {
      await authContext.internalAdapter.updatePassword(data.userId, hashedPassword);
    } else {
      await authContext.internalAdapter.createAccount({ userId: data.userId, providerId: "credential", accountId: data.userId, password: hashedPassword });
    }
    return { success: true };
  });

async function setUserStatus(actorId: string, userId: string, status: "active" | "suspended") {
  const sql = await getSql();
  const profile = await requirePermission(actorId, "org.users", "Only administrators can change account status");
  if (userId === actorId) throw new Error("You cannot change your own account status");
  const target = await loadProfile(userId);
  if (!target || target.organizationId !== profile.organizationId) throw new Error("User not found");
  if (status === "suspended" && target.role === "Admin" && (await activeAdminCount(sql, profile.organizationId, userId)) === 0) {
    throw new Error("The company must keep at least one administrator");
  }
  await sql`update profiles set status = ${status}, updated_at = now() where user_id = ${userId} and organization_id = ${profile.organizationId}`;
  if (status === "suspended") {
    // End every open session so suspension takes effect immediately.
    await sql`delete from session where "userId" = ${userId}`.catch(() => undefined);
  }
  await audit(sql, profile.organizationId, actorId, status, "user", userId);
  return { success: true };
}

export const suspendUser = createServerFn({ method: "POST" })
  .validator((userId: string) => userId)
  .middleware([authMiddleware, workdayMiddleware])
  .handler(({ context, data: userId }) => setUserStatus(context.userId, userId, "suspended"));

export const activateUser = createServerFn({ method: "POST" })
  .validator((userId: string) => userId)
  .middleware([authMiddleware, workdayMiddleware])
  .handler(({ context, data: userId }) => setUserStatus(context.userId, userId, "active"));

/** Accounts are never hard-deleted (audit trail); "delete" suspends. */
export const deleteUser = createServerFn({ method: "POST" })
  .validator((userId: string) => userId)
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data: userId }) => {
    const target = await loadProfile(userId);
    if (target?.role === "Admin") throw new Error("Cannot delete an administrator");
    return setUserStatus(context.userId, userId, "suspended");
  });

// ---- Notifications ----

export const sendNotification = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ userIds: z.array(z.string()).min(1), title: z.string().min(1).max(120), message: z.string().min(1).max(500) }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "announce.post", "You cannot send notifications");
    const recipients = await sql<{ user_id: string }>`select user_id from profiles where user_id = any(${data.userIds}::text[]) and organization_id = ${profile.organizationId}`;
    await notify(sql, { organizationId: profile.organizationId, userIds: recipients.map((r) => r.user_id), title: data.title, message: data.message, type: "message" });
    return { success: true, sent: recipients.length };
  });

export type AppNotification = {
  id: number; title: string; message: string; read_at: string | null; created_at: string; type: string; link: string | null;
};

export const listNotifications = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    return sql<AppNotification>`select id, title, message, read_at, created_at, type, link
      from notifications where user_id = ${context.userId} order by created_at desc limit 50`;
  });

export const markAllNotificationsRead = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await sql`update notifications set read_at = coalesce(read_at, now()) where user_id = ${context.userId} and read_at is null`;
    return { success: true };
  });

export const markNotificationRead = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .middleware([authMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    await sql`update notifications set read_at = coalesce(read_at, now()) where id = ${id} and user_id = ${context.userId}`;
    return { success: true };
  });

// ============================================
// PROJECT MANAGER FUNCTIONS
// ============================================

export const listAllUsersForManager = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    
    if (!profile?.organizationId || !can(profile, "people.view")) {
      throw new Error("Only managers and admins can view all users");
    }
    
    const rows = await sql<{
      user_id: string;
      full_name: string;
      role: string;
      department: string;
      organization_id: string | null;
      email: string | null;
      created_at: string;
      updated_at: string;
    }>`select p.user_id, p.full_name, p.role, p.department, p.organization_id, u.email, p.created_at, p.updated_at
      from profiles p
      left join "user" u on p.user_id = u.id::text
      where p.organization_id = ${profile?.organizationId}
      order by p.full_name asc`;
      
    return rows.map((r) => ({
      userId: r.user_id,
      fullName: r.full_name,
      role: r.role,
      department: r.department,
      organizationId: r.organization_id,
      email: r.email,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  });

export const getProjectSummary = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const { clause } = getOrgWhereClause(profile, context.userId);
    
    const projects = await sql<{
      id: number;
      name: string;
      budget: string | number;
      deadline: string | null;
      status: string;
      user_id: string;
      organization_id: string | null;
      created_at: string;
      updated_at: string;
    }>`select id, name, budget, deadline, status, user_id, organization_id, created_at, updated_at
      from projects
      where ${clause}
      order by created_at desc`;
    
    const taskCounts = await sql<{
      project_id: number | null;
      total: number;
      completed: number;
      pending: number;
      in_progress: number;
    }>`select 
      project_id,
      count(*) as total,
      sum(case when status = 'Completed' then 1 else 0 end) as completed,
      sum(case when status = 'Pending' then 1 else 0 end) as pending,
      sum(case when status = 'In Progress' then 1 else 0 end) as in_progress
      from project_tasks
      where ${clause}
      group by project_id`;
    
    const incidentCounts = await sql<{
      project_id: number | null;
      total: number;
      open: number;
    }>`select 
      project_id,
      count(*) as total,
      sum(case when status not in ('Closed', 'Resolved') then 1 else 0 end) as open
      from incidents
      where ${clause}
      group by project_id`;
    
    const result = projects.map((p) => {
      const tasks = taskCounts.find(t => t.project_id === p.id) || { total: 0, completed: 0, pending: 0, in_progress: 0 };
      const incidents = incidentCounts.find(i => i.project_id === p.id) || { total: 0, open: 0 };
      return {
        id: p.id,
        name: p.name,
        budget: Number(p.budget) || 0,
        deadline: p.deadline,
        status: p.status,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        userId: p.user_id,
        organizationId: p.organization_id,
        taskStats: tasks,
        incidentStats: incidents,
        progress: tasks.total > 0 ? Math.round((tasks.completed / tasks.total) * 100) : 0
      };
    });
    
    return result;
  });

export const getTeamPerformance = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const { clause } = getOrgWhereClause(profile, context.userId);
    
    const users = await sql<{
      user_id: string;
      full_name: string;
      role: string;
      department: string;
      organization_id: string | null;
      email: string | null;
      created_at: string;
      status: string | null;
    }>`select p.user_id, p.full_name, p.role, p.department, p.organization_id, u.email, p.created_at, p.status
      from profiles p
      left join "user" u on p.user_id = u.id::text
      where p.organization_id = ${profile?.organizationId}
      order by p.full_name asc`;
    
    const taskCounts = await sql<{
      assignee: string | null;
      total: number;
      completed: number;
      pending: number;
    }>`select 
      assignee,
      count(*) as total,
      sum(case when status = 'Completed' then 1 else 0 end) as completed,
      sum(case when status = 'Pending' then 1 else 0 end) as pending
      from project_tasks
      where ${clause}
      group by assignee`;
    
    const canViewHealth = profile?.role === "HR" || can(profile, "ehs.manage");
    const latestHealth = canViewHealth ? await sql<{
      user_id: string;
      fitness: string;
      created_at: string;
    }>`select distinct on (user_id) user_id, fitness, created_at
      from health_declarations
      where organization_id = ${profile?.organizationId}
        ${profile?.role === "HR" ? sqlFragment("") : sqlFragment("and created_at::date = current_date")}
      order by user_id, created_at desc` : [];
    
    const incidentCounts = await sql<{
      user_id: string;
      total: number;
    }>`select 
      user_id,
      count(*) as total
      from incidents
      where ${clause}
      group by user_id`;
    
    const result = users.map((u) => {
      const tasks = taskCounts.find(t => t.assignee === u.full_name || t.assignee === u.user_id) || { total: 0, completed: 0, pending: 0 };
      const health = latestHealth.find(h => h.user_id === u.user_id);
      const incidents = incidentCounts.find(i => i.user_id === u.user_id) || { total: 0 };
      return {
        userId: u.user_id,
        fullName: u.full_name,
        role: u.role,
        department: u.department,
        email: u.email,
        createdAt: u.created_at,
        taskStats: {
          total: tasks.total,
          completed: tasks.completed,
          pending: tasks.pending,
          completionRate: tasks.total > 0 ? Math.round((tasks.completed / tasks.total) * 100) : 0
        },
        health: health ? {
          fitness: health.fitness,
          lastChecked: health.created_at
        } : null,
        incidents: incidents.total,
        isActive: (u.status ?? 'active') === 'active'
      };
    });
    
    return result;
  });

export const getProjectManagerReport = createServerFn({ method: "GET" })
  .validator((input: unknown) => 
    z.object({
      period: z.enum(['weekly', 'monthly', 'quarterly']).default('monthly'),
      type: z.enum(['summary', 'detailed', 'financial']).default('summary'),
      projectId: z.number().optional(),
    }).parse(input)
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await loadProfile(context.userId);
    const { clause } = getOrgWhereClause(profile, context.userId);
    
    const { period, type, projectId } = data;
    
    const now = new Date();
    const startDate = new Date();
    if (period === 'weekly') {
      startDate.setDate(now.getDate() - 7);
    } else if (period === 'monthly') {
      startDate.setMonth(now.getMonth() - 1);
    } else {
      startDate.setMonth(now.getMonth() - 3);
    }
    
    const dateFilter = sqlFragment(`and created_at >= '${startDate.toISOString()}'`);
    const projectFilter = sqlFragment(projectId ? `and id = ${Number(projectId)}` : '');
    
    const projects = await sql<{
      id: number;
      name: string;
      budget: string | number;
      deadline: string | null;
      status: string;
      created_at: string;
      user_id: string;
    }>`select id, name, budget, deadline, status, created_at, user_id
      from projects
      where ${clause} ${projectFilter}
      order by created_at desc`;
    
    const tasks = await sql<{
      id: number;
      title: string;
      assignee: string | null;
      priority: string;
      status: string;
      project_id: number | null;
      created_at: string;
      user_id: string;
    }>`select id, title, assignee, priority, status, project_id, created_at, user_id
      from project_tasks
      where ${clause} ${dateFilter}
      order by created_at desc`;
    
    const team = await sql<{
      user_id: string;
      full_name: string;
      role: string;
      department: string;
    }>`select user_id, full_name, role, department
      from profiles
      where ${clause}`;
    
    const incidents = await sql<{
      id: number;
      title: string;
      severity: string;
      status: string;
      created_at: string;
      user_id: string;
    }>`select id, title, severity, status, created_at, user_id
      from incidents
      where ${clause} ${dateFilter}
      order by created_at desc`;
    
    const healthVisible = profile?.role === "HR" || can(profile, "ehs.manage");
    const health = healthVisible ? await sql<{
      user_id: string;
      fitness: string;
      created_at: string;
    }>`select user_id, fitness, created_at
      from health_declarations
      where organization_id = ${profile?.organizationId}
        ${profile?.role === "HR" ? dateFilter : can(profile, "ehs.manage") ? sqlFragment("and created_at::date = current_date") : sqlFragment("and false")}
      order by created_at desc` : [];
    
    const totalBudget = projects.reduce((acc, p) => acc + Number(p.budget || 0), 0);
    const completedProjects = projects.filter(p => p.status === 'Completed').length;
    const activeProjects = projects.filter(p => p.status === 'Active').length;
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.status === 'Completed').length;
    const pendingTasks = tasks.filter(t => t.status === 'Pending').length;
    const totalIncidents = incidents.length;
    const openIncidents = incidents.filter(i => i.status !== 'Closed' && i.status !== 'Resolved').length;
    
    return {
      generatedAt: new Date().toISOString(),
      period,
      type,
      dateRange: { from: startDate.toISOString(), to: now.toISOString() },
      summary: {
        totalProjects: projects.length,
        activeProjects,
        completedProjects,
        completionRate: projects.length > 0 ? Math.round((completedProjects / projects.length) * 100) : 0,
        totalBudget,
        avgBudget: projects.length > 0 ? Math.round(totalBudget / projects.length) : 0,
        totalTasks,
        completedTasks,
        pendingTasks,
        taskCompletionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
        totalIncidents,
        openIncidents,
        teamSize: team.length,
        healthCompliance: health.length > 0 ? Math.round((health.filter(h => h.fitness === 'Fit for Duty').length / health.length) * 100) : 0
      },
      projects: projects.map(p => ({
        ...p,
        budget: Number(p.budget || 0),
        taskCount: tasks.filter(t => t.project_id === p.id || !t.project_id).length,
        completedTasks: tasks.filter(t => (t.project_id === p.id || !t.project_id) && t.status === 'Completed').length,
        incidentCount: incidents.filter(i => i.user_id === p.user_id || !i.user_id).length,
      })),
      tasks: tasks.map(t => ({
        ...t,
        assigneeName: team.find(u => u.user_id === t.assignee || u.full_name === t.assignee)?.full_name || t.assignee || 'Unassigned'
      })),
      team: team.map(t => ({
        ...t,
        taskCount: tasks.filter(ta => ta.assignee === t.full_name || ta.assignee === t.user_id).length,
        completedTasks: tasks.filter(ta => (ta.assignee === t.full_name || ta.assignee === t.user_id) && ta.status === 'Completed').length,
        healthStatus: health.find(h => h.user_id === t.user_id)?.fitness || 'Not Reported',
        incidentCount: incidents.filter(i => i.user_id === t.user_id).length
      })),
      incidents: incidents
    };
  });
