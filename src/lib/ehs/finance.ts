import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { workdayMiddleware } from "@/lib/auth/workday-middleware";
import { getSql } from "@/lib/db.server";
import { can } from "./access";
import {
  audit,
  getUserFullName,
  notify,
  requirePermission,
  requireProfile,
  usersWithPermission,
} from "./core";

// ============================================
// TYPES
// ============================================

export type FinanceRequestStatus = "Draft" | "Submitted" | "Under Review" | "Approved" | "Rejected" | "Paid" | "Cancelled";

export type FinanceRequest = {
  id: number;
  projectId: number | null;
  userId: string;
  requestNumber: string;
  title: string;
  description: string | null;
  category: "Material" | "Equipment" | "Labor" | "Transport" | "Other";
  amount: number;
  currency: string;
  status: FinanceRequestStatus;
  priority: "Low" | "Medium" | "High" | "Critical";
  requestedBy: string;
  requestedAt: string;
  requiresManager: boolean;
  overBudget: boolean;
  endorsedBy: string | null;
  endorsedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedReason: string | null;
  paidBy: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  paymentMethod: string | null;
  notes: string | null;
  attachments: string[] | null;
  createdAt: string;
  updatedAt: string;
};

export type FinanceInvoice = {
  id: number;
  invoiceNumber: string;
  customerName: string;
  customerId: number | null;
  description: string;
  currency: string;
  status: string;
  issueDate: string;
  dueDate: string | null;
  projectId: number | null;
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  amountPaid: number;
  /** Kept for older screens: equals total. */
  amount: number;
  notes: string | null;
};
export type InvoiceLine = { id: number; position: number; description: string; quantity: number; unitPrice: number; lineTotal: number };
export type PaymentRow = { id: number; kind: string; receiptNo: string | null; amount: number; payDate: string; method: string; reference: string | null; partyName: string | null };
export type InvoiceDetail = FinanceInvoice & { lines: InvoiceLine[]; payments: PaymentRow[]; customerTin: string | null; customerAddress: string | null };
export type PurchaseOrder = { id: number; poNumber: string; supplierName: string; description: string; amount: number; currency: string; status: string; issueDate: string; projectId: number | null };
export type FinanceBill = { id: number; billNumber: string; supplierInvoiceNumber: string | null; supplierName: string; supplierId: number | null; description: string; currency: string; status: string; issueDate: string; dueDate: string | null; projectId: number | null; subtotal: number; vatRate: number; vatAmount: number; total: number; amountPaid: number; notes: string | null };
export type BillLine = { id: number; position: number; description: string; quantity: number; unitPrice: number; accountCode: string; projectId: number | null };
export type BankReconciliationLine = { id: number; date: string; entryNo: string; memo: string; description: string | null; debit: number; credit: number; amount: number; selected: boolean };
export type Party = { id: number; kind: "customer" | "supplier"; name: string; tin: string | null; vrn: string | null; email: string | null; phone: string | null; address: string | null };
export type Account = { id: number; code: string; name: string; type: "Asset" | "Liability" | "Equity" | "Income" | "Expense"; isSystem: boolean; active: boolean };
export type TrialBalanceRow = { code: string; accountName: string; type: string; debit: number; credit: number; balanceDr: number; balanceCr: number };
export type JournalEntryRow = { id: number; entryNo: string; entryDate: string; memo: string; sourceType: string; status: string; total: number; createdBy: string };

const num = (v: unknown) => Number(v ?? 0);
const PAY_METHODS = ["Cash", "Bank", "M-Pesa", "Tigo Pesa", "Airtel Money", "Cheque"] as const;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const today = () => new Date().toISOString().slice(0, 10);

/** Turn a Postgres exception raised by our accounting functions into a clean message. */
function friendly(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(message.replace(/^error:\s*/i, ""));
}

// ============================================
// FINANCE REQUESTS (site staff -> endorse -> approve -> pay)
// ============================================

type RequestRow = {
  id: number; project_id: number | null; user_id: string; request_number: string; title: string; description: string | null;
  category: string; amount: string | number; currency: string; status: string; priority: string; requested_by: string;
  requested_at: string; requires_manager: boolean | null; over_budget: boolean | null; endorsed_by: string | null; endorsed_at: string | null;
  approved_by: string | null; approved_at: string | null; rejected_by: string | null; rejected_reason: string | null;
  paid_by: string | null; paid_at: string | null; payment_reference: string | null; payment_method: string | null;
  notes: string | null; attachments: string[] | null; created_at: string; updated_at: string;
};

const mapRequest = (r: RequestRow): FinanceRequest => ({
  id: r.id, projectId: r.project_id, userId: r.user_id, requestNumber: r.request_number, title: r.title,
  description: r.description, category: r.category as FinanceRequest["category"], amount: num(r.amount), currency: r.currency,
  status: r.status as FinanceRequestStatus, priority: r.priority as FinanceRequest["priority"], requestedBy: r.requested_by,
  requestedAt: r.requested_at, requiresManager: Boolean(r.requires_manager), overBudget: Boolean(r.over_budget), endorsedBy: r.endorsed_by, endorsedAt: r.endorsed_at,
  approvedBy: r.approved_by, approvedAt: r.approved_at, rejectedBy: r.rejected_by, rejectedReason: r.rejected_reason,
  paidBy: r.paid_by, paidAt: r.paid_at, paymentReference: r.payment_reference, paymentMethod: r.payment_method,
  notes: r.notes, attachments: r.attachments, createdAt: r.created_at, updatedAt: r.updated_at,
});

const money = (n: number, currency: string) => `${currency} ${Math.round(n).toLocaleString("en-US")}`;

export const createFinanceRequest = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      projectId: z.number().int().nullable().optional(),
      title: z.string().min(1).max(200),
      description: z.string().max(2000).optional(),
      category: z.enum(["Material", "Equipment", "Labor", "Transport", "Other"]),
      amount: z.number().positive().max(1_000_000_000_000),
      currency: z.enum(["TZS", "USD"]).optional(),
      priority: z.enum(["Low", "Medium", "High", "Critical"]).default("Medium"),
      notes: z.string().max(1000).optional(),
      attachments: z.array(z.string().max(500)).max(10).optional(),
    }).parse(input),
  )
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "finance.request", "You cannot submit finance requests");
    if (profile.role === "Finance" || profile.department.trim().toLowerCase() === "finance") {
      throw new Error("Finance users receive and process requests in the Finance workspace");
    }
    const project = data.projectId == null ? [] : await sql<{ id: number; name: string; user_id: string }>`
      select id, name, user_id from projects where id = ${data.projectId} and organization_id = ${profile.organizationId}`;
    if (data.projectId != null && !project[0]) throw new Error("Choose a project from your company");
    const projectName = project[0]?.name ?? "Company / office";
    const org = await sql<{ currency: string }>`
      select currency from organizations where id = ${profile.organizationId}`;
    const currency = data.currency ?? org[0]?.currency ?? "TZS";

    // Budget check: category allocation if one is set, otherwise the project's total budget.
    const bud = data.projectId == null ? [{ alloc: null, committed: 0, total: 0, total_committed: 0 }] : await sql<{ alloc: string | number | null; committed: string | number; total: string | number; total_committed: string | number }>`
      select (select amount from project_budgets where project_id = ${data.projectId} and category = ${data.category}) as alloc,
             (select coalesce(sum(amount),0) from finance_requests where project_id = ${data.projectId} and category = ${data.category}
                and status in ('Submitted','Under Review','Approved','Paid')) as committed,
             (select coalesce(budget,0) from projects where id = ${data.projectId}) as total,
             (select coalesce(sum(amount),0) from finance_requests where project_id = ${data.projectId}
                and status in ('Submitted','Under Review','Approved','Paid')) as total_committed`;
    const b = bud[0]!;
    const overBy = b.alloc != null
      ? num(b.committed) + data.amount - num(b.alloc)
      : num(b.total) > 0 ? num(b.total_committed) + data.amount - num(b.total) : 0;
    const overBudget = overBy > 0;
    const requiresManager = false;
    const name = getUserFullName(profile);

    const rows = await sql<{ id: number; request_number: string }>`
      insert into finance_requests (project_id, user_id, organization_id, request_number, title, description, category, amount, currency,
                                    priority, status, requested_by, notes, attachments, requires_manager, over_budget)
      values (${data.projectId ?? null}, ${context.userId}, ${profile.organizationId}, acct_next_no(${profile.organizationId}, 'FR', 'FR'),
              ${data.title}, ${data.description ?? null}, ${data.category}, ${data.amount}, ${currency}, ${data.priority}, 'Submitted',
              ${name}, ${data.notes ?? null}, ${data.attachments ?? null}, ${requiresManager}, ${overBudget})
      returning id, request_number`;
    const created = rows[0]!;

    const approvers = await usersWithPermission(sql, profile.organizationId, "finance.approve");
    const summary = `${name} requested ${money(data.amount, currency)} for ${projectName}: ${data.title}`;
    await notify(sql, {
      organizationId: profile.organizationId,
      userIds: approvers.filter((id) => id !== context.userId),
      title: `${created.request_number} needs approval` + (overBudget ? " (over budget)" : ""),
      message: overBudget ? `${summary}. Over budget by ${money(overBy, currency)}.` : summary, type: "finance_request", link: `/finance?request=${created.id}`, entityType: "finance_request", entityId: created.id,
    });
    const requesterNotice = await notify(sql, {
      organizationId: profile.organizationId, userIds: [context.userId],
      title: `${created.request_number} submitted`,
      message: "Your request was sent directly to Finance for approval.",
      type: "finance_request", link: "/requests", entityType: "finance_request", entityId: created.id,
    });
    if (project[0] && project[0].user_id !== context.userId && !approvers.includes(project[0].user_id)) {
      await notify(sql, {
        organizationId: profile.organizationId, userIds: [project[0].user_id],
        title: `Money requested on ${project[0].name}`, message: summary, type: "finance_request", link: "/projectmanager",
        entityType: "finance_request", entityId: created.id,
      });
    }
    await audit(sql, profile.organizationId, context.userId, "create", "finance_request", created.id, { amount: data.amount });
    return { success: true, requestId: created.id, requestNumber: created.request_number, requiresManager: false, overBudget, emailStatus: requesterNotice.emailStatus };
  });

export const listFinanceRequests = createServerFn({ method: "GET" })
  .validator((input: unknown) =>
    z.object({
      projectId: z.number().int().optional(),
      status: z.enum(["Draft", "Submitted", "Under Review", "Approved", "Rejected", "Paid", "Cancelled"]).optional(),
      fromDate: dateStr.optional(),
      toDate: dateStr.optional(),
      mine: z.boolean().optional(),
    }).optional().parse(input),
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requireProfile(context.userId);
    const where: string[] = ["organization_id = $1"];
    const params: unknown[] = [profile.organizationId];
    const add = (cond: string, value: unknown) => { params.push(value); where.push(cond.replace("?", `$${params.length}`)); };
    const canReviewCompanyRequests = can(profile, "finance.approve") || can(profile, "finance.pay");
    if ((!can(profile, "finance.view") && !canReviewCompanyRequests) || data?.mine) add("user_id = ?", context.userId);
    if (data?.projectId) add("project_id = ?", data.projectId);
    if (data?.status) add("status = ?", data.status);
    if (data?.fromDate) add("created_at >= ?::date", data.fromDate);
    if (data?.toDate) add("created_at < (?::date + 1)", data.toDate);
    const rows = await sql.query<RequestRow>(`select * from finance_requests where ${where.join(" and ")} order by created_at desc limit 500`, params);
    return rows.map(mapRequest);
  });

export const getFinanceRequestById = createServerFn({ method: "GET" })
  .validator((id: number) => id)
  .middleware([authMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const profile = await requireProfile(context.userId);
    const rows = await sql<RequestRow>`select * from finance_requests where id = ${id} and organization_id = ${profile.organizationId}`;
    const r = rows[0];
    if (!r) throw new Error("Finance request not found");
    if (!can(profile, "finance.view") && r.user_id !== context.userId) throw new Error("You don't have permission to view this request");
    return mapRequest(r);
  });

async function loadRequestForUpdate(orgId: string, id: number) {
  const sql = await getSql();
  const rows = await sql<RequestRow>`select * from finance_requests where id = ${id} and organization_id = ${orgId}`;
  if (!rows[0]) throw new Error("Finance request not found");
  return { sql, r: rows[0] };
}

export const endorseFinanceRequest = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.number().int(), notes: z.string().max(500).optional() }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async () => {
    throw new Error("Management endorsement has been removed. Finance requests go directly to Finance for approval.");
  });

export const approveFinanceRequest = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.number().int(), notes: z.string().max(500).optional() }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requirePermission(context.userId, "finance.approve", "Only the finance team can approve requests");
    const { sql, r } = await loadRequestForUpdate(profile.organizationId, data.id);
    if (r.user_id === context.userId) throw new Error("You cannot approve your own request");
    const ready = r.status === "Under Review" || r.status === "Submitted";
    if (!ready) {
      throw new Error(`This request is ${r.status} and cannot be approved`);
    }
    const name = getUserFullName(profile);
    const payable = await sql<{ bill_id: number; bill_number: string }>`select * from fin_request_approve(${r.id}, ${profile.organizationId}, ${context.userId}, ${name})`;
    if (!payable[0]) throw new Error("This request was just updated by someone else. Refresh and try again.");
    const requesterNotice = await notify(sql, {
      organizationId: profile.organizationId, userIds: [r.user_id], title: `${r.request_number} approved`,
      message: `${name} approved ${money(num(r.amount), r.currency)} for "${r.title}". Payable ${payable[0].bill_number} is now in Bills & Payables for payment.`, type: "finance_approved",
      link: "/requests", entityType: "finance_request", entityId: r.id,
    });
    const payers = await usersWithPermission(sql, profile.organizationId, "finance.pay");
    await notify(sql, {
      organizationId: profile.organizationId, userIds: payers.filter((id) => id !== context.userId), title: `${r.request_number} ready to pay`,
      message: `${money(num(r.amount), r.currency)} to ${r.requested_by}: ${r.title}`, type: "finance_request", link: `/finance?request=${r.id}`,
      entityType: "finance_request", entityId: r.id,
    });
    await audit(sql, profile.organizationId, context.userId, "approve", "finance_request", r.id);
    return { success: true, message: `Finance request approved and payable ${payable[0].bill_number} created`, billNumber: payable[0].bill_number, emailStatus: requesterNotice.emailStatus };
  });

export const rejectFinanceRequest = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.number().int(), reason: z.string().min(1).max(500) }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requireProfile(context.userId);
    if (!can(profile, "finance.approve")) throw new Error("Only Finance can reject finance requests");
    const { sql, r } = await loadRequestForUpdate(profile.organizationId, data.id);
    if (!["Submitted", "Under Review", "Approved"].includes(r.status)) throw new Error(`This request is ${r.status} and cannot be rejected`);
    const name = getUserFullName(profile);
    const updated = await sql`update finance_requests set status = 'Rejected', rejected_by = ${name}, rejected_reason = ${data.reason},
        notes = ${data.reason}, updated_at = now()
      where id = ${r.id} and organization_id = ${profile.organizationId} and status = ${r.status} returning id`;
    if (!updated[0]) throw new Error("This request was just updated by someone else. Refresh and try again.");
    const requesterNotice = await notify(sql, {
      organizationId: profile.organizationId, userIds: [r.user_id], title: `${r.request_number} rejected`,
      message: `${name} rejected "${r.title}". Reason: ${data.reason}`, type: "finance_rejected", link: "/requests",
      entityType: "finance_request", entityId: r.id,
    });
    await audit(sql, profile.organizationId, context.userId, "reject", "finance_request", r.id, { reason: data.reason });
    return { success: true, message: "Finance request rejected", emailStatus: requesterNotice.emailStatus };
  });

export const cancelFinanceRequest = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data: id }) => {
    const profile = await requireProfile(context.userId);
    const { sql, r } = await loadRequestForUpdate(profile.organizationId, id);
    if (r.user_id !== context.userId) throw new Error("Only the person who made the request can cancel it");
    if (!["Draft", "Submitted"].includes(r.status)) throw new Error(`This request is ${r.status} and can no longer be cancelled`);
    await sql`update finance_requests set status = 'Cancelled', updated_at = now() where id = ${r.id} and status = ${r.status}`;
    return { success: true };
  });

export const markFinanceRequestPaid = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      id: z.number().int(),
      paymentReference: z.string().min(1).max(120),
      paymentMethod: z.enum(PAY_METHODS).default("Cash"),
      paymentDate: dateStr.optional(),
      notes: z.string().max(500).optional(),
    }).parse(input),
  )
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requirePermission(context.userId, "finance.pay", "Only the finance team can record payments");
    const { sql, r } = await loadRequestForUpdate(profile.organizationId, data.id);
    if (r.user_id === context.userId) throw new Error("You cannot pay out your own request");
    try {
      await sql`select fin_request_pay(${r.id}, ${profile.organizationId}, ${context.userId}, ${getUserFullName(profile)}, ${data.paymentReference}, ${data.paymentMethod}, ${data.paymentDate ?? null}::date)`;
    } catch (error) {
      throw friendly(error);
    }
    const requesterNotice = await notify(sql, {
      organizationId: profile.organizationId, userIds: [r.user_id], title: `${r.request_number} paid`,
      message: `${money(num(r.amount), r.currency)} was paid via ${data.paymentMethod}. Reference: ${data.paymentReference}`, type: "finance_paid",
      link: "/requests", entityType: "finance_request", entityId: r.id,
    });
    await audit(sql, profile.organizationId, context.userId, "pay", "finance_request", r.id, { reference: data.paymentReference });
    return { success: true, message: "Payment recorded and posted to the ledger", emailStatus: requesterNotice.emailStatus };
  });

export const getProjectBudgetSummary = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "finance.view");
    const rows = await sql<{
      id: number; name: string; status: string; budget: string | number; requested: string | number; approved: string | number; paid: string | number; pending: number;
    }>`select p.id, p.name, p.status, p.budget,
        coalesce(sum(case when f.status in ('Submitted','Under Review') then f.amount end),0) as requested,
        coalesce(sum(case when f.status = 'Approved' then f.amount end),0) as approved,
        coalesce(sum(case when f.status = 'Paid' then f.amount end),0) as paid,
        count(case when f.status in ('Submitted','Under Review') then 1 end)::int as pending
      from projects p
      left join finance_requests f on f.project_id = p.id and f.organization_id = p.organization_id
      where p.organization_id = ${profile.organizationId}
      group by p.id order by p.name`;
    return rows.map((p) => {
      const budget = num(p.budget);
      const paid = num(p.paid);
      return {
        projectId: p.id, projectName: p.name, status: p.status, totalBudget: budget, totalRequested: num(p.requested),
        totalApproved: num(p.approved), totalPaid: paid, pendingRequests: p.pending, remainingBudget: budget - paid,
        utilizationRate: budget > 0 ? Math.round((paid / budget) * 100) : 0,
      };
    });
  });

export const getFinanceDashboardStats = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "finance.view", "You cannot open the finance dashboard");
    const org = profile.organizationId;
    const sums = await sql<Record<string, string | number>>`select
        count(*)::int as total,
        count(*) filter (where status in ('Submitted','Under Review'))::int as pending,
        count(*) filter (where status = 'Approved')::int as approved,
        count(*) filter (where status = 'Paid')::int as paid,
        count(*) filter (where status = 'Rejected')::int as rejected,
        coalesce(sum(amount),0) as total_amount,
        coalesce(sum(amount) filter (where status in ('Submitted','Under Review')),0) as pending_amount,
        coalesce(sum(amount) filter (where status = 'Approved'),0) as approved_amount,
        coalesce(sum(amount) filter (where status = 'Paid'),0) as paid_amount
      from finance_requests where organization_id = ${org}`;
    const byCategory = await sql<{ category: string; count: number; total_amount: string | number }>`
      select category, count(*)::int as count, coalesce(sum(amount),0) as total_amount from finance_requests where organization_id = ${org}
        and status in ('Submitted','Under Review','Approved','Paid') group by category`;
    const recent = await sql<{ id: number; request_number: string; title: string; amount: string | number; status: string; requested_by: string; created_at: string }>`
      select id, request_number, title, amount, status, requested_by, created_at from finance_requests where organization_id = ${org} order by created_at desc limit 10`;
    const s = sums[0]!;
    return {
      summary: {
        total: num(s.total), pending: num(s.pending), approved: num(s.approved), paid: num(s.paid), rejected: num(s.rejected),
        totalAmount: num(s.total_amount), pendingAmount: num(s.pending_amount), approvedAmount: num(s.approved_amount), paidAmount: num(s.paid_amount),
      },
      byCategory: byCategory.map((c) => ({ category: c.category, count: c.count, totalAmount: num(c.total_amount) })),
      recent: recent.map((r) => ({ id: r.id, requestNumber: r.request_number, title: r.title, amount: num(r.amount), status: r.status, requestedBy: r.requested_by, createdAt: r.created_at })),
    };
  });

// ============================================
// CUSTOMERS AND SUPPLIERS
// ============================================

export const listParties = createServerFn({ method: "GET" })
  .validator((kind: "customer" | "supplier" | undefined) => kind)
  .middleware([authMiddleware])
  .handler(async ({ context, data: kind }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "accounts.view");
    const rows = await sql<Party>`select id, kind, name, tin, vrn, email, phone, address from parties
      where organization_id = ${profile.organizationId} and (${kind ?? null}::text is null or kind = ${kind ?? null}) order by name`;
    return rows;
  });

export const createParty = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      kind: z.enum(["customer", "supplier"]),
      name: z.string().min(1).max(160),
      tin: z.string().max(40).optional(), vrn: z.string().max(40).optional(),
      email: z.string().email().optional().or(z.literal("")), phone: z.string().max(40).optional(), address: z.string().max(300).optional(),
    }).parse(input),
  )
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, data.kind === "supplier" ? "accounts.payables" : "accounts.invoices");
    const rows = await sql<{ id: number }>`insert into parties (organization_id, kind, name, tin, vrn, email, phone, address)
      values (${profile.organizationId}, ${data.kind}, ${data.name}, ${data.tin ?? null}, ${data.vrn ?? null}, ${data.email || null}, ${data.phone ?? null}, ${data.address ?? null})
      returning id`;
    return { id: rows[0]!.id };
  });

// ============================================
// INVOICES AND RECEIPTS
// ============================================

type InvoiceRow = {
  id: number; invoice_number: string; customer_name: string; customer_id: number | null; description: string; currency: string; status: string;
  issue_date: string; due_date: string | null; project_id: number | null; subtotal: string | number; vat_rate: string | number;
  vat_amount: string | number; total: string | number; amount_paid: string | number; notes: string | null;
};
const mapInvoice = (r: InvoiceRow): FinanceInvoice => ({
  id: r.id, invoiceNumber: r.invoice_number, customerName: r.customer_name, customerId: r.customer_id, description: r.description, currency: r.currency,
  status: r.status, issueDate: r.issue_date, dueDate: r.due_date, projectId: r.project_id, subtotal: num(r.subtotal), vatRate: num(r.vat_rate),
  vatAmount: num(r.vat_amount), total: num(r.total), amountPaid: num(r.amount_paid), amount: num(r.total), notes: r.notes,
});
const INVOICE_COLS = `id, invoice_number, customer_name, customer_id, description, currency, status, issue_date::text as issue_date, due_date::text as due_date, project_id, subtotal, vat_rate, vat_amount, total, amount_paid, notes`;

export const listInvoices = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "accounts.view");
    const rows = await sql.query<InvoiceRow>(`select ${INVOICE_COLS} from finance_invoices where organization_id = $1 order by issue_date desc, id desc limit 500`, [profile.organizationId]);
    return rows.map(mapInvoice);
  });

export const getInvoice = createServerFn({ method: "GET" })
  .validator((id: number) => id)
  .middleware([authMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "accounts.view");
    const rows = await sql.query<InvoiceRow & { tin: string | null; address: string | null }>(
      `select i.id, i.invoice_number, i.customer_name, i.customer_id, i.description, i.currency, i.status, i.issue_date::text as issue_date,
              i.due_date::text as due_date, i.project_id, i.subtotal, i.vat_rate, i.vat_amount, i.total, i.amount_paid, i.notes, p.tin, p.address
         from finance_invoices i left join parties p on p.id = i.customer_id
        where i.id = $1 and i.organization_id = $2`, [id, profile.organizationId]);
    if (!rows[0]) throw new Error("Invoice not found");
    const lines = await sql<{ id: number; position: number; description: string; quantity: string | number; unit_price: string | number }>`
      select id, position, description, quantity, unit_price from invoice_lines where invoice_id = ${id} order by position`;
    const payments = await sql<{ id: number; kind: string; receipt_no: string | null; amount: string | number; pay_date: string; method: string; reference: string | null; party_name: string | null }>`
      select id, kind, receipt_no, amount, pay_date::text as pay_date, method, reference, party_name from payments where invoice_id = ${id} and organization_id = ${profile.organizationId} order by pay_date, id`;
    const detail: InvoiceDetail = {
      ...mapInvoice(rows[0]),
      customerTin: rows[0].tin, customerAddress: rows[0].address,
      lines: lines.map((l) => ({ id: l.id, position: l.position, description: l.description, quantity: num(l.quantity), unitPrice: num(l.unit_price), lineTotal: Math.round(num(l.quantity) * num(l.unit_price) * 100) / 100 })),
      payments: payments.map((p) => ({ id: p.id, kind: p.kind, receiptNo: p.receipt_no, amount: num(p.amount), payDate: p.pay_date, method: p.method, reference: p.reference, partyName: p.party_name })),
    };
    return detail;
  });

export const createInvoice = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      customerId: z.number().int().optional(),
      customerName: z.string().min(1).max(160),
      description: z.string().min(1).max(300),
      projectId: z.number().int().optional(),
      issueDate: dateStr.optional(),
      dueDate: dateStr.optional(),
      vatRate: z.number().min(0).max(30).optional(),
      notes: z.string().max(1000).optional(),
      lines: z.array(z.object({ description: z.string().min(1).max(300), quantity: z.number().positive(), unitPrice: z.number().min(0) })).min(1).max(60),
    }).refine((v) => !v.dueDate || !v.issueDate || v.dueDate >= v.issueDate, { path: ["dueDate"], message: "Due date must be on or after issue date" }).parse(input),
  )
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "accounts.invoices", "You cannot create invoices");
    const org = await sql<{ currency: string; vat_rate: string | number }>`select currency, vat_rate from organizations where id = ${profile.organizationId}`;
    const vatRate = data.vatRate ?? num(org[0]?.vat_rate);
    const subtotal = data.lines.reduce((s, l) => s + Math.round(l.quantity * l.unitPrice * 100) / 100, 0);
    const vat = Math.round(subtotal * vatRate) / 100;
    if (data.projectId) {
      const p = await sql`select 1 from projects where id = ${data.projectId} and organization_id = ${profile.organizationId}`;
      if (!p[0]) throw new Error("Choose a project from your company");
    }
    if (data.customerId) {
      const c = await sql`select 1 from parties where id = ${data.customerId} and organization_id = ${profile.organizationId} and kind = 'customer'`;
      if (!c[0]) throw new Error("Customer not found");
    }
    const rows = await sql<{ id: number; invoice_number: string }>`
      with inv as (
        insert into finance_invoices (organization_id, project_id, customer_id, invoice_number, customer_name, description, currency, status,
                                      issue_date, due_date, vat_rate, subtotal, vat_amount, total, amount, notes, created_by)
        values (${profile.organizationId}, ${data.projectId ?? null}, ${data.customerId ?? null}, acct_next_no(${profile.organizationId}, 'INV', 'INV'),
                ${data.customerName}, ${data.description}, ${org[0]?.currency ?? "TZS"}, 'Draft', coalesce(${data.issueDate ?? null}::date, current_date),
                ${data.dueDate ?? null}::date, ${vatRate}, ${subtotal}, ${vat}, ${subtotal + vat}, ${subtotal + vat}, ${data.notes ?? null}, ${context.userId})
        returning id, invoice_number
      ), ln as (
        insert into invoice_lines (invoice_id, position, description, quantity, unit_price)
        select inv.id, t.ord, t.e->>'description', (t.e->>'quantity')::numeric, (t.e->>'unitPrice')::numeric
        from inv, jsonb_array_elements(${JSON.stringify(data.lines)}::jsonb) with ordinality as t(e, ord)
        returning invoice_id
      )
      select id, invoice_number from inv`;
    await audit(sql, profile.organizationId, context.userId, "create", "invoice", rows[0]!.id);
    return { id: rows[0]!.id, invoiceNumber: rows[0]!.invoice_number };
  });

export const issueInvoice = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "accounts.invoices");
    try {
      await sql`select fin_invoice_issue(${id}, ${profile.organizationId}, ${context.userId})`;
    } catch (error) {
      throw friendly(error);
    }
    await audit(sql, profile.organizationId, context.userId, "issue", "invoice", id);
    return { success: true };
  });

export const receiveInvoicePayment = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ id: z.number().int(), amount: z.number().positive(), payDate: dateStr.optional(), method: z.enum(PAY_METHODS).default("Bank"), reference: z.string().max(120).optional() }).parse(input),
  )
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "accounts.invoices");
    try {
      await sql`select fin_invoice_receive(${data.id}, ${profile.organizationId}, ${context.userId}, ${data.amount}, ${data.payDate ?? null}::date, ${data.method}, ${data.reference ?? null})`;
    } catch (error) {
      throw friendly(error);
    }
    await audit(sql, profile.organizationId, context.userId, "receipt", "invoice", data.id, { amount: data.amount });
    return { success: true };
  });

export const voidInvoice = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.number().int(), reason: z.string().min(1).max(300) }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "accounts.invoices");
    try {
      await sql`select fin_invoice_void(${data.id}, ${profile.organizationId}, ${context.userId}, ${data.reason})`;
    } catch (error) {
      throw friendly(error);
    }
    await audit(sql, profile.organizationId, context.userId, "void", "invoice", data.id, { reason: data.reason });
    return { success: true };
  });

export const deleteDraftInvoice = createServerFn({ method: "POST" })
  .validator((id: number) => id)
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "accounts.invoices");
    const gone = await sql`delete from finance_invoices where id = ${id} and organization_id = ${profile.organizationId} and status = 'Draft' returning id`;
    if (!gone[0]) throw new Error("Only draft invoices can be deleted. Void an issued invoice instead.");
    return { success: true };
  });

// ============================================
// ACCOUNTS PAYABLE (supplier bills and payments)
// ============================================

type BillRow = {
  id: number; bill_number: string; supplier_invoice_number: string | null; supplier_name: string; supplier_id: number | null;
  description: string; currency: string; status: string; issue_date: string; due_date: string | null; project_id: number | null;
  subtotal: string | number; vat_rate: string | number; vat_amount: string | number; total: string | number;
  amount_paid: string | number; notes: string | null;
};
const BILL_COLS = `id,bill_number,supplier_invoice_number,supplier_name,supplier_id,description,currency,status,issue_date::text as issue_date,due_date::text as due_date,project_id,subtotal,vat_rate,vat_amount,total,amount_paid,notes`;
const mapBill = (r: BillRow): FinanceBill => ({
  id:r.id,billNumber:r.bill_number,supplierInvoiceNumber:r.supplier_invoice_number,supplierName:r.supplier_name,supplierId:r.supplier_id,
  description:r.description,currency:r.currency,status:r.status,issueDate:r.issue_date,dueDate:r.due_date,projectId:r.project_id,
  subtotal:num(r.subtotal),vatRate:num(r.vat_rate),vatAmount:num(r.vat_amount),total:num(r.total),amountPaid:num(r.amount_paid),notes:r.notes,
});

export const listBills = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "accounts.view");
    const rows = await sql.query<BillRow>(`select ${BILL_COLS} from finance_bills where organization_id=$1 order by issue_date desc,id desc limit 500`, [profile.organizationId]);
    return rows.map(mapBill);
  });

export const createBill = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({
    supplierId:z.number().int().optional(),supplierName:z.string().trim().min(1).max(160),supplierInvoiceNumber:z.string().trim().max(100).optional(),
    description:z.string().trim().min(1).max(300),projectId:z.number().int().optional(),issueDate:dateStr.optional(),dueDate:dateStr.optional(),
    vatRate:z.number().min(0).max(30).optional(),notes:z.string().max(1000).optional(),
    lines:z.array(z.object({description:z.string().trim().min(1).max(300),quantity:z.number().positive().max(1_000_000),unitPrice:z.number().min(0).max(1_000_000_000),accountCode:z.string().regex(/^[0-9]{3,6}$/),projectId:z.number().int().optional()})).min(1).max(60),
  }).refine(v=>!v.dueDate||!v.issueDate||v.dueDate>=v.issueDate,{path:["dueDate"],message:"Due date must be on or after bill date"}).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql=await getSql(); const profile=await requirePermission(context.userId,"accounts.payables","You cannot create supplier bills");
    const org=await sql<{currency:string;vat_rate:string|number}>`select currency,vat_rate from organizations where id=${profile.organizationId}`;
    if(data.supplierId){const s=await sql`select 1 from parties where id=${data.supplierId} and organization_id=${profile.organizationId} and kind='supplier'`;if(!s[0])throw new Error("Supplier not found in your company");}
    if(data.projectId){const p=await sql`select 1 from projects where id=${data.projectId} and organization_id=${profile.organizationId}`;if(!p[0])throw new Error("Choose a project from your company");}
    for(const line of data.lines){const a=await sql`select 1 from chart_of_accounts where organization_id=${profile.organizationId} and code=${line.accountCode} and active and type='Expense'`;if(!a[0])throw new Error(`Choose an active expense account for ${line.description}`);if(line.projectId){const p=await sql`select 1 from projects where id=${line.projectId} and organization_id=${profile.organizationId}`;if(!p[0])throw new Error("Choose a project from your company");}}
    const rate=data.vatRate??num(org[0]?.vat_rate); const subtotal=data.lines.reduce((s,l)=>s+Math.round(l.quantity*l.unitPrice*100)/100,0); const vat=Math.round(subtotal*rate)/100;
    const result=await sql<{id:number;bill_number:string}>`
      with bill as (
        insert into finance_bills(organization_id,supplier_id,supplier_name,supplier_invoice_number,bill_number,description,currency,status,issue_date,due_date,project_id,subtotal,vat_rate,vat_amount,total,notes,created_by)
        values(${profile.organizationId},${data.supplierId??null},${data.supplierName},${data.supplierInvoiceNumber||null},acct_next_no(${profile.organizationId},'BILL','BILL'),${data.description},${org[0]?.currency??'TZS'},'Draft',coalesce(${data.issueDate??null}::date,current_date),${data.dueDate??null}::date,${data.projectId??null},${subtotal},${rate},${vat},${subtotal+vat},${data.notes??null},${context.userId}) returning id,bill_number
      ), lines as (
        insert into finance_bill_lines(bill_id,position,description,quantity,unit_price,account_code,project_id)
        select bill.id,x.ord,x.e->>'description',(x.e->>'quantity')::numeric,(x.e->>'unitPrice')::numeric,x.e->>'accountCode',nullif(x.e->>'projectId','')::integer
        from bill,jsonb_array_elements(${JSON.stringify(data.lines)}::jsonb) with ordinality x(e,ord) returning bill_id
      ) select id,bill_number from bill`;
    await audit(sql,profile.organizationId,context.userId,"create","supplier_bill",result[0]!.id,{subtotal,vat,rate});
    return {id:result[0]!.id,billNumber:result[0]!.bill_number};
  });

export const postBill = createServerFn({method:"POST"})
  .validator((id:number)=>z.number().int().positive().parse(id)).middleware([authMiddleware])
  .handler(async({context,data:id})=>{const sql=await getSql();const profile=await requirePermission(context.userId,"accounts.payables");try{await sql`select fin_bill_post(${id},${profile.organizationId},${context.userId})`;}catch(e){throw friendly(e);}await audit(sql,profile.organizationId,context.userId,"post","supplier_bill",id);return{success:true};});

export const payBill = createServerFn({method:"POST"})
  .validator((input:unknown)=>z.object({id:z.number().int().positive(),amount:z.number().positive(),payDate:dateStr.optional(),method:z.enum(PAY_METHODS).default("Bank"),reference:z.string().trim().max(120).optional()}).parse(input))
  .middleware([authMiddleware]).handler(async({context,data})=>{const sql=await getSql();const profile=await requirePermission(context.userId,"accounts.payables");try{await sql`select fin_bill_pay(${data.id},${profile.organizationId},${context.userId},${data.amount},${data.payDate??null}::date,${data.method},${data.reference??null})`;}catch(e){throw friendly(e);}await audit(sql,profile.organizationId,context.userId,"payment","supplier_bill",data.id,{amount:data.amount,method:data.method});return{success:true};});

export const voidBill = createServerFn({method:"POST"})
  .validator((input:unknown)=>z.object({id:z.number().int().positive(),reason:z.string().trim().min(1).max(300)}).parse(input))
  .middleware([authMiddleware]).handler(async({context,data})=>{const sql=await getSql();const profile=await requirePermission(context.userId,"accounts.payables");try{await sql`select fin_bill_void(${data.id},${profile.organizationId},${context.userId},${data.reason})`;}catch(e){throw friendly(e);}await audit(sql,profile.organizationId,context.userId,"void","supplier_bill",data.id,{reason:data.reason});return{success:true};});

export const getVatSummary = createServerFn({method:"GET"})
  .validator((input:unknown)=>z.object({from:dateStr,to:dateStr}).refine(x=>x.to>=x.from,"End date must be on or after start date").parse(input))
  .middleware([authMiddleware]).handler(async({context,data})=>{const sql=await getSql();const profile=await requirePermission(context.userId,"accounts.reports");
    const rows=await sql<{direction:"Output"|"Input";reference:string;party:string;date:string;subtotal:string|number;vat_rate:string|number;vat_amount:string|number;total:string|number}>`
      select 'Output'::text direction,invoice_number reference,customer_name party,issue_date::text date,subtotal,vat_rate,vat_amount,total
        from finance_invoices where organization_id=${profile.organizationId} and status in ('Issued','Partially Paid','Paid') and issue_date between ${data.from}::date and ${data.to}::date
      union all
      select 'Input'::text,bill_number,supplier_name,issue_date::text,subtotal,vat_rate,vat_amount,total
        from finance_bills where organization_id=${profile.organizationId} and status in ('Open','Partially Paid','Paid') and issue_date between ${data.from}::date and ${data.to}::date
      order by date,reference`;
    const items=rows.map(r=>({direction:r.direction,reference:r.reference,party:r.party,date:r.date,subtotal:num(r.subtotal),vatRate:num(r.vat_rate),vatAmount:num(r.vat_amount),total:num(r.total)}));
    const output=items.filter(i=>i.direction==="Output").reduce((s,i)=>s+i.vatAmount,0),input=items.filter(i=>i.direction==="Input").reduce((s,i)=>s+i.vatAmount,0);
    return{from:data.from,to:data.to,outputVat:output,inputVat:input,netVat:output-input,items};});

export const listReconciliationLines = createServerFn({method:"GET"})
  .validator((input:unknown)=>z.object({code:z.string().regex(/^[0-9]{3,6}$/),from:dateStr,to:dateStr,reconciliationId:z.number().int().positive().optional()}).refine(x=>x.to>=x.from,"End date must be on or after start date").parse(input))
  .middleware([authMiddleware]).handler(async({context,data})=>{const sql=await getSql();const profile=await requirePermission(context.userId,"accounts.view");const rows=await sql<{id:number;entry_date:string;entry_no:string;memo:string;description:string|null;debit:string|number;credit:string|number;selected:boolean}>`
    select l.id,e.entry_date::text,e.entry_no,e.memo,l.description,l.debit,l.credit,
      exists(select 1 from bank_reconciliation_items ri where ri.journal_line_id=l.id and ri.reconciliation_id=${data.reconciliationId??null}) selected
    from journal_lines l join journal_entries e on e.id=l.entry_id join chart_of_accounts a on a.id=l.account_id
    where e.organization_id=${profile.organizationId} and a.organization_id=${profile.organizationId} and a.code=${data.code}
      and e.entry_date between ${data.from}::date and ${data.to}::date
      and not exists(select 1 from bank_reconciliation_items ri join bank_reconciliations br on br.id=ri.reconciliation_id where ri.journal_line_id=l.id and br.status='Completed')
    order by e.entry_date,e.id,l.id`;
    return rows.map(r=>({id:r.id,date:r.entry_date,entryNo:r.entry_no,memo:r.memo,description:r.description,debit:num(r.debit),credit:num(r.credit),amount:num(r.debit)-num(r.credit),selected:r.selected} satisfies BankReconciliationLine));});

export const listReconciliations = createServerFn({method:"GET"}).middleware([authMiddleware]).handler(async({context})=>{const sql=await getSql();const profile=await requirePermission(context.userId,"accounts.view");return sql<{id:number;account_code:string;statement_from:string;statement_to:string;beginning_balance:string|number;ending_balance:string|number;status:string;created_at:string}>`select id,account_code,statement_from::text,statement_to::text,beginning_balance,ending_balance,status,created_at::text from bank_reconciliations where organization_id=${profile.organizationId} order by statement_to desc limit 100`;});

export const saveReconciliation = createServerFn({method:"POST"})
  .validator((input:unknown)=>z.object({id:z.number().int().positive().optional(),code:z.string().regex(/^[0-9]{3,6}$/),from:dateStr,to:dateStr,beginningBalance:z.number(),endingBalance:z.number(),lineIds:z.array(z.number().int().positive()).max(5000)}).refine(x=>x.to>=x.from,"End date must be on or after start date").parse(input))
  .middleware([authMiddleware]).handler(async({context,data})=>{const sql=await getSql();const profile=await requirePermission(context.userId,"accounts.post");try{const r=await sql<{id:number}>`select acct_save_reconciliation(${data.id??null}::bigint,${profile.organizationId},${context.userId},${data.code},${data.from}::date,${data.to}::date,${data.beginningBalance},${data.endingBalance},${JSON.stringify(data.lineIds)}::jsonb) id`;await audit(sql,profile.organizationId,context.userId,"save","bank_reconciliation",r[0]!.id);return{id:r[0]!.id};}catch(e){throw friendly(e);}});

export const completeReconciliation = createServerFn({method:"POST"})
  .validator((id:number)=>z.number().int().positive().parse(id)).middleware([authMiddleware])
  .handler(async({context,data:id})=>{const sql=await getSql();const profile=await requirePermission(context.userId,"accounts.post");try{await sql`select acct_complete_reconciliation(${id}::bigint,${profile.organizationId})`;}catch(e){throw friendly(e);}await audit(sql,profile.organizationId,context.userId,"complete","bank_reconciliation",id);return{success:true};});

// ============================================
// PURCHASE ORDERS
// ============================================

export const listPurchaseOrders = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "accounts.view");
    const rows = await sql<{ id: number; po_number: string; supplier_name: string; description: string; amount: string | number; currency: string; status: string; issue_date: string; project_id: number | null }>`
      select id, po_number, supplier_name, description, amount, currency, status, issue_date::text as issue_date, project_id
      from purchase_orders where organization_id = ${profile.organizationId} order by issue_date desc, id desc limit 500`;
    return rows.map((r): PurchaseOrder => ({ id: r.id, poNumber: r.po_number, supplierName: r.supplier_name, description: r.description, amount: num(r.amount), currency: r.currency, status: r.status, issueDate: r.issue_date, projectId: r.project_id }));
  });

export const createPurchaseOrder = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ supplierName: z.string().min(1).max(160), description: z.string().min(1).max(300), amount: z.number().positive(), projectId: z.number().int().optional() }).parse(input),
  )
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "accounts.invoices", "You cannot create purchase orders");
    const rows = await sql<{ po_number: string }>`insert into purchase_orders (organization_id, project_id, po_number, supplier_name, description, amount, created_by)
      values (${profile.organizationId}, ${data.projectId ?? null}, acct_next_no(${profile.organizationId}, 'PO', 'PO'), ${data.supplierName}, ${data.description}, ${data.amount}, ${context.userId})
      returning po_number`;
    return { poNumber: rows[0]!.po_number };
  });

// ============================================
// BOOKS OF ACCOUNT
// ============================================

export const listAccounts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "accounts.view");
    await sql`select acct_seed_chart(${profile.organizationId})`;
    const rows = await sql<{ id: number; code: string; name: string; type: Account["type"]; is_system: boolean; active: boolean }>`
      select id, code, name, type, is_system, active from chart_of_accounts where organization_id = ${profile.organizationId} order by code`;
    return rows.map((r): Account => ({ id: r.id, code: r.code, name: r.name, type: r.type, isSystem: r.is_system, active: r.active }));
  });

export const createAccount = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ code: z.string().regex(/^[0-9]{3,6}$/, "Use a 3 to 6 digit code"), name: z.string().min(1).max(120), type: z.enum(["Asset", "Liability", "Equity", "Income", "Expense"]) }).parse(input),
  )
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "accounts.post");
    try {
      await sql`insert into chart_of_accounts (organization_id, code, name, type) values (${profile.organizationId}, ${data.code}, ${data.name}, ${data.type})`;
    } catch {
      throw new Error("An account with that code already exists");
    }
    return { success: true };
  });

export const postJournal = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      date: dateStr,
      memo: z.string().min(1).max(300),
      lines: z.array(z.object({ account: z.string().min(1), debit: z.number().min(0).default(0), credit: z.number().min(0).default(0), description: z.string().max(200).optional() })).min(2).max(60),
    }).parse(input),
  )
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "accounts.post", "You cannot post journal vouchers");
    try {
      const rows = await sql<{ id: number }>`select acct_post(${profile.organizationId}, ${data.date}::date, ${data.memo}, 'manual', null, ${context.userId}, ${JSON.stringify(data.lines)}::jsonb) as id`;
      await audit(sql, profile.organizationId, context.userId, "post", "journal", rows[0]!.id);
      return { id: rows[0]!.id };
    } catch (error) {
      throw friendly(error);
    }
  });

export const listJournalEntries = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ from: dateStr.optional(), to: dateStr.optional() }).optional().parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "accounts.view");
    const rows = await sql<{ id: number; entry_no: string; entry_date: string; memo: string; source_type: string; status: string; total: string | number; created_by: string }>`
      select e.id, e.entry_no, e.entry_date::text as entry_date, e.memo, e.source_type, e.status, coalesce(sum(l.debit),0) as total, e.created_by
      from journal_entries e left join journal_lines l on l.entry_id = e.id
      where e.organization_id = ${profile.organizationId}
        and e.entry_date >= coalesce(${data?.from ?? null}::date, date '1900-01-01') and e.entry_date <= coalesce(${data?.to ?? null}::date, date '2999-12-31')
      group by e.id order by e.entry_date desc, e.id desc limit 300`;
    return rows.map((r): JournalEntryRow => ({ id: r.id, entryNo: r.entry_no, entryDate: r.entry_date, memo: r.memo, sourceType: r.source_type, status: r.status, total: num(r.total), createdBy: r.created_by }));
  });

export const reverseJournalEntry = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.number().int(), reason: z.string().min(1).max(300) }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "accounts.post");
    try {
      await sql`select acct_reverse(${data.id}, ${profile.organizationId}, ${context.userId}, ${data.reason})`;
    } catch (error) {
      throw friendly(error);
    }
    await audit(sql, profile.organizationId, context.userId, "reverse", "journal", data.id, { reason: data.reason });
    return { success: true };
  });

// ============================================
// FINANCIAL REPORTS (Tally / QuickBooks style)
// ============================================

export const getTrialBalance = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ asOf: dateStr.optional() }).optional().parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "accounts.reports");
    const asOf = data?.asOf ?? today();
    const rows = await sql<{ code: string; name: string; type: string; debit: string | number; credit: string | number; balance_dr: string | number; balance_cr: string | number }>`
      select * from acct_trial_balance(${profile.organizationId}, ${asOf}::date)`;
    const mapped = rows.map((r): TrialBalanceRow => ({ code: r.code, accountName: r.name, type: r.type, debit: num(r.debit), credit: num(r.credit), balanceDr: num(r.balance_dr), balanceCr: num(r.balance_cr) }));
    const totalDr = mapped.reduce((s, r) => s + r.balanceDr, 0);
    const totalCr = mapped.reduce((s, r) => s + r.balanceCr, 0);
    return { asOf, rows: mapped, totalDebit: totalDr, totalCredit: totalCr, balanced: Math.round(totalDr * 100) === Math.round(totalCr * 100) };
  });

export const getIncomeStatement = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ from: dateStr, to: dateStr }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "accounts.reports");
    const rows = await sql<{ code: string; name: string; type: string; amount: string | number }>`
      select * from acct_income_statement(${profile.organizationId}, ${data.from}::date, ${data.to}::date)`;
    const income = rows.filter((r) => r.type === "Income").map((r) => ({ code: r.code, name: r.name, amount: num(r.amount) }));
    const expenses = rows.filter((r) => r.type === "Expense").map((r) => ({ code: r.code, name: r.name, amount: num(r.amount) }));
    const totalIncome = income.reduce((s, r) => s + r.amount, 0);
    const totalExpenses = expenses.reduce((s, r) => s + r.amount, 0);
    return { from: data.from, to: data.to, income, expenses, totalIncome, totalExpenses, netProfit: totalIncome - totalExpenses };
  });

export const getBalanceSheet = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ asOf: dateStr.optional() }).optional().parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "accounts.reports");
    const asOf = data?.asOf ?? today();
    const rows = await sql<{ section: string; code: string; name: string; amount: string | number }>`
      select * from acct_balance_sheet(${profile.organizationId}, ${asOf}::date)`;
    const pick = (section: string) => rows.filter((r) => r.section === section).map((r) => ({ code: r.code, name: r.name, amount: num(r.amount) }));
    const assets = pick("Assets"), liabilities = pick("Liabilities"), equity = pick("Equity");
    const sum = (a: { amount: number }[]) => a.reduce((s, r) => s + r.amount, 0);
    return {
      asOf, assets, liabilities, equity, totalAssets: sum(assets), totalLiabilities: sum(liabilities), totalEquity: sum(equity),
      balanced: Math.round(sum(assets) * 100) === Math.round((sum(liabilities) + sum(equity)) * 100),
    };
  });

export const getGeneralLedger = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ code: z.string().min(1), from: dateStr, to: dateStr }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "accounts.reports");
    const rows = await sql<{ entry_date: string; entry_no: string; memo: string; description: string | null; debit: string | number; credit: string | number; running: string | number }>`
      select entry_date::text as entry_date, entry_no, memo, description, debit, credit, running from acct_general_ledger(${profile.organizationId}, ${data.code}, ${data.from}::date, ${data.to}::date)`;
    return rows.map((r) => ({ date: r.entry_date, entryNo: r.entry_no, memo: r.memo, description: r.description, debit: num(r.debit), credit: num(r.credit), running: num(r.running) }));
  });

export const getReceivablesAging = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "accounts.reports");
    const rows = await sql<{ id: number; invoice_number: string; customer_name: string; due: string | null; balance: string | number; days: number }>`
      select id, invoice_number, customer_name, coalesce(due_date, issue_date)::text as due, (total - amount_paid) as balance,
             (current_date - coalesce(due_date, issue_date))::int as days
      from finance_invoices where organization_id = ${profile.organizationId} and status in ('Issued','Partially Paid') order by days desc`;
    const bucket = (d: number) => (d <= 0 ? "Current" : d <= 30 ? "1-30" : d <= 60 ? "31-60" : d <= 90 ? "61-90" : "90+");
    const items = rows.map((r) => ({ id: r.id, invoiceNumber: r.invoice_number, customerName: r.customer_name, dueDate: r.due, balance: num(r.balance), daysOverdue: Math.max(r.days, 0), bucket: bucket(r.days) }));
    const buckets = ["Current", "1-30", "31-60", "61-90", "90+"].map((b) => ({ bucket: b, total: items.filter((i) => i.bucket === b).reduce((s, i) => s + i.balance, 0) }));
    return { items, buckets, total: items.reduce((s, i) => s + i.balance, 0) };
  });

/** Projects a staff member may raise a request against (all active projects of the company). */
export const listProjectsForRequests = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "finance.request");
    return sql<{ id: number; name: string; status: string }>`select id, name, status from projects
      where organization_id = ${profile.organizationId} and status not in ('Completed','Cancelled','Closed') order by name`;
  });

// ============================================
// PROJECT BUDGETS BY CATEGORY
// ============================================

const CATEGORIES = ["Material", "Equipment", "Labor", "Transport", "Other"] as const;

export type ProjectBudget = {
  projectId: number;
  name: string;
  total: number;
  allocated: number;
  lines: { category: (typeof CATEGORIES)[number]; allocated: number; committed: number; paid: number }[];
};

export const getProjectBudget = createServerFn({ method: "GET" })
  .validator((projectId: number) => projectId)
  .middleware([authMiddleware])
  .handler(async ({ context, data: projectId }) => {
    const sql = await getSql();
    const profile = await requireProfile(context.userId);
    if (!can(profile, "finance.view") && !can(profile, "budgets.manage") && !can(profile, "projects.manage")) throw new Error("You cannot view budgets");
    const proj = await sql<{ id: number; name: string; budget: string | number }>`select id, name, coalesce(budget,0) as budget from projects where id = ${projectId} and organization_id = ${profile.organizationId}`;
    if (!proj[0]) throw new Error("Project not found");
    const alloc = await sql<{ category: string; amount: string | number }>`select category, amount from project_budgets where project_id = ${projectId}`;
    const used = await sql<{ category: string; committed: string | number; paid: string | number }>`
      select category, coalesce(sum(amount) filter (where status in ('Submitted','Under Review','Approved','Paid')),0) as committed,
             coalesce(sum(amount) filter (where status = 'Paid'),0) as paid
      from finance_requests where project_id = ${projectId} group by category`;
    const lines = CATEGORIES.map((category) => ({
      category,
      allocated: num(alloc.find((a) => a.category === category)?.amount),
      committed: num(used.find((u) => u.category === category)?.committed),
      paid: num(used.find((u) => u.category === category)?.paid),
    }));
    const result: ProjectBudget = { projectId, name: proj[0].name, total: num(proj[0].budget), allocated: lines.reduce((s, l) => s + l.allocated, 0), lines };
    return result;
  });

export const setProjectBudget = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ projectId: z.number().int(), lines: z.array(z.object({ category: z.enum(CATEGORIES), amount: z.number().min(0) })).min(1).max(5) }).parse(input),
  )
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profile = await requirePermission(context.userId, "budgets.manage", "You cannot set project budgets");
    const proj = await sql`select 1 from projects where id = ${data.projectId} and organization_id = ${profile.organizationId}`;
    if (!proj[0]) throw new Error("Project not found");
    await sql`insert into project_budgets (project_id, organization_id, category, amount)
      select ${data.projectId}, ${profile.organizationId}, x.category, x.amount
      from jsonb_to_recordset(${JSON.stringify(data.lines)}::jsonb) as x(category text, amount numeric)
      on conflict (project_id, category) do update set amount = excluded.amount, updated_at = now()`;
    const total = data.lines.reduce((s, l) => s + l.amount, 0);
    if (total > 0) await sql`update projects set budget = ${total}, updated_at = now() where id = ${data.projectId} and organization_id = ${profile.organizationId}`;
    await audit(sql, profile.organizationId, context.userId, "budget", "project", data.projectId, { total });
    return { success: true, total };
  });
