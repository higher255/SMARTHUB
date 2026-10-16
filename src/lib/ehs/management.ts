import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db.server";
import { can } from "./access";
import { requirePermission } from "./core";
import { computeSafetyMetrics, loadProjectHealth } from "./hse";

const num = (v: unknown) => Number(v ?? 0);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** One call that powers the management dashboard: money, projects, safety, people and what needs the caller's decision. */
export const getManagementOverview = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "management.view", "You cannot open the management dashboard");
    const org = profile.organizationId;
    const now = new Date();
    const today = iso(now);
    const yearStart = `${now.getFullYear()}-01-01`;
    const monthStart = iso(new Date(now.getFullYear(), now.getMonth(), 1));
    const yearAgo = iso(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()));

    const brand = await sql<{ currency: string; name: string }>`select currency, coalesce(display_name, name) as name from organizations where id = ${org}`;

    // ---- requests pipeline (always visible to management)
    const pipeline = await sql<Record<string, string | number>>`select
        0::int as awaiting_endorse,
        count(*) filter (where status in ('Submitted','Under Review'))::int as awaiting_approval,
        count(*) filter (where status = 'Approved')::int as awaiting_payment,
        coalesce(sum(amount) filter (where status in ('Submitted','Under Review')),0) as pending_amount,
        coalesce(sum(amount) filter (where status = 'Approved'),0) as approved_amount,
        coalesce(sum(amount) filter (where status = 'Paid' and paid_at >= ${monthStart}::date),0) as paid_this_month
      from finance_requests where organization_id = ${org}`;

    // ---- books
    let books: null | {
      incomeYtd: number; expenseYtd: number; profitYtd: number; incomeMonth: number; expenseMonth: number; cash: number; receivables: number; overdueReceivables: number; balanced: boolean;
    } = null;
    if (can(profile, "accounts.reports")) {
      const ytd = await sql<{ type: string; amount: string | number }>`select type, amount from acct_income_statement(${org}, ${yearStart}::date, ${today}::date)`;
      const mon = await sql<{ type: string; amount: string | number }>`select type, amount from acct_income_statement(${org}, ${monthStart}::date, ${today}::date)`;
      const tb = await sql<{ code: string; balance_dr: string | number; balance_cr: string | number }>`select code, balance_dr, balance_cr from acct_trial_balance(${org}, ${today}::date)`;
      const sumType = (rows: { type: string; amount: string | number }[], t: string) => rows.filter((r) => r.type === t).reduce((s, r) => s + num(r.amount), 0);
      const bal = (code: string) => { const r = tb.find((x) => x.code === code); return r ? num(r.balance_dr) - num(r.balance_cr) : 0; };
      const od = await sql<{ t: string | number }>`select coalesce(sum(total - amount_paid),0) as t from finance_invoices
        where organization_id = ${org} and status in ('Issued','Partially Paid') and coalesce(due_date, issue_date) < current_date`;
      books = {
        incomeYtd: sumType(ytd, "Income"), expenseYtd: sumType(ytd, "Expense"), profitYtd: sumType(ytd, "Income") - sumType(ytd, "Expense"),
        incomeMonth: sumType(mon, "Income"), expenseMonth: sumType(mon, "Expense"), cash: bal("1000") + bal("1010"), receivables: bal("1100"),
        overdueReceivables: num(od[0]?.t),
        balanced: Math.round(tb.reduce((s, r) => s + num(r.balance_dr), 0) * 100) === Math.round(tb.reduce((s, r) => s + num(r.balance_cr), 0) * 100),
      };
    }

    // ---- projects, safety
    const projects = await loadProjectHealth(profile);
    const safety = await computeSafetyMetrics(org, yearAgo, today);

    // ---- people and readiness
    const people = await sql<{ role: string; c: number }>`select role, count(*)::int as c from profiles where organization_id = ${org} and status = 'active' group by role order by c desc`;
    const certs = await sql<{ expired: number; expiring: number }>`select
        count(*) filter (where expires_at < current_date)::int as expired,
        count(*) filter (where expires_at >= current_date and expires_at <= current_date + 30)::int as expiring
      from certificates where organization_id = ${org}`;
    const permits = await sql<{ c: number }>`select count(*)::int as c from permits where organization_id = ${org} and status = 'Pending'`;
    const subs = await sql<{ c: number }>`select count(*)::int as c from subcontractors where organization_id = ${org} and status = 'Pending'`;

    // ---- decisions waiting on this person
    const p = pipeline[0]!;
    const inbox: { key: string; label: string; count: number; link: string }[] = [];
    if (can(profile, "finance.approve") && num(p.awaiting_approval) > 0) inbox.push({ key: "approve", label: "Finance requests to approve", count: num(p.awaiting_approval), link: "/finance" });
    if (can(profile, "finance.pay") && num(p.awaiting_payment) > 0) inbox.push({ key: "pay", label: "Approved requests to pay", count: num(p.awaiting_payment), link: "/finance" });
    if (can(profile, "permits.approve") && (permits[0]?.c ?? 0) > 0) inbox.push({ key: "permits", label: "Permits to work to approve", count: permits[0]!.c, link: "/ehs" });
    if (can(profile, "subcontractors.manage") && (subs[0]?.c ?? 0) > 0) inbox.push({ key: "subs", label: "Subcontractors to pre-qualify", count: subs[0]!.c, link: "/ehs" });
    if (safety.openCriticalNcr > 0) inbox.push({ key: "ncr", label: "Critical NCRs still open", count: safety.openCriticalNcr, link: "/ehs" });

    const activity = await sql<{ id: number; action: string; entity_type: string; entity_id: string | null; created_at: string; actor: string | null }>`
      select a.id, a.action, a.entity_type, a.entity_id, a.created_at, p.full_name as actor
      from audit_log a left join profiles p on p.user_id = a.actor_id
      where a.organization_id = ${org} order by a.created_at desc limit 12`;

    return {
      company: brand[0]?.name ?? "",
      currency: brand[0]?.currency ?? "TZS",
      pipeline: {
        awaitingEndorse: num(p.awaiting_endorse), awaitingApproval: num(p.awaiting_approval), awaitingPayment: num(p.awaiting_payment),
        pendingAmount: num(p.pending_amount), approvedAmount: num(p.approved_amount), paidThisMonth: num(p.paid_this_month),
      },
      books,
      projects,
      safety,
      people: { headcount: people.reduce((s, r) => s + r.c, 0), byRole: people.map((r) => ({ role: r.role, count: r.c })), certsExpired: certs[0]?.expired ?? 0, certsExpiring: certs[0]?.expiring ?? 0 },
      inbox,
      activity: activity.map((a) => ({ id: a.id, action: a.action, entity: a.entity_type, entityId: a.entity_id, at: a.created_at, actor: a.actor ?? "System" })),
    };
  });
