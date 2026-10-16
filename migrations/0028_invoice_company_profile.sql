-- Optional supplier details printed on customer invoices.
alter table organizations add column if not exists business_address text;
alter table organizations add column if not exists business_bank_name text;
alter table organizations add column if not exists business_bank_account_name text;
alter table organizations add column if not exists business_bank_account_number text;
alter table organizations add column if not exists business_bank_swift text;
alter table organizations add column if not exists business_tin text;
alter table organizations add column if not exists business_vrn text;
