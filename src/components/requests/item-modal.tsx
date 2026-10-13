import { useState } from "react";
import { Check, X } from "lucide-react";
import { Field } from "@/components/app-shell";
import { btnDanger, btnGhost, btnPrimary, Modal, Notice, StatusBadge, inputCls } from "@/components/ui-kit";
import { reviewInspection, updateJourneyStatus, type InboxItem } from "@/lib/ehs/requests-hub";
import { can } from "@/lib/ehs/access";
import type { Profile } from "@/lib/ehs/server";
import { errorMessage } from "@/lib/ui/use-live";

export function ItemModal({ profile, item, onClose, onChanged }: {
  profile: Profile;
  item: InboxItem;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canReview = can(profile, "fleet.manage") || can(profile, "ehs.manage");
  const journey = item.journey;
  const inspection = item.inspection;
  const dateTime = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  const decideJourney = async (status: "Approved" | "Rejected") => {
    setBusy(true); setError("");
    try {
      await updateJourneyStatus({ data: { id: item.id, status, reason: note || undefined } });
      onChanged(`Journey ${status.toLowerCase()}.`);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  const acknowledgeInspection = async () => {
    setBusy(true); setError("");
    try {
      await reviewInspection({ data: { id: item.id, note: note || undefined } });
      onChanged("Inspection review recorded.");
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <Modal title={item.title} onClose={onClose} wide>
      <div className="space-y-4">
        <Notice msg={error} tone="danger" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-fg-muted">{item.requesterName} · {dateTime(item.createdAt)}</p>
          <StatusBadge status={item.status} />
        </div>
        {journey ? (
          <div className="space-y-2 text-sm">
            <p><span className="text-fg-muted">Plan:</span> {journey.jmpNumber}</p>
            <p><span className="text-fg-muted">Route:</span> {journey.origin} to {journey.destination}</p>
            <p><span className="text-fg-muted">Vehicle:</span> {journey.vehicleLabel ?? "Not specified"}</p>
            <p><span className="text-fg-muted">Departure:</span> {dateTime(journey.departAt)}{journey.eta ? ` · ETA ${dateTime(journey.eta)}` : ""}</p>
            <p><span className="text-fg-muted">Passengers:</span> {journey.passengers}</p>
            {journey.purpose ? <p><span className="text-fg-muted">Purpose:</span> {journey.purpose}</p> : null}
            {journey.riskNotes ? <p><span className="text-fg-muted">Risks:</span> {journey.riskNotes}</p> : null}
            {journey.decisionNote ? <p className="text-fg-muted">Decision note: {journey.decisionNote}</p> : null}
          </div>
        ) : null}
        {inspection ? (
          <div className="space-y-3">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <p><span className="text-fg-muted">Vehicle:</span> {inspection.vehicleLabel}</p>
              <p><span className="text-fg-muted">Inspection:</span> {inspection.inspectionType}</p>
              {inspection.odometer != null ? <p><span className="text-fg-muted">Odometer:</span> {inspection.odometer.toLocaleString()} km</p> : null}
              <p><span className="text-fg-muted">Result:</span> {inspection.result}</p>
            </div>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {inspection.items.map((check) => <li key={check.item} className="flex items-center gap-2 text-sm"><span className={check.ok ? "text-ok" : "text-danger"}>{check.ok ? <Check className="size-4" /> : <X className="size-4" />}</span>{check.item}</li>)}
            </ul>
            {inspection.defects ? <p className="rounded-md bg-danger/10 p-3 text-sm text-danger">{inspection.defects}</p> : null}
            {inspection.reviewNote ? <p className="text-sm text-fg-muted">Review note: {inspection.reviewNote}</p> : null}
          </div>
        ) : null}
        {canReview && item.needsMyAction ? (
          <>
            {item.kind === "journey" ? <Field label="Review note"><textarea rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} className={inputCls} /></Field> : null}
            {item.kind === "inspection" ? <Field label="Review note"><textarea rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} className={inputCls} /></Field> : null}
            <div className="flex flex-wrap justify-end gap-2">
              {item.kind === "journey" ? <>
                <button type="button" disabled={busy} className={btnDanger} onClick={() => void decideJourney("Rejected")}><X className="size-4" /> Reject</button>
                <button type="button" disabled={busy} className={btnPrimary} onClick={() => void decideJourney("Approved")}><Check className="size-4" /> Approve</button>
              </> : <button type="button" disabled={busy} className={btnPrimary} onClick={() => void acknowledgeInspection()}><Check className="size-4" /> Mark reviewed</button>}
              <button type="button" className={btnGhost} onClick={onClose}>Close</button>
            </div>
          </>
        ) : <div className="flex justify-end"><button type="button" className={btnGhost} onClick={onClose}>Close</button></div>}
      </div>
    </Modal>
  );
}