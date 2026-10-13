import { useCallback, useEffect, useState } from "react";
import { Car, Check, Clock3, ShieldCheck, X } from "lucide-react";
import { Field, Panel } from "@/components/app-shell";
import { btnDanger, btnGhost, btnPrimary, EmptyState, Modal, Notice, StatusBadge, inputCls } from "@/components/ui-kit";
import {
  createAfterHoursVehicleRequest,
  listAfterHoursVehicleOptions,
  listAfterHoursVehicleRequests,
  reviewAfterHoursVehicleRequest,
  type AfterHoursVehicleRequest,
  type Profile,
} from "@/lib/ehs/server";
import { can } from "@/lib/ehs/access";
import { errorMessage, useLive } from "@/lib/ui/use-live";

type Checklist = {
  fitToDrive: boolean;
  licenseValid: boolean;
  vehicleInspected: boolean;
  seatBeltsConfirmed: boolean;
  routeAndWeatherChecked: boolean;
  supervisorNotified: boolean;
};

const CHECKS: { key: keyof Checklist; label: string }[] = [
  { key: "fitToDrive", label: "I am fit, rested and safe to drive." },
  { key: "licenseValid", label: "The assigned driver has a valid licence." },
  { key: "vehicleInspected", label: "The vehicle has passed a pre-trip inspection." },
  { key: "seatBeltsConfirmed", label: "Seat belts are available and will be used by everyone." },
  { key: "routeAndWeatherChecked", label: "The route, weather and known road risks have been checked." },
  { key: "supervisorNotified", label: "The supervisor knows the route and expected return time." },
];

const emptyChecklist = (): Checklist => ({
  fitToDrive: false,
  licenseValid: false,
  vehicleInspected: false,
  seatBeltsConfirmed: false,
  routeAndWeatherChecked: false,
  supervisorNotified: false,
});

function localDateTime(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function AfterHoursVehiclePanel({ profile, mode }: { profile: Profile; mode: "mine" | "review" }) {
  const mayRequest = can(profile, "finance.request");
  const mayReview = can(profile, "fleet.manage") || can(profile, "ehs.manage");
  const [requests, setRequests] = useState<AfterHoursVehicleRequest[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<AfterHoursVehicleRequest | null>(null);
  const [rejectionNote, setRejectionNote] = useState("");

  const load = useCallback(async () => {
    try {
      setRequests(await listAfterHoursVehicleRequests());
      setError("");
    } catch (e) {
      setError(errorMessage(e, "Could not load after-hours vehicle requests"));
    }
  }, []);
  useLive(load, 20000);

  if (mode === "mine" && !mayRequest) return null;
  if (mode === "review" && !mayReview) return null;

  const visible = mode === "review" ? requests : requests.filter((request) => request.requesterId === profile.userId);
  const decide = async (request: AfterHoursVehicleRequest, status: "Approved" | "Rejected", note?: string) => {
    setBusyId(request.id);
    setError("");
    try {
      await reviewAfterHoursVehicleRequest({ data: { id: request.id, status, note } });
      setMessage(`Request ${status.toLowerCase()}.`);
      setRejecting(null);
      setRejectionNote("");
      await load();
    } catch (e) {
      setError(errorMessage(e, "Could not update this request"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <Panel title={mode === "review" ? "After-hours vehicle approvals" : "After-hours vehicle use"}>
        <Notice msg={message} onClose={() => setMessage("")} />
        <Notice msg={error} tone="danger" />
        {mode === "mine" ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xl text-sm text-fg-muted">Request permission before using a company vehicle outside your normal working hours.</p>
            <button type="button" className={btnPrimary} onClick={() => setDialogOpen(true)}><Car className="size-4" /> Request vehicle use</button>
          </div>
        ) : (
          <p className="mb-4 text-sm text-fg-muted">Review the trip and safety checklist before approving. Approval is required before the vehicle is used.</p>
        )}
        {visible.length === 0 ? (
          <EmptyState title={mode === "review" ? "No requests to review" : "No after-hours requests yet"} hint={mode === "review" ? "New requests from your company will appear here." : "Your submitted requests and decisions will appear here."} />
        ) : (
          <ul className="space-y-3">
            {visible.map((request) => (
              <li key={request.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{request.vehicleRegistration} · {request.origin} to {request.destination}</p>
                    <p className="mt-1 text-xs text-fg-muted">
                      {mode === "review" ? `${request.requesterName} · ` : ""}
                      Submitted {formatDateTime(request.createdAt)} · Driver: {request.driverName}
                    </p>
                  </div>
                  <StatusBadge status={request.status} />
                </div>
                <div className="mt-3 grid gap-x-5 gap-y-2 text-sm sm:grid-cols-2">
                  <p><span className="text-fg-muted">Trip:</span> {formatDateTime(request.departureAt)} to {formatDateTime(request.returnAt)}</p>
                  <p><span className="text-fg-muted">Passengers:</span> {request.passengerCount}</p>
                  <p><span className="text-fg-muted">Supervisor:</span> {request.supervisorName} · {request.supervisorPhone}</p>
                  <p><span className="text-fg-muted">Emergency contact:</span> {request.emergencyContactName} · {request.emergencyContactPhone}</p>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm">{request.reason}</p>
                {request.riskControls ? <p className="mt-2 text-sm"><span className="text-fg-muted">Risks / controls:</span> {request.riskControls}</p> : null}
                <div className="mt-3 rounded-md bg-bg-subtle p-3">
                  <p className="mb-2 flex items-center gap-2 text-xs font-semibold"><ShieldCheck className="size-4 text-accent" /> Safety checklist</p>
                  <ul className="grid gap-1.5 sm:grid-cols-2">
                    {CHECKS.map((check) => (
                      <li key={check.key} className="flex items-start gap-2 text-xs text-fg-muted"><Check className="mt-0.5 size-3.5 shrink-0 text-ok" />{check.label}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-fg-muted">Outside normal working hours confirmed · {request.departureAt && request.returnAt ? `${request.origin} to ${request.destination}` : ""}</p>
                </div>
                {request.reviewNote ? <p className="mt-3 text-sm text-fg-muted">Review note: {request.reviewNote}</p> : null}
                {mode === "review" && request.status === "Pending" ? request.requesterId === profile.userId ? (
                  <p className="mt-3 text-xs text-warn">A different Fleet or EHS reviewer must decide your request.</p>
                ) : (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" disabled={busyId === request.id} className={btnPrimary} onClick={() => void decide(request, "Approved")}><Check className="size-4" /> Approve</button>
                    <button type="button" disabled={busyId === request.id} className={btnDanger} onClick={() => setRejecting(request)}><X className="size-4" /> Reject</button>
                  </div>
                ) : null}
                {mode === "mine" && request.status === "Pending" ? <p className="mt-3 flex items-center gap-2 text-xs font-medium text-warn"><Clock3 className="size-4" /> Do not use the vehicle until this request is approved.</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {dialogOpen ? <AfterHoursRequestForm profile={profile} onClose={() => setDialogOpen(false)} onDone={(text) => { setDialogOpen(false); setMessage(text); void load(); }} /> : null}
      {rejecting ? (
        <Modal title="Reject after-hours request" onClose={() => { setRejecting(null); setRejectionNote(""); }}>
          <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void decide(rejecting, "Rejected", rejectionNote); }}>
            <Field label="Reason for rejection"><textarea required minLength={3} maxLength={1000} rows={4} value={rejectionNote} onChange={(event) => setRejectionNote(event.target.value)} className={inputCls} /></Field>
            <div className="flex justify-end gap-2"><button type="button" className={btnGhost} onClick={() => setRejecting(null)}>Cancel</button><button type="submit" disabled={busyId === rejecting.id} className={btnDanger}>Confirm rejection</button></div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

function AfterHoursRequestForm({ profile, onClose, onDone }: { profile: Profile; onClose: () => void; onDone: (message: string) => void }) {
  const [vehicles, setVehicles] = useState<Awaited<ReturnType<typeof listAfterHoursVehicleOptions>>>([]);
  const [form, setForm] = useState(() => {
    const departure = new Date(Date.now() + 60 * 60 * 1000);
    const returning = new Date(departure.getTime() + 60 * 60 * 1000);
    return {
      vehicleId: "", driverName: profile.fullName, reason: "", origin: "", destination: "",
      departureAt: localDateTime(departure), returnAt: localDateTime(returning), passengerCount: "0",
      supervisorName: "", supervisorPhone: "", emergencyContactName: "", emergencyContactPhone: "", riskControls: "",
    };
  });
  const [checklist, setChecklist] = useState<Checklist>(emptyChecklist);
  const [outsideHours, setOutsideHours] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listAfterHoursVehicleOptions().then(setVehicles).catch((e) => setError(errorMessage(e, "Could not load company vehicles")));
  }, []);

  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Modal title="After-hours vehicle use" onClose={onClose} wide>
      <form className="space-y-4" onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        if (CHECKS.some(({ key }) => !checklist[key])) return setError("Confirm every safety checklist item before submitting");
        if (!outsideHours) return setError("Confirm that this trip is outside your normal working hours");
        if (new Date(form.returnAt) <= new Date(form.departureAt)) return setError("Return must be after departure");
        setBusy(true);
        try {
          await createAfterHoursVehicleRequest({ data: {
            vehicleId: form.vehicleId,
            driverName: form.driverName,
            reason: form.reason,
            origin: form.origin,
            destination: form.destination,
            departureAt: new Date(form.departureAt).toISOString(),
            returnAt: new Date(form.returnAt).toISOString(),
            passengerCount: Number(form.passengerCount),
            supervisorName: form.supervisorName,
            supervisorPhone: form.supervisorPhone,
            emergencyContactName: form.emergencyContactName,
            emergencyContactPhone: form.emergencyContactPhone,
            riskControls: form.riskControls,
            outsideWorkHoursConfirmed: true,
            safetyChecklist: Object.fromEntries(CHECKS.map(({ key }) => [key, checklist[key]])) as Record<keyof Checklist, true>,
          } });
          onDone("Request sent to Fleet and EHS. Do not use the vehicle until approved.");
        } catch (e) {
          setError(errorMessage(e, "Could not submit the vehicle request"));
        } finally {
          setBusy(false);
        }
      }}>
        <Notice msg={error} tone="danger" />
        <p className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">Company vehicle use is not authorized until a reviewer approves this request.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company vehicle"><select required value={form.vehicleId} onChange={(event) => set("vehicleId", event.target.value)} className={inputCls}><option value="">Choose an active vehicle</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.registration} · {vehicle.make} {vehicle.model}</option>)}</select></Field>
          <Field label="Driver"><input required minLength={2} value={form.driverName} onChange={(event) => set("driverName", event.target.value)} className={inputCls} /></Field>
          <Field label="Reason for use"><textarea required minLength={10} rows={3} value={form.reason} onChange={(event) => set("reason", event.target.value)} className={inputCls} /></Field>
          <Field label="Risks and controls"><textarea rows={3} value={form.riskControls} onChange={(event) => set("riskControls", event.target.value)} placeholder="Night driving, weather, fatigue, route hazards and controls" className={inputCls} /></Field>
          <Field label="From"><input required value={form.origin} onChange={(event) => set("origin", event.target.value)} className={inputCls} /></Field>
          <Field label="To"><input required value={form.destination} onChange={(event) => set("destination", event.target.value)} className={inputCls} /></Field>
          <Field label="Departure"><input required type="datetime-local" min={localDateTime(new Date())} value={form.departureAt} onChange={(event) => set("departureAt", event.target.value)} className={inputCls} /></Field>
          <Field label="Expected return"><input required type="datetime-local" min={form.departureAt} value={form.returnAt} onChange={(event) => set("returnAt", event.target.value)} className={inputCls} /></Field>
          <Field label="Passengers"><input required type="number" min="0" max="30" value={form.passengerCount} onChange={(event) => set("passengerCount", event.target.value)} className={inputCls} /></Field>
          <Field label="Supervisor name"><input required value={form.supervisorName} onChange={(event) => set("supervisorName", event.target.value)} className={inputCls} /></Field>
          <Field label="Supervisor phone"><input required type="tel" value={form.supervisorPhone} onChange={(event) => set("supervisorPhone", event.target.value)} className={inputCls} /></Field>
          <Field label="Emergency contact name"><input required value={form.emergencyContactName} onChange={(event) => set("emergencyContactName", event.target.value)} className={inputCls} /></Field>
          <Field label="Emergency contact phone"><input required type="tel" value={form.emergencyContactPhone} onChange={(event) => set("emergencyContactPhone", event.target.value)} className={inputCls} /></Field>
        </div>
        <fieldset className="rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-semibold">Safety checklist</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {CHECKS.map(({ key, label }) => (
              <label key={key} className="flex items-start gap-2 text-sm text-fg-muted"><input type="checkbox" checked={checklist[key]} onChange={(event) => setChecklist((current) => ({ ...current, [key]: event.target.checked }))} className="mt-0.5 accent-[var(--accent)]" />{label}</label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={outsideHours} onChange={(event) => setOutsideHours(event.target.checked)} className="mt-0.5 accent-[var(--accent)]" />I confirm this trip is outside my normal working hours.</label>
        <div className="flex justify-end gap-2"><button type="button" className={btnGhost} onClick={onClose}>Cancel</button><button type="submit" disabled={busy || vehicles.length === 0} className={btnPrimary}><Car className="size-4" /> {busy ? "Sending…" : "Send for approval"}</button></div>
        {vehicles.length === 0 ? <p className="text-xs text-fg-muted">No active company vehicles are available for selection.</p> : null}
      </form>
    </Modal>
  );
}