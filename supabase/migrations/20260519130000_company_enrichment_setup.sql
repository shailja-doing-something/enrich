-- Company enrichment: add mad_id to staging.teams and create public RPC wrappers
-- so the app can write/read staging schema without exposing it via PostgREST.
-- Tables staging.batches + staging.teams already exist — not re-created here.
-- All functions use SECURITY DEFINER so they run with definer privileges regardless
-- of which schemas PostgREST exposes.

ALTER TABLE staging.teams ADD COLUMN IF NOT EXISTS mad_id text;

-- ── RPC wrappers ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ce_create_batch(p_source_file text, p_total_rows int)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = staging, public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO staging.batches (source_file, total_rows, status)
  VALUES (p_source_file, p_total_rows, 'pending')
  RETURNING batch_id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ce_insert_teams(p_batch_id uuid, p_teams jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = staging, public AS $$
BEGIN
  INSERT INTO staging.teams (batch_id, mad_id, team_name, brokerage, location)
  SELECT
    p_batch_id,
    t->>'mad_id',
    t->>'team_name',
    t->>'brokerage',
    t->>'location'
  FROM jsonb_array_elements(p_teams) t;
END;
$$;

CREATE OR REPLACE FUNCTION public.ce_get_batches()
RETURNS TABLE(
  batch_id   uuid,
  source_file text,
  created_at timestamptz,
  total_rows  int,
  status      text
)
LANGUAGE sql SECURITY DEFINER SET search_path = staging, public AS $$
  SELECT batch_id, source_file, created_at, total_rows, status
  FROM staging.batches
  ORDER BY created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.ce_get_batch_teams(p_batch_id uuid)
RETURNS TABLE(
  team_id     uuid,
  batch_id    uuid,
  mad_id      text,
  team_name   text,
  brokerage   text,
  location    text,
  website_url text,
  web_valid   boolean,
  verify_error text
)
LANGUAGE sql SECURITY DEFINER SET search_path = staging, public AS $$
  SELECT team_id, batch_id, mad_id, team_name, brokerage, location,
         website_url, web_valid, verify_error
  FROM staging.teams
  WHERE batch_id = p_batch_id
  ORDER BY team_id;
$$;

CREATE OR REPLACE FUNCTION public.ce_update_batch_status(p_batch_id uuid, p_status text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = staging, public AS $$
  UPDATE staging.batches SET status = p_status WHERE batch_id = p_batch_id;
$$;

CREATE OR REPLACE FUNCTION public.ce_update_team_website(p_team_id uuid, p_website_url text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = staging, public AS $$
  UPDATE staging.teams SET website_url = p_website_url WHERE team_id = p_team_id;
$$;

CREATE OR REPLACE FUNCTION public.ce_update_team_web_valid(p_team_id uuid, p_web_valid boolean, p_verify_error text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = staging, public AS $$
  UPDATE staging.teams
  SET web_valid = p_web_valid, verify_error = p_verify_error
  WHERE team_id = p_team_id;
$$;
