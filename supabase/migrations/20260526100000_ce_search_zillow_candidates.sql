-- Returns Zillow profiles from the local staging table for app-side scoring.
-- Called by findZillowUrl before falling back to the external Zillow API.
-- p_is_team=true → only team records; p_is_team=false → all records in state.
CREATE OR REPLACE FUNCTION public.ce_search_zillow_candidates(
  p_state    text,
  p_is_team  boolean DEFAULT true
)
RETURNS TABLE (
  profile_link       text,
  full_name          text,
  team_name          text,
  business_name      text,
  address_state      text,
  address_city       text,
  is_team            boolean,
  team_member_count  integer
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    profile_link,
    full_name,
    team_name,
    business_name,
    address_state,
    address_city,
    is_team,
    team_member_count
  FROM staging.zillow_agent_profiles
  WHERE address_state = p_state
    AND (p_is_team IS NULL OR is_team = p_is_team)
  LIMIT 2000;
$$;
