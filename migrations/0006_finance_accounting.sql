create table if not exists finance_invoices (
  id serial primary key,
  organization_id text,
  project_id integer references projects(id) on delete set null,
  invoice_number text not null,
  customer_name text not null,
  description text not null,
  amount numeric not null default 0,
  currency text not null default 'TZS',
  status text not null default 'Draft',
  issue_date date not null default current_date,
  due_date date,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists finance_invoices_number_idx on finance_invoices(organization_id, invoice_number);

create table if not exists purchase_orders (
  id serial primary key,
  organization_id text,
  project_id integer references projects(id) on delete set null,
  po_number text not null,
  supplier_name text not null,
  description text not null,
  amount numeric not null default 0,
  currency text not null default 'TZS',
  status text not null default 'Draft',
  issue_date date not null default current_date,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists purchase_orders_number_idx on purchase_orders(organization_id, po_number);

create table if not exists ledger_entries (
  id serial primary key,
  organization_id text,
  project_id integer references projects(id) on delete set null,
  entry_date date not null default current_date,
  account_name text not null,
  description text not null,
  debit numeric not null default 0,
  credit numeric not null default 0,
  reference_type text,
  reference_id integer,
  created_by text not null,
  created_at timestamptz not null default now(),
  check (debit >= 0 and credit >= 0),
  check (debit = 0 or credit = 0)
);
create index if not exists ledger_entries_org_date_idx on ledger_entries(organization_id, entry_date);