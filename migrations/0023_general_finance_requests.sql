-- Allow finance requests for company or office expenses that are not tied to a site project.
alter table finance_requests alter column project_id drop not null;
