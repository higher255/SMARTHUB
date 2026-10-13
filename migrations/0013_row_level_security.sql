-- Supabase exposes every table in the public schema through its REST API. Turn row level security on for every
-- table that does not have it yet, with no policies, so that key can never read or write them. The app itself
-- connects as the database owner, which is not affected by row level security.
do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = current_schema() and c.relkind = 'r' and not c.relrowsecurity
  loop
    execute format('alter table %I enable row level security', t.relname);
  end loop;
end
$$;
