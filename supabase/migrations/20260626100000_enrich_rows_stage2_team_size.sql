-- Add Stage 2 team size columns to enrich_rows.
-- Apply in Supabase dashboard → SQL editor before running Stage 2.
ALTER TABLE enrich_rows
  ADD COLUMN IF NOT EXISTS stage2_team_size            integer,
  ADD COLUMN IF NOT EXISTS stage2_team_size_confidence text;
