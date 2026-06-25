-- Enrich overhaul: drop old tables and create new simplified schema.
-- Apply in Supabase dashboard → SQL editor.

DROP TABLE IF EXISTS enrich_rows CASCADE;
DROP TABLE IF EXISTS enrich_jobs CASCADE;

CREATE TABLE enrich_jobs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename             text NOT NULL,
  total_rows           integer NOT NULL DEFAULT 0,
  stage1_status        text NOT NULL DEFAULT 'pending'
                         CHECK (stage1_status IN ('pending','running','done','error')),
  stage1_matched       integer NOT NULL DEFAULT 0,
  stage1_completed_at  timestamptz,
  stage2_status        text NOT NULL DEFAULT 'pending'
                         CHECK (stage2_status IN ('pending','running','done','error')),
  stage2_enriched      integer NOT NULL DEFAULT 0,
  stage2_completed_at  timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE enrich_rows (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id               uuid NOT NULL REFERENCES enrich_jobs(id) ON DELETE CASCADE,
  row_index            integer NOT NULL,
  name                 text,
  email                text,
  phone                text,
  location             text,
  website              text,
  extra_fields         jsonb NOT NULL DEFAULT '{}'::jsonb,
  zillow_url           text,
  match_type           text CHECK (match_type IN
                         ('email','phone','name_fuzzy','no_match')),
  zillow_profile       jsonb NOT NULL DEFAULT '{}'::jsonb,
  stage1_completed_at  timestamptz,
  stage2_completed_at  timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON enrich_rows(job_id);
CREATE INDEX ON enrich_rows(job_id, stage1_completed_at);
