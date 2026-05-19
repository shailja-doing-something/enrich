-- Zillow profile lookup RPC and team zillow update helper.
-- Queries staging.zillow_profiles (30k rows) to find a team's Zillow URL by name.

CREATE OR REPLACE FUNCTION public.ce_find_zillow_url(p_team_name text)
RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = staging, public AS $$
  SELECT profile_link
  FROM staging.zillow_profiles
  WHERE is_team = true
    AND (
      lower(trim(team_name)) = lower(trim(p_team_name))
      OR lower(trim(business_name)) = lower(trim(p_team_name))
    )
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.ce_update_team_zillow(
  p_team_id    uuid,
  p_zillow_url text,
  p_zillow_valid boolean
)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = staging, public AS $$
  UPDATE staging.teams
  SET zillow_url = p_zillow_url,
      zillow_valid = p_zillow_valid,
      updated_at = now()
  WHERE team_id = p_team_id;
$$;
