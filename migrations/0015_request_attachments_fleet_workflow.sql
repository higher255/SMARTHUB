alter table trips add column if not exists jmp_number text;
alter table trips add column if not exists vehicle_label text;
alter table trips add column if not exists eta timestamptz;
alter table trips add column if not exists purpose text;
alter table trips add column if not exists passengers integer not null default 0;
alter table trips add column if not exists risk_notes text;
alter table trips add column if not exists decision_note text;
alter table trips add column if not exists approved_by text;
alter table trips add column if not exists started_at timestamptz;
alter table trips add column if not exists completed_at timestamptz;
create unique index if not exists trips_jmp_number_idx on trips(jmp_number) where jmp_number is not null;

create table if not exists vehicle_inspections (
  id text primary key default 'inspection-' || substr(md5(random()::text), 1, 20),
  organization_id text not null,
  user_id text,
  inspector_id text not null,
  vehicle_id text,
  vehicle_label text not null default '',
  inspection_date date not null default current_date,
  inspection_type text not null check (inspection_type in ('Pre-trip', 'Daily', 'Weekly')),
  type text,
  odometer numeric,
  result text not null check (result in ('Pass', 'Fail')),
  items jsonb not null default '[]'::jsonb,
  notes text,
  status text not null default 'Submitted' check (status in ('Submitted', 'Reviewed')),
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table vehicle_inspections add column if not exists user_id text;
alter table vehicle_inspections add column if not exists vehicle_label text not null default '';
alter table vehicle_inspections add column if not exists review_note text;
update vehicle_inspections set user_id = inspector_id where user_id is null;
alter table vehicle_inspections alter column user_id set not null;
create index if not exists vehicle_inspections_org_idx on vehicle_inspections(organization_id, created_at desc);
create index if not exists vehicle_inspections_user_idx on vehicle_inspections(user_id, created_at desc);

create table if not exists request_attachments (
  id bigserial primary key,
  organization_id text not null,
  user_id text not null,
  entity_type text not null check (entity_type in ('finance_request', 'permit', 'inspection')),
  entity_id text not null,
  file_name text not null,
  content_type text not null,
  data_url text not null,
  size_bytes integer not null check (size_bytes between 1 and 2621440),
  created_at timestamptz not null default now()
);
create index if not exists request_attachments_entity_idx on request_attachments(organization_id, entity_type, entity_id, created_at);
alter table vehicle_inspections enable row level security;
alter table request_attachments enable row level security;