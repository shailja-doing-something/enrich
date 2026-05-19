CREATE OR REPLACE FUNCTION public.ce_get_batch_detail(p_batch_id uuid)
RETURNS TABLE(
  batch_id uuid, source_file text, stage text, status text,
  created_at timestamptz, total_rows integer,
  total_teams bigint, website_processed bigint, website_found bigint,
  zillow_processed bigint, zillow_found bigint,
  qa_processed bigint, verified_count bigint,
  contacts_processed bigint, contacts_done bigint,
  contact_skipped bigint, contacts_failed bigint,
  web_valid_count bigint, zillow_valid_count bigint, agents_count bigint
)
LANGUAGE sql SECURITY DEFINER SET search_path = staging, public AS $$
  SELECT
    b.batch_id, b.source_file, b.current_stage AS stage, b.status, b.created_at, b.total_rows,
    -- total teams in this batch
    COUNT(t.team_id),
    -- website_processed: teams that have been through the website-finder stage
    COUNT(*) FILTER (WHERE t.pipeline_stage IN ('website_found','website_not_found','zillow_found','zillow_not_found','verified','contacts_done','contact_skipped','contacts_failed')),
    -- website_found: teams that actually have a website URL (column truth, not stage inference)
    COUNT(*) FILTER (WHERE t.website_url IS NOT NULL),
    -- zillow_processed: teams that have been through the zillow-lookup stage
    COUNT(*) FILTER (WHERE t.pipeline_stage IN ('zillow_found','zillow_not_found','verified','contacts_done','contact_skipped','contacts_failed')),
    -- zillow_found: teams that actually have a zillow URL (column truth, not stage inference)
    COUNT(*) FILTER (WHERE t.zillow_url IS NOT NULL),
    -- qa_processed: teams that have reached the verified stage or later
    COUNT(*) FILTER (WHERE t.pipeline_stage IN ('verified','contacts_done','contact_skipped','contacts_failed')),
    -- verified_count: teams with at least one valid data source
    COUNT(*) FILTER (WHERE t.web_valid = true OR t.zillow_valid = true),
    -- contacts pipeline
    COUNT(*) FILTER (WHERE t.pipeline_stage IN ('contacts_done','contact_skipped','contacts_failed')),
    COUNT(*) FILTER (WHERE t.pipeline_stage = 'contacts_done'),
    COUNT(*) FILTER (WHERE t.pipeline_stage = 'contact_skipped'),
    COUNT(*) FILTER (WHERE t.pipeline_stage = 'contacts_failed'),
    -- raw valid counts
    COUNT(*) FILTER (WHERE t.web_valid = true),
    COUNT(*) FILTER (WHERE t.zillow_valid = true),
    -- agents inserted for this batch
    (SELECT COUNT(a.agent_id) FROM staging.agents a WHERE a.batch_id = b.batch_id)
  FROM staging.batches b
  LEFT JOIN staging.teams t ON t.batch_id = b.batch_id
  WHERE b.batch_id = p_batch_id
  GROUP BY b.batch_id, b.source_file, b.current_stage, b.status, b.created_at, b.total_rows;
$$;
