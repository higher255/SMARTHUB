import { useEffect, useState } from "react";
import { Modal, Notice, btnGhost, btnPrimary, inputCls } from "@/components/ui-kit";
import { getProjectBudget, setProjectBudget, type ProjectBudget } from "@/lib/ehs/finance";
import { formatMoney } from "@/lib/ui/format";
import { errorMessage } from "@/lib/ui/use-live";
import { MoneyInput } from "@/components/finance/money-input";

const LABEL: Record<string, string> = { Material: "Materials", Equipment: "Equipment", Labor: "Labour", Transport: "Transport", Other: "Other" };

/** Split a project's budget across categories and see how much is committed and paid against each. */
export function BudgetDialog({ projectId, currency, canEdit, onClose, onSaved }: { projectId: number; currency: string; canEdit: boolean; onClose: () => void; onSaved: (m: string) => void }) {
  const [b, setB] = useState<ProjectBudget | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  useEffect(() => {
    getProjectBudget({ data: projectId }).then((x) => { setB(x); setVals(Object.fromEntries(x.lines.map((l) => [l.category, l.allocated ? String(l.allocated) : ""]))); }).catch((e) => setErr(errorMessage(e)));
  }, [projectId]);
  if (!b) return <Modal title="Project budget" onClose={onClose}><Notice msg={err} tone="danger" /><p className="text-sm text-fg-muted">Loading…</p></Modal>;
  const total = Object.values(vals).reduce((s, v) => s + (Number(v) || 0), 0);
  return (
    <Modal title={`Budget: ${b.name}`} onClose={onClose} wide>
      <Notice msg={err} tone="danger" />
      <p className="mb-4 text-sm text-fg-muted">Committed means submitted, approved or paid. New requests that go over a category budget are flagged to the approver{" "}(and blocked if your company turned on strict budgets).</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[520px]">
          <thead className="border-b border-border bg-bg-subtle/60"><tr>{["Category", "Budget", "Committed", "Paid", "Left"].map((h, i) => <th key={h} className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-border">
            {b.lines.map((l) => {
              const alloc = Number(vals[l.category]) || 0;
              const left = alloc - l.committed;
              const pct = alloc > 0 ? Math.min(100, Math.round((l.committed / alloc) * 100)) : 0;
              return (
                <tr key={l.category}>
                  <td className="px-3 py-2.5 text-sm">{LABEL[l.category]}{alloc > 0 ? <div className="mt-1 h-1 w-24 rounded-full bg-bg-subtle"><div className={`h-1 rounded-full ${pct > 100 || left < 0 ? "bg-danger" : pct > 80 ? "bg-warn" : "bg-accent"}`} style={{ width: `${pct}%` }} /></div> : null}</td>
                  <td className="px-3 py-2 text-right">{canEdit ? <MoneyInput value={vals[l.category] ?? ""} onChange={(value) => setVals({ ...vals, [l.category]: value })} className={`${inputCls} w-36 text-right`} /> : <span className="text-sm tabular-nums">{formatMoney(l.allocated, currency)}</span>}</td>
                  <td className="px-3 py-2.5 text-right text-sm tabular-nums">{formatMoney(l.committed, currency)}</td>
                  <td className="px-3 py-2.5 text-right text-sm tabular-nums">{formatMoney(l.paid, currency)}</td>
                  <td className={`px-3 py-2.5 text-right text-sm tabular-nums ${alloc > 0 && left < 0 ? "text-danger" : ""}`}>{alloc > 0 ? formatMoney(left, currency) : "-"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr className="border-t border-border font-semibold"><td className="px-3 py-2.5 text-sm">Project total</td><td className="px-3 py-2.5 text-right text-sm tabular-nums">{formatMoney(canEdit ? total : b.total, currency)}</td><td className="px-3 py-2.5 text-right text-sm tabular-nums">{formatMoney(b.lines.reduce((s, l) => s + l.committed, 0), currency)}</td><td className="px-3 py-2.5 text-right text-sm tabular-nums">{formatMoney(b.lines.reduce((s, l) => s + l.paid, 0), currency)}</td><td /></tr></tfoot>
        </table>
      </div>
      {canEdit ? (
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
          <button type="button" className={btnPrimary} onClick={async () => {
            try { await setProjectBudget({ data: { projectId, lines: b.lines.map((l) => ({ category: l.category, amount: Number(vals[l.category]) || 0 })) } }); onSaved(`Budget for ${b.name} saved`); onClose(); } catch (e) { setErr(errorMessage(e)); }
          }}>Save budget</button>
        </div>
      ) : null}
    </Modal>
  );
}
