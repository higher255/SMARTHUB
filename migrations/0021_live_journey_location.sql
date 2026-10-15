-- Store only the most recent opt-in GPS fix for an active trip; no route history.
alter table trips add column if not exists last_latitude double precision;
alter table trips add column if not exists last_longitude double precision;
alter table trips add column if not exists last_location_accuracy_m double precision;
alter table trips add column if not exists last_location_at timestamptz;
