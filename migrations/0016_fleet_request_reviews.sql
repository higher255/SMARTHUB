alter table trips add column if not exists departure_at timestamptz;
alter table vehicle_inspections add column if not exists reviewed_by text;
alter table vehicle_inspections add column if not exists reviewed_at timestamptz;
alter table vehicle_inspections add column if not exists review_note text;
create index if not exists vehicle_inspections_review_idx on vehicle_inspections(organization_id, status, created_at desc);