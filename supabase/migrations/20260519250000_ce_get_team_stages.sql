CREATE OR REPLACE FUNCTION public.ce_get_team_stages(p_batch_id uuid)
RETURNS TABLE(
  team_id      uuid,
  team_name    text,
  pipeline_stage text,
  web_valid    boolean,
  zillow_valid boolean,
  zillow_url   text,
  website_url  text
)
LANGUAGE sql SECURITY DEFINER SET search_path = staging, public AS $$
  SELECT team_id, team_name, pipeline_stage, web_valid, zillow_valid, zillow_url, website_url
  FROM staging.teams
  WHERE batch_id = p_batch_id
  ORDER BY team_name;
$$;
