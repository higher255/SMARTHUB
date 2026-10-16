-- Finance requests go to Finance for one-step approval, with no amount-based
-- management endorsement. Existing requests follow the same route.
update organizations set manager_approval_limit = 0;
update finance_requests set requires_manager = false;

-- Each approved money request becomes one posted Accounts Payable bill. The
-- source reference makes retries idempotent and keeps the request traceable.
alter table finance_bills add column if not exists request_id integer references finance_requests(id) on delete set null;
create unique index if not exists finance_bills_request_unique_idx
  on finance_bills (request_id) where request_id is not null;

create or replace function fin_request_approve(p_id integer, p_org text, p_user text, p_user_name text)
returns table (bill_id bigint, bill_number text) language plpgsql as $$
declare r finance_requests; b finance_bills; v_code text;
begin
  select * into r from finance_requests where id = p_id and organization_id::text = p_org for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status not in ('Submitted','Under Review') then
    raise exception 'This request is % and cannot be approved', r.status;
  end if;

  select * into b from finance_bills where request_id = r.id for update;
  if not found then
    v_code := case r.category when 'Material' then '5000' when 'Equipment' then '5100' when 'Labor' then '5200' when 'Transport' then '5300' else '5900' end;
    insert into finance_bills (
      organization_id, supplier_name, supplier_invoice_number, bill_number, description,
      currency, status, issue_date, project_id, subtotal, vat_rate, vat_amount,
      total, amount_paid, notes, created_by, request_id
    ) values (
      p_org, r.requested_by, r.request_number,
      acct_next_no(p_org, 'BILL', 'BILL'), r.title,
      r.currency, 'Draft', current_date, r.project_id, r.amount, 0, 0,
      r.amount, 0, concat_ws(E'\n', nullif(r.description,''), nullif(r.notes,'')), p_user, r.id
    ) returning * into b;
    insert into finance_bill_lines (bill_id, position, description, quantity, unit_price, account_code, project_id)
      values (b.id, 1, r.title, 1, r.amount, v_code, r.project_id);
    perform fin_bill_post(b.id, p_org, p_user);
  end if;

  update finance_requests set status='Approved', approved_by=p_user_name, approved_at=coalesce(approved_at,now()),
    requires_manager=false, updated_at=now()
  where id=r.id;
  return query select b.id, b.bill_number;
end $$;

-- Pay linked requests through Accounts Payable so the bill and request close
-- together and the ledger records Dr AP / Cr cash or bank exactly once.
create or replace function fin_request_pay(
  p_id integer, p_org text, p_user text, p_user_name text, p_reference text, p_method text, p_date date
) returns integer language plpgsql as $$
declare r finance_requests; b finance_bills; v_je integer; v_exp text; v_cash text;
begin
  select * into r from finance_requests where id=p_id and organization_id::text=p_org for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status <> 'Approved' then raise exception 'Only approved requests can be paid (current status: %)',r.status; end if;

  select * into b from finance_bills where request_id=r.id and organization_id=p_org for update;
  if found then
    if b.status not in ('Open','Partially Paid') then raise exception 'Linked payable is % and cannot be paid',b.status; end if;
    v_je := fin_bill_pay(b.id,p_org,p_user,r.amount,coalesce(p_date,current_date),coalesce(p_method,'Cash'),p_reference);
    update payments set request_id=r.id where bill_id=b.id and journal_entry_id=v_je;
  else
    -- Legacy approved requests from before automatic bill creation.
    v_exp := case r.category when 'Material' then '5000' when 'Equipment' then '5100' when 'Labor' then '5200' when 'Transport' then '5300' else '5900' end;
    v_cash := case when coalesce(p_method,'Cash')='Cash' then '1000' else '1010' end;
    v_je := acct_post(p_org,coalesce(p_date,current_date),'Payment of '||r.request_number||' - '||r.title,'finance_request',r.id::text,p_user,
      jsonb_build_array(
        jsonb_build_object('account',v_exp,'debit',r.amount,'credit',0,'description',r.title,'project_id',r.project_id),
        jsonb_build_object('account',v_cash,'debit',0,'credit',r.amount,'description','Paid to '||r.requested_by||' ref '||p_reference)));
    insert into payments (organization_id,kind,request_id,party_name,amount,pay_date,method,reference,journal_entry_id,created_by)
      values (p_org,'payment',r.id,r.requested_by,r.amount,coalesce(p_date,current_date),coalesce(p_method,'Cash'),p_reference,v_je,p_user);
  end if;
  update finance_requests set status='Paid',paid_by=p_user_name,paid_at=now(),payment_reference=p_reference,
    payment_method=coalesce(p_method,'Cash'),journal_entry_id=v_je,updated_at=now() where id=r.id;
  return v_je;
end $$;

revoke execute on function fin_request_approve(integer,text,text,text) from public;
revoke execute on function fin_request_pay(integer,text,text,text,text,text,date) from public;
do $$
declare role_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname=role_name) then
      execute format('revoke execute on function fin_request_approve(integer,text,text,text) from %I', role_name);
      execute format('revoke execute on function fin_request_pay(integer,text,text,text,text,text,date) from %I', role_name);
    end if;
  end loop;
end $$;
