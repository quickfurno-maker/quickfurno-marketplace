begin;

-- QuickFurno audit hardening (2026-09-21).
-- This migration changes no business data and grants no new browser authority.
-- It removes redundant browser EXECUTE exposure from SECURITY DEFINER helpers/
-- trigger functions and drops three byte-identical duplicate indexes.

-- RLS helper functions remain executable by authenticated users because active
-- policies depend on them, but PUBLIC/anon may not invoke them directly.
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

revoke execute on function public.owns_vendor(uuid) from public, anon;
grant execute on function public.owns_vendor(uuid) to authenticated, service_role;

-- Trigger functions are not RPC surfaces. Runtime trigger firing does not need
-- browser EXECUTE privileges, so remove them from every untrusted role.
revoke execute on function public.qf_produce_campaign_recipient_action()
  from public, anon, authenticated;
grant execute on function public.qf_produce_campaign_recipient_action()
  to service_role;

revoke execute on function public.qf_produce_vendor_low_credit_warning()
  from public, anon, authenticated;
grant execute on function public.qf_produce_vendor_low_credit_warning()
  to service_role;
revoke execute on function public.qf_produce_vendor_onboarding_reminder()
  from public, anon, authenticated;
grant execute on function public.qf_produce_vendor_onboarding_reminder()
  to service_role;

revoke execute on function public.qf_produce_vendor_package_expiry_warnings()
  from public, anon, authenticated;
grant execute on function public.qf_produce_vendor_package_expiry_warnings()
  to service_role;

-- These are exact duplicates of the retained indexes:
--   idx_vendor_dashboard_users_vendor (vendor_id)
--   idx_vendors_city (city)
--   idx_vendors_status (status)
drop index if exists public.idx_vendor_dashboard_users_vendor_id;
drop index if exists public.vendors_city_idx;
drop index if exists public.vendors_status_idx;

do $$
begin
  if has_function_privilege('anon', 'public.is_admin()', 'EXECUTE')
     or has_function_privilege('anon', 'public.owns_vendor(uuid)', 'EXECUTE') then
    raise exception 'QF audit hardening: anon still executes RLS helpers';
  end if;

  if not has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.owns_vendor(uuid)', 'EXECUTE') then
    raise exception 'QF audit hardening: authenticated RLS helper execution lost';
  end if;
  if has_function_privilege('anon', 'public.qf_produce_campaign_recipient_action()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.qf_produce_campaign_recipient_action()', 'EXECUTE')
     or has_function_privilege('anon', 'public.qf_produce_vendor_low_credit_warning()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.qf_produce_vendor_low_credit_warning()', 'EXECUTE')
     or has_function_privilege('anon', 'public.qf_produce_vendor_onboarding_reminder()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.qf_produce_vendor_onboarding_reminder()', 'EXECUTE')
     or has_function_privilege('anon', 'public.qf_produce_vendor_package_expiry_warnings()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.qf_produce_vendor_package_expiry_warnings()', 'EXECUTE') then
    raise exception 'QF audit hardening: trigger function remains browser executable';
  end if;

  if to_regclass('public.idx_vendor_dashboard_users_vendor_id') is not null
     or to_regclass('public.vendors_city_idx') is not null
     or to_regclass('public.vendors_status_idx') is not null then
    raise exception 'QF audit hardening: duplicate index still present';
  end if;

  if to_regclass('public.idx_vendor_dashboard_users_vendor') is null
     or to_regclass('public.idx_vendors_city') is null
     or to_regclass('public.idx_vendors_status') is null then
    raise exception 'QF audit hardening: retained index missing';
  end if;
end
$$;

commit;
