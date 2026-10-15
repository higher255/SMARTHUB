import { useCallback, useMemo, useState } from "react";
import { BookOpen, Download, FilePlus2, Plus, Printer, Receipt, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { Field } from "@/components/app-shell";
import { EmptyState, Kpi, Modal, Notice, StatusBadge, TabBar, btnDanger, btnGhost, btnPrimary, inputCls } from "@/components/ui-kit";
import { useOrgBrand } from "@/components/workspace-bar";
import { can } from "@/lib/ehs/access";
import {
  createAccount, createInvoice, createParty, createPurchaseOrder, deleteDraftInvoice, getBalanceSheet, getGeneralLedger, getIncomeStatement,
  getInvoice, getReceivablesAging, getTrialBalance, issueInvoice, listAccounts, listInvoices, listJournalEntries, listParties, listPurchaseOrders,
  postJournal, receiveInvoicePayment, reverseJournalEntry, voidInvoice,
  type Account, type FinanceInvoice, type InvoiceDetail, type JournalEntryRow, type Party, type PurchaseOrder,
} from "@/lib/ehs/finance";
import type { Profile } from "@/lib/ehs/server";
import { formatDate, formatMoney, todayIso } from "@/lib/ui/format";
import { errorMessage, useLive } from "@/lib/ui/use-live";
import { PayablesWorkspace, ReconciliationWorkspace, VatWorkspace } from "./operations";
import { MoneyInput } from "@/components/finance/money-input";

type Sub = "invoices" | "bills" | "banking" | "tax" | "journal" | "reports" | "accounts" | "orders";

export function AccountingWorkspace({ profile, projects }: { profile: Profile; projects: { id: number; name: string }[] }) {
  const [sub, setSub] = useState<Sub>("invoices");
  const tabs = useMemo(
    () => [
      { id: "invoices" as const, label: "Invoices" },
      { id: "bills" as const, label: "Bills & Payables" },
      { id: "banking" as const, label: "Bank reconciliation" },
      ...(can(profile, "accounts.reports") ? [{ id: "tax" as const, label: "VAT" }] : []),
      { id: "journal" as const, label: "Journal" },
      ...(can(profile, "accounts.reports") ? [{ id: "reports" as const, label: "Reports" }] : []),
      { id: "accounts" as const, label: "Chart of accounts" },
      { id: "orders" as const, label: "Purchase orders" },
    ],
    [profile],
  );
  return (
    <div>
      <TabBar tabs={tabs} active={sub} onChange={setSub} />
      {sub === "invoices" ? <Invoices profile={profile} projects={projects} /> : null}
      {sub === "bills" ? <PayablesWorkspace profile={profile} projects={projects} /> : null}
      {sub === "banking" ? <ReconciliationWorkspace profile={profile} /> : null}
      {sub === "tax" ? <VatWorkspace /> : null}
      {sub === "journal" ? <Journal profile={profile} /> : null}
      {sub === "reports" ? <Reports /> : null}
      {sub === "accounts" ? <Accounts profile={profile} /> : null}
      {sub === "orders" ? <Orders profile={profile} projects={projects} /> : null}
    </div>
  );
}

const th = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-fg-subtle";
const td = "px-3 py-2.5 text-sm";
const num = "px-3 py-2.5 text-right text-sm tabular-nums";

// ---------------------------------------------------------------- invoices

function Invoices({ profile, projects }: { profile: Profile; projects: { id: number; name: string }[] }) {
  const brand = useOrgBrand();
  const currency = brand?.currency ?? "TZS";
  const canEdit = can(profile, "accounts.invoices");
  const [rows, setRows] = useState<FinanceInvoice[]>([]);
  const [msg, setMsg] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const load = useCallback(async () => setRows(await listInvoices().catch(() => [])), []);
  useLive(load, 30000);

  const outstanding = rows.filter((r) => ["Issued", "Partially Paid"].includes(r.status)).reduce((s, r) => s + r.total - r.amountPaid, 0);
  const overdue = rows.filter((r) => ["Issued", "Partially Paid"].includes(r.status) && r.dueDate && r.dueDate < todayIso()).reduce((s, r) => s + r.total - r.amountPaid, 0);
  const billed = rows.filter((r) => r.status !== "Draft" && r.status !== "Void").reduce((s, r) => s + r.total, 0);

  return (
    <div className="space-y-5">
      <Notice msg={msg} onClose={() => setMsg("")} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Billed" value={formatMoney(billed, currency)} />
        <Kpi label="Outstanding" value={formatMoney(outstanding, currency)} tone={outstanding ? "warn" : undefined} />
        <Kpi label="Overdue" value={formatMoney(overdue, currency)} tone={overdue ? "danger" : undefined} />
      </div>
      <div className="flex justify-end">
        {canEdit ? <button type="button" className={btnPrimary} onClick={() => setCreating(true)}><FilePlus2 className="size-4" /> New invoice</button> : null}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No invoices yet" hint="Create an invoice for a client, issue it to post it to the books, then record receipts as money comes in." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-bg-elevated">
          <table className="w-full min-w-[720px]">
            <thead className="border-b border-border"><tr><th className={th}>Number</th><th className={th}>Customer</th><th className={th}>Date</th><th className={th}>Due</th><th className={`${th} text-right`}>Total</th><th className={`${th} text-right`}>Balance</th><th className={th}>Status</th></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setOpenId(r.id)} className="cursor-pointer hover:bg-bg-subtle/60">
                  <td className={`${td} font-medium`}>{r.invoiceNumber}</td>
                  <td className={td}>{r.customerName}</td>
                  <td className={td}>{formatDate(r.issueDate)}</td>
                  <td className={td}>{formatDate(r.dueDate)}</td>
                  <td className={num}>{formatMoney(r.total, r.currency)}</td>
                  <td className={num}>{formatMoney(r.total - r.amountPaid, r.currency)}</td>
                  <td className={td}><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating ? <InvoiceForm projects={projects} defaultVat={brand?.vatRate ?? 18} currency={currency} onClose={() => setCreating(false)} onDone={(m) => { setCreating(false); setMsg(m); void load(); }} /> : null}
      {openId ? <InvoiceView id={openId} canEdit={canEdit} onClose={() => setOpenId(null)} onChanged={(m) => { setMsg(m); void load(); }} /> : null}
    </div>
  );
}

function InvoiceForm({ projects, defaultVat, currency, onClose, onDone }: { projects: { id: number; name: string }[]; defaultVat: number; currency: string; onClose: () => void; onDone: (m: string) => void }) {
  const [customers, setCustomers] = useState<Party[]>([]);
  const [customer, setCustomer] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<number | "">("");
  const [issueDate, setIssueDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState("");
  const [vat, setVat] = useState(String(defaultVat));
  const [saveCustomer, setSaveCustomer] = useState(false);
  const [lines, setLines] = useState([{ description: "", quantity: "1", unitPrice: "" }]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useLive(async () => setCustomers(await listParties({ data: "customer" }).catch(() => [])), 600000);

  const subtotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
  const vatAmount = Math.round(subtotal * (Number(vat) || 0)) / 100;
  const existing = customers.find((c) => c.name.toLowerCase() === customer.trim().toLowerCase());

  const submit = async () => {
    setErr("");
    const clean = lines.filter((l) => l.description.trim() && Number(l.quantity) > 0);
    if (!customer.trim()) return setErr("Please enter the customer");
    if (clean.length === 0) return setErr("Add at least one line with a description");
    setBusy(true);
    try {
      let customerId = existing?.id;
      if (!customerId && saveCustomer) customerId = (await createParty({ data: { kind: "customer", name: customer.trim() } })).id;
      const r = await createInvoice({
        data: {
          customerId, customerName: customer.trim(), description: description.trim() || clean[0]!.description, projectId: projectId ? Number(projectId) : undefined,
          issueDate, dueDate: dueDate || undefined, vatRate: Number(vat) || 0,
          lines: clean.map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) || 0 })),
        },
      });
      onDone(`${r.invoiceNumber} saved as draft. Issue it to post it to the books.`);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <Modal title="New invoice" onClose={onClose} wide>
      <div className="space-y-4">
        <Notice msg={err} tone="danger" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Customer">
            <input list="customer-list" value={customer} onChange={(e) => setCustomer(e.target.value)} className={inputCls} placeholder="Vodacom Tanzania" />
            <datalist id="customer-list">{customers.map((c) => <option key={c.id} value={c.name} />)}</datalist>
          </Field>
          <Field label="Project (optional)"><select value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : "")} className={inputCls}><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Invoice date"><input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={inputCls} /></Field>
          <Field label="Due date"><input type="date" value={dueDate} min={issueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} /></Field>
        </div>
        <Field label="Description"><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Fibre survey, Kinondoni" className={inputCls} /></Field>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[560px]">
            <thead className="border-b border-border bg-bg-subtle/60"><tr><th className={th}>Item</th><th className={`${th} w-24`}>Qty</th><th className={`${th} w-36`}>Unit price</th><th className={`${th} w-36 text-right`}>Amount</th><th className="w-10" /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="p-2"><input value={l.description} onChange={(e) => setLines((cur) => cur.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} className={inputCls} /></td>
                  <td className="p-2"><input inputMode="decimal" value={l.quantity} onChange={(e) => setLines((cur) => cur.map((x, j) => (j === i ? { ...x, quantity: e.target.value.replace(/[^0-9.]/g, "") } : x)))} className={inputCls} /></td>
                  <td className="p-2"><MoneyInput value={l.unitPrice} onChange={(unitPrice) => setLines((cur) => cur.map((x, j) => (j === i ? { ...x, unitPrice } : x)))} className={inputCls} /></td>
                  <td className={num}>{formatMoney((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), currency)}</td>
                  <td className="p-2"><button type="button" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))} className="rounded p-1.5 text-fg-muted hover:bg-bg-subtle disabled:opacity-30"><Trash2 className="size-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className={btnGhost} onClick={() => setLines((cur) => [...cur, { description: "", quantity: "1", unitPrice: "" }])}><Plus className="size-4" /> Add line</button>

        <div className="ml-auto max-w-xs space-y-1.5 text-sm">
          <div className="flex justify-between"><span className="text-fg-muted">Subtotal</span><span className="tabular-nums">{formatMoney(subtotal, currency)}</span></div>
          <div className="flex items-center justify-between gap-2"><span className="text-fg-muted">VAT %</span><input inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value.replace(/[^0-9.]/g, ""))} className={`${inputCls} w-20 text-right`} /><span className="tabular-nums">{formatMoney(vatAmount, currency)}</span></div>
          <div className="flex justify-between border-t border-border pt-1.5 font-semibold"><span>Total</span><span className="tabular-nums">{formatMoney(subtotal + vatAmount, currency)}</span></div>
        </div>
        {!existing && customer.trim() ? <label className="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={saveCustomer} onChange={(e) => setSaveCustomer(e.target.checked)} /> Save {customer.trim()} to my customers</label> : null}
        <div className="flex justify-end gap-2"><button type="button" className={btnGhost} onClick={onClose}>Cancel</button><button type="button" className={btnPrimary} disabled={busy} onClick={() => void submit()}>{busy ? "Saving…" : "Save draft"}</button></div>
      </div>
    </Modal>
  );
}

function InvoiceView({ id, canEdit, onClose, onChanged }: { id: number; canEdit: boolean; onClose: () => void; onChanged: (m: string) => void }) {
  const brand = useOrgBrand();
  const [inv, setInv] = useState<InvoiceDetail | null>(null);
  const [err, setErr] = useState("");
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"Cash" | "Bank" | "M-Pesa" | "Tigo Pesa" | "Airtel Money" | "Cheque">("Bank");
  const [reference, setReference] = useState("");
  const [payDate, setPayDate] = useState(todayIso());
  const load = useCallback(async () => setInv(await getInvoice({ data: id }).catch((e) => { setErr(errorMessage(e)); return null; })), [id]);
  useLive(load, 60000);
  if (!inv) return <Modal title="Invoice" onClose={onClose}><Notice msg={err} tone="danger" /><p className="text-sm text-fg-muted">Loading…</p></Modal>;

  const balance = inv.total - inv.amountPaid;
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setErr("");
    try { await fn(); onChanged(done); await load(); setPaying(false); } catch (e) { setErr(errorMessage(e)); }
  };

  return (
    <Modal title={inv.invoiceNumber} onClose={onClose} wide>
      <Notice msg={err} tone="danger" />
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <StatusBadge status={inv.status} />
        <span className="flex-1" />
        <button type="button" className={btnGhost} onClick={() => window.print()}><Printer className="size-4" /> Print or save PDF</button>
        {canEdit && inv.status === "Draft" ? <button type="button" className={btnPrimary} onClick={() => void act(() => issueInvoice({ data: inv.id }), `${inv.invoiceNumber} issued and posted to the books`)}>Issue invoice</button> : null}
        {canEdit && ["Issued", "Partially Paid"].includes(inv.status) ? <button type="button" className={btnPrimary} onClick={() => { setPaying(true); setAmount(String(balance)); }}><Receipt className="size-4" /> Receive payment</button> : null}
        {canEdit && inv.status === "Draft" ? <button type="button" className={btnDanger} onClick={() => void act(async () => { await deleteDraftInvoice({ data: inv.id }); onClose(); }, "Draft deleted")}><Trash2 className="size-4" /> Delete</button> : null}
        {canEdit && ["Issued"].includes(inv.status) ? <button type="button" className={btnDanger} onClick={() => { const reason = window.prompt("Why is this invoice being voided?"); if (reason) void act(() => voidInvoice({ data: { id: inv.id, reason } }), `${inv.invoiceNumber} voided`); }}><Undo2 className="size-4" /> Void</button> : null}
      </div>

      {paying ? (
        <div className="mb-5 grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-4 print:hidden">
          <Field label="Amount"><MoneyInput value={amount} onChange={setAmount} className={inputCls} /></Field>
          <Field label="Method"><select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} className={inputCls}><option>Bank</option><option>Cash</option><option>M-Pesa</option><option>Tigo Pesa</option><option>Airtel Money</option><option>Cheque</option></select></Field>
          <Field label="Date"><input type="date" value={payDate} max={todayIso()} onChange={(e) => setPayDate(e.target.value)} className={inputCls} /></Field>
          <Field label="Reference"><input value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} /></Field>
          <div className="flex gap-2 sm:col-span-4"><button type="button" className={btnPrimary} onClick={() => void act(() => receiveInvoicePayment({ data: { id: inv.id, amount: Number(amount), method, reference: reference || undefined, payDate } }), "Payment recorded")}>Record receipt</button><button type="button" className={btnGhost} onClick={() => setPaying(false)}>Cancel</button></div>
        </div>
      ) : null}

      <article className="print-area rounded-xl border border-border bg-bg p-6">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-lg font-semibold">{brand?.displayName ?? ""}</p>
            <p className="text-xs text-fg-muted">TAX INVOICE</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold">{inv.invoiceNumber}</p>
            <p className="text-fg-muted">Date {formatDate(inv.issueDate)}</p>
            {inv.dueDate ? <p className="text-fg-muted">Due {formatDate(inv.dueDate)}</p> : null}
          </div>
        </header>
        <div className="mb-6 text-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Bill to</p>
          <p className="font-medium">{inv.customerName}</p>
          {inv.customerTin ? <p className="text-fg-muted">TIN {inv.customerTin}</p> : null}
          {inv.customerAddress ? <p className="text-fg-muted">{inv.customerAddress}</p> : null}
        </div>
        <table className="mb-4 w-full">
          <thead className="border-b border-border"><tr><th className={th}>Description</th><th className={`${th} text-right`}>Qty</th><th className={`${th} text-right`}>Unit price</th><th className={`${th} text-right`}>Amount</th></tr></thead>
          <tbody className="divide-y divide-border">
            {inv.lines.map((l) => (<tr key={l.id}><td className={td}>{l.description}</td><td className={num}>{l.quantity}</td><td className={num}>{formatMoney(l.unitPrice, inv.currency)}</td><td className={num}>{formatMoney(l.lineTotal, inv.currency)}</td></tr>))}
          </tbody>
        </table>
        <div className="ml-auto max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-fg-muted">Subtotal</span><span className="tabular-nums">{formatMoney(inv.subtotal || inv.lines.reduce((s, l) => s + l.lineTotal, 0), inv.currency)}</span></div>
          <div className="flex justify-between"><span className="text-fg-muted">VAT {inv.vatRate}%</span><span className="tabular-nums">{formatMoney(inv.vatAmount, inv.currency)}</span></div>
          <div className="flex justify-between border-t border-border pt-1 font-semibold"><span>Total</span><span className="tabular-nums">{formatMoney(inv.total || inv.subtotal, inv.currency)}</span></div>
          {inv.amountPaid > 0 ? <div className="flex justify-between"><span className="text-fg-muted">Paid</span><span className="tabular-nums">{formatMoney(inv.amountPaid, inv.currency)}</span></div> : null}
          {inv.status !== "Draft" ? <div className="flex justify-between font-semibold"><span>Balance due</span><span className="tabular-nums">{formatMoney(balance, inv.currency)}</span></div> : null}
        </div>
        {inv.payments.length ? (
          <div className="mt-6 text-sm">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Receipts</p>
            <ul className="space-y-0.5">{inv.payments.map((p) => (<li key={p.id} className="flex justify-between"><span>{p.receiptNo} · {formatDate(p.payDate)} · {p.method}{p.reference ? ` · ${p.reference}` : ""}</span><span className="tabular-nums">{formatMoney(p.amount, inv.currency)}</span></li>))}</ul>
          </div>
        ) : null}
        {inv.notes ? <p className="mt-6 text-sm text-fg-muted">{inv.notes}</p> : null}
      </article>
    </Modal>
  );
}

// ---------------------------------------------------------------- journal

function Journal({ profile }: { profile: Profile }) {
  const canPost = can(profile, "accounts.post");
  const [rows, setRows] = useState<JournalEntryRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    setRows(await listJournalEntries({}).catch(() => []));
    setAccounts(await listAccounts().catch(() => []));
  }, []);
  useLive(load, 30000);
  return (
    <div className="space-y-4">
      <Notice msg={msg} onClose={() => setMsg("")} />
      <div className="flex items-center justify-between">
        <p className="text-sm text-fg-muted">Every invoice, receipt and payment posts here automatically. Manual vouchers must balance.</p>
        {canPost ? <button type="button" className={btnPrimary} onClick={() => setOpen(true)}><BookOpen className="size-4" /> Journal voucher</button> : null}
      </div>
      {rows.length === 0 ? <EmptyState title="No entries yet" hint="Entries appear as soon as you issue an invoice, receive money or pay a request." /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-bg-elevated">
          <table className="w-full min-w-[640px]">
            <thead className="border-b border-border"><tr><th className={th}>No.</th><th className={th}>Date</th><th className={th}>Memo</th><th className={th}>Source</th><th className={`${th} text-right`}>Amount</th><th className="w-10" /></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className={`${td} font-medium`}>{r.entryNo}</td><td className={td}>{formatDate(r.entryDate)}</td>
                  <td className={td}>{r.memo}{r.status === "Reversed" ? <span className="ml-2 text-xs text-fg-subtle">(reversed)</span> : null}</td>
                  <td className={`${td} capitalize text-fg-muted`}>{r.sourceType.replace("_", " ")}</td><td className={num}>{formatMoney(r.total)}</td>
                  <td className="px-2">
                    {canPost && r.status === "Posted" && r.sourceType !== "reversal" ? (
                      <button type="button" title="Reverse entry" aria-label="Reverse entry" className="rounded p-1.5 text-fg-muted hover:bg-bg-subtle" onClick={async () => { const reason = window.prompt("Reason for reversing this entry?"); if (!reason) return; try { await reverseJournalEntry({ data: { id: r.id, reason } }); setMsg(`${r.entryNo} reversed`); void load(); } catch (e) { setMsg(errorMessage(e)); } }}><RotateCcw className="size-4" /></button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open ? <VoucherForm accounts={accounts} onClose={() => setOpen(false)} onDone={(m) => { setOpen(false); setMsg(m); void load(); }} /> : null}
    </div>
  );
}

function VoucherForm({ accounts, onClose, onDone }: { accounts: Account[]; onClose: () => void; onDone: (m: string) => void }) {
  const [date, setDate] = useState(todayIso());
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState([{ account: "", debit: "", credit: "" }, { account: "", debit: "", credit: "" }]);
  const [err, setErr] = useState("");
  const dr = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const cr = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = dr > 0 && Math.round(dr * 100) === Math.round(cr * 100);
  const set = (i: number, patch: Partial<(typeof lines)[number]>) => setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <Modal title="Journal voucher" onClose={onClose} wide>
      <div className="space-y-4">
        <Notice msg={err} tone="danger" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
          <div className="sm:col-span-2"><Field label="Narration"><input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Opening balance, owner's capital, bank charges..." className={inputCls} /></Field></div>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[560px]">
            <thead className="border-b border-border bg-bg-subtle/60"><tr><th className={th}>Account</th><th className={`${th} w-36 text-right`}>Debit</th><th className={`${th} w-36 text-right`}>Credit</th><th className="w-10" /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="p-2"><select value={l.account} onChange={(e) => set(i, { account: e.target.value })} className={inputCls}><option value="">Choose account</option>{accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.code}>{a.code} {a.name}</option>)}</select></td>
                  <td className="p-2"><MoneyInput value={l.debit} onChange={(debit) => set(i, { debit, credit: debit ? "" : l.credit })} className={`${inputCls} text-right`} /></td>
                  <td className="p-2"><MoneyInput value={l.credit} onChange={(credit) => set(i, { credit, debit: credit ? "" : l.debit })} className={`${inputCls} text-right`} /></td>
                  <td className="p-2"><button type="button" aria-label="Remove line" disabled={lines.length <= 2} onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))} className="rounded p-1.5 text-fg-muted hover:bg-bg-subtle disabled:opacity-30"><Trash2 className="size-4" /></button></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t border-border font-semibold"><td className={td}>Totals</td><td className={num}>{formatMoney(dr)}</td><td className={num}>{formatMoney(cr)}</td><td /></tr></tfoot>
          </table>
        </div>
        <div className="flex items-center justify-between">
          <button type="button" className={btnGhost} onClick={() => setLines((cur) => [...cur, { account: "", debit: "", credit: "" }])}><Plus className="size-4" /> Add line</button>
          <p className={`text-sm ${balanced ? "text-ok" : "text-warn"}`}>{balanced ? "Balanced" : `Difference ${formatMoney(Math.abs(dr - cr))}`}</p>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
          <button type="button" className={btnPrimary} disabled={!balanced || !memo.trim()} onClick={async () => {
            setErr("");
            try {
              const r = await postJournal({ data: { date, memo: memo.trim(), lines: lines.filter((l) => l.account && (Number(l.debit) || Number(l.credit))).map((l) => ({ account: l.account, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })) } });
              onDone(`Voucher posted (entry ${r.id})`);
            } catch (e) { setErr(errorMessage(e)); }
          }}>Post voucher</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- reports

type ReportKind = "tb" | "pl" | "bs" | "gl" | "aging";
const csvEscape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
function downloadCsv(name: string, rows: (string | number)[][]) {
  const blob = new Blob([rows.map((r) => r.map(csvEscape).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Reports() {
  const brand = useOrgBrand();
  const [kind, setKind] = useState<ReportKind>("tb");
  const [asOf, setAsOf] = useState(todayIso());
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(todayIso());
  const [code, setCode] = useState("1000");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [data, setData] = useState<unknown>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  useLive(async () => setAccounts(await listAccounts().catch(() => [])), 600000);

  const run = async () => {
    setErr(""); setLoading(true);
    try {
      if (kind === "tb") setData(await getTrialBalance({ data: { asOf } }));
      if (kind === "pl") setData(await getIncomeStatement({ data: { from, to } }));
      if (kind === "bs") setData(await getBalanceSheet({ data: { asOf } }));
      if (kind === "gl") setData(await getGeneralLedger({ data: { code, from, to } }));
      if (kind === "aging") setData(await getReceivablesAging());
    } catch (e) { setErr(errorMessage(e)); setData(null); } finally { setLoading(false); }
  };
  useLive(run, 60000);
  const currency = brand?.currency ?? "TZS";
  const money = (n: number) => formatMoney(n, currency);
  const titles: Record<ReportKind, string> = { tb: "Trial balance", pl: "Profit and loss", bs: "Balance sheet", gl: "General ledger", aging: "Receivables ageing" };
  const usesAsOf = kind === "tb" || kind === "bs";
  const usesRange = kind === "pl" || kind === "gl";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-bg-elevated p-4 print:hidden">
        <Field label="Report"><select value={kind} onChange={(e) => { setKind(e.target.value as ReportKind); setData(null); }} className={inputCls}>{(Object.keys(titles) as ReportKind[]).map((k) => <option key={k} value={k}>{titles[k]}</option>)}</select></Field>
        {usesAsOf ? <Field label="As at"><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={inputCls} /></Field> : null}
        {usesRange ? <><Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} /></Field><Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} /></Field></> : null}
        {kind === "gl" ? <Field label="Account"><select value={code} onChange={(e) => setCode(e.target.value)} className={inputCls}>{accounts.map((a) => <option key={a.id} value={a.code}>{a.code} {a.name}</option>)}</select></Field> : null}
        <button type="button" className={btnPrimary} onClick={() => void run()} disabled={loading}>{loading ? "Running…" : "Run report"}</button>
        <span className="flex-1" />
        <button type="button" className={btnGhost} disabled={!data} onClick={() => window.print()}><Printer className="size-4" /> Print or save PDF</button>
        <button type="button" className={btnGhost} disabled={!data} onClick={() => exportReport(kind, data, titles[kind])}><Download className="size-4" /> CSV</button>
      </div>
      <Notice msg={err} tone="danger" />
      {data ? (
        <article className="print-area rounded-xl border border-border bg-bg-elevated p-6">
          <header className="mb-4">
            <p className="text-base font-semibold">{brand?.displayName ?? ""}</p>
            <p className="text-sm font-medium">{titles[kind]}</p>
            <p className="text-xs text-fg-muted">{usesAsOf ? `As at ${formatDate(asOf)}` : kind === "aging" ? `As at ${formatDate(todayIso())}` : `${formatDate(from)} to ${formatDate(to)}`} · {currency}</p>
          </header>
          <ReportBody kind={kind} data={data} money={money} />
        </article>
      ) : <EmptyState title="Pick a report and run it" hint="Statements are built straight from the journal, so they always agree with each other." />}
    </div>
  );
}

type TB = Awaited<ReturnType<typeof getTrialBalance>>;
type PL = Awaited<ReturnType<typeof getIncomeStatement>>;
type BS = Awaited<ReturnType<typeof getBalanceSheet>>;
type GL = Awaited<ReturnType<typeof getGeneralLedger>>;
type AG = Awaited<ReturnType<typeof getReceivablesAging>>;

function exportReport(kind: ReportKind, data: unknown, title: string) {
  const name = `${title.toLowerCase().replace(/\s+/g, "-")}-${todayIso()}.csv`;
  if (kind === "tb") { const d = data as TB; downloadCsv(name, [["Code", "Account", "Debit", "Credit"], ...d.rows.map((r) => [r.code, r.accountName, r.balanceDr, r.balanceCr]), ["", "Total", d.totalDebit, d.totalCredit]]); }
  if (kind === "pl") { const d = data as PL; downloadCsv(name, [["Section", "Code", "Account", "Amount"], ...d.income.map((r) => ["Income", r.code, r.name, r.amount]), ...d.expenses.map((r) => ["Expense", r.code, r.name, r.amount]), ["", "", "Net profit", d.netProfit]]); }
  if (kind === "bs") { const d = data as BS; downloadCsv(name, [["Section", "Code", "Account", "Amount"], ...[["Assets", d.assets], ["Liabilities", d.liabilities], ["Equity", d.equity]].flatMap(([s, rows]) => (rows as BS["assets"]).map((r) => [s as string, r.code, r.name, r.amount]))]); }
  if (kind === "gl") { const d = data as GL; downloadCsv(name, [["Date", "Entry", "Memo", "Debit", "Credit", "Balance"], ...d.map((r) => [r.date, r.entryNo, r.memo, r.debit, r.credit, r.running])]); }
  if (kind === "aging") { const d = data as AG; downloadCsv(name, [["Invoice", "Customer", "Due", "Days overdue", "Balance"], ...d.items.map((r) => [r.invoiceNumber, r.customerName, r.dueDate ?? "", r.daysOverdue, r.balance])]); }
}

function Section({ title, rows, total, money }: { title: string; rows: { code: string; name: string; amount: number }[]; total: number; money: (n: number) => string }) {
  return (
    <>
      <tr><td colSpan={2} className="pt-4 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{title}</td></tr>
      {rows.map((r) => (<tr key={r.code}><td className={td}>{r.code} {r.name}</td><td className={num}>{money(r.amount)}</td></tr>))}
      <tr className="border-t border-border font-semibold"><td className={td}>Total {title.toLowerCase()}</td><td className={num}>{money(total)}</td></tr>
    </>
  );
}

function ReportBody({ kind, data, money }: { kind: ReportKind; data: unknown; money: (n: number) => string }) {
  if (kind === "tb") {
    const d = data as TB;
    return (
      <>
        <table className="w-full"><thead className="border-b border-border"><tr><th className={th}>Code</th><th className={th}>Account</th><th className={`${th} text-right`}>Debit</th><th className={`${th} text-right`}>Credit</th></tr></thead>
          <tbody className="divide-y divide-border">{d.rows.map((r) => (<tr key={r.code}><td className={td}>{r.code}</td><td className={td}>{r.accountName}</td><td className={num}>{r.balanceDr ? money(r.balanceDr) : ""}</td><td className={num}>{r.balanceCr ? money(r.balanceCr) : ""}</td></tr>))}</tbody>
          <tfoot><tr className="border-t-2 border-border font-semibold"><td className={td} colSpan={2}>Total</td><td className={num}>{money(d.totalDebit)}</td><td className={num}>{money(d.totalCredit)}</td></tr></tfoot></table>
        <p className={`mt-3 text-sm ${d.balanced ? "text-ok" : "text-danger"}`}>{d.balanced ? "Debits equal credits." : "Debits do not equal credits. Contact support."}</p>
      </>
    );
  }
  if (kind === "pl") {
    const d = data as PL;
    return (
      <table className="w-full"><tbody>
        <Section title="Income" rows={d.income} total={d.totalIncome} money={money} />
        <Section title="Expenses" rows={d.expenses} total={d.totalExpenses} money={money} />
        <tr className="border-t-2 border-border text-base font-semibold"><td className={td}>Net {d.netProfit >= 0 ? "profit" : "loss"}</td><td className={num}>{money(d.netProfit)}</td></tr>
      </tbody></table>
    );
  }
  if (kind === "bs") {
    const d = data as BS;
    return (
      <>
        <table className="w-full"><tbody>
          <Section title="Assets" rows={d.assets} total={d.totalAssets} money={money} />
          <Section title="Liabilities" rows={d.liabilities} total={d.totalLiabilities} money={money} />
          <Section title="Equity" rows={d.equity} total={d.totalEquity} money={money} />
          <tr className="border-t-2 border-border font-semibold"><td className={td}>Liabilities and equity</td><td className={num}>{money(d.totalLiabilities + d.totalEquity)}</td></tr>
        </tbody></table>
        <p className={`mt-3 text-sm ${d.balanced ? "text-ok" : "text-danger"}`}>{d.balanced ? "Assets equal liabilities plus equity." : "The balance sheet does not balance. Contact support."}</p>
      </>
    );
  }
  if (kind === "gl") {
    const d = data as GL;
    if (!d.length) return <p className="text-sm text-fg-muted">No movements in this period.</p>;
    return (
      <table className="w-full"><thead className="border-b border-border"><tr><th className={th}>Date</th><th className={th}>Entry</th><th className={th}>Narration</th><th className={`${th} text-right`}>Debit</th><th className={`${th} text-right`}>Credit</th><th className={`${th} text-right`}>Balance</th></tr></thead>
        <tbody className="divide-y divide-border">{d.map((r, i) => (<tr key={i}><td className={td}>{formatDate(r.date)}</td><td className={td}>{r.entryNo}</td><td className={td}>{r.memo}</td><td className={num}>{r.debit ? money(r.debit) : ""}</td><td className={num}>{r.credit ? money(r.credit) : ""}</td><td className={num}>{money(r.running)}</td></tr>))}</tbody></table>
    );
  }
  const d = data as AG;
  return (
    <>
      <div className="mb-4 grid grid-cols-5 gap-2 text-center text-sm">{d.buckets.map((b) => (<div key={b.bucket} className="rounded-lg border border-border p-2"><p className="text-[11px] text-fg-subtle">{b.bucket}</p><p className="font-semibold tabular-nums">{money(b.total)}</p></div>))}</div>
      {d.items.length === 0 ? <p className="text-sm text-fg-muted">No outstanding invoices.</p> : (
        <table className="w-full"><thead className="border-b border-border"><tr><th className={th}>Invoice</th><th className={th}>Customer</th><th className={th}>Due</th><th className={`${th} text-right`}>Days</th><th className={`${th} text-right`}>Balance</th></tr></thead>
          <tbody className="divide-y divide-border">{d.items.map((r) => (<tr key={r.id}><td className={td}>{r.invoiceNumber}</td><td className={td}>{r.customerName}</td><td className={td}>{formatDate(r.dueDate)}</td><td className={num}>{r.daysOverdue}</td><td className={num}>{money(r.balance)}</td></tr>))}</tbody>
          <tfoot><tr className="border-t-2 border-border font-semibold"><td className={td} colSpan={4}>Total outstanding</td><td className={num}>{money(d.total)}</td></tr></tfoot></table>
      )}
    </>
  );
}

// ---------------------------------------------------------------- accounts and orders

function Accounts({ profile }: { profile: Profile }) {
  const canPost = can(profile, "accounts.post");
  const [rows, setRows] = useState<Account[]>([]);
  const [msg, setMsg] = useState("");
  const [f, setF] = useState({ code: "", name: "", type: "Expense" as Account["type"] });
  const load = useCallback(async () => setRows(await listAccounts().catch(() => [])), []);
  useLive(load, 120000);
  const types: Account["type"][] = ["Asset", "Liability", "Equity", "Income", "Expense"];
  return (
    <div className="space-y-4">
      <Notice msg={msg} onClose={() => setMsg("")} />
      {canPost ? (
        <form className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-bg-elevated p-4" onSubmit={async (e) => { e.preventDefault(); try { await createAccount({ data: f }); setMsg(`Account ${f.code} created`); setF({ code: "", name: "", type: f.type }); void load(); } catch (err) { setMsg(errorMessage(err)); } }}>
          <Field label="Code"><input required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, "") })} className={`${inputCls} w-28`} placeholder="5450" /></Field>
          <div className="min-w-48 flex-1"><Field label="Account name"><input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} /></Field></div>
          <Field label="Type"><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Account["type"] })} className={inputCls}>{types.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <button type="submit" className={btnPrimary}><Plus className="size-4" /> Add account</button>
        </form>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {types.map((t) => (
          <div key={t} className="rounded-xl border border-border bg-bg-elevated p-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{t}</p>
            <ul className="space-y-1">{rows.filter((a) => a.type === t).map((a) => (<li key={a.id} className="flex justify-between text-sm"><span>{a.code} {a.name}</span>{a.isSystem ? <span className="text-xs text-fg-subtle">system</span> : null}</li>))}</ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function Orders({ profile, projects }: { profile: Profile; projects: { id: number; name: string }[] }) {
  const brand = useOrgBrand();
  const canMake = can(profile, "accounts.invoices");
  const [rows, setRows] = useState<PurchaseOrder[]>([]);
  const [msg, setMsg] = useState("");
  const [f, setF] = useState({ supplierName: "", description: "", amount: "", projectId: "" });
  const load = useCallback(async () => setRows(await listPurchaseOrders().catch(() => [])), []);
  useLive(load, 60000);
  return (
    <div className="space-y-4">
      <Notice msg={msg} onClose={() => setMsg("")} />
      {canMake ? (
        <form className="grid gap-3 rounded-xl border border-border bg-bg-elevated p-4 sm:grid-cols-5" onSubmit={async (e) => { e.preventDefault(); try { const r = await createPurchaseOrder({ data: { supplierName: f.supplierName, description: f.description, amount: Number(f.amount), projectId: f.projectId ? Number(f.projectId) : undefined } }); setMsg(`${r.poNumber} created`); setF({ supplierName: "", description: "", amount: "", projectId: "" }); void load(); } catch (err) { setMsg(errorMessage(err)); } }}>
          <Field label="Supplier"><input required value={f.supplierName} onChange={(e) => setF({ ...f, supplierName: e.target.value })} className={inputCls} /></Field>
          <div className="sm:col-span-2"><Field label="Purpose / work description"><input required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What is being purchased and what work is it for?" className={inputCls} /></Field></div>
          <Field label={`Amount (${brand?.currency ?? "TZS"})`}><MoneyInput required value={f.amount} onChange={(amount) => setF({ ...f, amount })} className={inputCls} /></Field>
          <Field label="Project (optional)"><select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })} className={inputCls}><option value="">None · Company / office</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <div className="sm:col-span-5"><button type="submit" className={btnPrimary}><Plus className="size-4" /> Create purchase order</button></div>
        </form>
      ) : null}
      {rows.length === 0 ? <EmptyState title="No purchase orders" /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-bg-elevated">
          <table className="w-full min-w-[560px]"><thead className="border-b border-border"><tr><th className={th}>PO</th><th className={th}>Supplier</th><th className={th}>Description</th><th className={th}>Date</th><th className={`${th} text-right`}>Amount</th><th className={th}>Status</th></tr></thead>
            <tbody className="divide-y divide-border">{rows.map((r) => (<tr key={r.id}><td className={`${td} font-medium`}>{r.poNumber}</td><td className={td}>{r.supplierName}</td><td className={td}>{r.description}</td><td className={td}>{formatDate(r.issueDate)}</td><td className={num}>{formatMoney(r.amount, r.currency)}</td><td className={td}><StatusBadge status={r.status} /></td></tr>))}</tbody></table>
        </div>
      )}
    </div>
  );
}
