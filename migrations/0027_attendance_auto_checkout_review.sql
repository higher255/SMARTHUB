-- A Vercel cron can close forgotten sessions without altering the original
-- check-in record, then employee/HR can complete a reason review in-app.
alter table attendance add column if not exists auto_checkout boolean not null default false;

create table if not exists attendance_checkout_reviews (
  attendance_id integer primary key references attendance(id) on delete restrict,
  organization_id text not null,
  user_id text not null,
  employee_reason text,
  status text not null default 'Awaiting reason'
    check (status in ('Awaiting reason', 'Pending', 'Needs details', 'Approved')),
  hr_note text,
  requested_at timestamptz,
  reviewed_by text,
  updated_at timestamptz not null default now()
);
create index if not exists attendance_checkout_reviews_org_status_idx
  on attendance_checkout_reviews (organization_id, status);

-- Only the one-time check-out and its system/manual marker may change.
create or replace function smart_attendance_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Attendance records cannot be deleted';
  end if;

  if row(new.id, new.organization_id, new.user_id, new.work_date, new.check_in, new.location, new.project_id, new.note, new.after_hours)
      is distinct from
     row(old.id, old.organization_id, old.user_id, old.work_date, old.check_in, old.location, old.project_id, old.note, old.after_hours) then
    raise exception 'Attendance check-in details are immutable';
  end if;

  if old.check_out is not null or new.check_out is null or old.auto_checkout then
    raise exception 'Attendance can only be checked out once';
  end if;

  if new.check_out < old.check_in then
    raise exception 'Check-out cannot be earlier than check-in';
  end if;

  return new;
end;
$$;
