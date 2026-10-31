-- pg17 synthetic structural regression. NOT a certification of the Core write path.
\set ON_ERROR_STOP on
DO $$
DECLARE t text;
BEGIN
 foreach t in array array[
 'vox_staff_department_requests_v1',
 'vox_staff_department_decisions_v1',
 'vox_staff_department_capabilities_v1',
 'vox_staff_department_activations_v1',
 'vox_staff_department_events_v1'] loop
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=t and c.relrowsecurity and c.relforcerowsecurity)
   then raise exception 'VOX_RLS_MISSING_%',t; end if;
  if has_table_privilege('anon',format('public.%I',t),'SELECT')
   or has_table_privilege('authenticated',format('public.%I',t),'SELECT')
   or has_table_privilege('anon',format('public.%I',t),'INSERT')
   or has_table_privilege('authenticated',format('public.%I',t),'INSERT')
   or has_table_privilege('authenticated',format('public.%I',t),'UPDATE')
   then raise exception 'VOX_PUBLIC_GRANT_PRESENT_%',t; end if;
  if has_table_privilege('service_role',format('public.%I',t),'DELETE')
   then raise exception 'VOX_UNSAFE_DELETE_GRANT_%',t; end if;
 end loop;
END $$;
insert into public.vox_staff_department_requests_v1(
 id,request_nonce,requested_by,target_staff_id,team_id,city_id,
 department,expires_at,reason
) values (
 '00000000-0000-4000-8000-000000000006',
 '00000000-0000-4000-8000-000000000007',
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000002',
 '00000000-0000-4000-8000-000000000005',
 '00000000-0000-4000-8000-000000000004',
 'client_success',now()+interval '1 day','Synthetic reviewed reason text'
);
DO $$
BEGIN
 BEGIN
  insert into public.vox_staff_department_requests_v1(
    request_nonce,requested_by,target_staff_id,team_id,city_id,department,expires_at,reason
  ) values (
   '00000000-0000-4000-8000-000000000007',
   '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-000000000005',
   '00000000-0000-4000-8000-000000000004',
   'vendor_success',now()+interval '1 day','Duplicate request nonce rejected'
  );
  raise exception 'VOX_DUPLICATE_NONCE_ACCEPTED';
 EXCEPTION WHEN unique_violation THEN null; END;
 BEGIN
  insert into public.vox_staff_department_requests_v1(
    request_nonce,requested_by,target_staff_id,team_id,city_id,department,expires_at,reason
  ) values (
   '00000000-0000-4000-8000-000000000008',
   '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-000000000005',
   '00000000-0000-4000-8000-000000000004',
   'admin',now()+interval '1 day','Privilege elevation should fail'
  );
  raise exception 'VOX_ADMIN_DEPARTMENT_ACCEPTED';
 EXCEPTION WHEN check_violation THEN null; END;
 BEGIN
  insert into public.vox_staff_department_requests_v1(
    request_nonce,requested_by,target_staff_id,team_id,city_id,department,expires_at,reason
  ) values (
   '00000000-0000-4000-8000-000000000009',
   '00000000-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-000000000005',
   '00000000-0000-4000-8000-000000000004',
   'client_success',now()+interval '1 day','Self request should fail closed'
  );
  raise exception 'VOX_SELF_GRANT_REQUEST_ACCEPTED';
 EXCEPTION WHEN check_violation THEN null; END;
END $$;
insert into public.vox_staff_department_capabilities_v1(
 request_id,auth_user_id,team_id,city_id,department,granted_by,expires_at
) values (
 '00000000-0000-4000-8000-000000000006',
 '00000000-0000-4000-8000-000000000002',
 '00000000-0000-4000-8000-000000000005',
 '00000000-0000-4000-8000-000000000004',
 'client_success',
 '00000000-0000-4000-8000-000000000001',
 now()+interval '1 day'
);
DO $$
BEGIN
 BEGIN
  insert into public.vox_staff_department_capabilities_v1(
    request_id,auth_user_id,team_id,city_id,department,granted_by,expires_at
  ) values (
   '00000000-0000-4000-8000-000000000006',
   '00000000-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-000000000005',
   '00000000-0000-4000-8000-000000000004',
   'client_success',
   '00000000-0000-4000-8000-000000000001',
   now()+interval '1 day'
  );
  raise exception 'VOX_DUPLICATE_GRANT_ACCEPTED';
 EXCEPTION WHEN unique_violation THEN null; END;
END $$;
select 'VOX_TO02B_PG17_SCHEMA_GUARDS_PASS' as result;
