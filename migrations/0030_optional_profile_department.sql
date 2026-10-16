-- Department is optional metadata; role is the account's required access level.
alter table profiles alter column department drop not null;
alter table profiles alter column department drop default;

-- Fold legacy standalone fleet accounts into regular staff accounts. EHS keeps
-- vehicle, journey and inspection controls inside its safety workspace.
update profiles
set role = 'Employee',
    department = null,
    permissions = array_remove(coalesce(permissions, '{}'::text[]), 'fleet.driver_dashboard')
where role = 'Driver';
