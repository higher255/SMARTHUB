-- Smart EHS enterprise operations: clients, readiness, fleet, trips and HR.
create table if not exists client_accounts (
  id text primary key default 'client-' || substr(md5(random()::text), 1, 20),
  organization_id text not null,
  name text not null,
  code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists vehicles (
  id text primary key default 'vehicle-' || substr(md5(random()::text), 1, 20),
  organization_id text not null,
  user_id text not null,
  registration text not null,
  make text not null default '', model text not null default '', year integer,
  color text, status text not null default 'Active', fuel_type text,
  mileage numeric not null default 0, notes text,
  last_inspection_date date, next_inspection_date date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists permits (
  id text primary key default 'permit-' || substr(md5(random()::text), 1, 20),
  organization_id text not null, user_id text not null, permit_number text not null,
  type text not null, title text not null, description text, location text not null default '',
  department text, supervisor text, start_date date, end_date date, status text not null default 'Pending',
  risk_level text, control_measures text[], approved_by text, approved_at timestamptz,
  rejected_reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists capa_actions (
  id text primary key default 'capa-' || substr(md5(random()::text), 1, 20),
  organization_id text not null, user_id text not null, capa_number text not null,
  title text not null, description text, type text not null default 'Corrective', category text not null default 'General',
  severity text not null default 'Low', status text not null default 'Open', assigned_to text, due_date date,
  root_cause text, action_plan text, resolution text, verified_by text, verified_at timestamptz,
  closed_by text, closed_at timestamptz, related_incident_id integer, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

alter table profiles add column if not exists client_account_id text references client_accounts(id) on delete set null;
alter table vehicles add column if not exists insurance_expiry date;
alter table vehicles add column if not exists service_due_date date;
alter table vehicles add column if not exists inspection_status text default 'Pending';

create table if not exists certificates (
  id serial primary key, user_id text not null, organization_id text, certificate_type text not null,
  certificate_number text, file_url text, issued_at date, expires_at date not null,
  status text not null default 'Valid', client_account_id text references client_accounts(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists certificates_user_idx on certificates(user_id, expires_at);

create table if not exists job_orders (
  id serial primary key, organization_id text, client_account_id text references client_accounts(id) on delete set null,
  project_id integer references projects(id) on delete set null, created_by text not null, title text not null,
  description text, location text, status text not null default 'Submitted', due_date date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists ppe_checks (
  id serial primary key, project_id integer not null references projects(id) on delete cascade,
  team_member_id text not null, checked_by text not null, status text not null default 'Pending', notes text,
  checked_at timestamptz not null default now()
);

create table if not exists trips (
  id serial primary key, organization_id text, client_account_id text references client_accounts(id) on delete set null,
  project_id integer references projects(id) on delete set null, driver_id text not null, assistant_id text,
  vehicle_id text, origin text not null, destination text not null, distance_km numeric not null default 0,
  requested_by text not null, status text not null default 'Pending', approval_mode text not null default 'Manual',
  rejection_reason text, requested_at timestamptz not null default now(), approved_at timestamptz
);
create index if not exists trips_driver_idx on trips(driver_id, requested_at desc);

create table if not exists announcements (
  id serial primary key, organization_id text, client_account_id text references client_accounts(id) on delete set null,
  posted_by text not null, audience_role text, title text not null, message text not null,
  starts_at timestamptz not null default now(), ends_at timestamptz, created_at timestamptz not null default now()
);

create table if not exists audit_log (
  id bigserial primary key, organization_id text, actor_id text not null, action text not null,
  entity_type text not null, entity_id text, metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create index if not exists audit_log_org_idx on audit_log(organization_id, created_at desc);