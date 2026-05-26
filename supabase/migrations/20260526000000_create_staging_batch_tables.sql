-- Create staging.batches, staging.teams, staging.agents, and staging.pipeline_log.
-- These tables were never created in the DB (the [0.7.0] schema note documented
-- incorrect column names that didn't match the RPCs). All ce_* RPCs reference these
-- exact column names — any rename will break them.

-- ── staging.batches ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staging.batches (
  batch_id      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  source_file   text,
  total_rows    int         NOT NULL DEFAULT 0,
  status        text        NOT NULL DEFAULT 'pending',
  current_stage text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── staging.teams ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staging.teams (
  team_id        uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id       uuid        NOT NULL REFERENCES staging.batches(batch_id) ON DELETE CASCADE,
  mad_id         text,
  team_name      text,
  brokerage      text,
  location       text,
  website_url    text,
  web_valid      boolean,
  verify_error   text,
  zillow_url     text,
  zillow_valid   boolean,
  pipeline_stage text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS teams_batch_id_idx ON staging.teams(batch_id);

-- ── staging.agents ─────────────────────────────────────────────────────────────
-- agent_id is the PK; the unique expression index supports ON CONFLICT DO NOTHING
-- in ce_insert_agents_bulk (deduplication by team + normalized name).
CREATE TABLE IF NOT EXISTS staging.agents (
  agent_id    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id    uuid        NOT NULL REFERENCES staging.batches(batch_id) ON DELETE CASCADE,
  team_id     uuid        NOT NULL REFERENCES staging.teams(team_id)   ON DELETE CASCADE,
  first_name  text,
  last_name   text,
  email       text,
  phone       text,
  designation text,
  source      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agents_batch_id_idx ON staging.agents(batch_id);
CREATE INDEX IF NOT EXISTS agents_team_id_idx  ON staging.agents(team_id);

-- Required by ce_insert_agents_bulk ON CONFLICT clause:
CREATE UNIQUE INDEX IF NOT EXISTS agents_team_name_dedup
  ON staging.agents(team_id, COALESCE(lower(first_name), ''), COALESCE(lower(last_name), ''));

-- ── staging.pipeline_log ───────────────────────────────────────────────────────
-- Referenced by ce_delete_batch for cascade cleanup. Minimal schema.
CREATE TABLE IF NOT EXISTS staging.pipeline_log (
  id         bigserial   PRIMARY KEY,
  batch_id   uuid        NOT NULL,
  stage      text,
  message    text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_log_batch_id_idx ON staging.pipeline_log(batch_id);
