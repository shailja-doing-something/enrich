-- Returns the total number of teams in batches that have completed enrichment
CREATE OR REPLACE FUNCTION public.ce_count_enriched_teams()
RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = staging, public AS $$
  SELECT COUNT(t.team_id)
  FROM staging.teams t
  JOIN staging.batches b ON t.batch_id = b.batch_id
  WHERE b.status = 'complete';
$$;
