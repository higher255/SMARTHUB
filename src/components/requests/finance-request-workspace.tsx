import { useCallback, useState } from "react";
import { Send, Wallet } from "lucide-react";
import { AppShell, Field, Panel } from "@/components/app-shell";
import { EmptyState, Notice, StatusBadge, btnPrimary, inputCls } from "@/components/ui-kit";
import { MoneyInput } from "@/components/finance/money-input";
import { cancelFinanceRequest, createFinanceRequest, listFinanceRequests, listProjectsForRequests, type FinanceRequest } from "@/lib/ehs/finance";
import type { Profile } from "@/lib/ehs/server";
import { formatDate, formatMoney } from "@/lib/ui/format";
import { errorMessage, useLive } from "@/lib/ui/use-live";
import { listAllUsers } from "@/lib/ehs/server";
import { useOrgBrand } from "@/components/workspace-bar";

export function FinanceRequestWorkspace({ profile, embedded = false }: { profile: Profile; embedded?: boolean }) {
  const brand = useOrgBrand();
  const isEhsOfficer = profile.role === "EHS_Officer";
  const [rows, setRows] = useState<FinanceRequest[]>([]);
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
  const [managers, setManagers] = useState<{ userId: string; fullName: string; email: string | null }[]>([]);
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<FinanceRequest["category"]>("Material");
  const [priority, setPriority] = useState<FinanceRequest["priority"]>("Medium");
  const [amount, setAmount] = useState("");
  const [recipientMode, setRecipientMode] = useState<"management" | "specific">("management");
  const [recipientUserId, setRecipientUserId] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountName, setBankAccountName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankSwift, setBankSwift] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setRows(await listFinanceRequests({ data: { mine: true } }).catch(() => [])), []);
  useLive(load, 20000);
  useLive(async () => setProjects((await listProjectsForRequests().catch(() => [])).map((project) => ({ id: project.id, name: project.name }))), 120000);
  useLive(async () => {
    if (!isEhsOfficer) return;
    const people = await listAllUsers().catch(() => []);
    setManagers(people.filter((person) => person.status === "active" && (person.role === "Admin" || person.role === "Manager"))
      .map((person) => ({ userId: person.userId, fullName: person.fullName, email: person.email })));
  }, 120000);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const result = await createFinanceRequest({ data: {
        projectId: projectId ? Number(projectId) : null, title, description, category,
        amount: Number(amount.replace(/,/g, "")), priority,
        ...(isEhsOfficer ? {
          recipientMode, recipientUserId: recipientMode === "management" ? recipientUserId : undefined,
          recipientName: recipientMode === "specific" ? recipientName : undefined,
          recipientEmail: recipientMode === "specific" ? recipientEmail : undefined,
          recipientBankName: bankName || undefined, recipientBankAccountName: bankAccountName || undefined,
          recipientBankAccountNumber: bankAccountNumber || undefined, recipientBankSwift: bankSwift || undefined,
        } : {}),
      } });
      setMessage(`${result.requestNumber} sent${isEhsOfficer ? ` to ${recipientMode === "management" ? managers.find((manager) => manager.userId === recipientUserId)?.fullName ?? "Management" : recipientName}` : " directly to Finance"}. Finance will record approval and payment.` + (result.recipientEmailStatus === "failed" ? " The recipient email could not be sent; check email settings." : ""));
      setTitle(""); setDescription(""); setAmount(""); setProjectId("");
      setRecipientName(""); setRecipientEmail(""); setBankName(""); setBankAccountName(""); setBankAccountNumber(""); setBankSwift("");
      await load();
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const cancel = async (request: FinanceRequest) => {
    try { await cancelFinanceRequest({ data: request.id }); setMessage(`${request.requestNumber} cancelled.`); await load(); }
    catch (error) { setMessage(errorMessage(error)); }
  };

  const printRequest = (request: FinanceRequest) => {
    const esc = (value: unknown) => String(value ?? "—").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
    const popup = window.open("", "_blank");
    if (!popup) { setMessage("Allow the print window to open, then try again."); return; }
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(request.requestNumber)}</title><style>body{font:15px Arial,sans-serif;color:#17202a;margin:40px}header{display:flex;justify-content:space-between;border-bottom:2px solid #17202a;padding-bottom:20px}h1{font-size:26px;margin:5px 0}.muted{color:#667085}.box{border:1px solid #d0d5dd;border-radius:8px;padding:18px;margin-top:20px}dl{display:grid;grid-template-columns:180px 1fr;gap:12px;margin:0}dt{color:#667085}dd{margin:0;font-weight:600}.total{font-size:22px;text-align:right;margin-top:24px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}footer{margin-top:32px;border-top:1px solid #d0d5dd;padding-top:12px;font-size:12px;color:#667085}@media print{body{margin:15mm}}</style></head><body><header><div><span class="muted">${esc(brand?.displayName ?? profile.organizationName ?? "Smart Hub")}</span><h1>Money request</h1><span class="muted">${esc(request.requestNumber)} · ${esc(formatDate(request.requestedAt))}</span></div><div><strong>${esc(request.status)}</strong><br><span class="muted">${esc(request.currency)}</span></div></header><div class="box grid"><div><h3>Request</h3><dl><dt>Requested by</dt><dd>${esc(request.requestedBy)}</dd><dt>Recipient</dt><dd>${esc(request.recipientName ?? "Finance")}</dd><dt>Email</dt><dd>${esc(request.recipientEmail)}</dd><dt>Category</dt><dd>${esc(request.category)}</dd><dt>Purpose</dt><dd>${esc(request.title)}</dd><dt>Details</dt><dd>${esc(request.description)}</dd></dl></div><div><h3>Payment details</h3><dl><dt>Bank</dt><dd>${esc(request.recipientBankName)}</dd><dt>Account name</dt><dd>${esc(request.recipientBankAccountName)}</dd><dt>Account number</dt><dd>${esc(request.recipientBankAccountNumber)}</dd><dt>SWIFT</dt><dd>${esc(request.recipientBankSwift)}</dd></dl></div></div><div class="box"><dl><dt>Finance approval</dt><dd>${esc(request.approvedBy ?? "Pending")}${request.approvedAt ? ` · ${esc(formatDate(request.approvedAt))}` : ""}</dd><dt>Payment status</dt><dd>${esc(request.status === "Paid" ? `Paid · ${request.paymentMethod ?? ""} · ${request.paymentReference ?? ""}` : request.status === "Approved" ? "Approved · awaiting payment" : request.status)}</dd></dl><p class="total">Amount requested: ${esc(formatMoney(request.amount, request.currency))}</p></div><footer>SmartHub finance request record. Approval and payment status are synchronized with Finance and Accounts Payable.</footer><script>window.onload=()=>window.print()<\/script></body></html>`);
    popup.document.close();
  };

  const content = <>
    <Notice msg={message} onClose={() => setMessage("")} />
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <Panel title="New money request">
        <form className="space-y-3" onSubmit={submit}>
          <Field label="Project (optional)"><select value={projectId} onChange={(event) => setProjectId(event.target.value)} className={inputCls}><option value="">Company / office</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field>
          <Field label="What is the request for"><input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} className={inputCls} placeholder="Materials, travel, labour…" /></Field>
          <Field label="Purpose and details"><textarea required minLength={5} maxLength={2000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} className={inputCls} placeholder="Explain what the money will support." /></Field>
          {isEhsOfficer ? <>
            <Field label="Send request to"><select value={recipientMode} onChange={(event) => setRecipientMode(event.target.value as "management" | "specific")} className={inputCls}><option value="management">Management / company boss</option><option value="specific">Specify a recipient by email</option></select></Field>
            {recipientMode === "management" ? <Field label="Management recipient"><select required value={recipientUserId} onChange={(event) => setRecipientUserId(event.target.value)} className={inputCls}><option value="">Select a manager</option>{managers.map((manager) => <option key={manager.userId} value={manager.userId}>{manager.fullName}{manager.email ? ` · ${manager.email}` : ""}</option>)}</select></Field> : <div className="grid gap-3 sm:grid-cols-2"><Field label="Recipient name"><input required value={recipientName} onChange={(event) => setRecipientName(event.target.value)} className={inputCls} /></Field><Field label="Recipient email"><input required type="email" value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} className={inputCls} /></Field></div>}
            <div className="rounded-lg border border-border p-3"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Recipient bank details · used in the printable request and payable record</p><div className="grid gap-3 sm:grid-cols-2"><Field label="Bank name"><input value={bankName} onChange={(event) => setBankName(event.target.value)} className={inputCls} /></Field><Field label="Account name"><input value={bankAccountName} onChange={(event) => setBankAccountName(event.target.value)} className={inputCls} /></Field><Field label="Account number"><input value={bankAccountNumber} onChange={(event) => setBankAccountNumber(event.target.value)} className={inputCls} /></Field><Field label="SWIFT / BIC (optional)"><input value={bankSwift} onChange={(event) => setBankSwift(event.target.value)} className={inputCls} /></Field></div></div>
          </> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category"><select value={category} onChange={(event) => setCategory(event.target.value as FinanceRequest["category"])} className={inputCls}><option>Material</option><option>Equipment</option><option>Labor</option><option>Transport</option><option>Other</option></select></Field>
            <Field label="Priority"><select value={priority} onChange={(event) => setPriority(event.target.value as FinanceRequest["priority"])} className={inputCls}><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select></Field>
          </div>
          <Field label="Amount"><MoneyInput required value={amount} onChange={setAmount} className={inputCls} /></Field>
          <p className="text-xs text-fg-muted">No amount ceiling. Finance keeps the approval, payable and payment records synchronized.</p>
          <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}><Send className="size-4" />{busy ? "Sending…" : "Send to Finance"}</button>
        </form>
      </Panel>

      <Panel title="My requests">
        {rows.length ? <ul className="divide-y divide-border">{rows.map((request) => <li key={request.id} className="flex flex-wrap items-center gap-3 py-3">
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{request.title}</span><span className="block text-xs text-fg-muted">{request.requestNumber} · {formatDate(request.createdAt)} · {request.category}</span></span>
          <span className="text-right"><span className="block text-sm font-semibold tabular-nums">{formatMoney(request.amount, request.currency)}</span><StatusBadge status={request.status} /></span>
          <button type="button" className="text-xs font-semibold text-accent hover:underline" onClick={() => printRequest(request)}>Invoice / print</button>
          {request.status === "Submitted" ? <button type="button" className="text-xs font-semibold text-danger hover:underline" onClick={() => void cancel(request)}>Cancel</button> : null}
        </li>)}</ul> : <EmptyState title="No requests yet" hint="Your request history and Finance decisions will appear here." />}
      </Panel>
    </div>
  </>;
  return embedded ? <div className="space-y-4">{content}</div> : <AppShell title="Finance requests" subtitle="Submit a request and follow its approval and payment record through Finance and Accounts Payable." role={profile.role}>{content}</AppShell>;
}
