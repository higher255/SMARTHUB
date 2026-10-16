import { useCallback, useState } from "react";
import { Send, Wallet } from "lucide-react";
import { AppShell, Field, Panel } from "@/components/app-shell";
import { EmptyState, Notice, StatusBadge, btnPrimary, inputCls } from "@/components/ui-kit";
import { MoneyInput } from "@/components/finance/money-input";
import { cancelFinanceRequest, createFinanceRequest, listFinanceRequests, listProjectsForRequests, type FinanceRequest } from "@/lib/ehs/finance";
import type { Profile } from "@/lib/ehs/server";
import { formatDate, formatMoney } from "@/lib/ui/format";
import { errorMessage, useLive } from "@/lib/ui/use-live";

export function FinanceRequestWorkspace({ profile }: { profile: Profile }) {
  const [rows, setRows] = useState<FinanceRequest[]>([]);
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<FinanceRequest["category"]>("Material");
  const [priority, setPriority] = useState<FinanceRequest["priority"]>("Medium");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setRows(await listFinanceRequests({ data: { mine: true } }).catch(() => [])), []);
  useLive(load, 20000);
  useLive(async () => setProjects((await listProjectsForRequests().catch(() => [])).map((project) => ({ id: project.id, name: project.name }))), 120000);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const result = await createFinanceRequest({ data: {
        projectId: projectId ? Number(projectId) : null, title, description, category,
        amount: Number(amount.replace(/,/g, "")), priority,
      } });
      setMessage(`${result.requestNumber} sent directly to Finance for approval.`);
      setTitle(""); setDescription(""); setAmount(""); setProjectId("");
      await load();
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const cancel = async (request: FinanceRequest) => {
    try { await cancelFinanceRequest({ data: request.id }); setMessage(`${request.requestNumber} cancelled.`); await load(); }
    catch (error) { setMessage(errorMessage(error)); }
  };

  return <AppShell title="Finance requests" subtitle="Send all money requests directly to Finance. Finance reviews and approves them, then approved requests move to Bills & Payables." role={profile.role}>
    <Notice msg={message} onClose={() => setMessage("")} />
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <Panel title="New money request">
        <form className="space-y-3" onSubmit={submit}>
          <Field label="Project (optional)"><select value={projectId} onChange={(event) => setProjectId(event.target.value)} className={inputCls}><option value="">Company / office</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field>
          <Field label="What is the request for"><input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} className={inputCls} placeholder="Materials, travel, labour…" /></Field>
          <Field label="Purpose and details"><textarea required minLength={5} maxLength={2000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} className={inputCls} placeholder="Explain what the money will support." /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category"><select value={category} onChange={(event) => setCategory(event.target.value as FinanceRequest["category"])} className={inputCls}><option>Material</option><option>Equipment</option><option>Labor</option><option>Transport</option><option>Other</option></select></Field>
            <Field label="Priority"><select value={priority} onChange={(event) => setPriority(event.target.value as FinanceRequest["priority"])} className={inputCls}><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select></Field>
          </div>
          <Field label="Amount"><MoneyInput required value={amount} onChange={setAmount} className={inputCls} /></Field>
          <p className="text-xs text-fg-muted">No amount ceiling. Every request goes to Finance for review.</p>
          <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}><Send className="size-4" />{busy ? "Sending…" : "Send to Finance"}</button>
        </form>
      </Panel>

      <Panel title="My requests">
        {rows.length ? <ul className="divide-y divide-border">{rows.map((request) => <li key={request.id} className="flex flex-wrap items-center gap-3 py-3">
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{request.title}</span><span className="block text-xs text-fg-muted">{request.requestNumber} · {formatDate(request.createdAt)} · {request.category}</span></span>
          <span className="text-right"><span className="block text-sm font-semibold tabular-nums">{formatMoney(request.amount, request.currency)}</span><StatusBadge status={request.status} /></span>
          {request.status === "Submitted" ? <button type="button" className="text-xs font-semibold text-danger hover:underline" onClick={() => void cancel(request)}>Cancel</button> : null}
        </li>)}</ul> : <EmptyState title="No requests yet" hint="Your request history and Finance decisions will appear here." />}
      </Panel>
    </div>
  </AppShell>;
}
