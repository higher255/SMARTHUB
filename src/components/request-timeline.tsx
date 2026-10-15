import { CheckCircle2, Circle, XCircle } from "lucide-react";
import type { FinanceRequest } from "@/lib/ehs/finance";
import { formatDate } from "@/lib/ui/format";

type Step = { label: string; by?: string | null; at?: string | null; done: boolean; current: boolean };

export function requestSteps(r: FinanceRequest): Step[] {
  const rank: Record<string, number> = { Submitted: 1, "Under Review": 2, Approved: 3, Paid: 4 };
  const at = rank[r.status] ?? 0;
  const steps: Step[] = [{ label: "Submitted", by: r.requestedBy, at: r.requestedAt || r.createdAt, done: true, current: r.status === "Submitted" && !r.requiresManager }];
  if (r.requiresManager) steps.push({ label: "Manager endorsement", by: r.endorsedBy, at: r.endorsedAt, done: at >= 2, current: r.status === "Submitted" });
  steps.push({ label: "Finance approval", by: r.approvedBy, at: r.approvedAt, done: at >= 3, current: r.status === "Under Review" || (r.status === "Submitted" && !r.requiresManager) });
  steps.push({ label: "Paid", by: r.paidBy, at: r.paidAt, done: at >= 4, current: r.status === "Approved" });
  return steps;
}

/** Where a request is, who acted, and what happens next. */
export function RequestTimeline({ request }: { request: FinanceRequest }) {
  if (request.status === "Rejected") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
        <XCircle className="mt-0.5 size-4 shrink-0" />
        <p>Rejected by {request.rejectedBy ?? "finance"}{request.rejectedReason ? `: ${request.rejectedReason}` : ""}</p>
      </div>
    );
  }
  if (request.status === "Cancelled") return <p className="text-sm text-fg-muted">This request was cancelled.</p>;
  return (
    <ol className="space-y-2.5">
      {requestSteps(request).map((s) => (
        <li key={s.label} className="flex items-start gap-2.5">
          {s.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <Circle className={`mt-0.5 size-4 shrink-0 ${s.current ? "text-accent" : "text-fg-subtle"}`} />}
          <div className="min-w-0 text-sm">
            <p className={s.done ? "font-medium" : s.current ? "font-medium text-accent" : "text-fg-muted"}>{s.label}</p>
            {s.done && (s.by || s.at) ? <p className="text-xs text-fg-muted">{[s.by, s.at ? formatDate(s.at) : null].filter(Boolean).join(" · ")}</p> : null}
            {s.label === "Paid" && request.status === "Paid" && (request.paymentMethod || request.paymentReference) ? <p className="text-xs text-fg-muted">{[request.paymentMethod ? `Via ${request.paymentMethod}` : null, request.paymentReference ? `Ref ${request.paymentReference}` : null].filter(Boolean).join(" · ")}</p> : null}
            {!s.done && s.current ? <p className="text-xs text-fg-muted">Waiting</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
