-- Smart Hub: real multi-tenancy, permission-based access, richer notifications.

-- ---------------------------------------------------------------------------
-- Tenants. `organizations` is the tenant table; every business table already
-- carries organization_id.
-- ---------------------------------------------------------------------------
do $$
begin
  if (select data_type from information_schema.columns
       where table_schema = current_schema() and table_name = 'organizations' and column_name = 'id') = 'uuid' then
    alter table organizations alter column id set default gen_random_uuid();
  else
    alter table organizations alter column id set default gen_random_uuid()::text;
  end if;
end
$$;
alter table organizations add column if not exists status text not null default 'active';
alter table organizations add column if not exists display_name text;
alter table organizations add column if not exists logo_url text;
alter table organizations add column if not exists primary_color text;
alter table organizations add column if not exists country text not null default 'TZ';
alter table organizations add column if not exists currency text not null default 'TZS';
alter table organizations add column if not exists vat_rate numeric not null default 18;
alter table organizations add column if not exists manager_approval_limit numeric not null default 2000000;
alter table organizations add column if not exists modules text[] not null default '{ehs,projects,finance,fleet,hr,management}';
alter table organizations add column if not exists books_locked_until date;

-- ---------------------------------------------------------------------------
-- Users: extra permissions on top of the role, real suspension, platform admin.
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists permissions text[] not null default '{}';
alter table profiles add column if not exists status text not null default 'active';
alter table profiles add column if not exists phone text;
alter table profiles add column if not exists supervisor_id text;
alter table profiles add column if not exists is_platform_admin boolean not null default false;
create index if not exists profiles_org_idx on profiles(organization_id, role);

-- Old code "suspended" a user by writing role='Suspended', which the app then
-- silently treated as Employee. Convert those rows to a real status.
update profiles set status = 'suspended', role = 'Employee' where role = 'Suspended';

-- ---------------------------------------------------------------------------
-- Notifications become a typed, linkable, tenant-scoped feed.
-- ---------------------------------------------------------------------------
alter table notifications add column if not exists organization_id text;
alter table notifications add column if not exists type text not null default 'info';
alter table notifications add column if not exists link text;
alter table notifications add column if not exists entity_type text;
alter table notifications add column if not exists entity_id text;
create index if not exists notifications_unread_idx on notifications(user_id, read_at, created_at desc);

-- ---------------------------------------------------------------------------
-- Finance request workflow: two-step approval and traceability.
-- ---------------------------------------------------------------------------
alter table finance_requests add column if not exists requires_manager boolean not null default false;
alter table finance_requests add column if not exists endorsed_by text;
alter table finance_requests add column if not exists endorsed_at timestamptz;
alter table finance_requests add column if not exists rejected_by text;
alter table finance_requests add column if not exists rejected_reason text;
alter table finance_requests add column if not exists payment_method text;
alter table finance_requests add column if not exists journal_entry_id integer;
update finance_requests f set organization_id = p.organization_id
  from profiles p where f.organization_id is null and p.user_id = f.user_id;
update finance_requests set rejected_reason = notes where status = 'Rejected' and rejected_reason is null;
create index if not exists finance_requests_org_status_idx on finance_requests(organization_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- Tenant column everywhere. health_declarations never had one, so every
-- company-wide health query failed; older rows elsewhere may still be NULL.
-- ---------------------------------------------------------------------------
alter table health_declarations add column if not exists organization_id text;
alter table health_declarations add column if not exists updated_at timestamptz not null default now();
update health_declarations x set organization_id = p.organization_id from profiles p where x.organization_id is null and p.user_id = x.user_id;
update projects x set organization_id = p.organization_id from profiles p where x.organization_id is null and p.user_id = x.user_id;
update project_tasks x set organization_id = p.organization_id from profiles p where x.organization_id is null and p.user_id = x.user_id;
create index if not exists health_declarations_org_idx on health_declarations(organization_id, created_at desc);
