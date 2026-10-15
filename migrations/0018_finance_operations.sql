-- Accounts payable, input VAT, and bank statement reconciliation.
-- All monetary postings flow through acct_post so they remain balanced and tenant scoped.

insert into chart_of_accounts (organization_id, code, name, type, is_system)
select id::text, '2150', 'VAT Recoverable', 'Asset', true from organizations
on conflict (organization_id, code) do nothing;

create table if not exists finance_bills (
  id bigserial primary key,
  organization_id text not null,
  supplier_id integer references parties(id) on delete set null,
  supplier_name text not null,
  supplier_invoice_number text,
  bill_number text not null,
  description text not null,
  currency text not null default 'TZS',
  status text not null default 'Draft' check (status in ('Draft','Open','Partially Paid','Paid','Void')),
  issue_date date not null default current_date,
  due_date date,
  project_id integer references projects(id) on delete set null,
  subtotal numeric(18,2) not null default 0,
  vat_rate numeric(6,3) not null default 0 check (vat_rate between 0 and 100),
  vat_amount numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  amount_paid numeric(18,2) not null default 0,
  journal_entry_id integer references journal_entries(id),
  notes text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, bill_number),
  check (subtotal >= 0 and vat_amount >= 0 and total >= 0 and amount_paid >= 0 and amount_paid <= total)
);
create index if not exists finance_bills_org_status_idx on finance_bills(organization_id, status, due_date);
create index if not exists finance_bills_supplier_idx on finance_bills(organization_id, supplier_id, issue_date desc);

create table if not exists finance_bill_lines (
  id bigserial primary key,
  bill_id bigint not null references finance_bills(id) on delete cascade,
  position integer not null default 1,
  description text not null,
  quantity numeric(18,4) not null default 1 check (quantity > 0),
  unit_price numeric(18,2) not null default 0 check (unit_price >= 0),
  account_code text not null default '5900',
  project_id integer references projects(id) on delete set null
);
create index if not exists finance_bill_lines_bill_idx on finance_bill_lines(bill_id, position);

alter table payments add column if not exists bill_id bigint references finance_bills(id) on delete set null;
create index if not exists payments_bill_idx on payments(organization_id, bill_id, pay_date);

create table if not exists bank_reconciliations (
  id bigserial primary key,
  organization_id text not null,
  account_code text not null,
  statement_from date not null,
  statement_to date not null,
  beginning_balance numeric(18,2) not null,
  ending_balance numeric(18,2) not null,
  status text not null default 'Draft' check (status in ('Draft','Completed')),
  created_by text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (statement_to >= statement_from),
  unique (organization_id, account_code, statement_to)
);
create index if not exists bank_reconciliations_org_idx on bank_reconciliations(organization_id, account_code, statement_to desc);

create table if not exists bank_reconciliation_items (
  reconciliation_id bigint not null references bank_reconciliations(id) on delete cascade,
  journal_line_id integer not null references journal_lines(id),
  primary key (reconciliation_id, journal_line_id)
);
create index if not exists bank_reconciliation_items_line_idx on bank_reconciliation_items(journal_line_id);

alter table finance_bills enable row level security;
alter table finance_bill_lines enable row level security;
alter table bank_reconciliations enable row level security;
alter table bank_reconciliation_items enable row level security;

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
    (p_org,'2150','VAT Recoverable','Asset',true),
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

-- A completed bank reconciliation is a period lock for its bank account. Do not
-- let later edits or back-dated postings silently change a reconciled balance.
create or replace function acct_guard_reconciled_bank_lines() returns trigger language plpgsql as $$
declare v_org text; v_code text; v_date date;
begin
  -- Protect the old side too: otherwise moving a reconciled line to another
  -- date/account or deleting it would silently change a completed statement.
  if TG_OP in ('UPDATE','DELETE') then
    select e.organization_id, a.code, e.entry_date into v_org, v_code, v_date
      from journal_entries e join chart_of_accounts a on a.id = old.account_id
      where e.id = old.entry_id;
    if exists (
      select 1 from bank_reconciliations r
      where r.organization_id = v_org and r.account_code = v_code and r.status = 'Completed'
        and v_date <= r.statement_to
    ) then
      raise exception 'This bank account period is reconciled; use a current-dated correcting entry instead';
    end if;
  end if;
  if TG_OP in ('INSERT','UPDATE') then
    select e.organization_id, a.code, e.entry_date into v_org, v_code, v_date
      from journal_entries e join chart_of_accounts a on a.id = new.account_id
      where e.id = new.entry_id;
    if exists (
      select 1 from bank_reconciliations r
      where r.organization_id = v_org and r.account_code = v_code and r.status = 'Completed'
        and v_date <= r.statement_to
    ) then
      raise exception 'This bank account period is reconciled; use a current-dated correcting entry instead';
    end if;
    return new;
  end if;
  return old;
end $$;
drop trigger if exists journal_lines_reconciled_guard on journal_lines;
create trigger journal_lines_reconciled_guard before insert or update or delete on journal_lines
  for each row execute function acct_guard_reconciled_bank_lines();

create or replace function fin_bill_post(p_id bigint, p_org text, p_user text) returns integer language plpgsql as $$
declare b finance_bills; v_sub numeric; v_vat numeric; v_total numeric; v_lines integer; v_post jsonb; v_je integer;
begin
  select * into b from finance_bills where id = p_id and organization_id = p_org for update;
  if not found then raise exception 'Bill not found'; end if;
  if b.status <> 'Draft' then raise exception 'Only draft bills can be posted'; end if;
  select count(*), coalesce(sum(round(quantity * unit_price, 2)), 0)
    into v_lines, v_sub from finance_bill_lines where bill_id = b.id;
  if v_lines = 0 or v_sub <= 0 then raise exception 'Add at least one bill line with an amount'; end if;
  v_vat := round(v_sub * b.vat_rate / 100, 2);
  v_total := v_sub + v_vat;
  select coalesce(jsonb_agg(jsonb_build_object('account', l.account_code, 'debit', round(l.quantity*l.unit_price,2), 'credit', 0,
      'description', l.description, 'project_id', l.project_id)), '[]'::jsonb)
    into v_post from finance_bill_lines l where l.bill_id = b.id;
  if v_vat > 0 then
    v_post := v_post || jsonb_build_array(jsonb_build_object('account','2150','debit',v_vat,'credit',0,'description','Input VAT'));
  end if;
  v_post := v_post || jsonb_build_array(jsonb_build_object('account','2000','debit',0,'credit',v_total,'description',b.bill_number));
  v_je := acct_post(p_org, b.issue_date, 'Supplier bill ' || b.bill_number || ' - ' || b.supplier_name, 'supplier_bill', b.id::text, p_user, v_post);
  update finance_bills set status = 'Open', subtotal = v_sub, vat_amount = v_vat, total = v_total,
    journal_entry_id = v_je, updated_at = now() where id = b.id;
  return v_je;
end $$;

create or replace function fin_bill_pay(
  p_id bigint, p_org text, p_user text, p_amount numeric, p_date date, p_method text, p_reference text
) returns integer language plpgsql as $$
declare b finance_bills; v_balance numeric; v_cash text; v_je integer; v_no text;
begin
  select * into b from finance_bills where id = p_id and organization_id = p_org for update;
  if not found then raise exception 'Bill not found'; end if;
  if b.status not in ('Open','Partially Paid') then raise exception 'Bill is % and cannot be paid', b.status; end if;
  v_balance := b.total - b.amount_paid;
  if p_amount is null or p_amount <= 0 or p_amount > v_balance then raise exception 'Payment must be greater than zero and not exceed the balance of %', v_balance; end if;
  v_cash := case when coalesce(p_method,'Cash') = 'Cash' then '1000' else '1010' end;
  v_no := acct_next_no(p_org, 'PAY', 'PAY');
  v_je := acct_post(p_org, coalesce(p_date,current_date), 'Payment ' || v_no || ' for ' || b.bill_number, 'bill_payment', b.id::text, p_user,
    jsonb_build_array(
      jsonb_build_object('account','2000','debit',p_amount,'credit',0,'description',b.bill_number),
      jsonb_build_object('account',v_cash,'debit',0,'credit',p_amount,'description','Paid to ' || b.supplier_name || coalesce(' ref ' || p_reference,''))));
  insert into payments (organization_id, kind, bill_id, party_name, amount, pay_date, method, reference, journal_entry_id, created_by)
    values (p_org, 'payment', b.id, b.supplier_name, p_amount, coalesce(p_date,current_date), coalesce(p_method,'Cash'), p_reference, v_je, p_user);
  update finance_bills set amount_paid = amount_paid + p_amount,
    status = case when amount_paid + p_amount >= total then 'Paid' else 'Partially Paid' end, updated_at = now() where id = b.id;
  return v_je;
end $$;

create or replace function fin_bill_void(p_id bigint, p_org text, p_user text, p_reason text) returns void language plpgsql as $$
declare b finance_bills;
begin
  select * into b from finance_bills where id = p_id and organization_id = p_org for update;
  if not found then raise exception 'Bill not found'; end if;
  if b.status = 'Void' then raise exception 'Bill is already void'; end if;
  if b.amount_paid > 0 then raise exception 'Bill has payments; reverse those payments first'; end if;
  if b.journal_entry_id is not null then perform acct_reverse(b.journal_entry_id, p_org, p_user, p_reason); end if;
  update finance_bills set status = 'Void', updated_at = now() where id = b.id;
end $$;

create or replace function acct_save_reconciliation(
  p_id bigint, p_org text, p_user text, p_code text, p_from date, p_to date,
  p_beginning numeric, p_ending numeric, p_line_ids jsonb
) returns bigint language plpgsql as $$
declare v_id bigint; v_type text; v_previous record; v_inserted integer; v_expected integer;
begin
  if p_from is null or p_to < p_from then raise exception 'Enter a valid statement period'; end if;
  select type into v_type from chart_of_accounts where organization_id = p_org and code = p_code and active;
  if v_type is distinct from 'Asset' then raise exception 'Choose an active bank or cash asset account'; end if;
  select statement_to, ending_balance into v_previous from bank_reconciliations
    where organization_id = p_org and account_code = p_code and status = 'Completed'
    order by statement_to desc limit 1;
  if found then
    if p_from <= v_previous.statement_to then raise exception 'Statement period must start after the previous completed reconciliation'; end if;
    if abs(p_beginning - v_previous.ending_balance) > 0.01 then raise exception 'Beginning balance must match the previous statement ending balance'; end if;
  end if;
  if p_id is null then
    insert into bank_reconciliations (organization_id, account_code, statement_from, statement_to, beginning_balance, ending_balance, created_by)
    values (p_org,p_code,p_from,p_to,p_beginning,p_ending,p_user) returning id into v_id;
  else
    select id into v_id from bank_reconciliations where id=p_id and organization_id=p_org and status='Draft' for update;
    if v_id is null then raise exception 'Draft reconciliation not found'; end if;
    update bank_reconciliations set statement_from=p_from,statement_to=p_to,beginning_balance=p_beginning,ending_balance=p_ending where id=v_id;
  end if;
  delete from bank_reconciliation_items where reconciliation_id=v_id;
  select count(distinct x::integer) into v_expected from jsonb_array_elements_text(coalesce(p_line_ids,'[]'::jsonb)) a(x);
  insert into bank_reconciliation_items(reconciliation_id,journal_line_id)
  select v_id,l.id from journal_lines l
    join journal_entries e on e.id=l.entry_id and e.organization_id=p_org and e.entry_date between p_from and p_to
    join chart_of_accounts a on a.id=l.account_id and a.organization_id=p_org and a.code=p_code
    where l.id in (select x::integer from jsonb_array_elements_text(coalesce(p_line_ids,'[]'::jsonb)) a(x))
      and not exists (select 1 from bank_reconciliation_items ri join bank_reconciliations rr on rr.id=ri.reconciliation_id
        where ri.journal_line_id=l.id and rr.status='Completed' and rr.id<>v_id);
  get diagnostics v_inserted = row_count;
  if v_inserted <> v_expected then raise exception 'Some selected transactions are invalid, outside the period, or already reconciled'; end if;
  return v_id;
end $$;

create or replace function acct_complete_reconciliation(p_id bigint, p_org text) returns void language plpgsql as $$
declare r bank_reconciliations; v_cleared numeric;
begin
  select * into r from bank_reconciliations where id=p_id and organization_id=p_org and status='Draft' for update;
  if not found then raise exception 'Draft reconciliation not found'; end if;
  select coalesce(sum(l.debit-l.credit),0) into v_cleared
  from bank_reconciliation_items ri join journal_lines l on l.id=ri.journal_line_id where ri.reconciliation_id=r.id;
  if abs(r.beginning_balance + v_cleared - r.ending_balance) > 0.01 then
    raise exception 'Statement does not reconcile. Difference: %', round(r.ending_balance - (r.beginning_balance + v_cleared),2);
  end if;
  update bank_reconciliations set status='Completed',completed_at=now() where id=r.id;
end $$;

-- These are internal server-side routines. They take tenant/user IDs as
-- arguments and must not be exposed as unauthenticated PostgREST RPC methods.
revoke execute on function acct_seed_chart(text) from public;
revoke execute on function acct_guard_reconciled_bank_lines() from public;
revoke execute on function fin_bill_post(bigint,text,text) from public;
revoke execute on function fin_bill_pay(bigint,text,text,numeric,date,text,text) from public;
revoke execute on function fin_bill_void(bigint,text,text,text) from public;
revoke execute on function acct_save_reconciliation(bigint,text,text,text,date,date,numeric,numeric,jsonb) from public;
revoke execute on function acct_complete_reconciliation(bigint,text) from public;
do $$
declare role_name text; function_signature text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      foreach function_signature in array array[
        'acct_seed_chart(text)',
        'acct_guard_reconciled_bank_lines()',
        'fin_bill_post(bigint,text,text)',
        'fin_bill_pay(bigint,text,text,numeric,date,text,text)',
        'fin_bill_void(bigint,text,text,text)',
        'acct_save_reconciliation(bigint,text,text,text,date,date,numeric,numeric,jsonb)',
        'acct_complete_reconciliation(bigint,text)'
      ] loop
        execute format('revoke execute on function %s from %I', function_signature, role_name);
      end loop;
    end if;
  end loop;
end $$;
