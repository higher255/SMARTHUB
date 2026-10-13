create table if not exists after_hours_vehicle_requests (
  id bigserial primary key,
  organization_id text not null,
  user_id text not null,
  vehicle_id text not null,
  vehicle_registration text not null,
  driver_name text not null,
  reason text not null,
  origin text not null,
  destination text not null,
  departure_at timestamptz not null,
  return_at timestamptz not null,
  passenger_count integer not null default 0 check (passenger_count >= 0),
  supervisor_name text not null,
  supervisor_phone text not null,
  emergency_contact_name text not null,
  emergency_contact_phone text not null,
  risk_controls text not null default '',
  outside_work_hours_confirmed boolean not null default false,
  safety_checklist jsonb not null default '{}'::jsonb,
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected', 'Cancelled')),
  reviewer_id text,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  constraint after_hours_return_after_departure check (return_at > departure_at)
);

create index if not exists after_hours_org_status_idx
  on after_hours_vehicle_requests (organization_id, status, created_at desc);
create index if not exists after_hours_vehicle_time_idx
  on after_hours_vehicle_requests (organization_id, vehicle_id, departure_at, return_at)
  where status in ('Pending', 'Approved');
create index if not exists after_hours_user_idx
  on after_hours_vehicle_requests (user_id, created_at desc);

alter table after_hours_vehicle_requests enable row level security;