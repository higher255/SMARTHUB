import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { BadgeCheck, BookOpen, Check, CheckCheck, Download, Search, Wallet, X } from "lucide-react";
import { RoleGate } from "@/components/role-gate";
import { AnnouncementComposer } from "@/components/announcement-composer";
import { AccountingWorkspace } from "@/components/finance/accounting";
import { BudgetDialog } from "@/components/finance/budget-dialog";
import { RequestTimeline } from "@/components/request-timeline";
import { EmptyState, Kpi, Modal, Notice, StatusBadge, TabBar, btnDanger, btnGhost, btnPrimary, inputCls } from "@/components/ui-kit";
import { Field, Panel } from "@/components/app-shell";
import { useOrgBrand } from "@/components/workspace-bar";
import { can } from "@/lib/ehs/access";
import {
  approveFinanceRequest, endorseFinanceRequest, getFinanceDashboardStats, getProjectBudgetSummary, listFinanceRequests,
  markFinanceRequestPaid, rejectFinanceRequest, type FinanceRequest,
} from "@/lib/ehs/finance";
import { listProjects, type Profile } from "@/lib/ehs/server";
import { formatDate, formatMoney, todayIso } from "@/lib/ui/format";
import { errorMessage, useLive } from "@/lib/ui/use-live";

export const Route = createFileRoute("/finance")({ component: FinancePage });

function FinancePage() {
  return <RoleGate path="/finance">{(profile) => <FinanceDash profile={profile} />}</RoleGate>;
}

type Tab = "overview" | "requests" | "budgets" | "accounting";
type Stats = Awaited<ReturnType<typeof getFinanceDashboardStats>>;
type Budget = Awaited<ReturnType<typeof getProjectBudgetSummary>>[number];

function FinanceDash({ profile }: { profile: Profile }) {
  const brand = useOrgBrand();
  const currency = brand?.currency ?? "TZS";
  const canView = can(profile, "finance.view");
  const canBooks = can(profile, "accounts.view");
  const [tab, setTab] = useState<Tab>(canView ? "overview" : "accounting");
  const [requests, setRequests] = useState<FinanceRequest[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
  const [msg, setMsg] = useState("");
  const [selected, setSelected] = useState<FinanceRequest | null>(null);
  const [budgetFor, setBudgetFor] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!canView) return;
    const [r, s, b] = await Promise.all([listFinanceRequests({}).catch(() => []), getFinanceDashboardStats().catch(() => null), getProjectBudgetSummary().catch(() => [])]);
    setRequests(r);
    setStats(s);
    setBudgets(b);
    setSelected((cur) => (cur ? r.find((x) => x.id === cur.id) ?? cur : cur));
  }, [canView]);
  useLive(load, 15000);
  useLive(async () => setProjects((await listProjects().catch(() => [])).map((p) => ({ id: Number(p.id), name: p.name }))), 120000);

  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

  // What is waiting on this person right now
  const mine = useMemo(
    () => requests.filter((r) => actionFor(profile, r) !== null),
    [requests, profile],
  );

  const tabs = [
    ...(canView ? [{ id: "overview" as const, label: "Overview" }, { id: "requests" as const, label: "Requests", badge: mine.length || undefined }, { id: "budgets" as const, label: "Project budgets" }] : []),
    ...(canBooks ? [{ id: "accounting" as const, label: "Accounting", icon: <BookOpen className="size-4" /> }] : []),
  ];

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight"><Wallet className="size-6 text-accent" /> Finance</h1>
          <p className="mt-1 text-sm text-fg-muted">Requests from site, approvals, payments and the books, in one place.</p>
        </div>
      </div>
      <Notice msg={msg} onClose={() => setMsg("")} />
      <TabBar tabs={tabs} active={tab} onChange={setTab} />

      {tab === "overview" && stats ? (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Waiting for a decision" value={stats.summary.pending} hint={formatMoney(stats.summary.pendingAmount, currency)} tone={stats.summary.pending ? "warn" : undefined} />
            <Kpi label="Approved, to pay" value={stats.summary.approved} hint={formatMoney(stats.summary.approvedAmount, currency)} />
            <Kpi label="Paid" value={stats.summary.paid} hint={formatMoney(stats.summary.paidAmount, currency)} tone="ok" />
            <Kpi label="Rejected" value={stats.summary.rejected} />
          </div>
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <Panel title={`For you to action (${mine.length})`}>
                {mine.length === 0 ? <EmptyState title="Nothing waiting on you" hint="New requests appear here and in your notifications." /> : (
                  <ul className="divide-y divide-border">
                    {mine.slice(0, 8).map((r) => (
                      <li key={r.id}>
                        <button type="button" onClick={() => setSelected(r)} className="flex w-full items-center gap-3 py-3 text-left hover:bg-bg-subtle/60">
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{r.title}</span><span className="block text-xs text-fg-muted">{r.requestNumber} · {r.requestedBy} · {projectName.get(r.projectId) ?? `Project ${r.projectId}`}</span></span>
                          <span className="text-right"><span className="block text-sm font-semibold tabular-nums">{formatMoney(r.amount, r.currency)}</span><span className="text-xs text-accent">{actionFor(profile, r)}</span></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
            <div className="lg:col-span-2">
              <Panel title="Spend by category">
                {stats.byCategory.length === 0 ? <p className="text-sm text-fg-muted">No requests yet.</p> : (
                  <ul className="space-y-3">
                    {stats.byCategory.map((c) => {
                      const max = Math.max(...stats.byCategory.map((x) => x.totalAmount), 1);
                      return (<li key={c.category}><div className="mb-1 flex justify-between text-sm"><span>{c.category}</span><span className="tabular-nums text-fg-muted">{formatMoney(c.totalAmount, currency)}</span></div><div className="h-1.5 rounded-full bg-bg-subtle"><div className="h-1.5 rounded-full bg-accent" style={{ width: `${(c.totalAmount / max) * 100}%` }} /></div></li>);
                    })}
                  </ul>
                )}
              </Panel>
            </div>
          </div>
          <AnnouncementComposer />
        </div>
      ) : null}

      {tab === "requests" ? <RequestsTab profile={profile} requests={requests} projectName={projectName} onOpen={setSelected} currency={currency} /> : null}

      {tab === "budgets" ? (
        budgets.length === 0 ? <EmptyState title="No projects yet" hint="Project budgets appear once projects are created." /> : (
          <div className="overflow-x-auto rounded-xl border border-border bg-bg-elevated">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-border"><tr>{["Project", "Budget", "Paid", "Approved", "Pending", "Remaining", "Used"].map((h, i) => <th key={h} className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {budgets.map((b) => (
                  <tr key={b.projectId} onClick={() => setBudgetFor(b.projectId)} className="cursor-pointer hover:bg-bg-subtle/60">
                    <td className="px-3 py-3 text-sm font-medium">{b.projectName}<span className="ml-2 text-xs font-normal text-accent">{can(profile, "budgets.manage") ? "Set budget" : "Details"}</span></td>
                    <td className="px-3 py-3 text-right text-sm tabular-nums">{formatMoney(b.totalBudget, currency)}</td>
                    <td className="px-3 py-3 text-right text-sm tabular-nums">{formatMoney(b.totalPaid, currency)}</td>
                    <td className="px-3 py-3 text-right text-sm tabular-nums">{formatMoney(b.totalApproved, currency)}</td>
                    <td className="px-3 py-3 text-right text-sm tabular-nums">{formatMoney(b.totalRequested, currency)}</td>
                    <td className={`px-3 py-3 text-right text-sm tabular-nums ${b.remainingBudget < 0 ? "text-danger" : ""}`}>{formatMoney(b.remainingBudget, currency)}</td>
                    <td className="px-3 py-3 text-right"><span className={`text-sm font-medium tabular-nums ${b.utilizationRate > 90 ? "text-danger" : b.utilizationRate > 75 ? "text-warn" : ""}`}>{b.utilizationRate}%</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === "accounting" && canBooks ? <AccountingWorkspace profile={profile} projects={projects} /> : null}

      {budgetFor ? <BudgetDialog projectId={budgetFor} currency={currency} canEdit={can(profile, "budgets.manage")} onClose={() => setBudgetFor(null)} onSaved={(m) => { setMsg(m); void load(); }} /> : null}

      {selected ? (
        <RequestModal
          profile={profile}
          request={selected}
          project={projectName.get(selected.projectId) ?? `Project ${selected.projectId}`}
          onClose={() => setSelected(null)}
          onChanged={(m) => { setMsg(m); void load(); }}
        />
      ) : null}
    </main>
  );
}

/** What this person may do next with a request, or null when nothing is theirs to do. */
function actionFor(profile: Profile, r: FinanceRequest): string | null {
  if (r.userId === profile.userId) return null;
  if (r.status === "Submitted" && r.requiresManager && can(profile, "finance.endorse")) return "Endorse";
  if ((r.status === "Under Review" || (r.status === "Submitted" && !r.requiresManager)) && can(profile, "finance.approve")) return "Approve";
  if (r.status === "Approved" && can(profile, "finance.pay")) return "Pay";
  return null;
}

function RequestsTab({ profile, requests, projectName, onOpen, currency }: { profile: Profile; requests: FinanceRequest[]; projectName: Map<number, string>; onOpen: (r: FinanceRequest) => void; currency: string }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const rows = useMemo(() => requests.filter((r) => (!status || r.status === status) && (!q || `${r.title} ${r.requestNumber} ${r.requestedBy}`.toLowerCase().includes(q.toLowerCase()))), [requests, q, status]);

  const exportCsv = () => {
    const lines = [["Number", "Date", "Requested by", "Project", "Title", "Category", "Amount", "Status"], ...rows.map((r) => [r.requestNumber, r.createdAt.slice(0, 10), r.requestedBy, projectName.get(r.projectId) ?? "", r.title, r.category, String(r.amount), r.status])];
    const blob = new Blob([lines.map((l) => l.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `finance-requests-${todayIso()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-56 flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-fg-subtle" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number, title or person" className={`${inputCls} pl-9`} /></div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputCls} w-44`}><option value="">All statuses</option>{["Submitted", "Under Review", "Approved", "Paid", "Rejected", "Cancelled"].map((s) => <option key={s}>{s}</option>)}</select>
        <button type="button" className={btnGhost} onClick={exportCsv}><Download className="size-4" /> CSV</button>
      </div>
      {rows.length === 0 ? <EmptyState title="No requests match" /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-bg-elevated">
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-border"><tr>{["Request", "Requested by", "Project", "Amount", "Status", ""].map((h, i) => <th key={i} className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle ${h === "Amount" ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const action = actionFor(profile, r);
                return (
                  <tr key={r.id} onClick={() => onOpen(r)} className="cursor-pointer hover:bg-bg-subtle/60">
                    <td className="px-3 py-3"><p className="text-sm font-medium">{r.title}</p><p className="text-xs text-fg-muted">{r.requestNumber} · {formatDate(r.createdAt)}</p></td>
                    <td className="px-3 py-3 text-sm">{r.requestedBy}</td>
                    <td className="px-3 py-3 text-sm text-fg-muted">{projectName.get(r.projectId) ?? `Project ${r.projectId}`}</td>
                    <td className="px-3 py-3 text-right text-sm font-semibold tabular-nums">{formatMoney(r.amount, r.currency || currency)}</td>
                    <td className="px-3 py-3"><StatusBadge status={r.status} />{r.requiresManager && r.status === "Submitted" ? <span className="ml-1.5 text-[11px] text-warn">manager first</span> : null}{r.overBudget ? <span className="ml-1.5 text-[11px] font-medium text-danger">over budget</span> : null}</td>
                    <td className="px-3 py-3 text-right text-xs font-medium text-accent">{action}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RequestModal({ profile, request: r, project, onClose, onChanged }: { profile: Profile; request: FinanceRequest; project: string; onClose: () => void; onChanged: (m: string) => void }) {
  const action = actionFor(profile, r);
  const canReject = r.userId !== profile.userId && ["Submitted", "Under Review", "Approved"].includes(r.status) && (can(profile, "finance.approve") || can(profile, "finance.endorse"));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<null | "reject" | "pay">(null);
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [method, setMethod] = useState<"Cash" | "Bank" | "M-Pesa" | "Tigo Pesa" | "Airtel Money" | "Cheque">("Cash");
  const [date, setDate] = useState(todayIso());

  const run = async (fn: () => Promise<{ message?: string } | unknown>, done: string) => {
    setBusy(true); setErr("");
    try { await fn(); onChanged(done); onClose(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <Modal title={`${r.requestNumber} · ${r.title}`} onClose={onClose} wide>
      <Notice msg={err} tone="danger" />
      {r.overBudget ? <Notice msg="This request goes over the budget set for its project or category. Check the project budget before approving." tone="warn" /> : null}
      <div className="grid gap-6 md:grid-cols-5">
        <div className="space-y-4 md:col-span-3">
          <div className="flex items-center justify-between"><p className="text-2xl font-semibold tabular-nums">{formatMoney(r.amount, r.currency)}</p><StatusBadge status={r.status} /></div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div><dt className="text-xs text-fg-subtle">Requested by</dt><dd className="font-medium">{r.requestedBy}</dd></div>
            <div><dt className="text-xs text-fg-subtle">Project</dt><dd className="font-medium">{project}</dd></div>
            <div><dt className="text-xs text-fg-subtle">Category</dt><dd>{r.category}</dd></div>
            <div><dt className="text-xs text-fg-subtle">Priority</dt><dd><StatusBadge status={r.priority} /></dd></div>
            <div><dt className="text-xs text-fg-subtle">Date</dt><dd>{formatDate(r.createdAt)}</dd></div>
            {r.paymentReference ? <div><dt className="text-xs text-fg-subtle">Payment</dt><dd>{r.paymentMethod} · {r.paymentReference}</dd></div> : null}
          </dl>
          {r.description ? <p className="rounded-lg bg-bg-subtle p-3 text-sm text-fg-muted">{r.description}</p> : null}

          {mode === "reject" ? (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <Field label="Reason (the requester will see this)"><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} /></Field>
              <div className="flex gap-2"><button type="button" disabled={busy || !reason.trim()} className={btnDanger} onClick={() => void run(() => rejectFinanceRequest({ data: { id: r.id, reason: reason.trim() } }), `${r.requestNumber} rejected`)}>Confirm rejection</button><button type="button" className={btnGhost} onClick={() => setMode(null)}>Back</button></div>
            </div>
          ) : null}
          {mode === "pay" ? (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Method"><select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} className={inputCls}><option>Cash</option><option>Bank</option><option>M-Pesa</option><option>Tigo Pesa</option><option>Airtel Money</option><option>Cheque</option></select></Field>
                <Field label="Reference"><input value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} placeholder="Receipt or transaction no." /></Field>
                <Field label="Date"><input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
              </div>
              <p className="text-xs text-fg-muted">This posts to the books: expense debited, {method === "Cash" ? "cash" : "bank"} credited.</p>
              <div className="flex gap-2"><button type="button" disabled={busy || !reference.trim()} className={btnPrimary} onClick={() => void run(() => markFinanceRequestPaid({ data: { id: r.id, paymentReference: reference.trim(), paymentMethod: method, paymentDate: date } }), `${r.requestNumber} paid and posted to the ledger`)}>Record payment</button><button type="button" className={btnGhost} onClick={() => setMode(null)}>Back</button></div>
            </div>
          ) : null}

          {mode === null && (action || canReject) ? (
            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              {action === "Endorse" ? <button type="button" disabled={busy} className={btnPrimary} onClick={() => void run(() => endorseFinanceRequest({ data: { id: r.id } }), `${r.requestNumber} endorsed and sent to finance`)}><BadgeCheck className="size-4" /> Endorse</button> : null}
              {action === "Approve" ? <button type="button" disabled={busy} className={btnPrimary} onClick={() => void run(() => approveFinanceRequest({ data: { id: r.id } }), `${r.requestNumber} approved`)}><Check className="size-4" /> Approve</button> : null}
              {action === "Pay" ? <button type="button" className={btnPrimary} onClick={() => setMode("pay")}><CheckCheck className="size-4" /> Record payment</button> : null}
              {canReject ? <button type="button" className={btnDanger} onClick={() => setMode("reject")}><X className="size-4" /> Reject</button> : null}
            </div>
          ) : null}
          {r.userId === profile.userId ? <p className="text-xs text-fg-muted">You cannot approve or pay your own request.</p> : null}
        </div>
        <div className="md:col-span-2"><p className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-subtle">Progress</p><RequestTimeline request={r} /></div>
      </div>
    </Modal>
  );
}
