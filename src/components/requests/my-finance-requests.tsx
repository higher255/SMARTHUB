import { useCallback, useState } from "react";
import { Panel } from "@/components/app-shell";
import { EmptyState, Modal, StatusBadge } from "@/components/ui-kit";
import { RequestTimeline } from "@/components/request-timeline";
import { listFinanceRequests, type FinanceRequest } from "@/lib/ehs/finance";
import { formatDate, formatMoney } from "@/lib/ui/format";
import { errorMessage, useLive } from "@/lib/ui/use-live";

export function MyFinanceRequests() {
  const [requests, setRequests] = useState<FinanceRequest[]>([]);
  const [selected, setSelected] = useState<FinanceRequest | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const rows = await listFinanceRequests({ data: { mine: true } });
      setRequests(rows);
      setSelected((current) => current ? rows.find((row) => row.id === current.id) ?? current : null);
      setError("");
    } catch (cause) {
      setError(errorMessage(cause, "Could not load your finance requests"));
    }
  }, []);
  useLive(load, 20000);

  return (
    <Panel title="My money requests">
      {error ? <p role="alert" className="mb-3 text-sm text-danger">{error}</p> : null}
      {requests.length === 0 ? <EmptyState title="No money requests yet" hint="Requests you send to Finance and their decisions will appear here." /> : (
        <ul className="divide-y divide-border">
          {requests.map((request) => (
            <li key={request.id}>
              <button type="button" onClick={() => setSelected(request)} className="flex w-full items-center gap-3 py-3 text-left transition hover:bg-bg-subtle/60">
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{request.title}</span><span className="block text-xs text-fg-muted">{request.requestNumber} · {formatDate(request.createdAt)} · {request.projectId == null ? "Company / office" : `Project ${request.projectId}`}</span></span>
                <span className="shrink-0 text-right"><span className="block text-sm font-semibold tabular-nums">{formatMoney(request.amount, request.currency)}</span><StatusBadge status={request.status} /></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected ? (
        <Modal title={`${selected.requestNumber} · ${selected.title}`} onClose={() => setSelected(null)}>
          <div className="mb-4 flex items-center justify-between gap-3"><p className="text-lg font-semibold tabular-nums">{formatMoney(selected.amount, selected.currency)}</p><StatusBadge status={selected.status} /></div>
          {selected.description ? <p className="mb-4 whitespace-pre-line text-sm text-fg-muted">{selected.description}</p> : null}
          <RequestTimeline request={selected} />
        </Modal>
      ) : null}
    </Panel>
  );
}
