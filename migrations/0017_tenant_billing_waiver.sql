alter table organizations
  add column if not exists billing_exempt boolean not null default false;
