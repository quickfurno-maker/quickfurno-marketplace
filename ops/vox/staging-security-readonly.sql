-- Read-only staging catalog verification. Never contains or returns vendor PII.
-- Must return exactly one row with EVERY *_ok = true before risk review.
WITH cols AS (
 SELECT array_agg(a.attname::text ORDER BY a.attnum) AS names
 FROM pg_attribute a WHERE a.attrelid='public.vendor_public_v'::regclass
 AND a.attnum>0 AND NOT a.attisdropped
), listing AS (
 SELECT pg_get_viewdef('public.vendor_public_v'::regclass,true) AS definition
)
SELECT
 (SELECT names FROM cols)=ARRAY[
 'id','business_name','city','office_city','areas_covered','covers_full_city',
 'service_categories','selected_subcategories','selected_category','business_type',
 'experience','years_experience','starting_price','public_description',
 'public_service_area_summary','public_business_hours','profile_image_url',
 'cover_image_url','portfolio_urls','rating','completed_projects']::text[] AS allowlist_ok,
 NOT has_table_privilege('anon','public.vendors','SELECT') AS anon_private_table_denied_ok,
 has_table_privilege('anon','public.vendor_public_v','SELECT') AS public_listing_works_ok,
 NOT has_table_privilege('anon','public.vendor_public_v','UPDATE') AS public_listing_writes_denied_ok,
 NOT has_schema_privilege('anon','public','CREATE') AS anon_cannot_create_in_public_ok,
 NOT has_schema_privilege('authenticated','public','CREATE') AS auth_cannot_create_in_public_ok,
 NOT has_function_privilege('anon','public.is_admin()','EXECUTE') AS anon_admin_rpc_denied_ok,
 NOT has_function_privilege('anon','public.owns_vendor(uuid)','EXECUTE') AS anon_vendor_rpc_denied_ok,
 (SELECT strpos(lower(definition),'''approved''')>0
  AND strpos(lower(definition),'is_active = true')>0
  AND strpos(lower(definition),'public_visibility = true')>0
  AND strpos(lower(definition),'remaining_credits > 0')>0 FROM listing) AS listing_filter_present_ok;
