-- VOX P0-6 read-only managed-Staging preflight.
-- SELECT-only. No DDL/DML. Intended for operator evidence before an authorized apply.
select
  current_database() as database_name,
  p.oid::regprocedure::text as function_name,
  p.prosecdef as security_definer,
  p.provolatile as volatility,
  p.proconfig as function_config,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('public', p.oid, 'EXECUTE') as public_execute,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'is_admin'
  and p.pronargs = 0;

select
  count(*) filter (where uses_is_admin) as is_admin_policy_count,
  count(*) filter (where uses_owns_vendor) as owns_vendor_policy_count,
  count(*) filter (where uses_is_admin or uses_owns_vendor) as helper_union_count
from (
  select
    ((coalesce(qual,'') || ' ' || coalesce(with_check,'')) ilike '%is_admin%') as uses_is_admin,
    ((coalesce(qual,'') || ' ' || coalesce(with_check,'')) ilike '%owns_vendor%') as uses_owns_vendor
  from pg_policies
  where schemaname = 'public'
) p;
