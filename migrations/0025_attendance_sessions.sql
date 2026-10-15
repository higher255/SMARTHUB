-- Keep every check-in/check-out session as its own permanent attendance row.
alter table attendance drop constraint if exists attendance_user_id_work_date_key;

-- A person can start another session after checking out, but cannot leave two
-- active sessions open for the same workday.
create unique index if not exists attendance_one_open_session_per_day_idx
  on attendance (user_id, work_date)
  where check_out is null;

-- Attendance is an audit record: only allow the one-way transition from an
-- open session to checked out. Never allow timestamps or the original entry
-- to be rewritten or removed.
create or replace function smart_attendance_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Attendance records cannot be deleted';
  end if;

  if row(new.id, new.organization_id, new.user_id, new.work_date, new.check_in, new.location, new.project_id, new.note)
      is distinct from
     row(old.id, old.organization_id, old.user_id, old.work_date, old.check_in, old.location, old.project_id, old.note) then
    raise exception 'Attendance check-in details are immutable';
  end if;

  if old.check_out is not null or new.check_out is null then
    raise exception 'Attendance can only be checked out once';
  end if;

  if new.check_out < old.check_in then
    raise exception 'Check-out cannot be earlier than check-in';
  end if;

  return new;
end;
$$;

drop trigger if exists attendance_immutable_update on attendance;
create trigger attendance_immutable_update
  before update on attendance
  for each row execute function smart_attendance_guard();

drop trigger if exists attendance_immutable_delete on attendance;
create trigger attendance_immutable_delete
  before delete on attendance
  for each row execute function smart_attendance_guard();
