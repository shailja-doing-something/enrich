-- Company enrichment: ensure staging.batches + staging.teams exist,
-- add mad_id to staging.teams, and create public RPC wrappers so
-- the app can write/read staging schema without exposing it via PostgREST.
-- SECURITY DEFINER lets each function bypass RLS and access staging internally.

CREATE SCHEMA IF NOT EXISTS staging;

CREATE TABLE IF NOT EXISTS staging.batches (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  uploaded_at timestamptz DEFAULT now() NOT NULL,
  row_count   int         NOT NULL,
  status      text        NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS staging.teams (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id    uuid        NOT NULL REFERENCES staging.batches(id) ON DELETE CASCADE,
  team_name   text,
  brokerage   text,
  location    text,
  website     text,
  zillow_match text,
  verified_url text,
  status      text        NOT NULL DEFAULT 'pending'
);

ALTER TABLE staging.teams ADD COLUMN IF NOT EXISTS mad_id text;

-- ── RPC wrappers ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ce_create_batch(p_row_count int)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = staging, public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO staging.batches (uploaded_at, row_count, status)
  VALUES (now(), p_row_count, 'pending')
  RETURNING id INTO v_id;
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
RETURNS TABLE(id uuid, uploaded_at timestamptz, row_count int, status text)
LANGUAGE sql SECURITY DEFINER SET search_path = staging, public AS $$
  SELECT id, uploaded_at, row_count, status
  FROM staging.batches
  ORDER BY uploaded_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.ce_get_batch_teams(p_batch_id uuid)
RETURNS TABLE(
  id          uuid,
  batch_id    uuid,
  mad_id      text,
  team_name   text,
  brokerage   text,
  location    text,
  website     text,
  zillow_match text,
  verified_url text,
  status      text
)
LANGUAGE sql SECURITY DEFINER SET search_path = staging, public AS $$
  SELECT id, batch_id, mad_id, team_name, brokerage, location,
         website, zillow_match, verified_url, status
  FROM staging.teams
  WHERE batch_id = p_batch_id
  ORDER BY id;
$$;

CREATE OR REPLACE FUNCTION public.ce_update_batch_status(p_batch_id uuid, p_status text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = staging, public AS $$
  UPDATE staging.batches SET status = p_status WHERE id = p_batch_id;
$$;

CREATE OR REPLACE FUNCTION public.ce_update_team_website(p_team_id uuid, p_website text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = staging, public AS $$
  UPDATE staging.teams SET website = p_website WHERE id = p_team_id;
$$;

CREATE OR REPLACE FUNCTION public.ce_update_team_verified_url(p_team_id uuid, p_verified_url text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = staging, public AS $$
  UPDATE staging.teams SET verified_url = p_verified_url WHERE id = p_team_id;
$$;
