import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { workdayMiddleware } from "@/lib/auth/workday-middleware";
import { getSql } from "@/lib/db.server";
import { can } from "./access";
import { audit, notify, requirePermission, requireProfile, usersWithPermission } from "./core";

export const INSPECTION_ITEMS = [
  "Brakes", "Tyres and wheels", "Lights and indicators", "Seat belts", "Horn and mirrors",
  "Wipers and windscreen", "Fluid levels and leaks", "Emergency equipment",
] as const;

export type VehicleOption = { id: string; registration: string; make: string; model: string };
export type JourneyPlan = {
  id: number; jmpNumber: string; status: string; origin: string; destination: string;
  departAt: string; eta: string | null; vehicleId: string | null; vehicleLabel: string | null;
  purpose: string | null; passengers: number; riskNotes: string | null; decisionNote: string | null;
  requesterId: string; requesterName: string; createdAt: string;
};
export type InspectionRecord = {
  id: string; vehicleId: string | null; vehicleLabel: string; inspectionType: string; odometer: number | null;
  result: "Pass" | "Fail"; items: { item: string; ok: boolean }[]; defects: string | null;
  fleetReviewStatus: string; reviewNote: string | null; requesterId: string; requesterName: string; createdAt: string;
};
export type InboxItem = {
  id: number | string; kind: "journey" | "inspection"; requesterId: string; requesterName: string;
  title: string; status: string; createdAt: string; needsMyAction: boolean;
  journey?: JourneyPlan; inspection?: InspectionRecord;
};

export const listVehicleOptions = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const profile = await requirePermission(context.userId, "finance.request");
    const sql = await getSql();
    return sql<VehicleOption>`select id, registration, make, model from vehicles
      where organization_id = ${profile.organizationId} and status = 'Active'
      order by registration`;
  });

const journeyInput = z.object({
  vehicleId: z.string().optional(), vehicleLabel: z.string().max(120).optional(),
  origin: z.string().trim().min(1).max(200), destination: z.string().trim().min(1).max(200),
  departAt: z.string().datetime(), eta: z.string().datetime().optional(),
  purpose: z.string().max(1000).optional(), passengers: z.number().int().min(0).max(30).default(0),
  riskNotes: z.string().max(2000).optional(),
});

export const createJourneyPlan = createServerFn({ method: "POST" })
  .validator((input: unknown) => journeyInput.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requirePermission(context.userId, "finance.request");
    const departure = new Date(data.departAt);
    if (departure.getTime() <= Date.now()) throw new Error("Departure must be in the future");
    if (data.eta && new Date(data.eta) <= departure) throw new Error("Expected arrival must be after departure");
    const sql = await getSql();
    let vehicleLabel = data.vehicleLabel?.trim() || null;
    if (data.vehicleId) {
      const vehicle = await sql<{ registration: string }>`select registration from vehicles
        where id::text = ${data.vehicleId} and organization_id = ${profile.organizationId} and status = 'Active'`;
      if (!vehicle[0]) throw new Error("Choose an active vehicle from your company fleet");
      vehicleLabel = vehicle[0].registration;
    }
    if (!data.vehicleId && !vehicleLabel) throw new Error("Choose or enter a vehicle");

    const inserted = await sql<{ id: number }>`insert into trips (
      organization_id, driver_id, vehicle_id, origin, destination, requested_by, status,
      approval_mode, vehicle_label, departure_at, eta, purpose, passengers, risk_notes
    ) values (
      ${profile.organizationId}, ${context.userId}, ${data.vehicleId ?? null}, ${data.origin}, ${data.destination},
      ${context.userId}, 'Pending', 'Manual', ${vehicleLabel}, ${data.departAt}::timestamptz,
      ${data.eta ?? null}::timestamptz, ${data.purpose ?? null}, ${data.passengers}, ${data.riskNotes ?? null}
    ) returning id`;
    const id = inserted[0]!.id;
    const jmpNumber = `JMP-${new Date().getFullYear()}-${String(id).padStart(5, "0")}`;
    await sql`update trips set jmp_number = ${jmpNumber} where id = ${id} and organization_id = ${profile.organizationId}`;

    const reviewers = await usersWithPermission(sql, profile.organizationId, "fleet.manage");
    await notify(sql, {
      organizationId: profile.organizationId,
      userIds: reviewers.filter((userId) => userId !== context.userId),
      title: `${jmpNumber} needs Fleet approval`,
      message: `${profile.fullName} planned ${data.origin} to ${data.destination} in ${vehicleLabel}.`,
      type: "journey", link: "/driver", entityType: "trip", entityId: id,
    });
    await audit(sql, profile.organizationId, context.userId, "submit", "trip", id, { jmpNumber });
    return { success: true, jmpNumber, id };
  });

const journeyColumns = `t.id, t.jmp_number, t.status, t.origin, t.destination, t.departure_at, t.eta,
  t.vehicle_id, t.vehicle_label, t.purpose, t.passengers, t.risk_notes, t.decision_note,
  t.requested_by, coalesce(p.full_name, 'Unknown') as requester_name, t.requested_at`;

function mapJourney(row: Record<string, any>): JourneyPlan {
  return {
    id: Number(row.id), jmpNumber: row.jmp_number ?? `JMP-${row.id}`, status: row.status,
    origin: row.origin, destination: row.destination, departAt: row.departure_at,
    eta: row.eta, vehicleId: row.vehicle_id, vehicleLabel: row.vehicle_label,
    purpose: row.purpose, passengers: Number(row.passengers ?? 0), riskNotes: row.risk_notes,
    decisionNote: row.decision_note ?? row.rejection_reason, requesterId: row.requested_by,
    requesterName: row.requester_name, createdAt: row.requested_at,
  };
}

export const listMyJourneyPlans = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const profile = await requireProfile(context.userId);
    const sql = await getSql();
    const rows = await sql.query<Record<string, any>>(`select ${journeyColumns} from trips t
      left join profiles p on p.user_id = t.requested_by and p.organization_id = t.organization_id
      where t.organization_id::text = $1 and (t.requested_by = $2 or t.driver_id = $2)
      order by t.requested_at desc limit 100`, [profile.organizationId, context.userId]);
    return rows.map(mapJourney);
  });

export const updateJourneyStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({
    id: z.number().int().positive(),
    status: z.enum(["Approved", "Rejected", "Started", "Completed", "Cancelled"]),
    reason: z.string().trim().max(1000).optional(),
  }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requireProfile(context.userId);
    const reviewer = can(profile, "fleet.manage") || can(profile, "ehs.manage");
    const sql = await getSql();
    const rows = await sql<{ id: number; requested_by: string; driver_id: string; status: string; organization_id: string; vehicle_id: string | null }>`select id, requested_by, driver_id, status, organization_id, vehicle_id from trips
      where id = ${data.id} and organization_id::text = ${profile.organizationId}`;
    const trip = rows[0];
    if (!trip) throw new Error("Journey plan not found");
    const decision = data.status === "Approved" || data.status === "Rejected";
    if (decision) {
      if (!reviewer || trip.requested_by === context.userId) throw new Error("A different Fleet reviewer must decide this journey");
      if (trip.status !== "Pending") throw new Error("This journey is no longer pending");
      if (data.status === "Rejected" && !data.reason) throw new Error("Add a reason before rejecting this journey");
      if (data.status === "Approved" && trip.vehicle_id) {
        const active = await sql`select 1 from vehicles where id::text = ${trip.vehicle_id} and organization_id = ${profile.organizationId} and status = 'Active'`;
        if (!active.length) throw new Error("The selected vehicle is no longer active");
      }
      await sql`update trips set status = ${data.status}, approved_by = ${context.userId}, approved_at = now(),
        decision_note = ${data.reason ?? null}, rejection_reason = ${data.status === "Rejected" ? data.reason ?? null : null}
        where id = ${data.id} and organization_id::text = ${profile.organizationId} and status = 'Pending'`;
    } else {
      if (trip.requested_by !== context.userId && trip.driver_id !== context.userId) throw new Error("Only the requester or assigned driver can update this journey");
      if (data.status === "Started") {
        if (trip.status !== "Approved") throw new Error("Journey must be approved before it starts");
        await sql`update trips set status = 'Started', started_at = now() where id = ${data.id} and organization_id::text = ${profile.organizationId} and status = 'Approved'`;
      } else if (data.status === "Completed") {
        if (trip.status !== "Started") throw new Error("Only a started journey can be completed");
        await sql`update trips set status = 'Completed', completed_at = now(), last_latitude=null, last_longitude=null,
          last_location_accuracy_m=null, last_location_at=null where id = ${data.id} and organization_id::text = ${profile.organizationId} and status = 'Started'`;
      } else {
        if (!(["Pending", "Approved"].includes(trip.status))) throw new Error("This journey can no longer be cancelled");
        await sql`update trips set status = 'Cancelled', decision_note = 'Cancelled by requester', last_latitude=null, last_longitude=null,
          last_location_accuracy_m=null, last_location_at=null where id = ${data.id} and organization_id::text = ${profile.organizationId} and status = ${trip.status}`;
      }
    }
    if (decision) await notify(sql, { organizationId: profile.organizationId, userIds: [trip.requested_by], title: `Journey ${data.status.toLowerCase()}`, message: data.reason ?? `Your journey was ${data.status.toLowerCase()}.`, type: "journey", link: "/driver", entityType: "trip", entityId: data.id });
    await audit(sql, profile.organizationId, context.userId, data.status.toLowerCase(), "trip", data.id, { reason: data.reason ?? null });
    return { success: true };
  });

export const shareJourneyLocation = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.number().int().positive(), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracy: z.number().min(0).max(10000) }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requireProfile(context.userId);
    const sql = await getSql();
    const rows = await sql`update trips set last_latitude=${data.latitude}, last_longitude=${data.longitude},
      last_location_accuracy_m=${data.accuracy}, last_location_at=now()
      where id=${data.id} and organization_id::text=${profile.organizationId} and driver_id=${context.userId} and status='Started'
      returning id`;
    if (!rows[0]) throw new Error("Only the assigned driver can share location while the journey is active");
    return { success: true };
  });

export const stopJourneyLocationSharing = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.number().int().positive() }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requireProfile(context.userId);
    const sql = await getSql();
    await sql`update trips set last_latitude=null,last_longitude=null,last_location_accuracy_m=null,last_location_at=null
      where id=${data.id} and organization_id::text=${profile.organizationId} and driver_id=${context.userId} and status='Started'`;
    return { success: true };
  });

export type ActiveJourneyLocation = { id: number; jmpNumber: string; driverName: string; vehicleLabel: string | null; origin: string; destination: string; latitude: number | null; longitude: number | null; accuracy: number | null; updatedAt: string | null };

export const listActiveJourneyLocations = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const profile = await requirePermission(context.userId, "fleet.manage", "Fleet managers can view active journey locations");
    const sql = await getSql();
    const rows = await sql<{ id: number; jmp_number: string | null; driver_name: string | null; vehicle_label: string | null; origin: string; destination: string; latitude: number | null; longitude: number | null; accuracy: number | null; updated_at: string | null }>`select t.id,t.jmp_number,p.full_name driver_name,t.vehicle_label,t.origin,t.destination,
      case when t.last_location_at>=now()-interval '5 minutes' then t.last_latitude else null end latitude,
      case when t.last_location_at>=now()-interval '5 minutes' then t.last_longitude else null end longitude,
      case when t.last_location_at>=now()-interval '5 minutes' then t.last_location_accuracy_m else null end accuracy,t.last_location_at::text updated_at
      from trips t left join profiles p on p.user_id=t.driver_id and p.organization_id=t.organization_id
      where t.organization_id::text=${profile.organizationId} and t.status='Started' order by t.started_at desc nulls last limit 50`;
    return rows.map((r) => ({ id: r.id, jmpNumber: r.jmp_number ?? `JMP-${r.id}`, driverName: r.driver_name ?? "Driver", vehicleLabel: r.vehicle_label, origin: r.origin, destination: r.destination, latitude: r.latitude, longitude: r.longitude, accuracy: r.accuracy, updatedAt: r.updated_at } satisfies ActiveJourneyLocation));
  });

export const submitInspection = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({
    vehicleId: z.string().optional(), vehicleLabel: z.string().min(1).max(120),
    inspectionType: z.enum(["Pre-trip", "Daily", "Weekly"]), odometer: z.number().nonnegative().optional(),
    items: z.array(z.object({ item: z.string(), ok: z.boolean() })).min(1).max(30), defects: z.string().max(2000).optional(),
  }).parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requirePermission(context.userId, "finance.request");
    const sql = await getSql();
    let vehicleLabel = data.vehicleLabel;
    if (data.vehicleId) {
      const vehicle = await sql<{ registration: string }>`select registration from vehicles
        where id::text = ${data.vehicleId} and organization_id = ${profile.organizationId} and status = 'Active'`;
      if (!vehicle[0]) throw new Error("Choose an active company vehicle");
      vehicleLabel = vehicle[0].registration;
    }
    const failedItems = data.items.filter((item) => !item.ok);
    if (failedItems.length && !data.defects?.trim()) throw new Error("Describe the failed inspection items");
    const result = failedItems.length ? "Fail" : "Pass";
    const inserted = await sql<{ id: string }>`insert into vehicle_inspections (
      organization_id, inspector_id, user_id, vehicle_id, vehicle_label, inspection_date,
      type, inspection_type, odometer, result, items, notes, status
    ) values (
      ${profile.organizationId}, ${context.userId}, ${context.userId}, ${data.vehicleId ?? null}, ${vehicleLabel}, current_date,
      ${data.inspectionType}, ${data.inspectionType}, ${data.odometer ?? null}, ${result},
      ${JSON.stringify(data.items)}::jsonb, ${data.defects?.trim() || null}, 'Submitted'
    ) returning id`;
    const id = inserted[0]!.id;
    if (data.vehicleId) {
      await sql`update vehicles set inspection_status = ${result === "Pass" ? "Passed" : "Failed"},
        last_inspection_date = current_date, updated_at = now()
        where id::text = ${data.vehicleId} and organization_id = ${profile.organizationId}`;
    }
    if (result === "Fail") {
      const reviewers = await usersWithPermission(sql, profile.organizationId, "fleet.manage");
      await notify(sql, { organizationId: profile.organizationId, userIds: reviewers.filter((userId) => userId !== context.userId), title: "Failed vehicle inspection", message: `${vehicleLabel}: ${data.defects}`, type: "inspection", link: "/driver", entityType: "vehicle_inspection", entityId: id });
    }
    await audit(sql, profile.organizationId, context.userId, "submit", "vehicle_inspection", id, { result, vehicleLabel });
    return { id: String(id), result };
  });

type InspectionRow = {
  id: string; vehicle_id: string | null; vehicle_label: string; inspection_type: string; odometer: number | null;
  result: "Pass" | "Fail"; items: { item: string; ok: boolean }[]; defects: string | null; notes: string | null;
  status: string; review_note: string | null; user_id: string; requester_name: string; created_at: string;
};

function mapInspection(row: InspectionRow): InspectionRecord {
  return { id: String(row.id), vehicleId: row.vehicle_id, vehicleLabel: row.vehicle_label, inspectionType: row.inspection_type,
    odometer: row.odometer == null ? null : Number(row.odometer), result: row.result, items: row.items, defects: row.defects ?? row.notes,
    fleetReviewStatus: row.status, reviewNote: row.review_note, requesterId: row.user_id,
    requesterName: row.requester_name, createdAt: row.created_at };
}

export const listInbox = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({}).optional().parse(input))
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const profile = await requireProfile(context.userId);
    const reviewer = can(profile, "fleet.manage") || can(profile, "ehs.manage");
    const sql = await getSql();
    const [journeys, inspections] = await Promise.all([
      sql.query<Record<string, any>>(`select ${journeyColumns} from trips t
        left join profiles p on p.user_id = t.requested_by and p.organization_id = t.organization_id
        where t.organization_id::text = $1 and ($2::boolean or t.requested_by = $3 or t.driver_id = $3)
        order by t.requested_at desc limit 100`, [profile.organizationId, reviewer, context.userId]),
      sql.query<InspectionRow>(`select i.*, p.full_name as requester_name from vehicle_inspections i
        left join profiles p on p.user_id = i.user_id and p.organization_id = i.organization_id
        where i.organization_id = $1 and ($2::boolean or i.user_id = $3)
        order by i.created_at desc limit 100`, [profile.organizationId, reviewer, context.userId]),
    ]);
    const journeyItems: InboxItem[] = journeys.map((row) => {
      const journey = mapJourney(row);
      return { id: journey.id, kind: "journey", requesterId: journey.requesterId, requesterName: journey.requesterName,
        title: `${journey.origin} to ${journey.destination}`, status: journey.status, createdAt: journey.createdAt,
        needsMyAction: reviewer && journey.status === "Pending", journey };
    });
    const inspectionItems: InboxItem[] = inspections.map((row) => {
      const inspection = mapInspection(row);
      return { id: inspection.id, kind: "inspection", requesterId: inspection.requesterId, requesterName: inspection.requesterName,
        title: `${inspection.vehicleLabel} · ${inspection.inspectionType}`, status: inspection.fleetReviewStatus,
        createdAt: inspection.createdAt, needsMyAction: reviewer && inspection.result === "Fail" && inspection.fleetReviewStatus === "Submitted", inspection };
    });
    return [...journeyItems, ...inspectionItems].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

export const listMyInspections = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const profile = await requireProfile(context.userId);
    const sql = await getSql();
    const rows = await sql<InspectionRow>`select i.*, p.full_name as requester_name from vehicle_inspections i
      left join profiles p on p.user_id = i.user_id and p.organization_id = i.organization_id
      where i.organization_id = ${profile.organizationId} and i.user_id = ${context.userId}
      order by i.created_at desc limit 100`;
    return rows.map(mapInspection);
  });

export const reviewInspection = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.string().min(1).max(80), note: z.string().trim().max(1000).optional() }).parse(input))
  .middleware([authMiddleware, workdayMiddleware])
  .handler(async ({ context, data }) => {
    const profile = await requireProfile(context.userId);
    if (!can(profile, "fleet.manage") && !can(profile, "ehs.manage")) throw new Error("Only Fleet or EHS reviewers can review inspections");
    const sql = await getSql();
    const updated = await sql<{ user_id: string }>`update vehicle_inspections set status = 'Reviewed', reviewed_by = ${context.userId}, reviewed_at = now(), review_note = ${data.note ?? null}
      where id::text = ${data.id} and organization_id::text = ${profile.organizationId} and result = 'Fail' and status = 'Submitted'
      returning user_id`;
    if (!updated[0]) throw new Error("Inspection was already reviewed or is unavailable");
    await audit(sql, profile.organizationId, context.userId, "review", "vehicle_inspection", data.id, { note: data.note ?? null });
    return { success: true };
  });

