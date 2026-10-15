import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { workdayMiddleware } from "@/lib/auth/workday-middleware";
import { getSql } from "@/lib/db.server";
import { can } from "./access";
import { audit, notify, requirePermission, requireProfile, usersWithPermission } from "./core";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const category = z.enum(["Unsafe act", "Unsafe condition", "Near miss", "Good practice", "Environmental"]);
const severity = z.enum(["Low", "Medium", "High", "Critical"]);

export type SafetyObservation = {
  id: number; projectId: number | null; projectName: string | null; category: z.infer<typeof category>;
  severity: z.infer<typeof severity>; title: string; description: string; location: string; anonymous: boolean;
  immediateAction: string | null; status: string; assignedTo: string | null; dueDate: string | null;
  closureNote: string | null; createdAt: string; reporterLabel: string;
};

export const listSafetyAssignees = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "ehs.manage");
    const rows = await sql<{ user_id: string; full_name: string; role: string }>`select user_id, full_name, role from profiles
      where organization_id=${profile.organizationId} and status='active' and user_id<>${context.userId}
      order by full_name limit 300`;
    return rows.map((r) => ({ userId: r.user_id, fullName: r.full_name, role: r.role }));
  });

export const listSafetyObservations = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requireProfile(context.userId);
    const orgWide = can(profile, "ehs.view_org") || can(profile, "ehs.manage");
    const teamLead = profile.role === "Team_Leader" || can(profile, "teamleader.dashboard");
    const rows = await sql<{
      id: number; project_id: number | null; project_name: string | null; category: string; severity: string;
      title: string; description: string; location: string; anonymous: boolean; immediate_action: string | null;
      status: string; assigned_to: string | null; due_date: string | null; closure_note: string | null;
      created_at: string; reporter_id: string; reporter_name: string | null;
    }>`select o.id, o.project_id, p.name as project_name, o.category, o.severity, o.title, o.description,
        o.location, o.anonymous, o.immediate_action, o.status, o.assigned_to, o.due_date::text as due_date,
        o.closure_note, o.created_at::text as created_at, o.reporter_id, pr.full_name as reporter_name
      from safety_observations o left join projects p on p.id=o.project_id and p.organization_id=o.organization_id
      left join profiles pr on pr.user_id=o.reporter_id and pr.organization_id=o.organization_id
      where o.organization_id=${profile.organizationId}
        and (${orgWide} or o.reporter_id=${context.userId}
          or (${teamLead} and o.project_id in (select pm.project_id from project_members pm where pm.user_id=${context.userId} and pm.status='Accepted')))
      order by case o.severity when 'Critical' then 0 when 'High' then 1 when 'Medium' then 2 else 3 end, o.created_at desc limit 200`;
    return rows.map((r) => ({
      id: Number(r.id), projectId: r.project_id, projectName: r.project_name, category: r.category as SafetyObservation["category"],
      severity: r.severity as SafetyObservation["severity"], title: r.title, description: r.description, location: r.location,
      anonymous: r.anonymous, immediateAction: r.immediate_action, status: r.status, assignedTo: r.assigned_to,
      dueDate: r.due_date, closureNote: r.closure_note, createdAt: r.created_at,
      reporterLabel: r.anonymous ? "Anonymous reporter" : r.reporter_name ?? "Team member",
    } satisfies SafetyObservation));
  });

export type ObservationSummary = {
  total: number; open: number; critical: number; closedThisMonth: number;
  byCategory: { category: string; count: number }[];
  monthly: { month: string; count: number }[];
};

export const getObservationSummary = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requireProfile(context.userId);
    if (!can(profile, "ehs.view_org") && !can(profile, "ehs.manage")) throw new Error("You cannot view company observation analytics");
    const [totals, categories, monthly] = await Promise.all([
      sql<{ total: number; open: number; critical: number; closed_this_month: number }>`select count(*)::int total,
        count(*) filter (where status<>'Closed')::int open,
        count(*) filter (where severity in ('High','Critical') and status<>'Closed')::int critical,
        count(*) filter (where status='Closed' and closed_at>=date_trunc('month',current_date))::int closed_this_month
        from safety_observations where organization_id=${profile.organizationId}`,
      sql<{ category: string; count: number }>`select category,count(*)::int count from safety_observations
        where organization_id=${profile.organizationId} and created_at>=current_date-interval '90 days'
        group by category order by count desc,category`,
      sql<{ month: string; count: number }>`with months as (
        select date_trunc('month',current_date)-make_interval(months=>n) as start from generate_series(5,0,-1) n
      ) select to_char(months.start,'YYYY-MM') month,count(o.id)::int count from months
        left join safety_observations o on o.organization_id=${profile.organizationId} and o.created_at>=months.start
          and o.created_at<months.start+interval '1 month' group by months.start order by months.start`,
    ]);
    const row = totals[0];
    return { total: row?.total ?? 0, open: row?.open ?? 0, critical: row?.critical ?? 0,
      closedThisMonth: row?.closed_this_month ?? 0, byCategory: categories, monthly } satisfies ObservationSummary;
  });

export const createSafetyObservation = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({
    projectId: z.number().int().positive().optional(), category, severity,
    title: z.string().trim().min(3).max(160), description: z.string().trim().min(3).max(2000),
    location: z.string().trim().min(1).max(160), anonymous: z.boolean().default(false),
    immediateAction: z.string().trim().max(1000).optional(),
  }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "ehs.report");
    if (data.projectId) {
      const project = await sql`select 1 from projects where id=${data.projectId} and organization_id=${profile.organizationId}`;
      if (!project[0]) throw new Error("Choose a project from your company");
    }
    const rows = await sql<{ id: number }>`insert into safety_observations
      (organization_id, project_id, reporter_id, category, severity, title, description, location, anonymous, immediate_action)
      values (${profile.organizationId}, ${data.projectId ?? null}, ${context.userId}, ${data.category}, ${data.severity},
        ${data.title}, ${data.description}, ${data.location}, ${data.anonymous}, ${data.immediateAction || null}) returning id`;
    const recipients = await usersWithPermission(sql, profile.organizationId, "ehs.manage");
    await notify(sql, { organizationId: profile.organizationId, userIds: recipients, title: `Safety observation · ${data.severity}`,
      message: `${data.category} at ${data.location}: ${data.title}`, type: "safety_observation", link: "/ehs",
      entityType: "safety_observation", entityId: String(rows[0]!.id) });
    await audit(sql, profile.organizationId, context.userId, "create", "safety_observation", rows[0]!.id, { category: data.category, severity: data.severity });
    return { id: Number(rows[0]!.id) };
  });

export const updateSafetyObservation = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({
    id: z.number().int().positive(), status: z.enum(["Under Review", "Action Required", "Closed"]),
    assignedTo: z.string().min(1).max(100).optional(), dueDate: day.optional(), closureNote: z.string().trim().max(1000).optional(),
  }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "ehs.manage", "Only the company admin or EHS team can manage observations");
    if (data.assignedTo) {
      const assignee = await sql`select 1 from profiles where user_id=${data.assignedTo} and organization_id=${profile.organizationId} and status='active'`;
      if (!assignee[0]) throw new Error("Choose an active user from your company");
    }
    if (data.status === "Closed" && !data.closureNote?.trim()) throw new Error("Add a short closure note before closing this observation");
    const rows = await sql<{ id: number; reporter_id: string }>`update safety_observations set status=${data.status},
      assigned_to=coalesce(${data.assignedTo ?? null},assigned_to), due_date=coalesce(${data.dueDate ?? null}::date,due_date),
      closure_note=case when ${data.status}='Closed' then ${data.closureNote ?? null} else closure_note end,
      closed_by=case when ${data.status}='Closed' then ${context.userId} else null end,
      closed_at=case when ${data.status}='Closed' then now() else null end, updated_at=now()
      where id=${data.id} and organization_id=${profile.organizationId} returning id,reporter_id`;
    if (!rows[0]) throw new Error("Observation not found");
    await notify(sql, { organizationId: profile.organizationId, userIds: [rows[0].reporter_id, ...(data.assignedTo ? [data.assignedTo] : [])],
      title: `Observation ${data.status.toLowerCase()}`, message: `Your safety observation has been updated: ${data.status}.`,
      type: "safety_observation", link: "/dashboard", entityType: "safety_observation", entityId: String(data.id) });
    await audit(sql, profile.organizationId, context.userId, "update", "safety_observation", data.id, { status: data.status });
    return { success: true };
  });

export type WellbeingChallenge = { id: number; title: string; description: string; startsOn: string; endsOn: string; dailyStepGoal: number; status: string; participantCount: number; totalSteps: number; mySteps: number; myTodaySteps: number };

export const listWellbeingChallenges = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requireProfile(context.userId);
    const rows = await sql<{ id: number; title: string; description: string; starts_on: string; ends_on: string; daily_step_goal: number; status: string; participants: number; total_steps: string | number; mine: string | number; today: number }>`select c.id,c.title,c.description,c.starts_on::text,c.ends_on::text,c.daily_step_goal,c.status,
      (select count(distinct e.user_id)::int from wellbeing_challenge_entries e where e.challenge_id=c.id) participants,
      (select case when count(distinct e.user_id)>=3 then coalesce(sum(e.steps),0) else 0 end from wellbeing_challenge_entries e where e.challenge_id=c.id) total_steps,
      (select coalesce(sum(e.steps),0) from wellbeing_challenge_entries e where e.challenge_id=c.id and e.user_id=${context.userId}) mine,
      (select coalesce(sum(e.steps),0)::int from wellbeing_challenge_entries e where e.challenge_id=c.id and e.user_id=${context.userId} and e.entry_date=current_date) today
      from wellbeing_challenges c where c.organization_id=${profile.organizationId} and c.status<>'Cancelled'
      order by case c.status when 'Active' then 0 else 1 end,c.starts_on desc limit 30`;
    return rows.map((r) => ({ id: Number(r.id), title: r.title, description: r.description, startsOn: r.starts_on,
      endsOn: r.ends_on, dailyStepGoal: r.daily_step_goal, status: r.status, participantCount: r.participants,
      totalSteps: Number(r.total_steps), mySteps: Number(r.mine), myTodaySteps: r.today } satisfies WellbeingChallenge));
  });

export const createWellbeingChallenge = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ title: z.string().trim().min(3).max(100), description: z.string().trim().max(500).default(""),
    startsOn: day, endsOn: day, dailyStepGoal: z.number().int().min(1000).max(50000).default(6000) }).refine((x) => x.endsOn >= x.startsOn, "End date must be on or after start date").parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "wellbeing.manage");
    const rows = await sql<{ id: number }>`insert into wellbeing_challenges (organization_id,title,description,starts_on,ends_on,daily_step_goal,created_by)
      values (${profile.organizationId},${data.title},${data.description},${data.startsOn}::date,${data.endsOn}::date,${data.dailyStepGoal},${context.userId}) returning id`;
    const recipients = await sql<{ user_id: string }>`select user_id from profiles where organization_id=${profile.organizationId} and status='active' and user_id<>${context.userId}`;
    await notify(sql, { organizationId: profile.organizationId, userIds: recipients.map((r) => r.user_id),
      title: "New wellbeing challenge", message: `${data.title} starts ${data.startsOn}. Daily goal: ${data.dailyStepGoal.toLocaleString()} steps.`,
      type: "wellbeing", link: "/dashboard", entityType: "wellbeing_challenge", entityId: rows[0]!.id });
    await audit(sql, profile.organizationId, context.userId, "create", "wellbeing_challenge", rows[0]!.id, { title: data.title });
    return { id: Number(rows[0]!.id) };
  });

export const setWellbeingChallengeStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.number().int().positive(), status: z.enum(["Completed", "Cancelled"]) }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "wellbeing.manage");
    const rows = await sql`update wellbeing_challenges set status=${data.status} where id=${data.id} and organization_id=${profile.organizationId} returning id`;
    if (!rows[0]) throw new Error("Challenge not found");
    await audit(sql, profile.organizationId, context.userId, "update", "wellbeing_challenge", data.id, { status: data.status });
    return { success: true };
  });

export const logWellbeingSteps = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ challengeId: z.number().int().positive(), entryDate: day, steps: z.number().int().min(0).max(100000) }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "ehs.report");
    if (data.entryDate > new Date().toISOString().slice(0, 10)) throw new Error("You cannot log steps for a future date");
    const challenge = await sql`select id from wellbeing_challenges where id=${data.challengeId} and organization_id=${profile.organizationId} and status='Active' and ${data.entryDate}::date between starts_on and ends_on`;
    if (!challenge[0]) throw new Error("This challenge is not active for that date");
    await sql`insert into wellbeing_challenge_entries (organization_id,challenge_id,user_id,entry_date,steps) values
      (${profile.organizationId},${data.challengeId},${context.userId},${data.entryDate}::date,${data.steps})
      on conflict (challenge_id,user_id,entry_date) do update set steps=excluded.steps,updated_at=now()`;
    return { success: true };
  });
