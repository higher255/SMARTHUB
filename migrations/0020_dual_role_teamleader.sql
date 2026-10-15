-- Existing Driver accounts created with the old dual-role toggle already have
-- hours.record + ncr.raise. Grant those accounts the new Team & Site workspace.
update profiles
set permissions = array(
  select distinct permission
  from unnest(coalesce(profiles.permissions, '{}'::text[]) || array['teamleader.dashboard','attendance.view']) as permission
), updated_at = now()
where role = 'Driver' and permissions @> array['hours.record','ncr.raise'];
