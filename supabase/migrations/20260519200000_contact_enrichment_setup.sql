-- Contact enrichment phase: RPC wrappers for staging.agents writes/reads
-- and batch/team pipeline stage management.
-- All functions are SECURITY DEFINER in public schema (staging not PostgREST-exposed).

-- ── Team helpers ──────────────────────────────────────────────────────────────

-- Returns teams in a batch where at least one QA flag passed
CREATE OR REPLACE FUNCTION public.ce_get_qualified_teams(p_batch_id uuid)
RETURNS TABLE(
  team_id     uuid,
  team_name   text,
  website_url text,
  zillow_url  text,
  web_valid   boolean,
  zillow_valid boolean
)
LANGUAGE sql SECURITY DEFINER SET search_path = staging, public AS $$
  SELECT team_id, team_name, website_url, zillow_url, web_valid, zillow_valid
  FROM staging.teams
  WHERE batch_id = p_batch_id
    AND (web_valid = true OR zillow_valid = true)
  ORDER BY team_id;
$$;

-- Marks all teams that failed both QA checks as contact_skipped
CREATE OR REPLACE FUNCTION public.ce_skip_unqualified_teams(p_batch_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = staging, public AS $$
  UPDATE staging.teams
  SET pipeline_stage = 'contact_skipped', updated_at = now()
  WHERE batch_id = p_batch_id
    AND (web_valid IS NOT TRUE AND zillow_valid IS NOT TRUE)
    AND (pipeline_stage IS NULL OR pipeline_stage NOT IN ('contacts_done', 'contact_skipped'));
$$;

-- Updates pipeline_stage on a single team
CREATE OR REPLACE FUNCTION public.ce_update_team_pipeline_stage(p_team_id uuid, p_stage text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = staging, public AS $$
  UPDATE staging.teams SET pipeline_stage = p_stage, updated_at = now()
  WHERE team_id = p_team_id;
$$;

-- ── Batch helpers ─────────────────────────────────────────────────────────────

-- Updates both current_stage and status on a batch in one call
CREATE OR REPLACE FUNCTION public.ce_update_batch_pipeline(
  p_batch_id uuid,
  p_stage    text,
  p_status   text
)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = staging, public AS $$
  UPDATE staging.batches
  SET current_stage = p_stage, status = p_status, updated_at = now()
  WHERE batch_id = p_batch_id;
$$;

-- ── Agent writes ──────────────────────────────────────────────────────────────

-- Bulk inserts into staging.agents; skips rows with no email
CREATE OR REPLACE FUNCTION public.ce_insert_agents_bulk(p_agents jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = staging, public AS $$
BEGIN
  INSERT INTO staging.agents (
    batch_id, team_id, first_name, last_name,
    email, phone, designation, source
  )
  SELECT
    (a->>'batch_id')::uuid,
    (a->>'team_id')::uuid,
    a->>'first_name',
    a->>'last_name',
    a->>'email',
    a->>'phone',
    a->>'designation',
    a->>'source'
  FROM jsonb_array_elements(p_agents) a
  WHERE (a->>'email') IS NOT NULL AND trim(a->>'email') <> '';
END;
$$;

-- ── Agent reads ───────────────────────────────────────────────────────────────

-- Returns all agents for a batch, joined with team_name
CREATE OR REPLACE FUNCTION public.ce_get_batch_agents(p_batch_id uuid)
RETURNS TABLE(
  agent_id    uuid,
  team_id     uuid,
  team_name   text,
  first_name  text,
  last_name   text,
  email       text,
  phone       text,
  designation text,
  source      text,
  created_at  timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = staging, public AS $$
  SELECT a.agent_id, a.team_id, t.team_name,
    a.first_name, a.last_name, a.email, a.phone,
    a.designation, a.source, a.created_at
  FROM staging.agents a
  JOIN staging.teams t ON t.team_id = a.team_id
  WHERE a.batch_id = p_batch_id
  ORDER BY t.team_name, a.last_name;
$$;

-- ── Extended batch listing ────────────────────────────────────────────────────

-- Replaces ce_get_batches with contacts_count + current_stage included
CREATE OR REPLACE FUNCTION public.ce_get_batches_v2()
RETURNS TABLE(
  batch_id       uuid,
  source_file    text,
  created_at     timestamptz,
  total_rows     int,
  status         text,
  current_stage  text,
  contacts_count bigint
)
LANGUAGE sql SECURITY DEFINER SET search_path = staging, public AS $$
  SELECT
    b.batch_id, b.source_file, b.created_at, b.total_rows,
    b.status, b.current_stage,
    COUNT(a.agent_id)::bigint AS contacts_count
  FROM staging.batches b
  LEFT JOIN staging.agents a ON a.batch_id = b.batch_id
  GROUP BY b.batch_id, b.source_file, b.created_at, b.total_rows,
           b.status, b.current_stage
  ORDER BY b.created_at DESC;
$$;

-- Returns extended info for a single batch
CREATE OR REPLACE FUNCTION public.ce_get_batch_info(p_batch_id uuid)
RETURNS TABLE(
  batch_id       uuid,
  source_file    text,
  created_at     timestamptz,
  total_rows     int,
  status         text,
  current_stage  text,
  contacts_count bigint
)
LANGUAGE sql SECURITY DEFINER SET search_path = staging, public AS $$
  SELECT
    b.batch_id, b.source_file, b.created_at, b.total_rows,
    b.status, b.current_stage,
    COUNT(a.agent_id)::bigint AS contacts_count
  FROM staging.batches b
  LEFT JOIN staging.agents a ON a.batch_id = b.batch_id
  WHERE b.batch_id = p_batch_id
  GROUP BY b.batch_id, b.source_file, b.created_at, b.total_rows,
           b.status, b.current_stage;
$$;
