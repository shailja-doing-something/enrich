-- Pre-enrichment contact QA columns on enrich_rows
-- Populated by prioritizeRows() before any enrichment branch runs.

ALTER TABLE enrich_rows
  ADD COLUMN IF NOT EXISTS priority_tier text,
  ADD COLUMN IF NOT EXISTS rejected boolean,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS needs_review boolean,
  ADD COLUMN IF NOT EXISTS work_email boolean,
  ADD COLUMN IF NOT EXISTS inferred_website text,
  ADD COLUMN IF NOT EXISTS inferred_company text,
  ADD COLUMN IF NOT EXISTS team_name_normalized text;
