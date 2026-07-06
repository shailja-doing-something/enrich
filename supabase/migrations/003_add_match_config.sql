-- Add match_config to jobs tables (configurable step order feature)
ALTER TABLE mad_enrich_jobs
  ADD COLUMN IF NOT EXISTS match_config jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE enrich_jobs
  ADD COLUMN IF NOT EXISTS match_config jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Drop restrictive match_type CHECK constraints.
-- Configurable steps produce dynamic composite keys (e.g. 'location_name',
-- 'company_email') that the original fixed-enum constraints don't allow.
ALTER TABLE mad_enrich_rows
  DROP CONSTRAINT IF EXISTS mad_enrich_rows_match_type_check;

ALTER TABLE enrich_rows
  DROP CONSTRAINT IF EXISTS enrich_rows_match_type_check;
