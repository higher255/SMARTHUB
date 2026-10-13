import { useCallback, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { EmptyState, StatusBadge } from "@/components/ui-kit";
import { getProjectHealth } from "@/lib/ehs/hse";
import { useLive } from "@/lib/ui/use-live";

type Row = Awaited<ReturnType<typeof getProjectHealth>>[number];

/** Which active sites could be stopped by a client because of open non-conformances or serious incidents. */
export function ProjectHealth() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const load = useCallback(async () => setRows(await getProjectHealth().catch(() => [])), []);
  useLive(load, 30000);
  if (rows === null) return null;
  const order = { "Stop-work risk": 0, Watch: 1, Healthy: 2 } as const;
  const sorted = [...rows].sort((a, b) => order[a.health] - order[b.health]);
  return (
    <section aria-label="Project health" className="mb-6">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><ShieldAlert className="size-4 text-accent" /> Project health</h2>
      {sorted.length === 0 ? <EmptyState title="No active projects" /> : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((p) => (
            <li key={p.projectId} className="rounded-xl border border-border bg-bg-elevated p-4">
              <div className="mb-2 flex items-start justify-between gap-2"><p className="text-sm font-medium">{p.name}</p><StatusBadge status={p.health} /></div>
              <p className="text-xs text-fg-muted">
                {p.openNcr} open NCR{p.openNcr === 1 ? "" : "s"}{p.criticalNcr ? ` (${p.criticalNcr} critical)` : ""} · {p.openIncidents} open incident{p.openIncidents === 1 ? "" : "s"} · {p.pendingRequests} pending request{p.pendingRequests === 1 ? "" : "s"}
              </p>
              <div className="mt-3 h-1.5 rounded-full bg-bg-subtle"><div className={`h-1.5 rounded-full ${p.utilization > 90 ? "bg-danger" : p.utilization > 75 ? "bg-warn" : "bg-accent"}`} style={{ width: `${Math.min(p.utilization, 100)}%` }} /></div>
              <p className="mt-1 text-[11px] text-fg-subtle">{p.utilization}% of budget paid</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
