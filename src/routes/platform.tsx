import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Building2, KeyRound, Megaphone, Plus, ReceiptText, ScrollText, LayoutGrid, UserRound } from "lucide-react";
import { RoleGate } from "@/components/role-gate";
import { Field } from "@/components/app-shell";
import { EmptyState, Kpi, Modal, Notice, StatusBadge, btnDanger, btnGhost, btnPrimary, inputCls } from "@/components/ui-kit";
import { createTenant, setTenantStatus } from "@/lib/ehs/server";
import {
  broadcastToTenants, getPlatformOverview, listPlatformActivity, listTenantPayments, listTenantsDetailed, recordTenantPayment, updateTenant, type Tenant,
} from "@/lib/ehs/platform";
import { formatDate, formatMoney, timeAgo, todayIso } from "@/lib/ui/format";
import { errorMessage, useLive } from "@/lib/ui/use-live";
import { authClient } from "@/lib/auth/client";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getPlatformOwnerSecurity, setPlatformOwnerPassword, updatePlatformOwnerName } from "@/lib/ehs/platform";
import type { Profile } from "@/lib/ehs/server";

export const Route = createFileRoute("/platform")({ component: PlatformPage });

function PlatformPage() {
  return <RoleGate path="/platform">{(profile) => <Console profile={profile} />}</RoleGate>;
}

type Section = "overview" | "companies" | "payments" | "broadcast" | "activity" | "account";
const NAV: { id: Section; label: string; icon: typeof Building2 }[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "companies", label: "Companies", icon: Building2 },
  { id: "payments", label: "Rent payments", icon: ReceiptText },
  { id: "broadcast", label: "Announcements", icon: Megaphone },
  { id: "activity", label: "Activity", icon: ScrollText },
  { id: "account", label: "Owner account", icon: UserRound },
];

function Console({ profile }: { profile: Profile }) {
  const [section, setSection] = useState<Section>("overview");
  const [msg, setMsg] = useState("");
  return (
    <div className="mx-auto max-w-7xl gap-8 px-4 py-8 sm:px-6 md:flex">
      <nav aria-label="Platform sections" className="mb-6 flex shrink-0 gap-1 overflow-x-auto md:mb-0 md:w-52 md:flex-col">
        {NAV.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => setSection(n.id)}
            aria-current={section === n.id ? "page" : undefined}
            className={`flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition ${section === n.id ? "bg-accent/10 font-semibold text-accent" : "font-medium text-fg-muted hover:bg-bg-subtle hover:text-fg"}`}
          >
            <n.icon className="size-[18px]" /> {n.label}
          </button>
        ))}
      </nav>
      <main className="min-w-0 flex-1">
        <Notice msg={msg} onClose={() => setMsg("")} />
        {section === "overview" ? <Overview go={setSection} onMsg={setMsg} /> : null}
        {section === "companies" ? <Companies onMsg={setMsg} /> : null}
        {section === "payments" ? <Payments /> : null}
        {section === "broadcast" ? <Broadcast onMsg={setMsg} /> : null}
        {section === "activity" ? <Activity /> : null}
        {section === "account" ? <OwnerAccount profile={profile} onMsg={setMsg} /> : null}
      </main>
    </div>
  );
}

function OwnerAccount({ profile, onMsg }: { profile: Profile; onMsg: (message: string) => void }) {
  const user = useCurrentUser();
  const [fullName, setFullName] = useState(profile.fullName);
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFullName(profile.fullName);
    void getPlatformOwnerSecurity().then((security) => setHasPassword(security.hasPassword)).catch((e) => setError(errorMessage(e)));
  }, [profile.fullName]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Owner account</h1>
        <p className="mt-1 text-sm text-fg-muted">Manage the system owner profile and sign-in password.</p>
      </div>
      <Notice msg={error} tone="danger" />
      <section className="max-w-2xl rounded-xl border border-border bg-bg-elevated p-5">
        <h2 className="mb-1 text-sm font-semibold">Profile</h2>
        <p className="mb-4 text-sm text-fg-muted">{user?.primaryEmail ?? "Owner account"}</p>
        <form className="space-y-3" onSubmit={async (event) => {
          event.preventDefault(); setBusy(true); setError("");
          try {
            const result = await updatePlatformOwnerName({ data: { fullName } });
            setFullName(result.fullName);
            await authClient.getSession();
            onMsg("Owner name updated.");
            window.setTimeout(() => window.location.reload(), 500);
          } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
        }}>
          <Field label="Owner name"><input required minLength={2} maxLength={120} value={fullName} onChange={(event) => setFullName(event.target.value)} className={inputCls} /></Field>
          <button type="submit" disabled={busy || fullName.trim() === profile.fullName} className={btnPrimary}>Save name</button>
        </form>
      </section>
      <section className="max-w-2xl rounded-xl border border-border bg-bg-elevated p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold"><KeyRound className="size-4 text-accent" /> Password</h2>
        <p className="mb-4 text-sm text-fg-muted">{hasPassword === false ? "Set a password for this Google account." : "Use your current password to choose a new one."}</p>
        <form className="space-y-3" onSubmit={async (event) => {
          event.preventDefault(); setError("");
          if (newPassword.length < 10) return setError("New password must be at least 10 characters");
          if (newPassword !== confirmPassword) return setError("New passwords do not match");
          setBusy(true);
          try {
            if (hasPassword) {
              const result = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
              if (result.error) throw new Error(result.error.message || "Could not change password");
            } else {
              await setPlatformOwnerPassword({ data: { newPassword } });
              setHasPassword(true);
            }
            setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
            onMsg(hasPassword ? "Password changed." : "Password set.");
          } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
        }}>
          {hasPassword ? <Field label="Current password"><input required type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className={inputCls} /></Field> : null}
          <Field label="New password"><input required minLength={10} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className={inputCls} /></Field>
          <Field label="Confirm new password"><input required minLength={10} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className={inputCls} /></Field>
          <button type="submit" disabled={busy || hasPassword === null} className={btnPrimary}>{hasPassword ? "Change password" : "Set password"}</button>
        </form>
      </section>
    </div>
  );
}

function Title({ title, hint, action }: { title: string; hint: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-1 text-sm text-fg-muted">{hint}</p></div>
      {action}
    </div>
  );
}

function Overview({ go, onMsg }: { go: (s: Section) => void; onMsg: (m: string) => void }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof getPlatformOverview>> | null>(null);
  const [pay, setPay] = useState<Tenant | null>(null);
  const load = useCallback(async () => setD(await getPlatformOverview().catch(() => null)), []);
  useLive(load, 30000);
  if (!d) return <p className="text-sm text-fg-muted">Loading…</p>;
  const money = (rows: { currency: string; amount: number }[]) => (rows.length ? rows.map((r) => formatMoney(r.amount, r.currency)).join(" + ") : "0");
  return (
    <div className="space-y-6">
      <Title title="Overview" hint="Your companies, their rent and who needs a reminder." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Companies" value={d.active} hint={d.suspended ? `${d.suspended} suspended` : "All active"} />
        <Kpi label="Users across companies" value={d.users} />
        <Kpi label="Monthly rent (MRR)" value={money(d.mrr)} />
        <Kpi label="Collected this month" value={money(d.collectedThisMonth)} tone="ok" />
      </div>
      <section className="rounded-xl border border-border bg-bg-elevated p-5">
        <h2 className="mb-3 text-sm font-semibold">Needs attention</h2>
        {d.overdue.length + d.dueSoon.length === 0 ? <p className="text-sm text-fg-muted">Every company is paid up.</p> : (
          <ul className="divide-y divide-border">
            {[...d.overdue, ...d.dueSoon].map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{t.name}</span><span className="text-xs text-fg-muted">{formatMoney(t.monthlyFee, t.currency)} a month · paid until {formatDate(t.paidUntil)}</span></span>
                <StatusBadge status={t.billing} />
                <button type="button" className={btnGhost} onClick={() => setPay(t)}>Record payment</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-xl border border-border bg-bg-elevated p-5">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Recent payments</h2><button type="button" className="text-xs text-accent hover:underline" onClick={() => go("payments")}>See all</button></div>
        {d.recentPayments.length === 0 ? <p className="text-sm text-fg-muted">No payments recorded yet.</p> : (
          <ul className="divide-y divide-border">{d.recentPayments.map((p) => (<li key={p.id} className="flex justify-between py-2 text-sm"><span>{p.company} <span className="text-fg-muted">· {formatDate(p.paidOn)} · {p.method ?? "n/a"}</span></span><span className="tabular-nums">{formatMoney(p.amount, p.currency)}</span></li>))}</ul>
        )}
      </section>
      {pay ? <PaymentDialog tenant={pay} onClose={() => setPay(null)} onDone={(m) => { setPay(null); onMsg(m); void load(); }} /> : null}
    </div>
  );
}

function Companies({ onMsg }: { onMsg: (m: string) => void }) {
  const [rows, setRows] = useState<Tenant[]>([]);
  const [open, setOpen] = useState<Tenant | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(async () => setRows(await listTenantsDetailed().catch(() => [])), []);
  useLive(load, 30000);
  const th = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-fg-subtle";
  return (
    <div>
      <Title title="Companies" hint="Each company has its own users, books and safety records. You never see inside them." action={<button type="button" className={btnPrimary} onClick={() => setCreating(true)}><Plus className="size-4" /> New company</button>} />
      {rows.length === 0 ? <EmptyState title="No companies yet" /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-bg-elevated">
          <table className="w-full min-w-[820px]">
            <thead className="border-b border-border"><tr><th className={th}>Company</th><th className={th}>Plan</th><th className={th}>Users</th><th className={th}>Rent</th><th className={th}>Paid until</th><th className={th}>Billing</th><th className={th}>Status</th><th className={th}>Last active</th></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((t) => (
                <tr key={t.id} onClick={() => setOpen(t)} className="cursor-pointer hover:bg-bg-subtle/60">
                  <td className="px-3 py-3"><p className="text-sm font-medium">{t.name}</p><p className="text-xs text-fg-muted">{t.slug}</p></td>
                  <td className="px-3 py-3 text-sm capitalize">{t.plan}</td>
                  <td className="px-3 py-3 text-sm tabular-nums">{t.users}{t.maxUsers ? ` / ${t.maxUsers}` : ""}</td>
                  <td className="px-3 py-3 text-sm tabular-nums">{t.monthlyFee ? formatMoney(t.monthlyFee, t.currency) : "Free"}</td>
                  <td className="px-3 py-3 text-sm">{formatDate(t.paidUntil)}</td>
                  <td className="px-3 py-3"><StatusBadge status={t.billing} /></td>
                  <td className="px-3 py-3"><StatusBadge status={t.status} /></td>
                  <td className="px-3 py-3 text-sm text-fg-muted">{t.lastActive ? timeAgo(t.lastActive) : "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open ? <TenantDialog tenant={open} onClose={() => setOpen(null)} onDone={(m) => { setOpen(null); onMsg(m); void load(); }} /> : null}
      {creating ? <NewCompany onClose={() => setCreating(false)} onDone={(m) => { setCreating(false); onMsg(m); void load(); }} /> : null}
    </div>
  );
}

function TenantDialog({ tenant: t, onClose, onDone }: { tenant: Tenant; onClose: () => void; onDone: (m: string) => void }) {
  const [f, setF] = useState({ plan: t.plan, maxUsers: String(t.maxUsers), monthlyFee: String(t.monthlyFee), paidUntil: t.paidUntil ?? "", billingExempt: t.billingExempt, contactName: t.contactName ?? "", contactEmail: t.contactEmail ?? "", contactPhone: t.contactPhone ?? "", notes: t.notes ?? "" });
  const [err, setErr] = useState("");
  const [paying, setPaying] = useState(false);
  if (paying) return <PaymentDialog tenant={t} onClose={() => setPaying(false)} onDone={onDone} />;
  return (
    <Modal title={t.name} onClose={onClose} wide>
      <Notice msg={err} tone="danger" />
      <div className="mb-4 flex flex-wrap items-center gap-2"><StatusBadge status={t.status} /><StatusBadge status={t.billing} /><span className="text-sm text-fg-muted">{t.users} active users · {t.billingExempt ? "expiry waived" : `plan ends ${formatDate(t.paidUntil)}`}</span></div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Plan"><input value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} className={inputCls} /></Field>
        <Field label="User limit (0 = no limit)"><input inputMode="numeric" value={f.maxUsers} onChange={(e) => setF({ ...f, maxUsers: e.target.value.replace(/\D/g, "") })} className={inputCls} /></Field>
        <Field label={`Monthly rent (${t.currency})`}><input inputMode="decimal" value={f.monthlyFee} onChange={(e) => setF({ ...f, monthlyFee: e.target.value.replace(/[^0-9.]/g, "") })} className={inputCls} /></Field>
        <Field label="Plan expiry"><input type="date" value={f.paidUntil} disabled={f.billingExempt} onChange={(e) => setF({ ...f, paidUntil: e.target.value })} className={inputCls} /></Field>
        <Field label="Contact person"><input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} className={inputCls} /></Field>
        <Field label="Contact email"><input type="email" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} className={inputCls} /></Field>
        <Field label="Contact phone"><input value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} className={inputCls} /></Field>
      </div>
      <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={f.billingExempt} onChange={(e) => setF({ ...f, billingExempt: e.target.checked })} className="mt-0.5 accent-accent" /><span><span className="font-medium">Waive plan expiry</span><span className="block text-xs text-fg-muted">Keep this company active after its paid period ends.</span></span></label>
      <div className="mt-3"><Field label="Private notes"><textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className={inputCls} /></Field></div>
      <div className="mt-5 flex flex-wrap justify-between gap-2">
        <div className="flex gap-2">
          <button type="button" className={btnGhost} onClick={() => setPaying(true)}><ReceiptText className="size-4" /> Record payment</button>
          <button type="button" className={t.status === "active" ? btnDanger : btnGhost} onClick={async () => {
            const next = t.status === "active" ? "suspended" : "active";
            if (next === "suspended" && !window.confirm(`Suspend ${t.name}? Nobody in the company will be able to sign in.`)) return;
            try { await setTenantStatus({ data: { id: t.id, status: next } }); onDone(`${t.name} ${next}`); } catch (e) { setErr(errorMessage(e)); }
          }}>{t.status === "active" ? "Suspend" : "Reactivate"}</button>
        </div>
        <div className="flex gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
          <button type="button" className={btnPrimary} onClick={async () => {
            if (!f.billingExempt && Number(f.monthlyFee) > 0 && !f.paidUntil) { setErr("Choose a plan expiry date or waive expiry."); return; }
            try { await updateTenant({ data: { id: t.id, plan: f.plan, maxUsers: Number(f.maxUsers) || 0, monthlyFee: Number(f.monthlyFee) || 0, paidUntil: f.paidUntil || undefined, billingExempt: f.billingExempt, contactName: f.contactName, contactEmail: f.contactEmail, contactPhone: f.contactPhone, notes: f.notes } }); onDone(`${t.name} updated`); } catch (e) { setErr(errorMessage(e)); }
          }}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

function PaymentDialog({ tenant: t, onClose, onDone }: { tenant: Tenant; onClose: () => void; onDone: (m: string) => void }) {
  const [months, setMonths] = useState("1");
  const [amount, setAmount] = useState(String(t.monthlyFee || ""));
  const [method, setMethod] = useState("Bank");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(todayIso());
  const [err, setErr] = useState("");
  return (
    <Modal title={`Rent payment: ${t.name}`} onClose={onClose}>
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        try { const r = await recordTenantPayment({ data: { id: t.id, amount: Number(amount), months: Number(months) || 1, paidOn: date, method, reference: reference || undefined } }); onDone(`Payment recorded. ${t.name} is paid until ${formatDate(r.paidUntil)}`); } catch (x) { setErr(errorMessage(x)); }
      }}>
        <Notice msg={err} tone="danger" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Months paid for"><input inputMode="numeric" value={months} onChange={(e) => { const m = e.target.value.replace(/\D/g, ""); setMonths(m); if (t.monthlyFee) setAmount(String(t.monthlyFee * (Number(m) || 1))); }} className={inputCls} /></Field>
          <Field label={`Amount (${t.currency})`}><input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} className={inputCls} /></Field>
          <Field label="Method"><select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}><option>Bank</option><option>Cash</option><option>M-Pesa</option><option>Tigo Pesa</option><option>Airtel Money</option></select></Field>
          <Field label="Date"><input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
        </div>
        <Field label="Reference"><input value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} /></Field>
        <div className="flex justify-end gap-2"><button type="button" className={btnGhost} onClick={onClose}>Cancel</button><button type="submit" className={btnPrimary}>Record payment</button></div>
      </form>
    </Modal>
  );
}

function NewCompany({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const [f, setF] = useState({ name: "", slug: "", adminName: "", adminEmail: "", adminPassword: "", currency: "TZS" as "TZS" | "USD", plan: "standard", maxUsers: "0", monthlyFee: "0", planDays: "0" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="New company" onClose={onClose} wide>
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr("");
        try { await createTenant({ data: { name: f.name, slug: f.slug, adminName: f.adminName, adminEmail: f.adminEmail, adminPassword: f.adminPassword, currency: f.currency, vatRate: 18, plan: f.plan, maxUsers: Number(f.maxUsers) || 0, monthlyFee: Number(f.monthlyFee) || 0, planDays: Number(f.planDays) || 0 } }); onDone(`${f.name} created. Share the administrator's login with them.`); } catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
      }}>
        <Notice msg={err} tone="danger" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company name"><input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: f.slug || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) })} className={inputCls} /></Field>
          <Field label="Company code"><input required value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} className={inputCls} /></Field>
          <Field label="Currency"><select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as "TZS" | "USD" })} className={inputCls}><option>TZS</option><option>USD</option></select></Field>
          <Field label="Plan"><input value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} className={inputCls} /></Field>
          <Field label="User limit (0 = no limit)"><input inputMode="numeric" value={f.maxUsers} onChange={(e) => setF({ ...f, maxUsers: e.target.value.replace(/\D/g, "") })} className={inputCls} /></Field>
          <Field label="Monthly rent"><input inputMode="decimal" value={f.monthlyFee} onChange={(e) => setF({ ...f, monthlyFee: e.target.value.replace(/[^0-9.]/g, "") })} className={inputCls} /></Field>
          <Field label="Plan duration (days; 0 = no expiry)"><input inputMode="numeric" value={f.planDays} onChange={(e) => setF({ ...f, planDays: e.target.value.replace(/\D/g, "") })} className={inputCls} /></Field>
        </div>
        <hr className="border-border" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Administrator name"><input required value={f.adminName} onChange={(e) => setF({ ...f, adminName: e.target.value })} className={inputCls} /></Field>
          <Field label="Administrator email"><input required type="email" value={f.adminEmail} onChange={(e) => setF({ ...f, adminEmail: e.target.value })} className={inputCls} /></Field>
          <Field label="Temporary password (10+)"><input required minLength={10} value={f.adminPassword} onChange={(e) => setF({ ...f, adminPassword: e.target.value })} className={inputCls} /></Field>
        </div>
        <div className="flex justify-end gap-2"><button type="button" className={btnGhost} onClick={onClose}>Cancel</button><button type="submit" disabled={busy} className={btnPrimary}>Create company</button></div>
      </form>
    </Modal>
  );
}

function Payments() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listTenantPayments>>>([]);
  const load = useCallback(async () => setRows(await listTenantPayments({ data: undefined }).catch(() => [])), []);
  useLive(load, 60000);
  const th = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-fg-subtle";
  return (
    <div>
      <Title title="Rent payments" hint="Every payment you have recorded from your companies." />
      {rows.length === 0 ? <EmptyState title="No payments yet" hint="Record a payment from the company's page or from Overview." /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-bg-elevated">
          <table className="w-full min-w-[640px]"><thead className="border-b border-border"><tr><th className={th}>Company</th><th className={th}>Paid on</th><th className={th}>Covers</th><th className={th}>Method</th><th className={`${th} text-right`}>Amount</th></tr></thead>
            <tbody className="divide-y divide-border">{rows.map((p) => (<tr key={p.id}><td className="px-3 py-3 text-sm font-medium">{p.company}</td><td className="px-3 py-3 text-sm">{formatDate(p.paidOn)}</td><td className="px-3 py-3 text-sm text-fg-muted">{formatDate(p.from)} to {formatDate(p.to)}</td><td className="px-3 py-3 text-sm">{p.method ?? "n/a"}{p.reference ? ` · ${p.reference}` : ""}</td><td className="px-3 py-3 text-right text-sm tabular-nums">{formatMoney(p.amount, p.currency)}</td></tr>))}</tbody></table>
        </div>
      )}
    </div>
  );
}

function Broadcast({ onMsg }: { onMsg: (m: string) => void }) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState<"admins" | "everyone">("admins");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useLive(async () => setTenants(await listTenantsDetailed().catch(() => [])), 120000);
  return (
    <div>
      <Title title="Announcements" hint="Send a notice to your companies. It appears in their notification bell." />
      <form className="max-w-2xl space-y-3 rounded-xl border border-border bg-bg-elevated p-5" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true);
        try { const r = await broadcastToTenants({ data: { title, message, audience, companyIds: picked } }); onMsg(`Sent to ${r.sent} people`); setTitle(""); setMessage(""); } catch (x) { onMsg(errorMessage(x)); } finally { setBusy(false); }
      }}>
        <Field label="Title"><input required value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} /></Field>
        <Field label="Message"><textarea required rows={4} value={message} onChange={(e) => setMessage(e.target.value)} className={inputCls} /></Field>
        <Field label="Send to"><select value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)} className={inputCls}><option value="admins">Company administrators only</option><option value="everyone">Everyone in the company</option></select></Field>
        <fieldset><legend className="mb-1.5 text-xs font-medium uppercase tracking-wider text-fg-subtle">Companies (none ticked = all active companies)</legend>
          <div className="grid gap-1 sm:grid-cols-2">{tenants.filter((t) => t.status === "active").map((t) => (<label key={t.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={picked.includes(t.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, t.id] : picked.filter((x) => x !== t.id))} /> {t.name}</label>))}</div>
        </fieldset>
        <button type="submit" disabled={busy} className={btnPrimary}><Megaphone className="size-4" /> Send announcement</button>
      </form>
    </div>
  );
}

function Activity() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listPlatformActivity>>>([]);
  useLive(async () => setRows(await listPlatformActivity().catch(() => [])), 30000);
  return (
    <div>
      <Title title="Activity" hint="What you and your team changed at platform level." />
      {rows.length === 0 ? <EmptyState title="Nothing yet" /> : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-bg-elevated">
          {rows.map((r) => (<li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span><span className="font-medium capitalize">{r.action}</span> <span className="text-fg-muted">{r.entity}{r.company ? ` · ${r.company}` : ""}</span></span><span className="text-xs text-fg-subtle">{timeAgo(r.at)}</span></li>))}
        </ul>
      )}
    </div>
  );
}
