-- Fix ce_insert_agents_bulk:
-- 1. Accept agents with name OR email (was email-only, dropping all Zillow-scraped name-only agents)
-- 2. Add ON CONFLICT DO NOTHING so duplicate (team_id, first_name, last_name) entries are skipped
-- 3. Return actual inserted count (was void)
DROP FUNCTION IF EXISTS public.ce_insert_agents_bulk(jsonb);

CREATE OR REPLACE FUNCTION public.ce_insert_agents_bulk(p_agents jsonb)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = staging, public AS $$
DECLARE
  v_inserted int;
BEGIN
  WITH ins AS (
    INSERT INTO staging.agents (
      batch_id, team_id, first_name, last_name,
      email, phone, designation, source
    )
    SELECT
      (a->>'batch_id')::uuid,
      (a->>'team_id')::uuid,
      NULLIF(trim(a->>'first_name'), ''),
      NULLIF(trim(a->>'last_name'), ''),
      NULLIF(trim(a->>'email'), ''),
      NULLIF(trim(a->>'phone'), ''),
      NULLIF(trim(a->>'designation'), ''),
      a->>'source'
    FROM jsonb_array_elements(p_agents) a
    WHERE (
      (a->>'first_name' IS NOT NULL AND trim(a->>'first_name') <> '')
      OR (a->>'last_name' IS NOT NULL AND trim(a->>'last_name') <> '')
      OR (a->>'email' IS NOT NULL AND trim(a->>'email') <> '')
    )
    ON CONFLICT (team_id, COALESCE(lower(first_name),''), COALESCE(lower(last_name),''))
    DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;
  RETURN v_inserted;
END;
$$;
