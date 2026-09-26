begin;

-- Remove browser RPC exposure from internal trigger/event-trigger functions.
-- The functions continue to execute through their database trigger authority.
do $$
begin
  if to_regprocedure('public.qf_produce_vendor_assignment_actions()') is not null then
    execute 'revoke execute on function public.qf_produce_vendor_assignment_actions() from public, anon, authenticated';
    execute 'grant execute on function public.qf_produce_vendor_assignment_actions() to service_role';
  end if;

  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
    execute 'grant execute on function public.rls_auto_enable() to service_role';
  end if;
end
$$;

do $$
begin
  if to_regprocedure('public.qf_produce_vendor_assignment_actions()') is not null
     and (
       has_function_privilege('anon', 'public.qf_produce_vendor_assignment_actions()', 'EXECUTE')
       or has_function_privilege('authenticated', 'public.qf_produce_vendor_assignment_actions()', 'EXECUTE')
     ) then
    raise exception 'QF audit RPC hardening: assignment trigger remains browser executable';
  end if;

  if to_regprocedure('public.rls_auto_enable()') is not null
     and (
       has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE')
       or has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE')
     ) then
    raise exception 'QF audit RPC hardening: RLS event trigger remains browser executable';
  end if;
end
$$;

commit;
