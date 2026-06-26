-- find_zillow_by_website: normalize both sides (strip scheme, www, trailing slash)
-- and match against website_url in zillow_agent_profiles.
CREATE OR REPLACE FUNCTION public.find_zillow_by_website(p_website text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = staging, public
AS $$
  SELECT to_jsonb(z.*)
  FROM staging.zillow_agent_profiles z
  WHERE z.website_url IS NOT NULL
    AND z.website_url <> ''
    AND lower(rtrim(regexp_replace(regexp_replace(z.website_url, '^https?://(www\.)?', '', 'i'), '/$', ''), '/'))
      = lower(rtrim(regexp_replace(regexp_replace(p_website,      '^https?://(www\.)?', '', 'i'), '/$', ''), '/'))
  LIMIT 1;
$$;

-- find_zillow_by_phone_name: exact phone match (digits only) across all three
-- phone columns, filtered by case-insensitive full_name substring match.
CREATE OR REPLACE FUNCTION public.find_zillow_by_phone_name(p_phone text, p_name text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = staging, public
AS $$
  SELECT to_jsonb(z.*)
  FROM staging.zillow_agent_profiles z
  WHERE (
    regexp_replace(z.phone_cell,      '\D', '', 'g') = p_phone OR
    regexp_replace(z.phone_business,  '\D', '', 'g') = p_phone OR
    regexp_replace(z.phone_brokerage, '\D', '', 'g') = p_phone
  )
    AND z.full_name ILIKE '%' || p_name || '%'
  LIMIT 1;
$$;
