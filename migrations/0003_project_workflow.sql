-- Project delivery workflow: assignments, approvals, milestones and traceability.
create table if not exists organizations (
  id text primary key default '11111111-1111-1111-1111-111111111111',
  name text not null,
  slug text not null unique,
  settings jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists finance_requests (
  id serial primary key,
  project_id integer not null,
  user_id text not null,
  organization_id text,
  request_number text not null,
  title text not null,
  description text,
  category text not null default 'Other',
  amount numeric not null default 0,
  currency text not null default 'TZS',
  status text not null default 'Draft',
  priority text not null default 'Medium',
  requested_by text not null default '',
  requested_at timestamptz not null default now(),
  approved_by text,
  approved_at timestamptz,
  paid_by text,
  paid_at timestamptz,
  payment_reference text,
  notes text,
  attachments text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles add column if not exists organization_id text;
alter table profiles add column if not exists updated_at timestamptz not null default now();
alter table projects add column if not exists organization_id text;
alter table projects add column if not exists updated_at timestamptz not null default now();
alter table project_tasks add column if not exists organization_id text;
alter table project_tasks add column if not exists updated_at timestamptz not null default now();
alter table incidents add column if not exists organization_id text;
alter table incidents add column if not exists updated_at timestamptz not null default now();
alter table finance_requests add column if not exists project_id integer;

create table if not exists project_members (
  id serial primary key,
  project_id integer not null references projects(id) on delete cascade,
  user_id text not null,
  role text not null default 'Contributor',
  status text not null default 'Pending',
  response_reason text,
  invited_by text not null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique(project_id, user_id)
);
create index if not exists project_members_user_idx on project_members(user_id, status);

create table if not exists project_milestones (
  id serial primary key,
  project_id integer not null references projects(id) on delete cascade,
  title text not null,
  description text,
  due_date date,
  status text not null default 'Pending',
  owner_id text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_milestones_project_idx on project_milestones(project_id, due_date);

create table if not exists project_approvals (
  id serial primary key,
  project_id integer not null references projects(id) on delete cascade,
  approver_id text not null,
  status text not null default 'Pending',
  reason text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique(project_id, approver_id)
);

create table if not exists project_attachments (
  id serial primary key,
  project_id integer not null references projects(id) on delete cascade,
  uploaded_by text not null,
  file_name text not null,
  file_url text not null,
  attachment_type text not null default 'document',
  created_at timestamptz not null default now()
);

alter table incidents add column if not exists project_id integer references projects(id) on delete set null;
create index if not exists incidents_project_idx on incidents(project_id);
create index if not exists finance_requests_project_idx on finance_requests(project_id);