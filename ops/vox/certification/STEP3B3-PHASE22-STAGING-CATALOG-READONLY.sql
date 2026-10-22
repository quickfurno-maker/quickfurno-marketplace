-- Step 3B-3; SELECT-only catalog preflight. NO managed database changes.
select jsonb_build_object(
 'project_target','QuickFurno Staging',
 'phase22_version_applied',exists(select 1 from supabase_migrations.schema_migrations where version='20261006113720'),
 'existing_dependencies',jsonb_build_object(
   'profiles',to_regclass('public.profiles') is not null,
   'client_accounts',to_regclass('public.client_accounts') is not null,
   'vendor_dashboard_users',to_regclass('public.vendor_dashboard_users') is not null,
   'cities',to_regclass('public.cities') is not null,
   'auth_users',to_regclass('auth.users') is not null),
 'phase22_tables',jsonb_build_object(
   'identity_principals',to_regclass('public.identity_principals') is not null,
   'identity_provider_identities',to_regclass('public.identity_provider_identities') is not null,
   'identity_business_bindings',to_regclass('public.identity_business_bindings') is not null,
   'identity_admin_roles',to_regclass('public.identity_admin_roles') is not null),
 'auth_users_count',(select count(*) from auth.users),
 'verified_mfa_count',(select count(*) from auth.mfa_factors where status='verified'),
 'auth_onboarding_trigger_enabled',exists(
   select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
   join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='auth' and c.relname='users'
   and t.tgname='on_auth_user_created' and t.tgenabled='O' and not t.tgisinternal),
 'handle_new_user_security_definer',coalesce((
   select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='handle_new_user'),false),
 'handle_new_user_anon_executable',has_function_privilege('anon','public.handle_new_user()','EXECUTE'),
 'handle_new_user_authenticated_executable',has_function_privilege('authenticated','public.handle_new_user()','EXECUTE'),
 'current_rls',(
   select jsonb_object_agg(c.relname,c.relrowsecurity)
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname in
    ('profiles','client_accounts','vendor_dashboard_users')),
 'zero_managed_ddl_by_this_statement',true
) as phase22_preflight;
