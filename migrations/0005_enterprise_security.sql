-- Smart EHS enterprise infrastructure for Supabase.
-- Server-side Better Auth functions remain the primary authorization boundary.

-- Supabase-only: the storage schema does not exist on plain Postgres / PGlite.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('smart-ehs-project-documents', 'smart-ehs-project-documents', false)
    on conflict (id) do update set public = false;
  end if;
end
$$;

create index if not exists profiles_client_account_idx on profiles(client_account_id);
create index if not exists projects_org_status_idx on projects(organization_id, status);
create index if not exists vehicles_safety_idx on vehicles(organization_id, insurance_expiry, inspection_status);
create index if not exists announcements_active_idx on announcements(organization_id, starts_at, ends_at);
create index if not exists job_orders_client_status_idx on job_orders(client_account_id, status, created_at desc);
create index if not exists certificates_expiry_idx on certificates(expires_at, status);
create index if not exists trips_approval_idx on trips(status, requested_at);

create or replace function smart_ehs_refresh_certificate_status()
returns trigger language plpgsql as $$
begin
  new.status := case
    when new.expires_at < current_date then 'Expired'
    when new.expires_at <= current_date + 7 then 'Expiring'
    else 'Valid'
  end;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists certificates_refresh_status on certificates;
create trigger certificates_refresh_status
before insert or update of expires_at on certificates
for each row execute function smart_ehs_refresh_certificate_status();

create or replace function smart_ehs_trip_eligibility(
  p_driver_id text, p_assistant_id text, p_vehicle_id text, p_distance_km numeric
)
returns table (eligible boolean, approval_mode text, reason text)
language sql stable as $$
with driver_ready as (
  select not exists (select 1 from certificates c where c.user_id = p_driver_id and (c.expires_at < current_date or c.status in ('Expired', 'Expiring'))) as ok
), assistant_ready as (
  select coalesce(not exists (select 1 from certificates c where c.user_id = p_assistant_id and (c.expires_at < current_date or c.status in ('Expired', 'Expiring'))), true) as ok
), vehicle_ready as (
  select exists (select 1 from vehicles v where v.id::text = p_vehicle_id and v.status = 'Active' and coalesce(v.insurance_expiry, current_date - 1) >= current_date and coalesce(v.inspection_status, 'Pending') = 'Passed' and coalesce(v.next_inspection_date, current_date - 1) >= current_date) as ok
)
select (driver_ready.ok and assistant_ready.ok and vehicle_ready.ok), case when p_distance_km <= 10 then 'Auto' else 'Manual' end,
  case when not driver_ready.ok then 'Driver certificate is expired or expiring' when not assistant_ready.ok then 'Assistant certificate is expired or expiring' when not vehicle_ready.ok then 'Vehicle insurance or inspection is not valid' else 'Ready for trip approval' end
from driver_ready, assistant_ready, vehicle_ready;
$$;

create or replace function smart_ehs_escalate_trip_requests()
returns integer language plpgsql as $$
declare changed integer;
begin
  update trips set status = 'Escalated' where status = 'Pending' and approval_mode = 'Manual' and requested_at < now() - interval '2 hours';
  get diagnostics changed = row_count;
  return changed;
end;
$$;

create or replace function smart_ehs_audit_row_change()
returns trigger language plpgsql as $$
begin
  insert into audit_log (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (coalesce(new.organization_id, old.organization_id), coalesce(nullif(current_setting('app.actor_id', true), ''), 'system'), tg_op, tg_table_name, coalesce(new.id::text, old.id::text), jsonb_build_object('source', 'database-trigger'));
  return coalesce(new, old);
end;
$$;

drop trigger if exists projects_audit on projects;
create trigger projects_audit after insert or update or delete on projects for each row execute function smart_ehs_audit_row_change();
drop trigger if exists trips_audit on trips;
create trigger trips_audit after insert or update or delete on trips for each row execute function smart_ehs_audit_row_change();
drop trigger if exists job_orders_audit on job_orders;
create trigger job_orders_audit after insert or update or delete on job_orders for each row execute function smart_ehs_audit_row_change();

alter table organizations enable row level security;
alter table client_accounts enable row level security;
alter table profiles enable row level security;
alter table projects enable row level security;
alter table vehicles enable row level security;
alter table certificates enable row level security;
alter table announcements enable row level security;
alter table job_orders enable row level security;
alter table ppe_checks enable row level security;
alter table trips enable row level security;
alter table project_members enable row level security;
alter table project_milestones enable row level security;
alter table project_approvals enable row level security;
alter table project_attachments enable row level security;
alter table notifications enable row level security;
alter table audit_log enable row level security;

-- No anon/authenticated policies are granted. Direct REST access is denied by default.
-- The Better Auth server uses the private PostgreSQL connection and performs checks.
