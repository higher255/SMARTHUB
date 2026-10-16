-- EHS money requests can name their intended recipient and payment details while
-- remaining linked to the existing Finance approval and Accounts Payable flow.
alter table finance_requests add column if not exists recipient_mode text not null default 'finance';
alter table finance_requests add column if not exists recipient_user_id text;
alter table finance_requests add column if not exists recipient_name text;
alter table finance_requests add column if not exists recipient_email text;
alter table finance_requests add column if not exists recipient_bank_name text;
alter table finance_requests add column if not exists recipient_bank_account_name text;
alter table finance_requests add column if not exists recipient_bank_account_number text;
alter table finance_requests add column if not exists recipient_bank_swift text;
alter table finance_requests drop constraint if exists finance_requests_recipient_mode_check;
alter table finance_requests add constraint finance_requests_recipient_mode_check
  check (recipient_mode in ('finance', 'management', 'specific'));

alter table finance_bills add column if not exists payee_email text;
alter table finance_bills add column if not exists payee_bank_name text;
alter table finance_bills add column if not exists payee_bank_account_name text;
alter table finance_bills add column if not exists payee_bank_account_number text;
alter table finance_bills add column if not exists payee_bank_swift text;

create or replace function fin_request_approve(p_id integer, p_org text, p_user text, p_user_name text)
returns table (bill_id bigint, bill_number text) language plpgsql as $$
declare r finance_requests; b finance_bills; v_code text; v_payee text;
begin
  select * into r from finance_requests where id = p_id and organization_id::text = p_org for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status not in ('Submitted','Under Review') then
    raise exception 'This request is % and cannot be approved', r.status;
  end if;

  select * into b from finance_bills where request_id = r.id for update;
  if not found then
    v_code := case r.category when 'Material' then '5000' when 'Equipment' then '5100' when 'Labor' then '5200' when 'Transport' then '5300' else '5900' end;
    v_payee := coalesce(nullif(r.recipient_name, ''), r.requested_by);
    insert into finance_bills (
      organization_id, supplier_name, supplier_invoice_number, bill_number, description,
      currency, status, issue_date, project_id, subtotal, vat_rate, vat_amount,
      total, amount_paid, notes, created_by, request_id, payee_email,
      payee_bank_name, payee_bank_account_name, payee_bank_account_number, payee_bank_swift
    ) values (
      p_org, v_payee, r.request_number,
      acct_next_no(p_org, 'BILL', 'BILL'), r.title,
      r.currency, 'Draft', current_date, r.project_id, r.amount, 0, 0,
      r.amount, 0, concat_ws(E'\n', nullif(r.description,''), nullif(r.notes,'')), p_user, r.id,
      r.recipient_email, r.recipient_bank_name, r.recipient_bank_account_name,
      r.recipient_bank_account_number, r.recipient_bank_swift
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

revoke execute on function fin_request_approve(integer,text,text,text) from public;
do $$
declare role_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname=role_name) then
      execute format('revoke execute on function fin_request_approve(integer,text,text,text) from %I', role_name);
    end if;
  end loop;
end $$;
