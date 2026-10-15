import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { workdayMiddleware } from "@/lib/auth/workday-middleware";
import { getSql } from "@/lib/db.server";
import { can, canAny } from "./access";
import { audit, getUserFullName, notify, requirePermission, requireProfile, usersWithPermission, type Profile } from "./core";

const num = (v: unknown) => Number(v ?? 0);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const RATE_BASE = 1_000_000;

export const INJURY_TYPES = ["None", "First Aid", "Medical Treatment", "Restricted Work", "Lost Time", "Fatality"] as const;
const RECORDABLE = new Set<string>(["Medical Treatment", "Restricted Work", "Lost Time", "Fatality"]);

// ============================================
// HOURS WORKED (denominator of every frequency rate)
// ============================================

export const recordWorkHours = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      projectId: z.number().int().optional(),
      workDate: dateStr.optional(),
      workers: z.number().int().min(0).max(5000),
      hoursPerWorker: z.number().min(0).max(24),
      notes: z.string().max(300).optional(),
    }).parse(input),
  )
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "hours.record", "You cannot record hours worked");
    if (data.projectId) {
      const p = await sql`select 1 from projects where id = ${data.projectId} and organization_id = ${profile.organizationId}`;
      if (!p[0]) throw new Error("Choose a project from your company");
    }
    await sql`insert into work_hours (organization_id, project_id, work_date, workers, hours_per_worker, recorded_by, notes)
      values (${profile.organizationId}, ${data.projectId ?? null}, coalesce(${data.workDate ?? null}::date, current_date), ${data.workers}, ${data.hoursPerWorker}, ${context.userId}, ${data.notes ?? null})`;
    return { success: true };
  });

export const listWorkHours = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requireProfile(context.userId);
    const mine = !canAny(profile, ["ehs.view_org", "ehs.manage", "management.view"]);
    const rows = await sql<{ id: number; project_id: number | null; project_name: string | null; work_date: string; workers: number; hours_per_worker: string | number; man_hours: string | number; recorded_by: string }>`
      select w.id, w.project_id, p.name as project_name, w.work_date::text as work_date, w.workers, w.hours_per_worker, w.man_hours, w.recorded_by
      from work_hours w left join projects p on p.id = w.project_id
      where w.organization_id = ${profile.organizationId} and (${!mine} or w.recorded_by = ${context.userId})
      order by w.work_date desc, w.id desc limit 60`;
    return rows.map((r) => ({ id: r.id, projectId: r.project_id, projectName: r.project_name, workDate: r.work_date, workers: r.workers, hoursPerWorker: num(r.hours_per_worker), manHours: num(r.man_hours) }));
  });

// ============================================
// SAFETY KPIs
// ============================================

export type SafetyMetrics = {
  from: string;
  to: string;
  manHours: number;
  incidents: number;
  recordable: number;
  lostTime: number;
  fatalities: number;
  lostDays: number;
  nearMisses: number;
  /** Per 1,000,000 hours worked; null until hours have been recorded. */
  trifr: number | null;
  ltifr: number | null;
  severityRate: number | null;
  openNcr: number;
  openCriticalNcr: number;
  totalCost: number;
  idleHours: number;
  monthly: { month: string; recordable: number; lostTime: number; manHours: number; trifr: number | null }[];
};

const rate = (count: number, hours: number) => (hours > 0 ? Math.round(((count * RATE_BASE) / hours) * 100) / 100 : null);

export const computeSafetyMetrics = createServerOnlyFn(async (orgId: string, from: string, to: string): Promise<SafetyMetrics> => {
  const sql = await getSql();
  const hours = await sql<{ h: string | number }>`select coalesce(sum(man_hours),0) as h from work_hours where organization_id = ${orgId} and work_date between ${from}::date and ${to}::date`;
  const inc = await sql<Record<string, string | number>>`select
      count(*)::int as incidents,
      count(*) filter (where is_recordable)::int as recordable,
      count(*) filter (where injury_type in ('Lost Time','Fatality'))::int as lost_time,
      count(*) filter (where injury_type = 'Fatality')::int as fatalities,
      coalesce(sum(lost_days),0)::int as lost_days,
      count(*) filter (where injury_type = 'None' and severity in ('Low','Medium'))::int as near_misses,
      coalesce(sum(cost_estimate),0) as cost, coalesce(sum(idle_hours),0) as idle
    from incidents where organization_id = ${orgId} and coalesce(occurred_at, created_at)::date between ${from}::date and ${to}::date`;
  const ncr = await sql<{ open: number; crit: number }>`select count(*) filter (where status <> 'Closed')::int as open,
      count(*) filter (where status <> 'Closed' and severity = 'Critical')::int as crit from ncrs where organization_id = ${orgId}`;
  const monthly = await sql<{ m: string; recordable: number; lost_time: number; hours: string | number }>`
    with months as (select to_char(d, 'YYYY-MM') as m, d as start from generate_series(date_trunc('month', ${to}::date) - interval '11 months', date_trunc('month', ${to}::date), interval '1 month') d)
    select months.m,
      (select count(*)::int from incidents i where i.organization_id = ${orgId} and i.is_recordable and to_char(coalesce(i.occurred_at, i.created_at), 'YYYY-MM') = months.m) as recordable,
      (select count(*)::int from incidents i where i.organization_id = ${orgId} and i.injury_type in ('Lost Time','Fatality') and to_char(coalesce(i.occurred_at, i.created_at), 'YYYY-MM') = months.m) as lost_time,
      (select coalesce(sum(w.man_hours),0) from work_hours w where w.organization_id = ${orgId} and to_char(w.work_date, 'YYYY-MM') = months.m) as hours
    from months order by months.m`;
  const i = inc[0]!;
  const manHours = num(hours[0]?.h);
  return {
    from, to, manHours, incidents: num(i.incidents), recordable: num(i.recordable), lostTime: num(i.lost_time), fatalities: num(i.fatalities),
    lostDays: num(i.lost_days), nearMisses: num(i.near_misses), trifr: rate(num(i.recordable), manHours), ltifr: rate(num(i.lost_time), manHours),
    severityRate: rate(num(i.lost_days), manHours), openNcr: ncr[0]?.open ?? 0, openCriticalNcr: ncr[0]?.crit ?? 0, totalCost: num(i.cost), idleHours: num(i.idle),
    monthly: monthly.map((m) => ({ month: m.m, recordable: m.recordable, lostTime: m.lost_time, manHours: num(m.hours), trifr: rate(m.recordable, num(m.hours)) })),
  };
});

export const getSafetyMetrics = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ from: dateStr.optional(), to: dateStr.optional() }).optional().parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requireProfile(context.userId);
    if (!canAny(profile, ["ehs.view_org", "ehs.manage", "management.view"])) throw new Error("You cannot view safety metrics");
    const to = data?.to ?? new Date().toISOString().slice(0, 10);
    const from = data?.from ?? new Date(new Date(to).setFullYear(new Date(to).getFullYear() - 1)).toISOString().slice(0, 10);
    return computeSafetyMetrics(profile.organizationId, from, to);
  });

/** Classify an incident the way an auditor will: injury type, lost days, cost, idle time. */
export const classifyIncident = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      id: z.number().int(),
      injuryType: z.enum(INJURY_TYPES),
      lostDays: z.number().int().min(0).max(3650).default(0),
      costEstimate: z.number().min(0).default(0),
      idleHours: z.number().min(0).default(0),
      occurredAt: z.string().datetime().optional(),
    }).parse(input),
  )
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "ehs.manage", "Only EHS officers can classify incidents");
    const lostDays = data.injuryType === "Lost Time" || data.injuryType === "Fatality" ? data.lostDays : 0;
    const rows = await sql`update incidents set injury_type = ${data.injuryType}, lost_days = ${lostDays}, is_recordable = ${RECORDABLE.has(data.injuryType)},
        cost_estimate = ${data.costEstimate}, idle_hours = ${data.idleHours}, occurred_at = coalesce(${data.occurredAt ?? null}::timestamptz, occurred_at), updated_at = now()
      where id = ${data.id} and organization_id = ${profile.organizationId} returning id`;
    if (!rows[0]) throw new Error("Incident not found");
    await audit(sql, profile.organizationId, context.userId, "classify", "incident", data.id, { injuryType: data.injuryType, lostDays });
    return { success: true };
  });

/** Anonymous hazard / near-miss channel: the reporter is hidden from everyone but themselves. */
export const reportAnonymousHazard = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      title: z.string().min(3).max(160),
      location: z.string().min(1).max(160),
      description: z.string().max(2000).optional(),
      severity: z.enum(["Low", "Medium", "High"]).default("Low"),
      projectId: z.number().int().optional(),
    }).parse(input),
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "ehs.report");
    await sql`insert into incidents (user_id, title, location, severity, status, description, organization_id, project_id, is_anonymous)
      values (${context.userId}, ${data.title}, ${data.location}, ${data.severity}, 'Reported', ${data.description ?? null}, ${profile.organizationId}, ${data.projectId ?? null}, true)`;
    const officers = await usersWithPermission(sql, profile.organizationId, "ehs.manage");
    await notify(sql, {
      organizationId: profile.organizationId, userIds: officers, title: "Anonymous hazard report",
      message: `${data.severity} risk at ${data.location}: ${data.title}`, type: "incident", link: "/ehs",
    });
    return { success: true };
  });

// ============================================
// NON-CONFORMANCE REPORTS
// ============================================

export type Ncr = {
  id: number; ncrNumber: string; projectId: number | null; projectName: string | null; title: string; description: string | null;
  severity: "Minor" | "Major" | "Critical"; status: "Open" | "In Progress" | "Closed"; raisedBy: string; raisedByName: string | null;
  assignedTo: string | null; assignedToName: string | null; dueDate: string | null; closedAt: string | null; closureNote: string | null; createdAt: string;
};

export const createNcr = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      projectId: z.number().int().optional(),
      title: z.string().min(3).max(200),
      description: z.string().max(2000).optional(),
      severity: z.enum(["Minor", "Major", "Critical"]).default("Minor"),
      assignedTo: z.string().optional(),
      dueDate: dateStr.optional(),
    }).parse(input),
  )
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "ncr.raise", "You cannot raise non-conformance reports");
    let projectOwner: string | null = null;
    if (data.projectId) {
      const p = await sql<{ user_id: string }>`select user_id from projects where id = ${data.projectId} and organization_id = ${profile.organizationId}`;
      if (!p[0]) throw new Error("Choose a project from your company");
      projectOwner = p[0].user_id;
    }
    if (data.assignedTo) {
      const a = await sql`select 1 from profiles where user_id = ${data.assignedTo} and organization_id = ${profile.organizationId} and status = 'active'`;
      if (!a[0]) throw new Error("Assignee not found");
    }
    const rows = await sql<{ id: number; ncr_number: string }>`
      insert into ncrs (organization_id, ncr_number, project_id, title, description, severity, raised_by, assigned_to, due_date)
      values (${profile.organizationId}, acct_next_no(${profile.organizationId}, 'NCR', 'NCR'), ${data.projectId ?? null}, ${data.title}, ${data.description ?? null},
              ${data.severity}, ${context.userId}, ${data.assignedTo ?? null}, coalesce(${data.dueDate ?? null}::date, current_date + case ${data.severity} when 'Critical' then 1 when 'Major' then 7 else 14 end))
      returning id, ncr_number`;
    const n = rows[0]!;
    const managers = await usersWithPermission(sql, profile.organizationId, "ncr.manage");
    const recipients = [...managers, ...(data.assignedTo ? [data.assignedTo] : []), ...(data.severity === "Critical" && projectOwner ? [projectOwner] : [])].filter((u) => u !== context.userId);
    await notify(sql, {
      organizationId: profile.organizationId, userIds: recipients, title: `${n.ncr_number} raised (${data.severity})`,
      message: `${getUserFullName(profile)}: ${data.title}`, type: "ncr", link: "/ehs", entityType: "ncr", entityId: n.id,
    });
    return { id: n.id, ncrNumber: n.ncr_number };
  });

export const listNcrs = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requireProfile(context.userId);
    const all = canAny(profile, ["ehs.view_org", "ncr.manage", "management.view"]);
    const rows = await sql<{
      id: number; ncr_number: string; project_id: number | null; project_name: string | null; title: string; description: string | null; severity: string; status: string;
      raised_by: string; raiser: string | null; assigned_to: string | null; assignee: string | null; due_date: string | null; closed_at: string | null; closure_note: string | null; created_at: string;
    }>`select n.id, n.ncr_number, n.project_id, p.name as project_name, n.title, n.description, n.severity, n.status, n.raised_by, r.full_name as raiser,
              n.assigned_to, a.full_name as assignee, n.due_date::text as due_date, n.closed_at, n.closure_note, n.created_at
         from ncrs n left join projects p on p.id = n.project_id left join profiles r on r.user_id = n.raised_by left join profiles a on a.user_id = n.assigned_to
        where n.organization_id = ${profile.organizationId} and (${all} or n.raised_by = ${context.userId} or n.assigned_to = ${context.userId})
        order by (n.status = 'Closed'), case n.severity when 'Critical' then 0 when 'Major' then 1 else 2 end, n.created_at desc limit 300`;
    return rows.map((r): Ncr => ({
      id: r.id, ncrNumber: r.ncr_number, projectId: r.project_id, projectName: r.project_name, title: r.title, description: r.description,
      severity: r.severity as Ncr["severity"], status: r.status as Ncr["status"], raisedBy: r.raised_by, raisedByName: r.raiser, assignedTo: r.assigned_to,
      assignedToName: r.assignee, dueDate: r.due_date, closedAt: r.closed_at, closureNote: r.closure_note, createdAt: r.created_at,
    }));
  });

export const updateNcr = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ id: z.number().int(), status: z.enum(["Open", "In Progress", "Closed"]).optional(), assignedTo: z.string().optional(), closureNote: z.string().max(1000).optional() }).parse(input),
  )
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requireProfile(context.userId);
    const rows = await sql<{ id: number; ncr_number: string; raised_by: string; assigned_to: string | null; title: string }>`
      select id, ncr_number, raised_by, assigned_to, title from ncrs where id = ${data.id} and organization_id = ${profile.organizationId}`;
    const n = rows[0];
    if (!n) throw new Error("NCR not found");
    const manager = can(profile, "ncr.manage");
    if (!manager && n.assigned_to !== context.userId) throw new Error("Only EHS managers or the assignee can update this NCR");
    if (data.status === "Closed" && !data.closureNote?.trim()) throw new Error("Describe how it was closed");
    if (data.assignedTo && !manager) throw new Error("Only EHS managers can reassign an NCR");
    await sql`update ncrs set status = coalesce(${data.status ?? null}::text, status), assigned_to = coalesce(${data.assignedTo ?? null}::text, assigned_to),
        closure_note = coalesce(${data.closureNote ?? null}::text, closure_note),
        closed_at = case when ${data.status ?? null}::text = 'Closed' then now() when ${data.status ?? null}::text is not null then null else closed_at end, updated_at = now()
      where id = ${data.id} and organization_id = ${profile.organizationId}`;
    const who = [n.raised_by, ...(data.assignedTo ? [data.assignedTo] : [])].filter((u) => u !== context.userId);
    if (data.status || data.assignedTo) {
      await notify(sql, {
        organizationId: profile.organizationId, userIds: who, title: `${n.ncr_number} ${data.status ? data.status.toLowerCase() : "reassigned"}`,
        message: n.title, type: "ncr", link: "/ehs", entityType: "ncr", entityId: n.id,
      });
    }
    return { success: true };
  });

// ============================================
// HIRA (hazard identification and risk assessment)
// ============================================

export const listRiskAssessments = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "ehs.view_org");
    const rows = await sql<{ id: number; project_id: number | null; project_name: string | null; activity: string; hazard: string; likelihood: number; consequence: number; risk_score: number; controls: string | null; residual_score: number | null; owner: string | null; review_date: string | null; status: string }>`
      select r.id, r.project_id, p.name as project_name, r.activity, r.hazard, r.likelihood, r.consequence, r.risk_score, r.controls, r.residual_score, r.owner, r.review_date::text as review_date, r.status
      from risk_assessments r left join projects p on p.id = r.project_id
      where r.organization_id = ${profile.organizationId} order by (r.status = 'Closed'), r.risk_score desc, r.id desc limit 300`;
    return rows.map((r) => ({ id: r.id, projectId: r.project_id, projectName: r.project_name, activity: r.activity, hazard: r.hazard, likelihood: r.likelihood, consequence: r.consequence, riskScore: r.risk_score, controls: r.controls, residualScore: r.residual_score, owner: r.owner, reviewDate: r.review_date, status: r.status }));
  });

export const createRiskAssessment = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      projectId: z.number().int().optional(),
      activity: z.string().min(2).max(200),
      hazard: z.string().min(2).max(300),
      likelihood: z.number().int().min(1).max(5),
      consequence: z.number().int().min(1).max(5),
      controls: z.string().max(1000).optional(),
      residualScore: z.number().int().min(1).max(25).optional(),
      owner: z.string().max(120).optional(),
      reviewDate: dateStr.optional(),
    }).parse(input),
  )
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "hira.manage", "Only EHS officers can manage risk assessments");
    await sql`insert into risk_assessments (organization_id, project_id, activity, hazard, likelihood, consequence, controls, residual_score, owner, review_date, created_by)
      values (${profile.organizationId}, ${data.projectId ?? null}, ${data.activity}, ${data.hazard}, ${data.likelihood}, ${data.consequence}, ${data.controls ?? null},
              ${data.residualScore ?? null}, ${data.owner ?? null}, ${data.reviewDate ?? null}::date, ${context.userId})`;
    return { success: true };
  });

export const setRiskAssessmentStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.number().int(), status: z.enum(["Open", "Controlled", "Closed"]) }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "hira.manage");
    await sql`update risk_assessments set status = ${data.status}, updated_at = now() where id = ${data.id} and organization_id = ${profile.organizationId}`;
    return { success: true };
  });

// ============================================
// SUBCONTRACTOR PRE-QUALIFICATION
// ============================================

export const listSubcontractors = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "subcontractors.manage");
    const rows = await sql<{ id: number; company_name: string; contact_name: string | null; contact_phone: string | null; contact_email: string | null; company_size: string; industry: string; job_types: string[]; status: string; valid_until: string | null; decision_note: string | null; documents: unknown }>`
      select id, company_name, contact_name, contact_phone, contact_email, company_size, industry, job_types, status, valid_until::text as valid_until, decision_note, documents
      from subcontractors where organization_id = ${profile.organizationId}
      order by case status when 'Pending' then 0 when 'Approved' then 1 else 2 end, company_name`;
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id, companyName: r.company_name, contactName: r.contact_name, contactPhone: r.contact_phone, contactEmail: r.contact_email, companySize: r.company_size,
      industry: r.industry, jobTypes: r.job_types, status: r.status === "Approved" && r.valid_until && new Date(r.valid_until).getTime() < now ? "Expired" : r.status,
      validUntil: r.valid_until, decisionNote: r.decision_note, documents: (Array.isArray(r.documents) ? r.documents : []) as { name: string; expires?: string }[],
    }));
  });

export const registerSubcontractor = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      companyName: z.string().min(2).max(160),
      contactName: z.string().max(120).optional(), contactPhone: z.string().max(40).optional(), contactEmail: z.string().email().optional().or(z.literal("")),
      companySize: z.enum(["Micro", "Small", "Medium", "Large"]).default("Small"),
      industry: z.string().max(80).default("Telecom"),
      jobTypes: z.array(z.string().max(80)).min(1).max(12),
      documents: z.array(z.object({ name: z.string().max(160), expires: dateStr.optional() })).max(20).default([]),
    }).parse(input),
  )
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "subcontractors.manage");
    await sql`insert into subcontractors (organization_id, company_name, contact_name, contact_phone, contact_email, company_size, industry, job_types, documents, created_by)
      values (${profile.organizationId}, ${data.companyName}, ${data.contactName ?? null}, ${data.contactPhone ?? null}, ${data.contactEmail || null}, ${data.companySize}, ${data.industry},
              ${data.jobTypes}::text[], ${JSON.stringify(data.documents)}::jsonb, ${context.userId})`;
    return { success: true };
  });

export const decideSubcontractor = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ id: z.number().int(), decision: z.enum(["Approved", "Rejected"]), validUntil: dateStr.optional(), note: z.string().max(500).optional() }).parse(input),
  )
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "subcontractors.manage");
    if (data.decision === "Approved" && !data.validUntil) throw new Error("Set the date the clearance expires");
    if (data.decision === "Rejected" && !data.note?.trim()) throw new Error("Give a reason for rejecting");
    const rows = await sql`update subcontractors set status = ${data.decision}, decided_by = ${context.userId}, decided_at = now(), valid_until = ${data.validUntil ?? null}::date,
        decision_note = ${data.note ?? null}, updated_at = now() where id = ${data.id} and organization_id = ${profile.organizationId} returning id`;
    if (!rows[0]) throw new Error("Subcontractor not found");
    await audit(sql, profile.organizationId, context.userId, data.decision.toLowerCase(), "subcontractor", data.id);
    return { success: true };
  });

// ============================================
// PROJECT HEALTH (which sites could be stopped by a client?)
// ============================================

export const getProjectHealth = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const profile = await requireProfile(context.userId);
    if (!canAny(profile, ["projects.manage", "management.view", "ehs.view_org"])) throw new Error("You cannot view project health");
    return loadProjectHealth(profile);
  });

export const loadProjectHealth = createServerOnlyFn(async (profile: Profile & { organizationId: string }) => {
  const sql = await getSql();
  const rows = await sql<{
    id: number; name: string; status: string; budget: string | number; paid: string | number; pending_requests: number;
    open_ncr: number; critical_ncr: number; major_ncr: number; open_incidents: number; high_incidents: number; hazards: number;
  }>`select p.id, p.name, p.status, p.budget,
      (select coalesce(sum(amount),0) from finance_requests f where f.project_id = p.id and f.organization_id = p.organization_id and f.status = 'Paid') as paid,
      (select count(*)::int from finance_requests f where f.project_id = p.id and f.organization_id = p.organization_id and f.status in ('Submitted','Under Review')) as pending_requests,
      (select count(*)::int from ncrs n where n.project_id = p.id and n.status <> 'Closed') as open_ncr,
      (select count(*)::int from ncrs n where n.project_id = p.id and n.status <> 'Closed' and n.severity = 'Critical') as critical_ncr,
      (select count(*)::int from ncrs n where n.project_id = p.id and n.status <> 'Closed' and n.severity = 'Major') as major_ncr,
      (select count(*)::int from incidents i where i.project_id = p.id and i.status not in ('Closed','Resolved')) as open_incidents,
      (select count(*)::int from incidents i where i.project_id = p.id and i.status not in ('Closed','Resolved') and i.severity = 'High') as high_incidents,
      (select count(*)::int from risk_assessments r where r.project_id = p.id and r.status = 'Open' and r.risk_score >= 15) as hazards
    from projects p where p.organization_id = ${profile.organizationId} and p.status in ('Planning','Active','On Hold') order by p.name`;
  return rows.map((r) => {
    const budget = num(r.budget);
    const paid = num(r.paid);
    const stopRisk = r.critical_ncr > 0 || r.high_incidents > 0;
    const watch = r.major_ncr > 0 || r.hazards > 0 || (budget > 0 && paid / budget > 0.9);
    return {
      projectId: r.id, name: r.name, status: r.status, budget, paid, utilization: budget > 0 ? Math.round((paid / budget) * 100) : 0,
      pendingRequests: r.pending_requests, openNcr: r.open_ncr, criticalNcr: r.critical_ncr, openIncidents: r.open_incidents, highRiskHazards: r.hazards,
      health: (stopRisk ? "Stop-work risk" : watch ? "Watch" : "Healthy") as "Stop-work risk" | "Watch" | "Healthy",
    };
  });
});
