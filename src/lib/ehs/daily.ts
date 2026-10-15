import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db.server";
import { can, canAny } from "./access";
import { audit, getUserFullName, notify, requirePermission, requireProfile, usersWithPermission } from "./core";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const num = (v: unknown) => Number(v ?? 0);

// ============================================
// ATTENDANCE
// ============================================

export type AttendanceRow = { id: number; userId: string; name: string | null; workDate: string; checkIn: string; checkOut: string | null; location: string | null; projectName: string | null };

export const getMyAttendance = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await requireProfile(context.userId);
    const rows = await sql<{ id: number; work_date: string; check_in: string; check_out: string | null; location: string | null }>`
      select id, work_date::text as work_date, check_in, check_out, location from attendance where user_id = ${context.userId} order by work_date desc limit 14`;
    const today = new Date().toISOString().slice(0, 10);
    const list = rows.map((r) => ({ id: r.id, workDate: r.work_date, checkIn: r.check_in, checkOut: r.check_out, location: r.location }));
    return { today: list.find((r) => r.workDate === today) ?? null, recent: list };
  });

export const checkIn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ location: z.string().trim().min(1).max(160), projectId: z.number().int().optional() }).parse(input ?? {}))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requireProfile(context.userId);
    if (data.projectId) {
      const p = await sql`select 1 from projects where id = ${data.projectId} and organization_id = ${profile.organizationId}`;
      if (!p[0]) throw new Error("Choose a project from your company");
    }
    const rows = await sql`insert into attendance (organization_id, user_id, work_date, location, project_id)
      values (${profile.organizationId}, ${context.userId}, current_date, ${data.location ?? null}, ${data.projectId ?? null})
      on conflict (user_id, work_date) do nothing returning id`;
    if (!rows[0]) throw new Error("You already checked in today");
    return { success: true };
  });

export const checkOut = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await requireProfile(context.userId);
    const rows = await sql`update attendance set check_out = now() where user_id = ${context.userId} and work_date = current_date and check_out is null returning id`;
    if (!rows[0]) throw new Error("You are not checked in, or you already checked out");
    return { success: true };
  });

export const listAttendance = createServerFn({ method: "GET" })
  .validator((date: string | undefined) => (date ? dateStr.parse(date) : undefined))
  .middleware([authMiddleware])
  .handler(async ({ context, data: date }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "attendance.view", "You cannot view attendance");
    const teamLead = profile.role === "Team_Leader" || can(profile, "teamleader.dashboard");
    const rows = await sql<{ id: number; user_id: string; name: string | null; work_date: string; check_in: string; check_out: string | null; location: string | null; project_name: string | null }>`
      select a.id, a.user_id, p.full_name as name, a.work_date::text as work_date, a.check_in, a.check_out, a.location, pr.name as project_name
      from attendance a left join profiles p on p.user_id = a.user_id left join projects pr on pr.id = a.project_id
      where a.organization_id = ${profile.organizationId} and a.work_date = coalesce(${date ?? null}::date, current_date)
        and (${!teamLead} or a.project_id in (select pm.project_id from project_members pm where pm.user_id=${context.userId} and pm.status='Accepted')) order by a.check_in`;
    return rows.map((r): AttendanceRow => ({ id: r.id, userId: r.user_id, name: r.name, workDate: r.work_date, checkIn: r.check_in, checkOut: r.check_out, location: r.location, projectName: r.project_name }));
  });

// ============================================
// LEAVE
// ============================================

export type LeaveRow = {
  id: number; userId: string; name: string | null; leaveType: string; startDate: string; endDate: string; days: number; reason: string | null;
  status: "Pending" | "Approved" | "Rejected" | "Cancelled"; decisionNote: string | null; createdAt: string;
};

export const requestLeave = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      leaveType: z.enum(["Annual", "Sick", "Compassionate", "Unpaid", "Permission", "Other"]),
      startDate: dateStr,
      endDate: dateStr,
      reason: z.string().max(500).optional(),
    }).parse(input),
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requireProfile(context.userId);
    if (data.endDate < data.startDate) throw new Error("The end date is before the start date");
    const clash = await sql`select 1 from leave_requests where user_id = ${context.userId} and status in ('Pending','Approved')
      and start_date <= ${data.endDate}::date and end_date >= ${data.startDate}::date`;
    if (clash[0]) throw new Error("You already have leave that overlaps these dates");
    const rows = await sql<{ id: number; days: number }>`insert into leave_requests (organization_id, user_id, leave_type, start_date, end_date, reason)
      values (${profile.organizationId}, ${context.userId}, ${data.leaveType}, ${data.startDate}::date, ${data.endDate}::date, ${data.reason ?? null}) returning id, days`;
    const approvers = (await usersWithPermission(sql, profile.organizationId, "leave.approve")).filter((u) => u !== context.userId);
    await notify(sql, {
      organizationId: profile.organizationId, userIds: approvers, title: "Leave request",
      message: `${getUserFullName(profile)} asked for ${rows[0]!.days} day(s) of ${data.leaveType.toLowerCase()} leave from ${data.startDate}.`,
      type: "leave", link: "/hr", entityType: "leave", entityId: rows[0]!.id,
    });
    return { id: rows[0]!.id, days: rows[0]!.days };
  });

export const listLeave = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requireProfile(context.userId);
    const all = canAny(profile, ["leave.approve", "hr.manage"]);
    const rows = await sql<{ id: number; user_id: string; name: string | null; leave_type: string; start_date: string; end_date: string; days: number; reason: string | null; status: string; decision_note: string | null; created_at: string }>`
      select l.id, l.user_id, p.full_name as name, l.leave_type, l.start_date::text as start_date, l.end_date::text as end_date, l.days, l.reason, l.status, l.decision_note, l.created_at
      from leave_requests l left join profiles p on p.user_id = l.user_id
      where l.organization_id = ${profile.organizationId} and (${all} or l.user_id = ${context.userId})
      order by (l.status = 'Pending') desc, l.start_date desc limit 200`;
    return rows.map((r): LeaveRow => ({ id: r.id, userId: r.user_id, name: r.name, leaveType: r.leave_type, startDate: r.start_date, endDate: r.end_date, days: r.days, reason: r.reason, status: r.status as LeaveRow["status"], decisionNote: r.decision_note, createdAt: r.created_at }));
  });

export const decideLeave = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.number().int(), decision: z.enum(["Approved", "Rejected"]), note: z.string().max(300).optional() }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "leave.approve", "You cannot decide leave requests");
    if (data.decision === "Rejected" && !data.note?.trim()) throw new Error("Give a reason for rejecting");
    const cur = await sql<{ user_id: string; leave_type: string; start_date: string; days: number }>`select user_id, leave_type, start_date::text as start_date, days from leave_requests where id = ${data.id} and organization_id = ${profile.organizationId}`;
    if (!cur[0]) throw new Error("Leave request not found");
    if (cur[0].user_id === context.userId) throw new Error("You cannot decide your own leave");
    const rows = await sql`update leave_requests set status = ${data.decision}, decided_by = ${context.userId}, decided_at = now(), decision_note = ${data.note ?? null}
      where id = ${data.id} and organization_id = ${profile.organizationId} and status = 'Pending' returning id`;
    if (!rows[0]) throw new Error("This request was already decided");
    await notify(sql, {
      organizationId: profile.organizationId, userIds: [cur[0].user_id], title: `Leave ${data.decision.toLowerCase()}`,
      message: `${getUserFullName(profile)} ${data.decision.toLowerCase()} your ${cur[0].days} day(s) of ${cur[0].leave_type.toLowerCase()} leave from ${cur[0].start_date}.${data.note ? ` ${data.note}` : ""}`,
      type: "leave", link: "/dashboard", entityType: "leave", entityId: data.id,
    });
    await audit(sql, profile.organizationId, context.userId, data.decision.toLowerCase(), "leave", data.id);
    return { success: true };
  });

export const cancelLeave = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .middleware([authMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    await requireProfile(context.userId);
    const rows = await sql`update leave_requests set status = 'Cancelled' where id = ${id} and user_id = ${context.userId} and status in ('Pending','Approved') and end_date >= current_date returning id`;
    if (!rows[0]) throw new Error("This leave cannot be cancelled");
    return { success: true };
  });

// ============================================
// DAILY SITE REPORTS (also feed hours worked for TRIFR / LTIFR)
// ============================================

export type SiteReport = {
  id: number; projectId: number | null; projectName: string | null; reportDate: string; summary: string; workDone: string | null; issues: string | null;
  weather: string | null; workers: number; hoursPerWorker: number; author: string | null; createdAt: string;
};

export const createSiteReport = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      projectId: z.number().int(),
      reportDate: dateStr.optional(),
      summary: z.string().min(3).max(300),
      workDone: z.string().max(2000).optional(),
      issues: z.string().max(2000).optional(),
      weather: z.string().max(60).optional(),
      workers: z.number().int().min(0).max(5000).default(0),
      hoursPerWorker: z.number().min(0).max(24).default(0),
    }).parse(input),
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "hours.record", "You cannot file site reports");
    const proj = await sql<{ user_id: string; name: string }>`select user_id, name from projects where id = ${data.projectId} and organization_id = ${profile.organizationId}`;
    if (!proj[0]) throw new Error("Choose a project from your company");
    if (profile.role === "Team_Leader" || can(profile, "teamleader.dashboard")) {
      const assigned = await sql`select 1 from project_members where project_id=${data.projectId} and user_id=${context.userId} and status='Accepted'`;
      if (!assigned[0]) throw new Error("You can only report on a project assigned to your team");
    }
    const rows = await sql<{ id: number }>`
      with r as (
        insert into site_reports (organization_id, project_id, report_date, summary, work_done, issues, weather, workers, hours_per_worker, created_by)
        values (${profile.organizationId}, ${data.projectId}, coalesce(${data.reportDate ?? null}::date, current_date), ${data.summary}, ${data.workDone ?? null},
                ${data.issues ?? null}, ${data.weather ?? null}, ${data.workers}, ${data.hoursPerWorker}, ${context.userId})
        returning id, report_date
      ), w as (
        insert into work_hours (organization_id, project_id, work_date, workers, hours_per_worker, recorded_by, notes)
        select ${profile.organizationId}, ${data.projectId}, r.report_date, ${data.workers}, ${data.hoursPerWorker}, ${context.userId}, 'From daily site report'
        from r where ${data.workers}::int > 0 and ${data.hoursPerWorker}::numeric > 0
      )
      select id from r`;
    if (data.issues?.trim() && proj[0].user_id !== context.userId) {
      await notify(sql, {
        organizationId: profile.organizationId, userIds: [proj[0].user_id], title: `Issue reported on ${proj[0].name}`,
        message: `${getUserFullName(profile)}: ${data.issues.slice(0, 160)}`, type: "site_report", link: "/projectmanager", entityType: "site_report", entityId: rows[0]!.id,
      });
    }
    return { id: rows[0]!.id };
  });

export const listSiteReports = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requireProfile(context.userId);
    const all = canAny(profile, ["projects.manage", "ehs.view_org", "management.view"]);
    const teamLead = profile.role === "Team_Leader" || can(profile, "teamleader.dashboard");
    const rows = await sql<{ id: number; project_id: number | null; project_name: string | null; report_date: string; summary: string; work_done: string | null; issues: string | null; weather: string | null; workers: number; hours_per_worker: string | number; author: string | null; created_at: string }>`
      select s.id, s.project_id, p.name as project_name, s.report_date::text as report_date, s.summary, s.work_done, s.issues, s.weather, s.workers, s.hours_per_worker, u.full_name as author, s.created_at
      from site_reports s left join projects p on p.id = s.project_id left join profiles u on u.user_id = s.created_by
      where s.organization_id = ${profile.organizationId} and (${all} or s.created_by = ${context.userId}
        or (${teamLead} and s.project_id in (select pm.project_id from project_members pm where pm.user_id=${context.userId} and pm.status='Accepted')))
      order by s.report_date desc, s.id desc limit 40`;
    return rows.map((r): SiteReport => ({ id: r.id, projectId: r.project_id, projectName: r.project_name, reportDate: r.report_date, summary: r.summary, workDone: r.work_done, issues: r.issues, weather: r.weather, workers: r.workers, hoursPerWorker: num(r.hours_per_worker), author: r.author, createdAt: r.created_at }));
  });
