-- QF Batch 9 - PRE-MIGRATION vendor baseline inventory, NO remote execution.
-- This script uses EXISTING Core tables only. It intentionally never
-- references qf_vendor_private, scan receipts or a new RPC that cannot exist
-- before the source-only migrations are reviewed and approved.
-- Read-only aggregates: no vendor phone, name, address or ID is printed.
-- RUN MANUALLY IN AUTHORIZED STAGING ONLY after separate Owner approval.
begin transaction isolation level repeatable read read only;
set local statement_timeout='20s';
set local lock_timeout='3s';

select 'preexisting_vendor_count' as check_name,
  count(*)::text as observed,'BASELINE_COUNTS_ONLY' as meaning
from public.vendors;

select 'legacy_active_or_lead_eligible_vendors' as check_name,
  count(*)::text as observed,
  'MUST_HAVE_APPROVED_COMPATIBILITY_AND_VERIFICATION_PLAN' as meaning
from public.vendors v
where v.is_active is true or v.accepting_leads is true
   or v.public_visibility is true;

select 'vendors_with_noncanonical_10_digit_mobile' as check_name,
  count(*)::text as observed,
  'REVIEW_WITHOUT_AUTO_MERGE_OR_ACCOUNT_ADOPTION' as meaning
from public.vendors v
where v.phone is null or v.phone !~ '^[6-9][0-9]{9}$';

select 'duplicate_canonical_vendor_phone_groups' as check_name,
  count(*)::text as observed,
  'MUST_BE_ZERO_BEFORE_ANY_SIGNUP_ENABLEMENT' as meaning
from (
 select phone from public.vendors
  where phone ~ '^[6-9][0-9]{9}$'
 group by phone having count(*)>1
) collisions;

select 'active_vendor_owner_membership_mismatches' as check_name,
  count(distinct v.id)::text as observed,
  'REVIEW_IDENTITY_MAPPING_WITHOUT_REASSIGNMENT' as meaning
from public.vendors v
join public.vendor_dashboard_users m
 on m.vendor_id=v.id and m.role='owner' and m.status='active'
where v.user_id is distinct from m.user_id;

select 'vendor_and_client_shared_auth_principals' as check_name,
  count(distinct v.id)::text as observed,
  'MUST_BE_INVESTIGATED_BEFORE_PUBLIC_SIGNUP' as meaning
from public.vendors v
join public.client_accounts c on c.user_id=v.user_id
where v.user_id is not null;

select 'pending_vendors_with_live_flags' as check_name,
  count(*)::text as observed,
  'MUST_BE_ZERO_BEFORE_SIGNUP_ENABLEMENT' as meaning
from public.vendors v
where v.status='Pending'
 and (v.is_active is true or v.accepting_leads is true
   or v.public_visibility is true);

select 'historical_assignment_vendor_population' as check_name,
  count(distinct a.vendor_id)::text as observed,
  'DO_NOT_APPLY_UNIVERSAL_NEW_ASSIGNMENT_GATE_WITHOUT_EXPLICIT_ADOPTION_PLAN' as meaning
from public.lead_assignments a
where a.vendor_id is not null
 and a.lifecycle_status in ('assigned','delivered','accepted');

select 'private_case_schema_already_present' as check_name,
  (to_regclass('qf_vendor_private.verification_cases') is not null)::text as observed,
  'RECONCILE_IF_TRUE_DO_NOT_BLINDLY_REPLAY_SOURCE_MIGRATIONS' as meaning;

select 'managed_migration_history_present' as check_name,
  (to_regclass('supabase_migrations.schema_migrations') is not null)::text as observed,
  'REVIEW_EXACT_VERSIONS_AND_CANONICAL_HASHES_OUTSIDE_THIS_READ_ONLY_SCRIPT' as meaning;

rollback;
