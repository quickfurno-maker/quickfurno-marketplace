\set ON_ERROR_STOP on
-- Real SQL RPC execution, on disposable synthetic PG17.
select * from public.qf_vox_department_request_v1(
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000002',
 '00000000-0000-4000-8000-000000000005',
 '00000000-0000-4000-8000-000000000004',
 'client_success',
 '00000000-0000-4000-8000-000000000021',
 now()+interval '1 day','Approved test client responsibility');
DO $$
declare v_request uuid;
begin
 select id into v_request from public.vox_staff_department_requests_v1
 where request_nonce='00000000-0000-4000-8000-000000000021';
 if v_request is null then raise exception 'REQUEST_NOT_PERSISTED'; end if;
 -- Wrong-city request denied; nonce not persisted.
 begin
 perform public.qf_vox_department_request_v1(
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000005',
  '00000000-0000-4000-8000-000000000099',
  'vendor_success','00000000-0000-4000-8000-000000000022',
  now()+interval '1 day','Wrong city should be rejected');
 raise exception 'WRONG_CITY_ALLOWED';
 exception when sqlstate 'P0001' then null; end;
 -- Owner may not serve as independent TL reviewer.
 begin
 perform public.qf_vox_department_review_v1(
  '00000000-0000-4000-8000-000000000001',v_request,0,'APPROVE',
  'TEST_WRONG_REVIEWER','00000000-0000-4000-8000-000000000023');
 raise exception 'OWNER_SELF_REVIEWED';
 exception when sqlstate 'P0001' then null; end;
 -- Legitimate TL reviews exactly same team.
 perform public.qf_vox_department_review_v1(
  '00000000-0000-4000-8000-000000000003',v_request,0,'APPROVE',
  'TEST_TL_REVIEW_OK','00000000-0000-4000-8000-000000000024');
 -- SQL candidate must enforce the original auditable requestor, even if
 -- a corrupted request row is relabelled to another owner between review
 -- and activation. Test ONLY in disposable synthetic PG17.
 update public.vox_staff_department_requests_v1
  set requested_by='00000000-0000-4000-8000-000000000099'
  where id=v_request;
 begin
  perform public.qf_vox_department_activate_v1(
   '00000000-0000-4000-8000-000000000001',v_request,1,
   'TEST_WRONG_REQUEST_OWNER','00000000-0000-4000-8000-000000000086');
  raise exception 'NON_REQUESTING_OWNER_ACTIVATED';
 exception when sqlstate 'P0001' then null; end;
 update public.vox_staff_department_requests_v1
  set requested_by='00000000-0000-4000-8000-000000000001'
  where id=v_request;
 -- TL may not perform owner activation.
 begin
 perform public.qf_vox_department_activate_v1(
  '00000000-0000-4000-8000-000000000003',v_request,1,
  'TEST_WRONG_OWNER','00000000-0000-4000-8000-000000000025');
 raise exception 'TL_ACTIVATED_ADMIN_GRANT';
 exception when sqlstate 'P0001' then null; end;
 perform public.qf_vox_department_activate_v1(
  '00000000-0000-4000-8000-000000000001',v_request,1,
  'TEST_OWNER_ACTIVATED','00000000-0000-4000-8000-000000000026');
 -- Immutable activation; replay fails.
 begin
 perform public.qf_vox_department_activate_v1(
  '00000000-0000-4000-8000-000000000001',v_request,1,
  'TEST_DUPLICATE_ACT','00000000-0000-4000-8000-000000000027');
 raise exception 'DUPLICATE_ACTIVATION_ALLOWED';
 exception when sqlstate 'P0001' then null; end;
 if (select count(*) from public.vox_staff_department_capabilities_v1
  where auth_user_id='00000000-0000-4000-8000-000000000002'
    and department='client_success' and revoked_at is null)<>1
 then raise exception 'CAPABILITY_NOT_UNIQUE'; end if;
 if (select count(*) from public.vox_staff_department_events_v1
  where request_id=v_request)<>3 then raise exception 'AUDIT_CHAIN_MISSING'; end if;
end $$;
-- Same employee can hold a second reviewed department, separately.
select * from public.qf_vox_department_request_v1(
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000002',
 '00000000-0000-4000-8000-000000000005',
 '00000000-0000-4000-8000-000000000004',
 'vendor_success',
 '00000000-0000-4000-8000-000000000031',
 now()+interval '1 day','Second approved department responsibility');
DO $$
declare v_request uuid;v_cap uuid;
begin
 select id into v_request from public.vox_staff_department_requests_v1
 where request_nonce='00000000-0000-4000-8000-000000000031';
 perform public.qf_vox_department_review_v1(
  '00000000-0000-4000-8000-000000000003',v_request,0,'APPROVE',
  'TEST_TL_SECOND_OK','00000000-0000-4000-8000-000000000032');
 perform public.qf_vox_department_activate_v1(
  '00000000-0000-4000-8000-000000000001',v_request,1,
  'TEST_OWNER_SECOND','00000000-0000-4000-8000-000000000033');
 if (select count(*) from public.vox_staff_department_capabilities_v1
   where auth_user_id='00000000-0000-4000-8000-000000000002'
     and revoked_at is null)<>2
 then raise exception 'SECOND_DEPARTMENT_NOT_ACTIVE'; end if;
 select id into v_cap from public.vox_staff_department_capabilities_v1
  where department='client_success' and auth_user_id='00000000-0000-4000-8000-000000000002';
 perform public.qf_vox_department_revoke_v1(
  '00000000-0000-4000-8000-000000000001',v_cap,2,
  'TEST_REVOKE_FIRST','00000000-0000-4000-8000-000000000034');
 if (select count(*) from public.vox_staff_department_capabilities_v1
   where auth_user_id='00000000-0000-4000-8000-000000000002' and revoked_at is null)<>1
 then raise exception 'REVOKE_ALSO_DISABLED_SECOND_DEPARTMENT';end if;
 begin
 perform public.qf_vox_department_revoke_v1(
  '00000000-0000-4000-8000-000000000001',v_cap,2,
  'TEST_DOUBLE_REVOKE','00000000-0000-4000-8000-000000000035');
 raise exception 'REVOKE_REPLAY_ALLOWED';
 exception when sqlstate 'P0001' then null; end;
end $$;
select 'VOX_TO02C_ISOLATED_CORE_RPCS_PASS' as result;
