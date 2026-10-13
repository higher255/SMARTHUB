import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { AlertTriangle, ArrowRight, Gauge, HardHat, TrendingUp, Users } from "lucide-react";
import { RoleGate } from "@/components/role-gate";
import { Panel } from "@/components/app-shell";
import { EmptyState, Kpi, StatusBadge } from "@/components/ui-kit";
import { MiniBars } from "@/components/mini-bars";
import { getManagementOverview } from "@/lib/ehs/management";
import { formatMoney, formatNumber, timeAgo } from "@/lib/ui/format";
import { useLive } from "@/lib/ui/use-live";

export const Route = createFileRoute("/management")({ component: ManagementPage });

function ManagementPage() {
  return <RoleGate path="/management">{() => <Overview />}</RoleGate>;
}

type Data = Awaited<ReturnType<typeof getManagementOverview>>;

function Overview() {
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setD(await getManagementOverview()); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Could not load"); }
  }, []);
  useLive(load, 30000);

  if (!d) return <main className="mx-auto max-w-7xl px-4 py-10 text-sm text-fg-muted sm:px-6">{error || "Loading overview…"}</main>;
  const c = d.currency;
  const s = d.safety;
  const stop = d.projects.filter((p) => p.health === "Stop-work risk").length;
  const watch = d.projects.filter((p) => p.health === "Watch").length;

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight"><Gauge className="size-6 text-accent" /> Management overview</h1>
        <p className="mt-1 text-sm text-fg-muted">{d.company}. Money, sites and safety on one screen, refreshed automatically.</p>
      </div>

      {d.inbox.length > 0 ? (
        <section aria-label="Needs your decision" className="rounded-xl border border-accent/30 bg-accent/5 p-4">
          <p className="mb-3 text-sm font-semibold">Needs your decision</p>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {d.inbox.map((i) => (
              <li key={i.key}>
                <Link to={i.link} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-elevated px-3 py-2.5 text-sm transition hover:border-accent">
                  <span>{i.label}</span>
                  <span className="flex items-center gap-2 font-semibold text-accent">{i.count}<ArrowRight className="size-4" /></span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {d.books ? (
        <section aria-label="Finance" className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><TrendingUp className="size-4 text-accent" /> Finance</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi label="Cash and bank" value={formatMoney(d.books.cash, c)} />
            <Kpi label="Income this year" value={formatMoney(d.books.incomeYtd, c)} hint={`This month ${formatMoney(d.books.incomeMonth, c)}`} />
            <Kpi label="Expenses this year" value={formatMoney(d.books.expenseYtd, c)} hint={`This month ${formatMoney(d.books.expenseMonth, c)}`} />
            <Kpi label="Profit this year" value={formatMoney(d.books.profitYtd, c)} tone={d.books.profitYtd < 0 ? "danger" : "ok"} />
            <Kpi label="Owed to us" value={formatMoney(d.books.receivables, c)} hint={d.books.overdueReceivables ? `${formatMoney(d.books.overdueReceivables, c)} overdue` : "Nothing overdue"} tone={d.books.overdueReceivables ? "warn" : undefined} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Kpi label="Requests awaiting decision" value={d.pipeline.awaitingEndorse + d.pipeline.awaitingApproval} hint={formatMoney(d.pipeline.pendingAmount, c)} />
            <Kpi label="Approved, waiting for payment" value={d.pipeline.awaitingPayment} hint={formatMoney(d.pipeline.approvedAmount, c)} />
            <Kpi label="Paid out this month" value={formatMoney(d.pipeline.paidThisMonth, c)} />
          </div>
        </section>
      ) : null}

      <section aria-label="Safety" className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><HardHat className="size-4 text-accent" /> Safety, last 12 months</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi label="TRIFR" value={formatNumber(s.trifr, 2)} hint="Recordable injuries per million hours" tone={s.trifr && s.trifr > 5 ? "warn" : undefined} />
          <Kpi label="LTIFR" value={formatNumber(s.ltifr, 2)} hint="Lost-time injuries per million hours" />
          <Kpi label="Severity rate" value={formatNumber(s.severityRate, 1)} hint={`${s.lostDays} lost days`} />
          <Kpi label="Hours worked" value={formatNumber(s.manHours)} hint={s.manHours ? undefined : "Team leaders record hours"} />
          <Kpi label="Open NCRs" value={s.openNcr} hint={s.openCriticalNcr ? `${s.openCriticalNcr} critical` : "None critical"} tone={s.openCriticalNcr ? "danger" : undefined} />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Recordable injuries by month"><MiniBars label="Recordable injuries by month" data={s.monthly.map((m) => ({ label: m.month, value: m.recordable }))} /></Panel>
          <Panel title="Cost of incidents">
            <p className="text-2xl font-semibold tabular-nums">{formatMoney(s.totalCost, c)}</p>
            <p className="mt-1 text-sm text-fg-muted">{formatNumber(s.idleHours)} idle hours across {s.incidents} incidents ({s.nearMisses} near misses).</p>
          </Panel>
          <Panel title="Readiness">
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between"><span className="text-fg-muted">Certificates expired</span><span className={d.people.certsExpired ? "font-semibold text-danger" : ""}>{d.people.certsExpired}</span></li>
              <li className="flex justify-between"><span className="text-fg-muted">Expiring in 30 days</span><span className={d.people.certsExpiring ? "font-semibold text-warn" : ""}>{d.people.certsExpiring}</span></li>
              <li className="flex justify-between"><span className="text-fg-muted">Active staff</span><span className="flex items-center gap-1.5"><Users className="size-4 text-fg-subtle" />{d.people.headcount}</span></li>
            </ul>
          </Panel>
        </div>
      </section>

      <section aria-label="Sites" className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="size-4 text-accent" /> Site health {stop ? <span className="text-danger">({stop} at risk of stop-work)</span> : watch ? <span className="text-warn">({watch} to watch)</span> : null}</h2>
        {d.projects.length === 0 ? <EmptyState title="No active projects" /> : (
          <div className="overflow-x-auto rounded-xl border border-border bg-bg-elevated">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-border"><tr>{["Project", "Health", "Open NCRs", "Open incidents", "Pending requests", "Budget used"].map((h, i) => <th key={h} className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle ${i > 1 ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {d.projects.map((p) => (
                  <tr key={p.projectId}>
                    <td className="px-3 py-3 text-sm font-medium">{p.name}</td>
                    <td className="px-3 py-3"><StatusBadge status={p.health} /></td>
                    <td className="px-3 py-3 text-right text-sm tabular-nums">{p.openNcr}{p.criticalNcr ? <span className="ml-1 text-danger">({p.criticalNcr} critical)</span> : null}</td>
                    <td className="px-3 py-3 text-right text-sm tabular-nums">{p.openIncidents}</td>
                    <td className="px-3 py-3 text-right text-sm tabular-nums">{p.pendingRequests}</td>
                    <td className="px-3 py-3 text-right text-sm tabular-nums">{p.utilization}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Panel title="Recent activity">
        {d.activity.length === 0 ? <p className="text-sm text-fg-muted">Activity appears here as your team works.</p> : (
          <ul className="divide-y divide-border">
            {d.activity.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span><span className="font-medium">{a.actor}</span> <span className="text-fg-muted">{a.action.replace(/_/g, " ")} {a.entity.replace(/_/g, " ")}{a.entityId ? ` #${a.entityId}` : ""}</span></span>
                <span className="shrink-0 text-xs text-fg-subtle">{timeAgo(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </main>
  );
}
