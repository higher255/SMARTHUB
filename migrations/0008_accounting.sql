-- Smart Hub accounting: double-entry books, invoices with VAT, receipts, reports.
-- Business rules live in SQL functions so every posting is atomic and balanced.

create table if not exists chart_of_accounts (
  id serial primary key,
  organization_id text not null,
  code text not null,
  name text not null,
  type text not null check (type in ('Asset','Liability','Equity','Income','Expense')),
  is_system boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table if not exists acct_counters (
  organization_id text not null,
  kind text not null,
  year integer not null,
  n integer not null default 0,
  primary key (organization_id, kind, year)
);

create table if not exists journal_entries (
  id serial primary key,
  organization_id text not null,
  entry_no text not null,
  entry_date date not null default current_date,
  memo text not null,
  source_type text not null default 'manual',
  source_id text,
  status text not null default 'Posted' check (status in ('Posted','Reversed')),
  reverses_id integer references journal_entries(id),
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, entry_no)
);
create index if not exists journal_entries_org_date_idx on journal_entries(organization_id, entry_date);
create index if not exists journal_entries_source_idx on journal_entries(organization_id, source_type, source_id);

create table if not exists journal_lines (
  id serial primary key,
  entry_id integer not null references journal_entries(id) on delete cascade,
  account_id integer not null references chart_of_accounts(id),
  debit numeric(18,2) not null default 0,
  credit numeric(18,2) not null default 0,
  description text,
  project_id integer references projects(id) on delete set null,
  check (debit >= 0 and credit >= 0),
  check ((debit = 0) <> (credit = 0))
);
create index if not exists journal_lines_entry_idx on journal_lines(entry_id);
create index if not exists journal_lines_account_idx on journal_lines(account_id);

-- Defence in depth: whatever writes to journal_lines, an entry must balance at commit.
create or replace function acct_check_entry_balanced() returns trigger language plpgsql as $$
declare d numeric; c numeric;
begin
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d, c from journal_lines where entry_id = new.entry_id;
  if d <> c then
    raise exception 'Unbalanced journal entry %: debit % <> credit %', new.entry_id, d, c;
  end if;
  return null;
end $$;
drop trigger if exists journal_lines_balanced on journal_lines;
create constraint trigger journal_lines_balanced after insert or update on journal_lines
  deferrable initially deferred for each row execute function acct_check_entry_balanced();

-- Customers and suppliers
create table if not exists parties (
  id serial primary key,
  organization_id text not null,
  kind text not null check (kind in ('customer','supplier')),
  name text not null,
  tin text, vrn text, email text, phone text, address text,
  created_at timestamptz not null default now()
);
create index if not exists parties_org_idx on parties(organization_id, kind, name);

-- Invoices: header extended, lines added.
alter table finance_invoices add column if not exists customer_id integer references parties(id) on delete set null;
alter table finance_invoices add column if not exists subtotal numeric(18,2) not null default 0;
alter table finance_invoices add column if not exists vat_rate numeric not null default 0;
alter table finance_invoices add column if not exists vat_amount numeric(18,2) not null default 0;
alter table finance_invoices add column if not exists total numeric(18,2) not null default 0;
alter table finance_invoices add column if not exists amount_paid numeric(18,2) not null default 0;
alter table finance_invoices add column if not exists journal_entry_id integer;
alter table finance_invoices add column if not exists notes text;
alter table finance_invoices add column if not exists issued_at timestamptz;
update finance_invoices set subtotal = amount, total = amount where total = 0 and amount > 0;

create table if not exists invoice_lines (
  id serial primary key,
  invoice_id integer not null references finance_invoices(id) on delete cascade,
  position integer not null default 1,
  description text not null,
  quantity numeric not null default 1 check (quantity > 0),
  unit_price numeric(18,2) not null default 0 check (unit_price >= 0)
);
create index if not exists invoice_lines_invoice_idx on invoice_lines(invoice_id, position);

create table if not exists payments (
  id serial primary key,
  organization_id text not null,
  kind text not null check (kind in ('receipt','payment')),
  receipt_no text,
  invoice_id integer references finance_invoices(id) on delete set null,
  request_id integer,
  party_name text,
  amount numeric(18,2) not null check (amount > 0),
  pay_date date not null default current_date,
  method text not null default 'Cash',
  reference text,
  journal_entry_id integer,
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists payments_org_date_idx on payments(organization_id, pay_date);

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------
create or replace function acct_seed_chart(p_org text) returns void language plpgsql as $$
begin
  insert into chart_of_accounts (organization_id, code, name, type, is_system) values
    (p_org,'1000','Cash on Hand','Asset',true),
    (p_org,'1010','Bank','Asset',true),
    (p_org,'1100','Accounts Receivable','Asset',true),
    (p_org,'1150','Staff Advances','Asset',true),
    (p_org,'1300','Prepaid Expenses','Asset',false),
    (p_org,'2000','Accounts Payable','Liability',true),
    (p_org,'2100','VAT Payable','Liability',true),
    (p_org,'2200','Accrued Expenses','Liability',false),
    (p_org,'3000','Owner''s Equity','Equity',true),
    (p_org,'3100','Retained Earnings','Equity',true),
    (p_org,'4000','Service Revenue','Income',true),
    (p_org,'4100','Other Income','Income',false),
    (p_org,'5000','Materials & Supplies','Expense',true),
    (p_org,'5100','Equipment & Tools','Expense',true),
    (p_org,'5200','Labour','Expense',true),
    (p_org,'5300','Transport & Fleet','Expense',true),
    (p_org,'5400','Safety & PPE','Expense',false),
    (p_org,'5900','Other Expenses','Expense',true)
  on conflict (organization_id, code) do nothing;
end $$;

create or replace function acct_next_no(p_org text, p_kind text, p_prefix text) returns text language plpgsql as $$
declare y integer := extract(year from current_date)::int; v integer;
begin
  insert into acct_counters (organization_id, kind, year, n) values (p_org, p_kind, y, 1)
  on conflict (organization_id, kind, year) do update set n = acct_counters.n + 1
  returning n into v;
  return p_prefix || '-' || y || '-' || lpad(v::text, 4, '0');
end $$;

-- p_lines: [{"account":"1000","debit":100,"credit":0,"description":"..","project_id":1}, ...]
create or replace function acct_post(
  p_org text, p_date date, p_memo text, p_source_type text, p_source_id text, p_user text, p_lines jsonb
) returns integer language plpgsql as $$
declare
  v_id integer; v_no text; rec record; v_acc integer; v_d numeric := 0; v_c numeric := 0; v_locked date; n integer := 0;
begin
  perform acct_seed_chart(p_org);
  select books_locked_until into v_locked from organizations where id::text = p_org;
  if v_locked is not null and p_date <= v_locked then
    raise exception 'Books are locked up to %; cannot post on %', v_locked, p_date;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'A journal entry needs at least two lines';
  end if;
  for rec in select * from jsonb_to_recordset(p_lines) as x(account text, debit numeric, credit numeric) loop
    v_d := v_d + coalesce(rec.debit,0); v_c := v_c + coalesce(rec.credit,0);
  end loop;
  if round(v_d,2) <> round(v_c,2) then
    raise exception 'Entry does not balance: debit % vs credit %', round(v_d,2), round(v_c,2);
  end if;
  if round(v_d,2) <= 0 then raise exception 'Entry total must be greater than zero'; end if;

  v_no := acct_next_no(p_org, 'JE', 'JE');
  insert into journal_entries (organization_id, entry_no, entry_date, memo, source_type, source_id, created_by)
  values (p_org, v_no, p_date, p_memo, coalesce(p_source_type,'manual'), p_source_id, p_user) returning id into v_id;

  for rec in select * from jsonb_to_recordset(p_lines) as x(account text, debit numeric, credit numeric, description text, project_id integer) loop
    select id into v_acc from chart_of_accounts where organization_id = p_org and code = rec.account and active;
    if v_acc is null then raise exception 'Unknown or inactive account %', rec.account; end if;
    if coalesce(rec.debit,0) = 0 and coalesce(rec.credit,0) = 0 then continue; end if;
    insert into journal_lines (entry_id, account_id, debit, credit, description, project_id)
    values (v_id, v_acc, round(coalesce(rec.debit,0),2), round(coalesce(rec.credit,0),2), rec.description, rec.project_id);
    n := n + 1;
  end loop;
  if n < 2 then raise exception 'A journal entry needs at least two non-zero lines'; end if;
  return v_id;
end $$;

create or replace function acct_reverse(p_entry_id integer, p_org text, p_user text, p_reason text) returns integer language plpgsql as $$
declare e journal_entries; v_new integer; v_no text; v_locked date;
begin
  select * into e from journal_entries where id = p_entry_id and organization_id::text = p_org for update;
  if not found then raise exception 'Journal entry not found'; end if;
  if e.status = 'Reversed' or e.reverses_id is not null then raise exception 'Entry cannot be reversed again'; end if;
  select books_locked_until into v_locked from organizations where id::text = p_org;
  if v_locked is not null and current_date <= v_locked then raise exception 'Books are locked up to %', v_locked; end if;
  v_no := acct_next_no(p_org, 'JE', 'JE');
  insert into journal_entries (organization_id, entry_no, entry_date, memo, source_type, source_id, reverses_id, created_by)
  values (p_org, v_no, current_date, 'Reversal of ' || e.entry_no || coalesce(': ' || p_reason,''), 'reversal', e.id::text, e.id, p_user)
  returning id into v_new;
  insert into journal_lines (entry_id, account_id, debit, credit, description, project_id)
  select v_new, account_id, credit, debit, description, project_id from journal_lines where entry_id = e.id;
  update journal_entries set status = 'Reversed' where id = e.id;
  return v_new;
end $$;

-- Pay an approved finance request: post Dr expense / Cr cash|bank and close the request, atomically.
create or replace function fin_request_pay(
  p_id integer, p_org text, p_user text, p_user_name text, p_reference text, p_method text, p_date date
) returns integer language plpgsql as $$
declare r finance_requests; v_exp text; v_cash text; v_je integer;
begin
  select * into r from finance_requests where id = p_id and organization_id::text = p_org for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status <> 'Approved' then raise exception 'Only approved requests can be paid (current status: %)', r.status; end if;
  v_exp := case r.category when 'Material' then '5000' when 'Equipment' then '5100' when 'Labor' then '5200' when 'Transport' then '5300' else '5900' end;
  v_cash := case when coalesce(p_method,'Cash') = 'Cash' then '1000' else '1010' end;
  v_je := acct_post(p_org, coalesce(p_date, current_date), 'Payment of ' || r.request_number || ' - ' || r.title, 'finance_request', r.id::text, p_user,
    jsonb_build_array(
      jsonb_build_object('account', v_exp, 'debit', r.amount, 'credit', 0, 'description', r.title, 'project_id', r.project_id),
      jsonb_build_object('account', v_cash, 'debit', 0, 'credit', r.amount, 'description', 'Paid to ' || r.requested_by || ' ref ' || p_reference)));
  update finance_requests set status = 'Paid', paid_by = p_user_name, paid_at = now(), payment_reference = p_reference,
    payment_method = coalesce(p_method,'Cash'), journal_entry_id = v_je, updated_at = now() where id = r.id;
  insert into payments (organization_id, kind, request_id, party_name, amount, pay_date, method, reference, journal_entry_id, created_by)
  values (p_org, 'payment', r.id, r.requested_by, r.amount, coalesce(p_date, current_date), coalesce(p_method,'Cash'), p_reference, v_je, p_user);
  return v_je;
end $$;

-- Issue a draft invoice: Dr Receivable / Cr Revenue + Cr VAT payable.
create or replace function fin_invoice_issue(p_id integer, p_org text, p_user text) returns integer language plpgsql as $$
declare i finance_invoices; v_sub numeric; v_vat numeric; v_tot numeric; v_je integer; v_lines integer;
begin
  select * into i from finance_invoices where id = p_id and organization_id::text = p_org for update;
  if not found then raise exception 'Invoice not found'; end if;
  if i.status <> 'Draft' then raise exception 'Only draft invoices can be issued (current status: %)', i.status; end if;
  select count(*), coalesce(sum(round(quantity * unit_price, 2)),0) into v_lines, v_sub from invoice_lines where invoice_id = i.id;
  if v_lines = 0 or v_sub <= 0 then raise exception 'Add at least one invoice line with an amount'; end if;
  v_vat := round(v_sub * i.vat_rate / 100, 2);
  v_tot := v_sub + v_vat;
  v_je := acct_post(p_org, i.issue_date, 'Invoice ' || i.invoice_number || ' - ' || i.customer_name, 'invoice', i.id::text, p_user,
    jsonb_build_array(
      jsonb_build_object('account','1100','debit',v_tot,'credit',0,'description',i.invoice_number,'project_id',i.project_id),
      jsonb_build_object('account','4000','debit',0,'credit',v_sub,'description',i.description,'project_id',i.project_id),
      jsonb_build_object('account','2100','debit',0,'credit',v_vat,'description','VAT ' || i.vat_rate || '%')));
  update finance_invoices set status = 'Issued', subtotal = v_sub, vat_amount = v_vat, total = v_tot, amount = v_tot,
    journal_entry_id = v_je, issued_at = now(), updated_at = now() where id = i.id;
  return v_je;
end $$;

-- Receive a customer payment against an issued invoice.
create or replace function fin_invoice_receive(
  p_id integer, p_org text, p_user text, p_amount numeric, p_date date, p_method text, p_reference text
) returns integer language plpgsql as $$
declare i finance_invoices; v_bal numeric; v_je integer; v_cash text; v_no text;
begin
  select * into i from finance_invoices where id = p_id and organization_id::text = p_org for update;
  if not found then raise exception 'Invoice not found'; end if;
  if i.status not in ('Issued','Partially Paid') then raise exception 'Invoice is % and cannot receive payment', i.status; end if;
  v_bal := i.total - i.amount_paid;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount greater than zero'; end if;
  if p_amount > v_bal then raise exception 'Amount exceeds the outstanding balance of %', v_bal; end if;
  v_cash := case when coalesce(p_method,'Cash') = 'Cash' then '1000' else '1010' end;
  v_no := acct_next_no(p_org, 'RCT', 'RCT');
  v_je := acct_post(p_org, coalesce(p_date, current_date), 'Receipt ' || v_no || ' for ' || i.invoice_number, 'receipt', i.id::text, p_user,
    jsonb_build_array(
      jsonb_build_object('account', v_cash, 'debit', p_amount, 'credit', 0, 'description', 'Received from ' || i.customer_name),
      jsonb_build_object('account', '1100', 'debit', 0, 'credit', p_amount, 'description', i.invoice_number, 'project_id', i.project_id)));
  insert into payments (organization_id, kind, receipt_no, invoice_id, party_name, amount, pay_date, method, reference, journal_entry_id, created_by)
  values (p_org, 'receipt', v_no, i.id, i.customer_name, p_amount, coalesce(p_date, current_date), coalesce(p_method,'Cash'), p_reference, v_je, p_user);
  update finance_invoices set amount_paid = amount_paid + p_amount,
    status = case when amount_paid + p_amount >= total then 'Paid' else 'Partially Paid' end, updated_at = now() where id = i.id;
  return v_je;
end $$;

create or replace function fin_invoice_void(p_id integer, p_org text, p_user text, p_reason text) returns void language plpgsql as $$
declare i finance_invoices;
begin
  select * into i from finance_invoices where id = p_id and organization_id::text = p_org for update;
  if not found then raise exception 'Invoice not found'; end if;
  if i.status = 'Void' then raise exception 'Invoice is already void'; end if;
  if i.amount_paid > 0 then raise exception 'Invoice has payments; reverse the receipts first'; end if;
  if i.journal_entry_id is not null then perform acct_reverse(i.journal_entry_id, p_org, p_user, p_reason); end if;
  update finance_invoices set status = 'Void', updated_at = now() where id = i.id;
end $$;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
create or replace function acct_trial_balance(p_org text, p_to date)
returns table (code text, name text, type text, debit numeric, credit numeric, balance_dr numeric, balance_cr numeric)
language sql stable as $$
  select a.code, a.name, a.type,
         coalesce(sum(l.debit),0), coalesce(sum(l.credit),0),
         greatest(coalesce(sum(l.debit),0) - coalesce(sum(l.credit),0), 0),
         greatest(coalesce(sum(l.credit),0) - coalesce(sum(l.debit),0), 0)
  from chart_of_accounts a
  left join journal_lines l on l.account_id = a.id
  left join journal_entries e on e.id = l.entry_id and e.entry_date <= p_to
  where a.organization_id = p_org and (e.id is not null or l.id is null)
  group by a.id, a.code, a.name, a.type
  having coalesce(sum(l.debit),0) <> 0 or coalesce(sum(l.credit),0) <> 0
  order by a.code;
$$;

create or replace function acct_income_statement(p_org text, p_from date, p_to date)
returns table (code text, name text, type text, amount numeric)
language sql stable as $$
  select a.code, a.name, a.type,
    case when a.type = 'Income' then coalesce(sum(l.credit - l.debit),0) else coalesce(sum(l.debit - l.credit),0) end
  from chart_of_accounts a
  join journal_lines l on l.account_id = a.id
  join journal_entries e on e.id = l.entry_id and e.entry_date between p_from and p_to
  where a.organization_id = p_org and a.type in ('Income','Expense')
  group by a.id, a.code, a.name, a.type
  order by a.code;
$$;

-- Balance sheet as at a date. Un-closed profit to date is reported as "Current period earnings".
create or replace function acct_balance_sheet(p_org text, p_to date)
returns table (section text, code text, name text, amount numeric)
language sql stable as $$
  with bal as (
    select a.code, a.name, a.type, coalesce(sum(l.debit),0) d, coalesce(sum(l.credit),0) c
    from chart_of_accounts a
    join journal_lines l on l.account_id = a.id
    join journal_entries e on e.id = l.entry_id and e.entry_date <= p_to
    where a.organization_id = p_org
    group by a.id, a.code, a.name, a.type
  )
  select 'Assets', code, name, d - c from bal where type = 'Asset' and d <> c
  union all select 'Liabilities', code, name, c - d from bal where type = 'Liability' and d <> c
  union all select 'Equity', code, name, c - d from bal where type = 'Equity' and d <> c
  union all select 'Equity', '9999', 'Current period earnings', coalesce(sum(c - d),0)
    from bal where type in ('Income','Expense')
  order by 1, 2;
$$;

create or replace function acct_general_ledger(p_org text, p_code text, p_from date, p_to date)
returns table (entry_date date, entry_no text, memo text, description text, debit numeric, credit numeric, running numeric)
language sql stable as $$
  select e.entry_date, e.entry_no, e.memo, l.description, l.debit, l.credit,
         sum(l.debit - l.credit) over (order by e.entry_date, e.id, l.id)
  from journal_lines l
  join journal_entries e on e.id = l.entry_id
  join chart_of_accounts a on a.id = l.account_id
  where a.organization_id = p_org and a.code = p_code and e.entry_date between p_from and p_to
  order by e.entry_date, e.id, l.id;
$$;
