-- Platform (landlord) billing, category budgets, and day-to-day activity records.

-- ---------------------------------------------------------------------------
-- Landlord view of each tenant
-- ---------------------------------------------------------------------------
alter table organizations add column if not exists plan text not null default 'standard';
alter table organizations add column if not exists max_users integer not null default 0;
alter table organizations add column if not exists monthly_fee numeric not null default 0;
alter table organizations add column if not exists paid_until date;
alter table organizations add column if not exists contact_name text;
alter table organizations add column if not exists contact_email text;
alter table organizations add column if not exists contact_phone text;
alter table organizations add column if not exists notes text;
alter table organizations add column if not exists enforce_budget boolean not null default false;

create table if not exists platform_payments (
  id serial primary key,
  organization_id text not null,
  amount numeric(18,2) not null check (amount > 0),
  currency text not null default 'TZS',
  paid_on date not null default current_date,
  months integer not null default 1 check (months between 1 and 60),
  period_from date not null,
  period_to date not null,
  method text,
  reference text,
  recorded_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists platform_payments_org_idx on platform_payments(organization_id, paid_on desc);

-- Record a rent payment and extend the tenant's paid-until date. A lapsed tenant is counted from the payment date.
create or replace function platform_record_payment(
  p_org text, p_amount numeric, p_currency text, p_paid_on date, p_months integer, p_method text, p_reference text, p_user text
) returns date language plpgsql as $$
declare v_until date; v_from date; v_to date;
begin
  select paid_until into v_until from organizations where id::text = p_org for update;
  if not found then raise exception 'Company not found'; end if;
  v_from := greatest(coalesce(v_until, p_paid_on), p_paid_on);
  v_to := (v_from + make_interval(months => p_months))::date;
  insert into platform_payments (organization_id, amount, currency, paid_on, months, period_from, period_to, method, reference, recorded_by)
  values (p_org, p_amount, coalesce(p_currency,'TZS'), p_paid_on, p_months, v_from, v_to, p_method, p_reference, p_user);
  update organizations set paid_until = v_to where id::text = p_org;
  return v_to;
end $$;

-- ---------------------------------------------------------------------------
-- Budgets by category, per project
-- ---------------------------------------------------------------------------
create table if not exists project_budgets (
  project_id integer not null references projects(id) on delete cascade,
  organization_id text not null,
  category text not null check (category in ('Material','Equipment','Labor','Transport','Other')),
  amount numeric(18,2) not null check (amount >= 0),
  updated_at timestamptz not null default now(),
  primary key (project_id, category)
);
alter table finance_requests add column if not exists over_budget boolean not null default false;

-- ---------------------------------------------------------------------------
-- Day-to-day: attendance, leave, daily site reports
-- ---------------------------------------------------------------------------
create table if not exists attendance (
  id serial primary key,
  organization_id text not null,
  user_id text not null,
  work_date date not null default current_date,
  check_in timestamptz not null default now(),
  check_out timestamptz,
  location text,
  project_id integer references projects(id) on delete set null,
  note text,
  unique (user_id, work_date)
);
create index if not exists attendance_org_date_idx on attendance(organization_id, work_date);

create table if not exists leave_requests (
  id serial primary key,
  organization_id text not null,
  user_id text not null,
  leave_type text not null check (leave_type in ('Annual','Sick','Compassionate','Unpaid','Other')),
  start_date date not null,
  end_date date not null,
  days integer generated always as ((end_date - start_date) + 1) stored,
  reason text,
  status text not null default 'Pending' check (status in ('Pending','Approved','Rejected','Cancelled')),
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists leave_requests_org_idx on leave_requests(organization_id, status, start_date);

create table if not exists site_reports (
  id serial primary key,
  organization_id text not null,
  project_id integer references projects(id) on delete set null,
  report_date date not null default current_date,
  summary text not null,
  work_done text,
  issues text,
  weather text,
  workers integer not null default 0 check (workers >= 0),
  hours_per_worker numeric not null default 0 check (hours_per_worker >= 0 and hours_per_worker <= 24),
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists site_reports_org_idx on site_reports(organization_id, report_date desc);
