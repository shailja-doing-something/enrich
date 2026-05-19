-- Returns the number of teams that have truly completed enrichment:
-- - batch must be complete (status = 'complete') or done (legacy status = 'done')
-- - team must have reached the verified or contacts_done pipeline stage

CREATE OR REPLACE FUNCTION public.ce_count_enriched_teams()
RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = staging, public AS $$
  SELECT COUNT(t.team_id)
  FROM staging.teams t
  JOIN staging.batches b ON t.batch_id = b.batch_id
  WHERE (b.status = 'complete' OR b.status = 'done')
    AND t.pipeline_stage IN ('verified', 'contacts_done');
$$;
