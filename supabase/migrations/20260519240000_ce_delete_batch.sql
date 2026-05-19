-- Deletes a batch and all its associated staging data (teams, agents, pipeline_log).
-- Cascades in order to satisfy FK constraints.

CREATE OR REPLACE FUNCTION public.ce_delete_batch(p_batch_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = staging, public AS $$
BEGIN
  DELETE FROM staging.pipeline_log WHERE batch_id = p_batch_id;
  DELETE FROM staging.agents WHERE batch_id = p_batch_id;
  DELETE FROM staging.teams WHERE batch_id = p_batch_id;
  DELETE FROM staging.batches WHERE batch_id = p_batch_id;
END;
$$;
