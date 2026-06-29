-- Jobs table for MAD lookup
CREATE TABLE IF NOT EXISTS mad_enrich_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename      text NOT NULL,
  total_rows    integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','running','done','error')),
  matched       integer NOT NULL DEFAULT 0,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Rows table for MAD lookup
CREATE TABLE IF NOT EXISTS mad_enrich_rows (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid NOT NULL
                  REFERENCES mad_enrich_jobs(id)
                  ON DELETE CASCADE,
  row_index     integer NOT NULL,
  name          text,
  email         text,
  phone         text,
  location      text,
  website       text,
  company       text,
  extra_fields  jsonb NOT NULL DEFAULT '{}'::jsonb,
  match_type    text CHECK (match_type IN (
                  'email','phone','name_exact',
                  'name_fuzzy','no_match')),
  mad_profile   jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mad_enrich_rows_job_id_idx
  ON mad_enrich_rows(job_id);

CREATE INDEX IF NOT EXISTS mad_enrich_rows_job_id_completed_at_idx
  ON mad_enrich_rows(job_id, completed_at);
