-- QuickFurno vendor-registration controlled Staging PRE-FLIGHT TEMPLATE.
-- READ ONLY, no PII rows, no deletes, no migrations, no storage writes.
-- Run against an approved, authenticated Staging psql session ONLY after
-- a separate Owner rollout authorization. Not executed on managed DB here.
-- These are COUNTS / FLAGS, not an automatic release approval.
begin transaction isolation level repeatable read read only;
set local statement_timeout='20s';
set local lock_timeout='3s';

select 'canonical_vendor_phone_duplicate_groups' as check_name,
       count(*)::text as observed,
       'MUST_BE_ZERO_BEFORE_APPLY' as meaning
from (
 select phone from public.vendors
 where phone ~ '^[6-9][0-9]{9}$'
 group by phone having count(*)>1
) grouped;

select 'verified_vendor_auth_owner_collisions' as check_name,
       count(*)::text as observed,
       'MUST_BE_ZERO_BEFORE_PUBLIC_ONBOARDING' as meaning
from public.vendors v
join public.vendor_dashboard_users m on m.vendor_id=v.id
where v.user_id is not null
  and m.role='owner' and m.status='active'
  and m.user_id is distinct from v.user_id;

select 'cross_client_vendor_principal_collisions' as check_name,
       count(distinct v.id)::text as observed,
       'REQUIRES_OWNER_INVESTIGATION' as meaning
from public.vendors v
join public.client_accounts c on c.user_id=v.user_id
where v.user_id is not null;

select 'pending_vendor_mistakenly_active' as check_name,
       count(*)::text as observed,
       'MUST_BE_ZERO_BEFORE_PUBLIC_ONBOARDING' as meaning
from public.vendors v where v.status='Pending'
 and (v.is_active is true
   or v.accepting_leads is true or v.public_visibility is true);

select 'latest_unapproved_private_cases' as check_name,
       count(*)::text as observed,
       'OWNER_REVIEW_BACKLOG_ONLY' as meaning
from qf_vendor_private.verification_cases c
where c.case_version=(select max(v.case_version)
 from qf_vendor_private.verification_cases v where v.vendor_id=c.vendor_id)
 and c.state<>'approved';

select 'pending_unscanned_private_evidence' as check_name,
       count(*)::text as observed,
       'MALWARE_SCAN_PROVIDER_REQUIRED' as meaning
from qf_vendor_private.verification_evidence e
where e.scan_status='pending';

select 'private_queue_browser_execute' as check_name,
       (has_function_privilege('anon',
         'public.qf_vox_owner_vendor_review_queue()','EXECUTE')
        or has_function_privilege('authenticated',
         'public.qf_vox_owner_vendor_review_queue()','EXECUTE'))::text as observed,
       'MUST_BE_FALSE' as meaning;

select 'private_upload_rpc_browser_execute' as check_name,
       (has_function_privilege('anon',
         'public.qf_vendor_attach_private_evidence(uuid,uuid,uuid,text,text,text)','EXECUTE')
        or has_function_privilege('authenticated',
         'public.qf_vendor_attach_private_evidence(uuid,uuid,uuid,text,text,text)','EXECUTE'))::text as observed,
       'MUST_BE_FALSE' as meaning;

select 'storage_bucket_schema_present' as check_name,
       (to_regclass('storage.buckets') is not null)::text as observed,
       'PRIVATE_ACL_AND_RETENTION_REQUIRE_SEPARATE_APPROVED_EVIDENCE' as meaning;

select 'managed_migration_history_present' as check_name,
       (to_regclass('supabase_migrations.schema_migrations') is not null)::text as observed,
       'REVIEW_EXACT_VERSIONS_BEFORE_APPLY' as meaning;

-- The presence of metadata DOES NOT certify private bucket policies, scan
-- workers, Auth Hook, Meta template approval or cloud edge authorization.
-- No source-only or synthetic test can independently establish those gates.
rollback;
