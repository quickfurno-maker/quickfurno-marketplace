-- Phase 3B22: READ ONLY digest witness for managed Staging + restored clone.
-- No UUIDs or raw PII returned; timezone is UTC for canonical JSONB timestamptz.
-- One READ ONLY transaction, nothing changed on the managed instance.
-- Verification read only, four protected families, no raw rows output.
-- SHA256 computed over sorted row JSONB text; session timezone pinned to UTC.
BEGIN READ ONLY;
SET LOCAL TIME ZONE 'UTC';
WITH ids AS (
 SELECT id::text s FROM public.vendors WHERE lower(trim(coalesce(city,''))) IN ('pune','mumbai')
 UNION SELECT id::text FROM public.leads WHERE lower(trim(coalesce(city,''))) IN ('pune','mumbai')
 UNION SELECT a.id::text FROM public.lead_assignments a
 WHERE a.vendor_id IN (SELECT id FROM public.vendors WHERE lower(trim(coalesce(city,''))) IN ('pune','mumbai'))
 OR a.lead_id IN (SELECT id FROM public.leads WHERE lower(trim(coalesce(city,''))) IN ('pune','mumbai'))
), pat AS (SELECT string_agg(s,'|' ORDER BY s) AS p FROM ids),
scoped AS (
 SELECT 'immutable_assignment_events' AS family,to_jsonb(e)::text AS canonical
 FROM public.lead_assignment_events e WHERE e.vendor_id IN (SELECT id FROM public.vendors WHERE lower(trim(coalesce(city,''))) IN ('pune','mumbai'))
 OR e.lead_id IN (SELECT id FROM public.leads WHERE lower(trim(coalesce(city,''))) IN ('pune','mumbai'))
 UNION ALL SELECT 'frozen_campaign_audiences',to_jsonb(x)::text FROM public.vendor_campaign_audience_members x WHERE x.vendor_id IN (SELECT id FROM public.vendors WHERE lower(trim(coalesce(city,''))) IN ('pune','mumbai'))
 UNION ALL SELECT 'append_only_vendor_notes',to_jsonb(x)::text FROM public.vendor_internal_notes x WHERE x.vendor_id IN (SELECT id FROM public.vendors WHERE lower(trim(coalesce(city,''))) IN ('pune','mumbai'))
 UNION ALL SELECT 'automation_action_requests',to_jsonb(x)::text FROM public.automation_action_requests x WHERE to_jsonb(x)::text ~* (SELECT p FROM pat)
)
SELECT family,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(canonical,E'\n' ORDER BY canonical),''),'UTF8')),'hex') AS digest FROM scoped GROUP BY family ORDER BY family;
ROLLBACK;
