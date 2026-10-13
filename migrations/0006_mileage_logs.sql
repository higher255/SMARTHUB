create table if not exists mileage_logs (
  id serial primary key,
  organization_id text not null,
  vehicle_id text not null,
  driver_id text not null,
  opening_mileage numeric not null,
  closing_mileage numeric not null,
  submitted_at timestamptz not null default now(),
  reset_by text,
  reset_at timestamptz,
  notes text
);
create index if not exists mileage_logs_vehicle_idx on mileage_logs(vehicle_id, submitted_at desc);