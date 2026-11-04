-- QF3B18 read-only inventory for DBA and Auth administrator.
-- NEVER attach this to a migration; no account deletion, PII or row IDs output.
-- Project ref yqpgcsduqbxulrlzwzap. Run only in separately approved SELECT scope.
SELECT 'public.vendors' AS object_name,COUNT(*) AS source_rows FROM public.vendors
UNION ALL SELECT 'public.leads',COUNT(*) FROM public.leads
UNION ALL SELECT 'public.lead_assignments',COUNT(*) FROM public.lead_assignments
UNION ALL SELECT 'public.lead_assignment_events',COUNT(*) FROM public.lead_assignment_events
UNION ALL SELECT 'public.vendor_credit_logs',COUNT(*) FROM public.vendor_credit_logs
UNION ALL SELECT 'auth.users',COUNT(*) FROM auth.users
UNION ALL SELECT 'auth.identities',COUNT(*) FROM auth.identities
UNION ALL SELECT 'auth.sessions',COUNT(*) FROM auth.sessions
UNION ALL SELECT 'storage.objects',COUNT(*) FROM storage.objects
ORDER BY object_name;

SELECT
 (SELECT COUNT(DISTINCT v.user_id) FROM public.vendors v WHERE v.user_id IS NOT NULL)
   AS linked_vendor_auth_users,
 (SELECT COUNT(*) FROM auth.users u WHERE u.id NOT IN
  (SELECT v.user_id FROM public.vendors v WHERE v.user_id IS NOT NULL))
   AS non_vendor_auth_users,
 (SELECT COUNT(*) FROM auth.sessions s WHERE s.user_id IN
  (SELECT v.user_id FROM public.vendors v WHERE v.user_id IS NOT NULL))
   AS linked_vendor_sessions,
 (SELECT COUNT(*) FROM auth.identities i WHERE i.user_id IN
  (SELECT v.user_id FROM public.vendors v WHERE v.user_id IS NOT NULL))
   AS linked_vendor_identities,
 (SELECT COUNT(*) FROM public.profiles p WHERE p.id IN
  (SELECT v.user_id FROM public.vendors v WHERE v.user_id IS NOT NULL))
   AS linked_vendor_profiles;

-- Detect changes to the protected append-only trigger policy.
SELECT c.relname AS table_name,t.tgname AS trigger_name,t.tgenabled AS enabled,
  pg_get_triggerdef(t.oid,true) AS definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
WHERE NOT t.tgisinternal AND t.tgrelid='public.lead_assignment_events'::regclass
ORDER BY t.tgname;

SELECT p.proname AS function_name,pg_get_functiondef(p.oid) AS body
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
 ('qf_prevent_lead_assignment_event_mutation',
  'qf_prevent_lead_assignment_event_truncate')
ORDER BY p.proname;

-- Full Supabase restore MUST account for these exact installed versions.
SELECT extname,extversion,extnamespace::regnamespace::text AS schema_name
FROM pg_extension ORDER BY extname;

-- Inventory potential authorization/cross-app references without revealing user IDs.
SELECT table_name,column_name,data_type
FROM information_schema.columns
WHERE table_schema='public'
 AND (column_name IN ('user_id','owner_id','created_by','approved_by',
   'reviewed_by','staff_id','admin_id','auth_user_id','actor_user_id','admin_user_id')
   OR column_name LIKE '%_user_id')
 AND data_type IN ('uuid','text','character varying')
ORDER BY table_name,column_name;
