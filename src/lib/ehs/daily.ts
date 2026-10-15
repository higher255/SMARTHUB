import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { workdayMiddleware } from "@/lib/auth/workday-middleware";
import { getSql } from "@/lib/db.server";
import { can, canAny } from "./access";
import { audit, getUserFullName, notify, notifyInApp, requirePermission, requireProfile, usersWithPermission } from "./core";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const num = (v: unknown) => Number(v ?? 0);
const darDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// ============================================
// ATTENDANCE
// ============================================

export type AttendanceRow = { id: number; userId: string; name: string | null; workDate: string; checkIn: string; checkOut: string | null; location: string | null; projectName: string | null; sessionCount: number; note: string | null; afterHours: boolean; autoCheckout: boolean; checkoutReason: string | null; reviewStatus: string | null; reviewNote: string | null };
export type OnDutyStaffRow = { userId: string; name: string; role: string; department: string; checkIn: string; location: string | null; projectName: string | null; fitness: string | null; declaredAt: string | null; sessionCount: number };

export const getMyAttendance = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await requireProfile(context.userId);
    const rows = await sql<{ id: number; work_date: string; check_in: string; check_out: string | null; location: string | null; project_name: string | null; session_count: number; note: string | null; after_hours: boolean; auto_checkout: boolean; checkout_reason: string | null; review_status: string | null; review_note: string | null }>`
      select a.id, a.work_date::text as work_date, a.check_in, a.check_out, a.location, pr.name as project_name, a.note, a.after_hours, a.auto_checkout,
        r.employee_reason as checkout_reason, r.status as review_status, r.hr_note as review_note,
        count(*) over (partition by a.work_date)::int as session_count
      from attendance a left join projects pr on pr.id = a.project_id
      left join attendance_checkout_reviews r on r.attendance_id = a.id
      where a.user_id = ${context.userId} order by a.work_date desc, a.check_in desc limit 30`;
    const today = darDate();
    const list = rows.map((r): AttendanceRow => ({ id: r.id, userId: context.userId, name: null, workDate: r.work_date, checkIn: r.check_in, checkOut: r.check_out, location: r.location, projectName: r.project_name, sessionCount: r.session_count, note: r.note, afterHours: r.after_hours, autoCheckout: r.auto_checkout, checkoutReason: r.checkout_reason, reviewStatus: r.review_status, reviewNote: r.review_note }));
    const todaySessions = list.filter((r) => r.workDate === today).sort((a, b) => a.checkIn.localeCompare(b.checkIn));
    return { today: todaySessions.find((r) => !r.checkOut) ?? todaySessions.at(-1) ?? null, todaySessions, recent: list };
  });

export const checkIn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ location: z.string().trim().min(1).max(160), projectId: z.number().int().optional(), reason: z.string().trim().max(500).optional() }).parse(input ?? {}))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requireProfile(context.userId);
    const policy = await sql<{ time: string; return_reason_required: boolean }>`select to_char(now() at time zone 'Africa/Dar_es_Salaam', 'HH24MI') as time,
      coalesce((select (extract(hour from a.check_out at time zone 'Africa/Dar_es_Salaam') * 60 + extract(minute from a.check_out at time zone 'Africa/Dar_es_Salaam')) < 1020
        from attendance a where a.user_id = ${context.userId} and a.work_date = (now() at time zone 'Africa/Dar_es_Salaam')::date and a.check_out is not null
        order by a.check_in desc limit 1), false) as return_reason_required`;
    if (Number(policy[0]?.time ?? "0000") < 700) throw new Error("Check-in opens at 07:00 East Africa Time.");
    if (policy[0]?.return_reason_required && !data.reason?.trim()) throw new Error("Please give a reason for returning after an early check-out.");
    if (data.projectId) {
      const p = await sql`select 1 from projects where id = ${data.projectId} and organization_id = ${profile.organizationId}`;
      if (!p[0]) throw new Error("Choose a project from your company");
    }
    const afterHours = Number(policy[0]?.time ?? "0000") >= 1800;
    const rows = await sql<{ id: number; work_date: string; check_in: string }>`insert into attendance (organization_id, user_id, work_date, location, project_id, note, after_hours)
      values (${profile.organizationId}, ${context.userId}, (now() at time zone 'Africa/Dar_es_Salaam')::date, ${data.location}, ${data.projectId ?? null}, ${data.reason?.trim() || null}, ${afterHours})
      on conflict do nothing returning id, work_date::text as work_date, check_in`;
    if (!rows[0]) throw new Error("You are already checked in. Check out before starting another session.");
    const count = await sql<{ count: number }>`select count(*)::int as count from attendance where user_id = ${context.userId} and work_date = ${rows[0].work_date}::date`;
    await audit(sql, profile.organizationId, context.userId, "check_in", "attendance", rows[0].id, {
      workDate: rows[0].work_date, checkIn: rows[0].check_in, location: data.location, projectId: data.projectId ?? null, session: count[0]?.count ?? 1, afterHours, reason: data.reason?.trim() || null,
    });
    return { success: true, id: rows[0].id };
  });

export const checkOut = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requireProfile(context.userId);
    const rows = await sql<{ id: number; check_in: string; check_out: string }>`update attendance set check_out = now()
      where id = (select id from attendance where user_id = ${context.userId} and work_date = (now() at time zone 'Africa/Dar_es_Salaam')::date and check_out is null order by check_in desc limit 1 for update)
      and check_out is null returning id, check_in, check_out`;
    if (!rows[0]) throw new Error("You are not checked in, or you already checked out");
    const elapsedMinutes = Math.max(0, Math.round((new Date(rows[0].check_out).getTime() - new Date(rows[0].check_in).getTime()) / 60000));
    await audit(sql, profile.organizationId, context.userId, "check_out", "attendance", rows[0].id, {
      checkIn: rows[0].check_in, checkOut: rows[0].check_out, elapsedMinutes,
    });
    return { success: true };
  });

export const listOnDutyStaff = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "hr.manage", "Only HR can view the staff attendance board");
    const rows = await sql<{ user_id: string; full_name: string; role: string; department: string; check_in: string; location: string | null; project_name: string | null; fitness: string | null; declared_at: string | null; session_count: number }>`
      select p.user_id, p.full_name, p.role, p.department, a.check_in, a.location, pr.name as project_name,
        h.fitness, h.declared_at, (select count(*)::int from attendance ax where ax.user_id = p.user_id::text and ax.work_date = (now() at time zone 'Africa/Dar_es_Salaam')::date) as session_count
      from attendance a
      join profiles p on p.user_id::text = a.user_id and p.organization_id::text = a.organization_id
      left join projects pr on pr.id = a.project_id
      left join lateral (
        select fitness, created_at::text as declared_at from health_declarations
        where user_id = p.user_id::text and organization_id = p.organization_id::text and created_at::date = current_date
        order by created_at desc limit 1
      ) h on true
      where a.organization_id = ${profile.organizationId} and a.work_date = (now() at time zone 'Africa/Dar_es_Salaam')::date and a.check_out is null and p.status = 'active'
      order by a.check_in`;
    return rows.map((r): OnDutyStaffRow => ({
      userId: r.user_id, name: r.full_name, role: r.role, department: r.department, checkIn: r.check_in,
      location: r.location, projectName: r.project_name, fitness: r.fitness, declaredAt: r.declared_at, sessionCount: r.session_count,
    }));
  });

export const listAttendance = createServerFn({ method: "GET" })
  .validator((date: string | undefined) => (date ? dateStr.parse(date) : undefined))
  .middleware([authMiddleware])
  .handler(async ({ context, data: date }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "attendance.view", "You cannot view attendance");
    const teamLead = profile.role === "Team_Leader" || can(profile, "teamleader.dashboard");
    const rows = await sql<{ id: number; user_id: string; name: string | null; work_date: string; check_in: string; check_out: string | null; location: string | null; project_name: string | null; session_count: number; note: string | null; after_hours: boolean; auto_checkout: boolean; checkout_reason: string | null; review_status: string | null; review_note: string | null }>`
      select a.id, a.user_id, p.full_name as name, a.work_date::text as work_date, a.check_in, a.check_out, a.location, pr.name as project_name, a.note, a.after_hours, a.auto_checkout,
        r.employee_reason as checkout_reason, r.status as review_status, r.hr_note as review_note,
        count(*) over (partition by a.user_id, a.work_date)::int as session_count
      from attendance a left join profiles p on p.user_id::text = a.user_id::text left join projects pr on pr.id = a.project_id
      left join attendance_checkout_reviews r on r.attendance_id = a.id
      where a.organization_id = ${profile.organizationId} and a.work_date = coalesce(${date ?? null}::date, (now() at time zone 'Africa/Dar_es_Salaam')::date)
        and (${!teamLead} or a.project_id in (select pm.project_id from project_members pm where pm.user_id=${context.userId} and pm.status='Accepted')) order by a.check_in`;
    return rows.map((r): AttendanceRow => ({ id: r.id, userId: r.user_id, name: r.name, workDate: r.work_date, checkIn: r.check_in, checkOut: r.check_out, location: r.location, projectName: r.project_name, sessionCount: r.session_count, note: r.note, afterHours: r.after_hours, autoCheckout: r.auto_checkout, checkoutReason: r.checkout_reason, reviewStatus: r.review_status, reviewNote: r.review_note }));
  });

export const askAttendanceReason = createServerFn({ method: "POST" })
  .validator((id: number) => z.number().int().positive().parse(id))
  .middleware([authMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "attendance.view", "You cannot review attendance");
    const rows = await sql<{ user_id: string; full_name: string; check_out: string | null }>`select a.user_id, p.full_name, a.check_out
      from attendance a join profiles p on p.user_id::text = a.user_id and p.organization_id::text = a.organization_id
      where a.id = ${id} and a.organization_id::text = ${profile.organizationId}::text`;
    const row = rows[0];
    if (!row?.check_out) throw new Error("This attendance session is not checked out");
    const cutoff = await sql<{ early: boolean }>`select (extract(hour from ${row.check_out}::timestamptz at time zone 'Africa/Dar_es_Salaam') * 60 + extract(minute from ${row.check_out}::timestamptz at time zone 'Africa/Dar_es_Salaam')) < 1020 as early`;
    if (!cutoff[0]?.early) throw new Error("A reason request is only available for check-outs before 17:00 EAT");
    return notify(sql, {
      organizationId: profile.organizationId,
      userIds: [row.user_id],
      title: "Attendance check-out follow-up",
      message: `HR would like a reason for your check-out at ${new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", hour: "2-digit", minute: "2-digit" }).format(new Date(row.check_out))}. Please reply to HR.`,
      type: "attendance", link: "/dashboard", entityType: "attendance_early_checkout", entityId: id,
    });
  });

export const submitAutoCheckoutReason = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ attendanceId: z.number().int().positive(), reason: z.string().trim().min(1).max(1000) }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requireProfile(context.userId);
    const rows = await sql<{ organization_id: string }>`select organization_id::text as organization_id from attendance
      where id = ${data.attendanceId} and user_id = ${context.userId} and organization_id::text = ${profile.organizationId}::text
        and auto_checkout = true and check_out is not null`;
    if (!rows[0]) throw new Error("This automatic check-out cannot be updated");
    const current = await sql<{ status: string }>`select status from attendance_checkout_reviews where attendance_id = ${data.attendanceId}`;
    if (current[0]?.status === "Approved") throw new Error("HR has already approved this reason");
    if (current[0]?.status === "Pending") throw new Error("Your reason is already waiting for HR review");
    await sql`insert into attendance_checkout_reviews (attendance_id, organization_id, user_id, employee_reason, status, hr_note, requested_at, reviewed_by, updated_at)
      values (${data.attendanceId}, ${profile.organizationId}, ${context.userId}, ${data.reason}, 'Pending', null, now(), null, now())
      on conflict (attendance_id) do update set employee_reason = excluded.employee_reason, status = 'Pending', hr_note = null, requested_at = now(), reviewed_by = null, updated_at = now()`;
    const reviewers = (await usersWithPermission(sql, profile.organizationId, "hr.manage")).filter((userId) => userId !== context.userId);
    const notified = await notifyInApp(sql, {
      organizationId: profile.organizationId, userIds: reviewers, title: "Automatic check-out reason submitted",
      message: `${profile.fullName} submitted a reason for an automatic check-out. Review it in HR → Attendance.`,
      type: "attendance", link: "/hr", entityType: "attendance_auto_checkout", entityId: data.attendanceId,
    });
    await audit(sql, profile.organizationId, context.userId, "submit_reason", "attendance_auto_checkout_review", data.attendanceId, { reason: data.reason });
    return { success: true, notified };
  });

export const reviewAutoCheckoutReason = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ attendanceId: z.number().int().positive(), decision: z.enum(["Approved", "Needs details"]), note: z.string().trim().max(1000).optional() }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "attendance.view", "You cannot review attendance");
    if (data.decision === "Needs details" && !data.note?.trim()) throw new Error("Add a note explaining what details are needed");
    const rows = await sql<{ user_id: string; employee_reason: string | null; status: string }>`select a.user_id, r.employee_reason, r.status
      from attendance a join attendance_checkout_reviews r on r.attendance_id = a.id
      where a.id = ${data.attendanceId} and a.organization_id::text = ${profile.organizationId}::text and a.auto_checkout = true`;
    const row = rows[0];
    if (!row || row.status !== "Pending" || !row.employee_reason) throw new Error("This check-out reason is not waiting for HR review");
    await sql`update attendance_checkout_reviews set status = ${data.decision}, hr_note = ${data.note?.trim() || null}, reviewed_by = ${context.userId}, updated_at = now()
      where attendance_id = ${data.attendanceId} and status = 'Pending'`;
    await notifyInApp(sql, {
      organizationId: profile.organizationId, userIds: [row.user_id],
      title: data.decision === "Approved" ? "Attendance reason approved" : "More attendance details requested",
      message: data.decision === "Approved" ? "HR approved your reason for the automatic check-out." : `HR needs more details about your automatic check-out: ${data.note?.trim()}`,
      type: "attendance", link: "/dashboard", entityType: "attendance_auto_checkout", entityId: data.attendanceId,
    });
    await audit(sql, profile.organizationId, context.userId, data.decision.toLowerCase().replace(" ", "_"), "attendance_auto_checkout_review", data.attendanceId, { note: data.note?.trim() || null, employeeId: row.user_id });
    return { success: true };
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
    if (data.leaveType === "Sick") {
      approvers.push(...(await usersWithPermission(sql, profile.organizationId, "ehs.manage")).filter((u) => u !== context.userId));
    }
    await notify(sql, {
      organizationId: profile.organizationId, userIds: [...new Set(approvers)], title: "Leave request",
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
  .middleware([authMiddleware, workdayMiddleware])
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
  .middleware([authMiddleware, workdayMiddleware])
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
