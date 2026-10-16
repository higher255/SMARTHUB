import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, Car, ClipboardCheck, FileWarning, Fuel, HardHat, Hammer, HeartPulse, Route, Send, Wallet, Wrench } from "lucide-react";
import { Field } from "@/components/app-shell";
import { AttachmentPicker } from "@/components/attachments";
import { uploadPending, type PendingFile } from "@/lib/ehs/attachments";
import { Modal, Notice, btnGhost, btnPrimary, inputCls } from "@/components/ui-kit";
import { createFinanceRequest } from "@/lib/ehs/finance";
import { MONEY_TYPES, moneyTypeById, type Department } from "@/lib/ehs/request-types";
import { INSPECTION_ITEMS, createJourneyPlan, listVehicleOptions, submitInspection } from "@/lib/ehs/requests-hub";
import { createPermit } from "@/lib/ehs/server";
import { formatMoney, todayIso } from "@/lib/ui/format";
import { errorMessage } from "@/lib/ui/use-live";
import { emailDeliveryNote } from "@/lib/ui/email-status";
import { MoneyInput } from "@/components/finance/money-input";

type Project = { id: number; name: string };
export type OtherKind = "hazard" | "leave";
type Pick = { kind: "money"; typeId: string } | { kind: "permit" | "journey" | "inspection" };

const ROUTE: Record<Department, string> = { Finance: "Goes directly to Finance", Projects: "Goes directly to Finance", Transport: "Goes directly to Finance", EHS: "Goes directly to Finance" };
const TYPE_ICON: Record<string, typeof Fuel> = { Fuel, "Vehicle repair": Wrench, Transport: Car, PPE: HardHat, "First aid": HeartPulse, "Safety training": ClipboardCheck, Materials: Hammer, Tools: Wrench, Labour: Hammer, Other: Wallet };

/** One place to ask for anything. Each choice goes to the department that handles it. */
export function RequestCenter({ projects, currency, onClose, onDone, onOther }: {
  projects: Project[]; currency: string; onClose: () => void; onDone: (m: string) => void; onOther: (k: OtherKind) => void;
}) {
  const [pick, setPick] = useState<Pick | null>(null);
  if (pick?.kind === "money") return <MoneyForm typeId={pick.typeId} projects={projects} currency={currency} onClose={() => setPick(null)} onDone={onDone} />;
  if (pick?.kind === "permit") return <PermitForm onClose={() => setPick(null)} onDone={onDone} />;
  if (pick?.kind === "journey") return <JourneyForm onClose={() => setPick(null)} onDone={onDone} />;
  if (pick?.kind === "inspection") return <InspectionForm onClose={() => setPick(null)} onDone={onDone} />;

  const groups: { title: string; dept: Department }[] = [
    { title: "Transport and vehicle costs", dept: "Transport" },
    { title: "Safety: PPE and first aid", dept: "EHS" },
    { title: "Site: materials, tools and labour", dept: "Projects" },
    { title: "Anything else", dept: "Finance" },
  ];
  const tile = "flex items-start gap-3 rounded-xl border border-border bg-bg p-3 text-left transition hover:border-accent hover:bg-bg-subtle";
  return (
    <Modal title="New request" onClose={onClose} wide>
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.dept}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">{g.title}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {MONEY_TYPES.filter((t) => t.department === g.dept).map((t) => {
                const Icon = TYPE_ICON[t.id] ?? Wallet;
                return (
                  <button key={t.id} type="button" className={tile} onClick={() => setPick({ kind: "money", typeId: t.id })}>
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent"><Icon className="size-[18px]" /></span>
                    <span className="min-w-0"><span className="block text-sm font-medium">{t.label}</span><span className="block text-xs text-fg-muted">{t.hint}</span><span className="mt-1 block text-[11px] text-accent">{ROUTE[t.department]}</span></span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">Safety and travel approvals</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" className={tile} onClick={() => setPick({ kind: "permit" })}><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-warn/15 text-warn"><FileWarning className="size-[18px]" /></span><span><span className="block text-sm font-medium">Permit to work (PTW)</span><span className="block text-xs text-fg-muted">Hot work, heights, excavation, electrical, confined space</span><span className="mt-1 block text-[11px] text-accent">Goes to EHS</span></span></button>
            <button type="button" className={tile} onClick={() => setPick({ kind: "journey" })}><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-warn/15 text-warn"><Route className="size-[18px]" /></span><span><span className="block text-sm font-medium">Journey plan (JMP)</span><span className="block text-xs text-fg-muted">Before a long or risky trip</span><span className="mt-1 block text-[11px] text-accent">EHS safety review</span></span></button>
            <button type="button" className={tile} onClick={() => setPick({ kind: "inspection" })}><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-warn/15 text-warn"><Car className="size-[18px]" /></span><span><span className="block text-sm font-medium">Vehicle inspection</span><span className="block text-xs text-fg-muted">Checklist and photos before you drive</span><span className="mt-1 block text-[11px] text-accent">EHS handles failed checks</span></span></button>
            <button type="button" className={tile} onClick={() => { onClose(); onOther("hazard"); }}><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-danger/10 text-danger"><AlertTriangle className="size-[18px]" /></span><span><span className="block text-sm font-medium">Report a hazard or incident</span><span className="block text-xs text-fg-muted">Can be anonymous</span><span className="mt-1 block text-[11px] text-accent">Goes to EHS</span></span></button>
            <button type="button" className={tile} onClick={() => { onClose(); onOther("leave"); }}><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent"><CalendarDays className="size-[18px]" /></span><span><span className="block text-sm font-medium">Leave</span><span className="block text-xs text-fg-muted">Annual, sick or other leave</span><span className="mt-1 block text-[11px] text-accent">Goes to HR and managers</span></span></button>
          </div>
        </section>
      </div>
    </Modal>
  );
}

function Back({ onClose }: { onClose: () => void }) { return <button type="button" className={btnGhost} onClick={onClose}>Back</button>; }

// ------------------------------------------------------------ money
function MoneyForm({ typeId, projects, currency, onClose, onDone }: { typeId: string; projects: Project[]; currency: string; onClose: () => void; onDone: (m: string) => void }) {
  const [type, setType] = useState(typeId);
  const t = moneyTypeById(type);
  const [projectId, setProjectId] = useState<number | "">("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [byQty, setByQty] = useState(Boolean(t.unit));
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState(t.unit ?? "");
  const [unitPrice, setUnitPrice] = useState("");
  const [total, setTotal] = useState("");
  const [priority, setPriority] = useState<"Low" | "Medium" | "High" | "Critical">("Medium");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setUnit(moneyTypeById(type).unit ?? ""); setByQty(Boolean(moneyTypeById(type).unit)); }, [type]);
  const amount = byQty ? Math.round((Number(quantity) || 0) * (Number(unitPrice) || 0) * 100) / 100 : Number(total) || 0;

  return (
    <Modal title={`Request: ${t.label}`} onClose={onClose} wide>
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault(); setErr("");
        if (!(amount > 0)) return setErr("Please enter the price");
        if (!projectId && description.trim().length < 5) return setErr("Describe the work or office activity this request supports");
        setBusy(true);
        try {
          const details = [
            description,
            location ? `Site: ${location}` : "",
            neededBy ? `Needed by: ${neededBy}` : "",
            byQty ? `Quantity: ${quantity} ${unit} at ${formatMoney(Number(unitPrice) || 0, currency)} each` : "",
          ].filter(Boolean).join("\n");
          const r = await createFinanceRequest({ data: {
            projectId: projectId ? Number(projectId) : null, title: `${t.label}: ${title}`.slice(0, 200), description: details, amount, priority, category: t.category,
          } });
          const failed = await uploadPending("finance_request", r.requestId, files);
          onDone(`${r.requestNumber} sent directly to Finance for review.${emailDeliveryNote(r.emailStatus)}${failed ? ` ${failed} file(s) could not be uploaded.` : ""}`);
        } catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
      }}>
        <Notice msg={err} tone="danger" />
        <p className="rounded-lg bg-accent/5 px-3 py-2 text-xs text-fg-muted">{ROUTE[t.department]}. Finance reviews every amount and will approve, reject, or request more information.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type"><select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>{MONEY_TYPES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></Field>
          <Field label="Project (optional)"><select value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : "")} className={inputCls}><option value="">No project · Company / office</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        </div>
        <Field label="What is it for (short title)"><input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Diesel for generator, Site A" className={inputCls} /></Field>
        <Field label="Description"><textarea required minLength={5} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What exactly is needed, why, and any supplier or quote details" className={inputCls} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Where it is needed (site)"><input value={location} onChange={(e) => setLocation(e.target.value)} className={inputCls} /></Field>
          <Field label="Needed by"><input type="date" min={todayIso()} value={neededBy} onChange={(e) => setNeededBy(e.target.value)} className={inputCls} /></Field>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">Price ({currency})</p>
            <button type="button" className="text-xs text-accent hover:underline" onClick={() => setByQty((v) => !v)}>{byQty ? "Enter one total instead" : "Enter quantity and unit price"}</button>
          </div>
          {byQty ? (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Quantity"><input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/[^0-9.]/g, ""))} className={inputCls} /></Field>
              <Field label="Unit"><input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="litres, pcs" className={inputCls} /></Field>
              <Field label="Price each"><MoneyInput value={unitPrice} onChange={setUnitPrice} className={inputCls} /></Field>
            </div>
          ) : <Field label="Total price"><MoneyInput value={total} onChange={setTotal} className={inputCls} /></Field>}
          <p className="mt-2 text-sm font-semibold tabular-nums">Total: {formatMoney(amount, currency)}</p>
          <p className="mt-1 text-xs text-fg-muted">There is no request amount ceiling. Finance reviews the request and supporting details.</p>
        </div>
        <Field label="Priority"><select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className={inputCls}><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select></Field>
        <AttachmentPicker files={files} onChange={setFiles} onError={setErr} />
        <div className="flex justify-between gap-2 pt-1"><Back onClose={onClose} /><button type="submit" disabled={busy} className={btnPrimary}><Send className="size-4" /> {busy ? "Sending…" : "Send request"}</button></div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------ permit
function PermitForm({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const [f, setF] = useState({ type: "Working at Height", title: "", location: "", description: "", startDate: todayIso(), endDate: todayIso(), riskLevel: "Medium", supervisor: "", controls: "" });
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Permit to work" onClose={onClose} wide>
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr("");
        try {
          const r = await createPermit({ data: { type: f.type as "Hot Work", title: f.title, location: f.location, description: f.description || undefined, startDate: f.startDate, endDate: f.endDate, riskLevel: f.riskLevel as "Low", supervisor: f.supervisor || undefined, controlMeasures: f.controls.split(",").map((c) => c.trim()).filter(Boolean) } });
          const failed = r.permitId ? await uploadPending("permit", r.permitId, files) : 0;
          onDone(`Permit sent to EHS for approval.${failed ? ` ${failed} file(s) could not be uploaded.` : ""}`);
        } catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
      }}>
        <Notice msg={err} tone="danger" />
        <p className="rounded-lg bg-accent/5 px-3 py-2 text-xs text-fg-muted">Goes to EHS. Work must not start until it is approved.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type of work"><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className={inputCls}>{["Hot Work", "Confined Space", "Working at Height", "Excavation", "Electrical", "Chemical"].map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Risk level"><select value={f.riskLevel} onChange={(e) => setF({ ...f, riskLevel: e.target.value })} className={inputCls}><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select></Field>
        </div>
        <Field label="What will be done"><input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={inputCls} /></Field>
        <Field label="Where (site or tower)"><input required value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} className={inputCls} /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Start"><input type="date" value={f.startDate} min={todayIso()} onChange={(e) => setF({ ...f, startDate: e.target.value })} className={inputCls} /></Field>
          <Field label="End"><input type="date" value={f.endDate} min={f.startDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} className={inputCls} /></Field>
          <Field label="Supervisor"><input value={f.supervisor} onChange={(e) => setF({ ...f, supervisor: e.target.value })} className={inputCls} /></Field>
        </div>
        <Field label="Description and method"><textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className={inputCls} /></Field>
        <Field label="Safety controls (separate with commas)"><input value={f.controls} onChange={(e) => setF({ ...f, controls: e.target.value })} placeholder="Harness, second climber, rescue plan" className={inputCls} /></Field>
        <AttachmentPicker files={files} onChange={setFiles} onError={setErr} />
        <div className="flex justify-between gap-2"><Back onClose={onClose} /><button type="submit" disabled={busy} className={btnPrimary}><Send className="size-4" /> Send for approval</button></div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------ journey + vehicle helpers
function useVehicles() {
  const [v, setV] = useState<Awaited<ReturnType<typeof listVehicleOptions>>>([]);
  useEffect(() => { listVehicleOptions().then(setV).catch(() => undefined); }, []);
  return v;
}

function VehiclePicker({ vehicles, vehicleId, label, onChange }: { vehicles: { id: string; registration: string; make: string; model: string }[]; vehicleId: string; label: string; onChange: (id: string, label: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Vehicle">
        <select value={vehicleId} onChange={(e) => { const v = vehicles.find((x) => x.id === e.target.value); onChange(e.target.value, v ? `${v.registration} (${v.make} ${v.model})` : label); }} className={inputCls}>
          <option value="">Not in the list</option>
          {vehicles.map((v) => <option key={v.id} value={v.id}>{v.registration} · {v.make} {v.model}</option>)}
        </select>
      </Field>
      {!vehicleId ? <Field label="Vehicle name or plate"><input value={label} onChange={(e) => onChange("", e.target.value)} className={inputCls} /></Field> : null}
    </div>
  );
}

export function JourneyForm({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const vehicles = useVehicles();
  const [vehicleId, setVehicleId] = useState("");
  const [label, setLabel] = useState("");
  const [f, setF] = useState({ origin: "", destination: "", departAt: "", eta: "", purpose: "", passengers: "0", risk: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Journey plan (JMP)" onClose={onClose} wide>
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault(); setErr("");
        if (!vehicleId && !label.trim()) return setErr("Please choose or type the vehicle");
        setBusy(true);
        try {
          const r = await createJourneyPlan({ data: { vehicleId: vehicleId || undefined, vehicleLabel: label || undefined, origin: f.origin, destination: f.destination, departAt: new Date(f.departAt).toISOString(), eta: f.eta ? new Date(f.eta).toISOString() : undefined, purpose: f.purpose || undefined, passengers: Number(f.passengers) || 0, riskNotes: f.risk || undefined } });
          onDone(`${r.jmpNumber} sent to EHS for approval.`);
        } catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
      }}>
        <Notice msg={err} tone="danger" />
        <p className="rounded-lg bg-accent/5 px-3 py-2 text-xs text-fg-muted">EHS reviews this plan. Do not start the trip until it is approved.</p>
        <VehiclePicker vehicles={vehicles} vehicleId={vehicleId} label={label} onChange={(id, l) => { setVehicleId(id); setLabel(l); }} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From"><input required value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })} className={inputCls} /></Field>
          <Field label="To"><input required value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} className={inputCls} /></Field>
          <Field label="Departure"><input required type="datetime-local" value={f.departAt} onChange={(e) => setF({ ...f, departAt: e.target.value })} className={inputCls} /></Field>
          <Field label="Expected arrival"><input type="datetime-local" value={f.eta} min={f.departAt} onChange={(e) => setF({ ...f, eta: e.target.value })} className={inputCls} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2"><Field label="Purpose"><input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} className={inputCls} /></Field></div>
          <Field label="Passengers"><input inputMode="numeric" value={f.passengers} onChange={(e) => setF({ ...f, passengers: e.target.value.replace(/\D/g, "") })} className={inputCls} /></Field>
        </div>
        <Field label="Risks on the road (night driving, weather, fatigue, bad road)"><textarea rows={2} value={f.risk} onChange={(e) => setF({ ...f, risk: e.target.value })} className={inputCls} /></Field>
        <div className="flex justify-between gap-2"><Back onClose={onClose} /><button type="submit" disabled={busy} className={btnPrimary}><Send className="size-4" /> Send for approval</button></div>
      </form>
    </Modal>
  );
}

export function InspectionForm({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const vehicles = useVehicles();
  const [vehicleId, setVehicleId] = useState("");
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"Pre-trip" | "Daily" | "Weekly">("Pre-trip");
  const [odometer, setOdometer] = useState("");
  const [ok, setOk] = useState<Record<string, boolean>>(() => Object.fromEntries(INSPECTION_ITEMS.map((i) => [i, true])));
  const [defects, setDefects] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const failed = useMemo(() => INSPECTION_ITEMS.filter((i) => !ok[i]), [ok]);
  return (
    <Modal title="Vehicle inspection" onClose={onClose} wide>
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault(); setErr("");
        if (!vehicleId && !label.trim()) return setErr("Please choose or type the vehicle");
        setBusy(true);
        try {
          const r = await submitInspection({ data: { vehicleId: vehicleId || undefined, vehicleLabel: label.trim() || "Vehicle", inspectionType: kind, odometer: odometer ? Number(odometer) : undefined, items: INSPECTION_ITEMS.map((i) => ({ item: i, ok: ok[i] ?? true })), defects: defects || undefined } });
          const up = await uploadPending("inspection", r.id, files);
          onDone(r.result === "Pass" ? "Inspection passed and recorded." : `Inspection failed. EHS was notified.${up ? ` ${up} file(s) could not be uploaded.` : ""}`);
        } catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
      }}>
        <Notice msg={err} tone="danger" />
        <VehiclePicker vehicles={vehicles} vehicleId={vehicleId} label={label} onChange={(id, l) => { setVehicleId(id); setLabel(l); }} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Inspection"><select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={inputCls}><option>Pre-trip</option><option>Daily</option><option>Weekly</option></select></Field>
          <Field label="Odometer (km)"><input inputMode="decimal" value={odometer} onChange={(e) => setOdometer(e.target.value.replace(/[^0-9.]/g, ""))} className={inputCls} /></Field>
        </div>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {INSPECTION_ITEMS.map((i) => (
            <li key={i} className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${ok[i] ? "border-border" : "border-danger/40 bg-danger/5"}`}>
              <span>{i}</span>
              <span className="flex overflow-hidden rounded-md border border-border-strong text-xs" role="group" aria-label={i}>
                <button type="button" aria-pressed={ok[i]} onClick={() => setOk({ ...ok, [i]: true })} className={`px-2.5 py-1 ${ok[i] ? "bg-ok/20 font-semibold text-ok" : "text-fg-muted"}`}>OK</button>
                <button type="button" aria-pressed={!ok[i]} onClick={() => setOk({ ...ok, [i]: false })} className={`px-2.5 py-1 ${!ok[i] ? "bg-danger/20 font-semibold text-danger" : "text-fg-muted"}`}>Fault</button>
              </span>
            </li>
          ))}
        </ul>
        {failed.length ? <Field label={`Describe the faults (${failed.length})`}><textarea rows={3} required value={defects} onChange={(e) => setDefects(e.target.value)} className={inputCls} /></Field> : <p className="text-sm text-ok">All checks are OK.</p>}
        <AttachmentPicker files={files} onChange={setFiles} onError={setErr} />
        <div className="flex justify-between gap-2"><Back onClose={onClose} /><button type="submit" disabled={busy} className={btnPrimary}><ClipboardCheck className="size-4" /> Submit inspection</button></div>
      </form>
    </Modal>
  );
}
