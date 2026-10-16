import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardCheck, Gauge, Route as RouteIcon, Truck, Wallet } from "lucide-react";
import { RoleGate } from "@/components/role-gate";
import { Field, Panel } from "@/components/app-shell";
import { EmptyState, Kpi, Modal, Notice, StatusBadge, btnGhost, btnPrimary, inputCls } from "@/components/ui-kit";
import { InspectionForm, JourneyForm, RequestCenter } from "@/components/requests/request-center";
import { ItemModal } from "@/components/requests/item-modal";
import { AfterHoursVehiclePanel } from "@/components/requests/after-hours-vehicle";
import { MyFinanceRequests } from "@/components/requests/my-finance-requests";
import { useOrgBrand } from "@/components/workspace-bar";
import { canAny } from "@/lib/ehs/access";
import { listProjectsForRequests } from "@/lib/ehs/finance";
import { listActiveJourneyLocations, listInbox, listMyJourneyPlans, shareJourneyLocation, stopJourneyLocationSharing, updateJourneyStatus, type ActiveJourneyLocation, type InboxItem, type JourneyPlan } from "@/lib/ehs/requests-hub";
import { listVehicles, submitDailyMileage, type Profile, type Vehicle } from "@/lib/ehs/server";
import { formatDate, formatNumber } from "@/lib/ui/format";
import { errorMessage, useLive } from "@/lib/ui/use-live";
import { SafetyHubWorkspace } from "@/components/hse/safetyhub-workspace";

export const Route = createFileRoute("/driver")({ component: DriverPage });

function DriverPage() {
  return <RoleGate path="/driver">{(profile) => <Fleet profile={profile} />}</RoleGate>;
}

type Dialog = null | "inspection" | "journey" | "center" | { mileage: Vehicle };

function Fleet({ profile }: { profile: Profile }) {
  const brand = useOrgBrand();
  const isDriver = profile.role === "Driver" || canAny(profile, ["fleet.driver_dashboard"]);
  const manager = canAny(profile, ["fleet.manage", "ehs.manage"]);
  const mayRequestMoney = profile.role !== "Finance";
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [journeys, setJourneys] = useState<JourneyPlan[]>([]);
  const [inspections, setInspections] = useState<InboxItem[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
  const [activeLocations, setActiveLocations] = useState<ActiveJourneyLocation[]>([]);
  const [trackingJourneyId, setTrackingJourneyId] = useState<number | null>(null);
  const lastLocationSentAt = useRef(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [item, setItem] = useState<InboxItem | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setVehicles(await listVehicles().catch(() => []));
    setJourneys(await listMyJourneyPlans().catch(() => []));
    const all = await listInbox({}).catch(() => []);
    setInspections(all.filter((i) => i.kind === "inspection" && i.requesterId === profile.userId));
    setWaiting(all.filter((i) => i.needsMyAction && ["journey", "inspection"].includes(i.kind)).length);
    if (manager) setActiveLocations(await listActiveJourneyLocations().catch(() => []));
  }, [profile.userId, manager]);
  useLive(load, 20000);
  useLive(async () => setProjects(await listProjectsForRequests().catch(() => [])), 120000);

  useEffect(() => {
    if (trackingJourneyId === null || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition((position) => {
      if (Date.now() - lastLocationSentAt.current < 15000) return;
      lastLocationSentAt.current = Date.now();
      void shareJourneyLocation({ data: { id: trackingJourneyId, latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy } })
        .catch((error) => { setMsg(errorMessage(error, "Could not update your live location")); setTrackingJourneyId(null); });
    }, (error) => {
      setMsg(error.code === error.PERMISSION_DENIED ? "Location permission was denied. You can still use the journey plan without live sharing." : "Could not read device location.");
      void stopJourneyLocationSharing({ data: { id: trackingJourneyId } }).catch(() => {});
      setTrackingJourneyId(null);
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
    return () => { navigator.geolocation.clearWatch(watchId); void stopJourneyLocationSharing({ data: { id: trackingJourneyId } }).catch(() => {}); };
  }, [trackingJourneyId]);

  const changeJourney = async (id: number, status: "Started" | "Completed" | "Cancelled", done: string) => {
    try { await updateJourneyStatus({ data: { id, status } }); if (status === "Completed" || status === "Cancelled") setTrackingJourneyId(null); setMsg(done); void load(); } catch (e) { setMsg(errorMessage(e)); }
  };
  const finish = (m: string) => { setDialog(null); setMsg(m); void load(); };

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <Notice msg={msg} onClose={() => setMsg("")} />
      <div className="mb-6"><AfterHoursVehiclePanel profile={profile} mode="review" /></div>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Kpi label="Vehicles" value={vehicles.length} hint={`${vehicles.filter((v) => v.status === "Active").length} active`} />
        <Kpi label="Journeys in progress" value={journeys.filter((j) => j.status === "Started").length} />
        {manager ? <Kpi label="Needs your action" value={waiting} tone={waiting ? "warn" : undefined} hint="Journey plans and failed inspections" /> : <Kpi label="Inspections" value={inspections.length} hint="You submitted" />}
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} onClick={() => setDialog("journey")}><RouteIcon className="size-4" /> New journey plan</button>
        <button type="button" className={btnGhost} onClick={() => setDialog("inspection")}><ClipboardCheck className="size-4" /> Vehicle inspection</button>
        {mayRequestMoney ? <button type="button" className={btnGhost} onClick={() => setDialog("center")}><Wallet className="size-4" /> Request fuel or repair</button> : null}
      </div>

      {manager ? <Panel title="Live journey monitoring">
        <p className="mb-3 text-xs text-fg-muted">Drivers must choose to share location from their active journey. SmartHub stores only the latest location, not a route history.</p>
        {activeLocations.length === 0 ? <EmptyState title="No active journeys" /> : <ul className="divide-y divide-border">{activeLocations.map((x) => <li key={x.id} className="flex flex-wrap items-center gap-3 py-3"><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{x.driverName} · {x.vehicleLabel ?? "Vehicle"}</span><span className="block text-xs text-fg-muted">{x.jmpNumber} · {x.origin} → {x.destination}</span><span className="block text-xs text-fg-muted">{x.updatedAt ? `Updated ${new Date(x.updatedAt).toLocaleTimeString()}` : "Waiting for driver location sharing"}</span></span>{x.latitude !== null && x.longitude !== null ? <a className={btnGhost} href={`https://maps.google.com/?q=${x.latitude},${x.longitude}`} target="_blank" rel="noreferrer">Open map · ±{Math.round(x.accuracy ?? 0)}m</a> : <span className="text-xs text-fg-muted">Location not shared</span>}</li>)}</ul>}
      </Panel> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Vehicles">
          {vehicles.length === 0 ? <EmptyState title="No vehicles yet" hint="Vehicles assigned to you appear here." /> : (
            <ul className="divide-y divide-border">
              {vehicles.map((v) => (
                <li key={v.id} className="flex items-center gap-3 py-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent"><Truck className="size-[18px]" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{v.registration} · {v.make} {v.model}</span><span className="block text-xs text-fg-muted">{formatNumber(v.mileage)} km{v.nextInspectionDate ? ` · next inspection ${formatDate(v.nextInspectionDate)}` : ""}</span></span>
                  <StatusBadge status={v.status === "Active" ? "active" : v.status === "Maintenance" ? "Watch" : "suspended"} />
                  {isDriver ? <button type="button" className={btnGhost} onClick={() => setDialog({ mileage: v })}><Gauge className="size-4" /> Mileage</button> : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="My journeys">
          {journeys.length === 0 ? <EmptyState title="No journey plans" hint="Plan a trip before you drive. Fleet approves it, then you start and mark arrival." /> : (
            <ul className="divide-y divide-border">
              {journeys.slice(0, 8).map((j) => (
                <li key={j.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0"><span className="block text-sm font-medium">{j.origin} to {j.destination}</span><span className="block text-xs text-fg-muted">{j.jmpNumber} · {formatDate(j.departAt)}{j.vehicleLabel ? ` · ${j.vehicleLabel}` : ""}</span></span>
                    <StatusBadge status={j.status} />
                  </div>
                  {j.decisionNote ? <p className="mt-1 text-xs text-fg-muted">{j.decisionNote}</p> : null}
                  <div className="mt-2 flex gap-2">
                    {j.status === "Approved" ? <button type="button" className={btnPrimary} onClick={() => void changeJourney(j.id, "Started", "Journey started. Drive safely.")}>Start journey</button> : null}
                    {j.status === "Started" ? <button type="button" className={btnPrimary} onClick={() => void changeJourney(j.id, "Completed", "Arrived safely")}>I have arrived</button> : null}
                    {j.status === "Started" && trackingJourneyId !== j.id ? <button type="button" className={btnGhost} onClick={() => { if (!navigator.geolocation) { setMsg("This device or browser does not provide GPS location."); return; } setTrackingJourneyId(j.id); setMsg("Live location sharing started for this active journey."); }}>Share live location</button> : null}
                    {trackingJourneyId === j.id ? <button type="button" className={btnGhost} onClick={() => { setTrackingJourneyId(null); void stopJourneyLocationSharing({ data: { id: j.id } }).then(() => { setMsg("Live location sharing stopped and the last location removed."); void load(); }).catch((e) => setMsg(errorMessage(e))); }}>Stop sharing</button> : null}
                    {["Pending", "Approved"].includes(j.status) ? <button type="button" className={btnGhost} onClick={() => void changeJourney(j.id, "Cancelled", "Journey cancelled")}>Cancel</button> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="My inspections">
          {inspections.length === 0 ? <EmptyState title="No inspections yet" hint="Check the vehicle before every trip and attach photos of any fault." /> : (
            <ul className="divide-y divide-border">
              {inspections.slice(0, 8).map((i) => (
                <li key={i.id}><button type="button" onClick={() => setItem(i)} className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-bg-subtle/60"><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{i.title}</span><span className="block text-xs text-fg-muted">{formatDate(i.createdAt)}</span></span><StatusBadge status={i.status === "Passed" ? "Approved" : "Rejected"} /></button></li>
              ))}
            </ul>
          )}
        </Panel>
        {mayRequestMoney ? <MyFinanceRequests /> : null}
      </div>

      <section className="mt-6"><h2 className="mb-3 text-lg font-semibold">Safety & wellbeing</h2><SafetyHubWorkspace profile={profile} compact /></section>

      {dialog === "journey" ? <JourneyForm onClose={() => setDialog(null)} onDone={finish} /> : null}
      {dialog === "inspection" ? <InspectionForm onClose={() => setDialog(null)} onDone={finish} /> : null}
          {dialog === "center" ? <RequestCenter projects={projects} currency={brand?.currency ?? "TZS"} onClose={() => setDialog(null)} onDone={finish} onOther={() => setDialog(null)} /> : null}
      {dialog && typeof dialog === "object" ? <MileageDialog vehicle={dialog.mileage} onClose={() => setDialog(null)} onDone={finish} /> : null}
      {item ? <ItemModal profile={profile} item={item} onClose={() => setItem(null)} onChanged={(m) => { setMsg(m); void load(); }} /> : null}
    </main>
  );
}

function MileageDialog({ vehicle, onClose, onDone }: { vehicle: Vehicle; onClose: () => void; onDone: (m: string) => void }) {
  const [opening, setOpening] = useState(String(vehicle.mileage ?? 0));
  const [closing, setClosing] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  return (
    <Modal title={`Mileage: ${vehicle.registration}`} onClose={onClose}>
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        try { await submitDailyMileage({ data: { vehicleId: String(vehicle.id), openingMileage: Number(opening), closingMileage: Number(closing), notes: notes || undefined } }); onDone("Mileage recorded"); } catch (x) { setErr(errorMessage(x)); }
      }}>
        <Notice msg={err} tone="danger" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Opening (km)"><input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value.replace(/[^0-9.]/g, ""))} className={inputCls} /></Field>
          <Field label="Closing (km)"><input required inputMode="decimal" value={closing} onChange={(e) => setClosing(e.target.value.replace(/[^0-9.]/g, ""))} className={inputCls} /></Field>
        </div>
        <Field label="Notes (optional)"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} /></Field>
        <button type="submit" className={`${btnPrimary} w-full`}>Save mileage</button>
      </form>
    </Modal>
  );
}
