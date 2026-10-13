import { useEffect, useState } from "react";
import { Field, Panel } from "@/components/app-shell";
import { Notice, btnPrimary, inputCls } from "@/components/ui-kit";
import { invalidateOrgBrand } from "@/components/workspace-bar";
import { getOrgBrand, updateCompanySettings, type OrgBrand } from "@/lib/ehs/server";
import { formatDate } from "@/lib/ui/format";
import { errorMessage } from "@/lib/ui/use-live";

/** The company's own settings: branding, currency, VAT, approval limit, strict budgets and books lock. */
export function CompanySettings() {
  const [b, setB] = useState<OrgBrand | null>(null);
  const [f, setF] = useState({ displayName: "", logoUrl: "", primaryColor: "", currency: "TZS" as "TZS" | "USD", vatRate: "18", limit: "0", locked: "", strict: false });
  const [msg, setMsg] = useState("");
  useEffect(() => {
    getOrgBrand().then((x) => {
      setB(x);
      setF({ displayName: x.displayName, logoUrl: x.logoUrl ?? "", primaryColor: x.primaryColor ?? "", currency: x.currency as "TZS" | "USD", vatRate: String(x.vatRate), limit: String(x.managerApprovalLimit), locked: x.booksLockedUntil ?? "", strict: x.enforceBudget });
    }).catch((e) => setMsg(errorMessage(e)));
  }, []);
  if (!b) return <p className="text-sm text-fg-muted">{msg || "Loading…"}</p>;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Panel title="Company settings">
          <Notice msg={msg} onClose={() => setMsg("")} />
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
            e.preventDefault();
            try {
              await updateCompanySettings({ data: { displayName: f.displayName, logoUrl: f.logoUrl, primaryColor: f.primaryColor, currency: f.currency, vatRate: Number(f.vatRate) || 0, managerApprovalLimit: Number(f.limit) || 0, booksLockedUntil: f.locked, enforceBudget: f.strict } });
              invalidateOrgBrand(); setMsg("Settings saved. Reload the page to see new branding.");
            } catch (x) { setMsg(errorMessage(x)); }
          }}>
            <Field label="Company name shown to staff"><input required value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} className={inputCls} /></Field>
            <Field label="Currency"><select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as "TZS" | "USD" })} className={inputCls}><option>TZS</option><option>USD</option></select></Field>
            <Field label="Logo link (https)"><input value={f.logoUrl} onChange={(e) => setF({ ...f, logoUrl: e.target.value })} placeholder="https://..." className={inputCls} /></Field>
            <Field label="Brand colour"><div className="flex gap-2"><input type="color" value={f.primaryColor || "#0f766e"} onChange={(e) => setF({ ...f, primaryColor: e.target.value })} className="h-10 w-12 rounded border border-border bg-bg p-1" /><input value={f.primaryColor} onChange={(e) => setF({ ...f, primaryColor: e.target.value })} placeholder="#0f766e" className={inputCls} /></div></Field>
            <Field label="VAT rate (%)"><input inputMode="decimal" value={f.vatRate} onChange={(e) => setF({ ...f, vatRate: e.target.value.replace(/[^0-9.]/g, "") })} className={inputCls} /></Field>
            <Field label={`Requests above this need a manager first (${f.currency})`}><input inputMode="decimal" value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value.replace(/[^0-9.]/g, "") })} className={inputCls} /></Field>
            <Field label="Lock the books up to (no postings on or before)"><input type="date" value={f.locked} onChange={(e) => setF({ ...f, locked: e.target.value })} className={inputCls} /></Field>
            <label className="flex items-start gap-2.5 rounded-lg border border-border p-3 text-sm sm:col-span-1">
              <input type="checkbox" className="mt-0.5" checked={f.strict} onChange={(e) => setF({ ...f, strict: e.target.checked })} />
              <span><span className="font-medium">Strict budgets</span><span className="block text-xs text-fg-muted">Block requests that go over a project or category budget. Off means they are only flagged to the approver.</span></span>
            </label>
            <div className="sm:col-span-2"><button type="submit" className={btnPrimary}>Save settings</button></div>
          </form>
        </Panel>
      </div>
      <Panel title="Your subscription">
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between"><dt className="text-fg-muted">Plan</dt><dd className="font-medium capitalize">{b.plan}</dd></div>
          <div className="flex justify-between"><dt className="text-fg-muted">User limit</dt><dd className="font-medium">{b.maxUsers || "No limit"}</dd></div>
          <div className="flex justify-between"><dt className="text-fg-muted">Paid until</dt><dd className="font-medium">{formatDate(b.paidUntil)}</dd></div>
        </dl>
        <p className="mt-4 text-xs text-fg-muted">To change your plan or add seats, contact Smart Hub.</p>
      </Panel>
    </div>
  );
}
