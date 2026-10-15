ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS dashboard_cover_url text;
