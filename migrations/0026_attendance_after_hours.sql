-- Label check-ins made after the standard day as after-hours sessions.
alter table attendance add column if not exists after_hours boolean not null default false;

-- Keep the flag immutable with the rest of each attendance session.
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

  if old.check_out is not null or new.check_out is null then
    raise exception 'Attendance can only be checked out once';
  end if;

  if new.check_out < old.check_in then
    raise exception 'Check-out cannot be earlier than check-in';
  end if;

  return new;
end;
$$;
