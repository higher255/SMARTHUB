-- SafetyHub-style observations and voluntary step challenges.
-- Every row is tenant scoped; RLS blocks direct public-schema access.
create table if not exists safety_observations (
  id bigserial primary key,
  organization_id text not null,
  project_id integer references projects(id) on delete set null,
  reporter_id text not null,
  category text not null check (category in ('Unsafe act','Unsafe condition','Near miss','Good practice','Environmental')),
  severity text not null check (severity in ('Low','Medium','High','Critical')),
  title text not null check (char_length(title) between 3 and 160),
  description text not null check (char_length(description) between 3 and 2000),
  location text not null check (char_length(location) between 1 and 160),
  anonymous boolean not null default false,
  immediate_action text,
  status text not null default 'Submitted' check (status in ('Submitted','Under Review','Action Required','Closed')),
  assigned_to text,
  due_date date,
  closure_note text,
  closed_by text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists safety_observations_org_idx on safety_observations(organization_id, status, created_at desc);
create index if not exists safety_observations_reporter_idx on safety_observations(organization_id, reporter_id, created_at desc);
alter table safety_observations enable row level security;

create table if not exists wellbeing_challenges (
  id bigserial primary key,
  organization_id text not null,
  title text not null check (char_length(title) between 3 and 100),
  description text not null default '' check (char_length(description) <= 500),
  starts_on date not null,
  ends_on date not null,
  daily_step_goal integer not null default 6000 check (daily_step_goal between 1000 and 50000),
  status text not null default 'Active' check (status in ('Active','Completed','Cancelled')),
  created_by text not null,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists wellbeing_challenges_org_idx on wellbeing_challenges(organization_id, status, starts_on);
alter table wellbeing_challenges enable row level security;

create table if not exists wellbeing_challenge_entries (
  id bigserial primary key,
  organization_id text not null,
  challenge_id bigint not null references wellbeing_challenges(id) on delete cascade,
  user_id text not null,
  entry_date date not null,
  steps integer not null check (steps between 0 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(challenge_id, user_id, entry_date)
);
create index if not exists wellbeing_entries_challenge_idx on wellbeing_challenge_entries(organization_id, challenge_id, user_id, entry_date desc);
alter table wellbeing_challenge_entries enable row level security;
