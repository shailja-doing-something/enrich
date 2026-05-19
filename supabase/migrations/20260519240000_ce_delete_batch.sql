-- Deletes a batch and all its associated staging data (teams, agents, pipeline_log).
-- Cascades in order to satisfy FK constraints.
-- Returns true if the batch was found and deleted; false if batch_id did not exist.
-- DROP required because return type changed from void → boolean.
DROP FUNCTION IF EXISTS public.ce_delete_batch(uuid);

CREATE OR REPLACE FUNCTION public.ce_delete_batch(p_batch_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = staging, public AS $$
DECLARE
  v_found boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM staging.batches WHERE batch_id = p_batch_id
  ) INTO v_found;

  IF NOT v_found THEN
    RETURN false;
  END IF;

  DELETE FROM staging.pipeline_log WHERE batch_id = p_batch_id;
  DELETE FROM staging.agents        WHERE batch_id = p_batch_id;
  DELETE FROM staging.teams         WHERE batch_id = p_batch_id;
  DELETE FROM staging.batches       WHERE batch_id = p_batch_id;

  RETURN true;
END;
$$;
