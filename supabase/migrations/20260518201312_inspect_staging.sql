CREATE OR REPLACE FUNCTION public.ce_inspect_staging()
RETURNS TABLE(table_name text, column_name text, data_type text, ordinal_position int)
LANGUAGE sql SECURITY DEFINER SET search_path = staging, public AS $$
  SELECT table_name::text, column_name::text, data_type::text, ordinal_position::int
  FROM information_schema.columns
  WHERE table_schema = 'staging'
    AND table_name IN ('batches', 'teams')
  ORDER BY table_name, ordinal_position;
$$;
