-- Add list classification and mapping report to enrich_jobs
-- list_type: A (name+email), B (name only), C (email only), D (team_name only), E (other)
-- column_mapping_report: { mapped: [{targetField, sourceColumn, confidence}], absent: [targetField] }

ALTER TABLE enrich_jobs
  ADD COLUMN IF NOT EXISTS list_type text,
  ADD COLUMN IF NOT EXISTS column_mapping_report jsonb;
