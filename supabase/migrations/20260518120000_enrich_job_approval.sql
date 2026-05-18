-- Add approval columns to enrich_jobs for the handoff-based pipeline flow.
-- The enrichment pipeline now stops at user approval; downstream processing
-- is handled by a separate architecture pending new pipeline integration.
--
-- approval_status: 'approved' | null — set when the user approves the mapping
-- approved_at: timestamp of approval — used for audit and handoff ordering

ALTER TABLE enrich_jobs
  ADD COLUMN IF NOT EXISTS approval_status text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;
