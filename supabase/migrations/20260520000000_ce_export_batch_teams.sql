CREATE OR REPLACE FUNCTION public.ce_export_batch_teams(p_batch_id uuid)
RETURNS TABLE(
  mad_id       text,
  team_name    text,
  brokerage    text,
  location     text,
  website_url  text,
  web_valid    boolean,
  zillow_url   text,
  zillow_valid boolean,
  verify_error text
)
LANGUAGE sql SECURITY DEFINER SET search_path = staging, public AS $$
  SELECT mad_id, team_name, brokerage, location, website_url, web_valid,
         zillow_url, zillow_valid, verify_error
  FROM staging.teams
  WHERE batch_id = p_batch_id
  ORDER BY team_name;
$$;
