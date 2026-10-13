-- Smart Hub EHS: safety KPIs (TRIFR / LTIFR / severity), NCRs, HIRA, subcontractor pre-qualification.

alter table incidents add column if not exists injury_type text not null default 'None';
alter table incidents add column if not exists lost_days integer not null default 0;
alter table incidents add column if not exists is_recordable boolean not null default false;
alter table incidents add column if not exists is_anonymous boolean not null default false;
alter table incidents add column if not exists cost_estimate numeric not null default 0;
alter table incidents add column if not exists idle_hours numeric not null default 0;
alter table incidents add column if not exists occurred_at timestamptz;
alter table incidents add column if not exists description text;
update incidents i set organization_id = p.organization_id
  from profiles p where i.organization_id is null and p.user_id = i.user_id;

-- Hours worked feed the frequency rates. Team leaders record crew hours per day.
create table if not exists work_hours (
  id serial primary key,
  organization_id text not null,
  project_id integer references projects(id) on delete set null,
  work_date date not null default current_date,
  workers integer not null check (workers >= 0),
  hours_per_worker numeric not null check (hours_per_worker >= 0 and hours_per_worker <= 24),
  man_hours numeric generated always as (workers * hours_per_worker) stored,
  recorded_by text not null,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists work_hours_org_date_idx on work_hours(organization_id, work_date);

-- Non-conformance reports. Open High/Critical NCRs are the early warning for client stop-work orders.
create table if not exists ncrs (
  id serial primary key,
  organization_id text not null,
  ncr_number text not null,
  project_id integer references projects(id) on delete set null,
  title text not null,
  description text,
  severity text not null default 'Minor' check (severity in ('Minor','Major','Critical')),
  status text not null default 'Open' check (status in ('Open','In Progress','Closed')),
  raised_by text not null,
  assigned_to text,
  due_date date,
  closed_at timestamptz,
  closure_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, ncr_number)
);
create index if not exists ncrs_org_status_idx on ncrs(organization_id, status, severity);

-- Hazard identification and risk assessment (5x5 matrix).
create table if not exists risk_assessments (
  id serial primary key,
  organization_id text not null,
  project_id integer references projects(id) on delete set null,
  activity text not null,
  hazard text not null,
  likelihood integer not null check (likelihood between 1 and 5),
  consequence integer not null check (consequence between 1 and 5),
  risk_score integer generated always as (likelihood * consequence) stored,
  controls text,
  residual_score integer check (residual_score between 1 and 25),
  owner text,
  review_date date,
  status text not null default 'Open' check (status in ('Open','Controlled','Closed')),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists risk_assessments_org_idx on risk_assessments(organization_id, status);

-- Subcontractor pre-qualification: register, describe the kazi, upload safety files, get cleared before site.
create table if not exists subcontractors (
  id serial primary key,
  organization_id text not null,
  company_name text not null,
  contact_name text,
  contact_phone text,
  contact_email text,
  company_size text not null default 'Small' check (company_size in ('Micro','Small','Medium','Large')),
  industry text not null default 'Telecom',
  job_types text[] not null default '{}',
  documents jsonb not null default '[]',
  status text not null default 'Pending' check (status in ('Pending','Approved','Rejected','Expired')),
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  valid_until date,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subcontractors_org_idx on subcontractors(organization_id, status);
