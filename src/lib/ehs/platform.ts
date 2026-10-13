import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { auth } from "@/lib/auth/server";
import { getSql } from "@/lib/db.server";
import { audit, requirePlatformAdmin } from "./core";

const num = (v: unknown) => Number(v ?? 0);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const dayMs = 86400000;

export type Billing = "Paid" | "Due soon" | "Overdue" | "No fee" | "Waived";

export type Tenant = {
  id: string; name: string; slug: string; status: string; currency: string; plan: string; maxUsers: number; monthlyFee: number;
  paidUntil: string | null; contactName: string | null; contactEmail: string | null; contactPhone: string | null; notes: string | null;
  users: number; lastActive: string | null; createdAt: string; billing: Billing; billingExempt: boolean;
};

function billingOf(fee: number, paidUntil: string | null, billingExempt: boolean): Billing {
  if (billingExempt) return "Waived";
  if (fee <= 0) return "No fee";
  if (!paidUntil) return "Overdue";
  const days = Math.floor((new Date(paidUntil).getTime() - Date.now()) / dayMs);
  return days < 0 ? "Overdue" : days <= 7 ? "Due soon" : "Paid";
}

type Row = {
  id: string; name: string; slug: string; status: string; currency: string; plan: string; max_users: number; monthly_fee: string | number;
  paid_until: string | null; contact_name: string | null; contact_email: string | null; contact_phone: string | null; notes: string | null;
  users: number; last_active: string | null; created_at: string; billing_exempt: boolean;
};

async function loadTenants(): Promise<Tenant[]> {
  const sql = await getSql();
  const rows = await sql<Row>`select o.id::text as id, o.name, o.slug, o.status, o.currency, o.plan, o.max_users, o.monthly_fee, o.paid_until::text as paid_until, o.billing_exempt,
      o.contact_name, o.contact_email, o.contact_phone, o.notes, o.created_at,
      (select count(*)::int from profiles p where p.organization_id::text = o.id::text and p.status = 'active') as users,
      (select max(a.created_at) from audit_log a where a.organization_id::text = o.id::text) as last_active
    from organizations o order by o.created_at desc`;
  return rows.map((r) => ({
    id: r.id, name: r.name, slug: r.slug, status: r.status, currency: r.currency, plan: r.plan, maxUsers: r.max_users, monthlyFee: num(r.monthly_fee),
    paidUntil: r.paid_until, contactName: r.contact_name, contactEmail: r.contact_email, contactPhone: r.contact_phone, notes: r.notes,
    users: r.users, lastActive: r.last_active, createdAt: r.created_at, billingExempt: r.billing_exempt, billing: billingOf(num(r.monthly_fee), r.paid_until, r.billing_exempt),
  }));
}

export const listTenantsDetailed = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);
    return loadTenants();
  });

export const getPlatformOverview = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await requirePlatformAdmin(context.userId);
    const tenants = await loadTenants();
    const active = tenants.filter((t) => t.status === "active");
    const mrr: Record<string, number> = {};
    for (const t of active) mrr[t.currency] = (mrr[t.currency] ?? 0) + t.monthlyFee;
    const collected = await sql<{ currency: string; total: string | number }>`select currency, coalesce(sum(amount),0) as total from platform_payments
      where paid_on >= date_trunc('month', current_date)::date group by currency`;
    const recent = await sql<{ id: number; name: string; amount: string | number; currency: string; paid_on: string; period_to: string; method: string | null }>`
      select p.id, o.name, p.amount, p.currency, p.paid_on::text as paid_on, p.period_to::text as period_to, p.method
      from platform_payments p join organizations o on o.id::text = p.organization_id order by p.created_at desc limit 6`;
    return {
      companies: tenants.length,
      active: active.length,
      suspended: tenants.length - active.length,
      users: tenants.reduce((s, t) => s + t.users, 0),
      mrr: Object.entries(mrr).map(([currency, amount]) => ({ currency, amount })),
      collectedThisMonth: collected.map((c) => ({ currency: c.currency, amount: num(c.total) })),
      overdue: tenants.filter((t) => t.status === "active" && t.billing === "Overdue"),
      dueSoon: tenants.filter((t) => t.status === "active" && t.billing === "Due soon"),
      recentPayments: recent.map((r) => ({ id: r.id, company: r.name, amount: num(r.amount), currency: r.currency, paidOn: r.paid_on, paidUntil: r.period_to, method: r.method })),
    };
  });

export const updateTenant = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      id: z.string(),
      plan: z.string().max(40).optional(),
      maxUsers: z.number().int().min(0).max(100000).optional(),
      monthlyFee: z.number().min(0).optional(),
      currency: z.enum(["TZS", "USD"]).optional(),
      contactName: z.string().max(120).optional(),
      contactEmail: z.string().email().or(z.literal("")).optional(),
      contactPhone: z.string().max(40).optional(),
      notes: z.string().max(2000).optional(),
      paidUntil: dateStr.optional(),
      billingExempt: z.boolean().optional(),
    }).parse(input),
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await requirePlatformAdmin(context.userId);
    const rows = await sql`update organizations set
        plan = coalesce(${data.plan ?? null}::text, plan),
        max_users = coalesce(${data.maxUsers ?? null}::int, max_users),
        monthly_fee = coalesce(${data.monthlyFee ?? null}::numeric, monthly_fee),
        currency = coalesce(${data.currency ?? null}::text, currency),
        contact_name = coalesce(${data.contactName ?? null}::text, contact_name),
        contact_email = coalesce(${data.contactEmail ?? null}::text, contact_email),
        contact_phone = coalesce(${data.contactPhone ?? null}::text, contact_phone),
        notes = coalesce(${data.notes ?? null}::text, notes),
        paid_until = case when ${data.billingExempt ?? false} then null else coalesce(${data.paidUntil ?? null}::date, paid_until) end,
        billing_exempt = coalesce(${data.billingExempt ?? null}::boolean, billing_exempt)
      where id::text = ${data.id} returning id`;
    if (!rows[0]) throw new Error("Company not found");
    await audit(sql, data.id, context.userId, "update", "tenant", data.id, { ...data, id: undefined });
    return { success: true };
  });

export const recordTenantPayment = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      id: z.string(),
      amount: z.number().positive(),
      months: z.number().int().min(1).max(60).default(1),
      paidOn: dateStr.optional(),
      method: z.string().max(40).optional(),
      reference: z.string().max(120).optional(),
    }).parse(input),
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await requirePlatformAdmin(context.userId);
    const org = await sql<{ currency: string }>`select currency from organizations where id::text = ${data.id}`;
    if (!org[0]) throw new Error("Company not found");
    const r = await sql<{ d: string }>`select platform_record_payment(${data.id}, ${data.amount}, ${org[0].currency}, coalesce(${data.paidOn ?? null}::date, current_date),
        ${data.months}, ${data.method ?? null}, ${data.reference ?? null}, ${context.userId})::text as d`;
    await audit(sql, data.id, context.userId, "payment", "tenant", data.id, { amount: data.amount, months: data.months });
    return { paidUntil: r[0]!.d };
  });

export const listTenantPayments = createServerFn({ method: "GET" })
  .validator((id: string | undefined) => id)
  .middleware([authMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    await requirePlatformAdmin(context.userId);
    const rows = await sql<{ id: number; company: string; amount: string | number; currency: string; paid_on: string; period_from: string; period_to: string; months: number; method: string | null; reference: string | null }>`
      select p.id, o.name as company, p.amount, p.currency, p.paid_on::text as paid_on, p.period_from::text as period_from, p.period_to::text as period_to, p.months, p.method, p.reference
      from platform_payments p join organizations o on o.id::text = p.organization_id
      where (${id ?? null}::text is null or p.organization_id = ${id ?? null}) order by p.paid_on desc, p.id desc limit 200`;
    return rows.map((r) => ({ id: r.id, company: r.company, amount: num(r.amount), currency: r.currency, paidOn: r.paid_on, from: r.period_from, to: r.period_to, months: r.months, method: r.method, reference: r.reference }));
  });

/** Message to company administrators (or everyone) of chosen companies. Appears in their notification bell. */
export const broadcastToTenants = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({
      title: z.string().min(2).max(120),
      message: z.string().min(2).max(600),
      audience: z.enum(["admins", "everyone"]).default("admins"),
      companyIds: z.array(z.string()).optional(),
    }).parse(input),
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await requirePlatformAdmin(context.userId);
    const ids = data.companyIds && data.companyIds.length ? data.companyIds : null;
    const sent = await sql<{ id: number }>`insert into notifications (user_id, organization_id, title, message, type)
      select p.user_id, p.organization_id::text, ${data.title}, ${data.message}, 'platform'
      from profiles p join organizations o on o.id::text = p.organization_id::text
      where p.status = 'active' and o.status = 'active' and not p.is_platform_admin
        and (${data.audience === "everyone"} or p.role = 'Admin')
        and (${ids}::text[] is null or o.id::text = any(${ids}::text[]))
      returning id`;
    await audit(sql, null, context.userId, "broadcast", "broadcast", null, { title: data.title, recipients: sent.length });
    return { sent: sent.length };
  });

export const listPlatformActivity = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await requirePlatformAdmin(context.userId);
    const rows = await sql<{ id: number; action: string; entity_type: string; created_at: string; company: string | null; metadata: Record<string, unknown> | null }>`
      select a.id, a.action, a.entity_type, a.created_at, o.name as company, a.metadata
      from audit_log a left join organizations o on o.id::text = a.organization_id::text
      where a.entity_type in ('tenant','broadcast') order by a.created_at desc limit 50`;
    return rows.map((r) => ({ id: r.id, action: r.action, entity: r.entity_type, at: r.created_at, company: r.company, detail: r.metadata ? JSON.stringify(r.metadata) : null }));
  });

export const getPlatformOwnerSecurity = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);
    const authContext = await auth.$context;
    const accounts = await authContext.internalAdapter.findAccounts(context.userId);
    return { hasPassword: accounts.some((account) => account.providerId === "credential" && Boolean(account.password)) };
  });

export const updatePlatformOwnerName = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ fullName: z.string().trim().min(2).max(120) }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await requirePlatformAdmin(context.userId);
    const authContext = await auth.$context;
    await authContext.internalAdapter.updateUser(context.userId, { name: data.fullName });
    const rows = await sql`update profiles set full_name = ${data.fullName}, updated_at = now()
      where user_id = ${context.userId} and is_platform_admin = true returning user_id`;
    if (!rows[0]) throw new Error("Platform owner profile not found");
    await audit(sql, null, context.userId, "rename", "platform_owner", context.userId, { fullName: data.fullName });
    return { success: true, fullName: data.fullName };
  });

export const setPlatformOwnerPassword = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ newPassword: z.string().min(10).max(128) }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await requirePlatformAdmin(context.userId);
    const authContext = await auth.$context;
    const accounts = await authContext.internalAdapter.findAccounts(context.userId);
    if (accounts.some((account) => account.providerId === "credential" && account.password)) {
      throw new Error("A password already exists. Use current password to change it.");
    }
    const request = getRequest();
    if (!request) throw new Error("Could not verify the current owner session");
    await auth.api.setPassword({ body: { newPassword: data.newPassword }, headers: request.headers });
    await audit(sql, null, context.userId, "set_password", "platform_owner", context.userId);
    return { success: true };
  });
