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
DO $vox_first$
declare v_request uuid; v_self_denied boolean; v_rejection text;
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
 raise exception 'WRONG_CITY_ALLOWED' using errcode='XX000';
 exception when sqlstate 'P0001' then null; end;
 -- Owner may not serve as independent TL reviewer.
 begin
 perform public.qf_vox_department_review_v1(
  '00000000-0000-4000-8000-000000000001',v_request,0,'APPROVE',
  'TEST_WRONG_REVIEWER','00000000-0000-4000-8000-000000000023');
 raise exception 'OWNER_SELF_REVIEWED' using errcode='XX000';
 exception when sqlstate 'P0001' then null; end;
 -- Legitimate TL reviews exactly same team.
 perform public.qf_vox_department_review_v1(
  '00000000-0000-4000-8000-000000000003',v_request,0,'APPROVE',
  'TEST_TL_REVIEW_OK','00000000-0000-4000-8000-000000000024');
 -- Adversarial persisted state: valid, current TL reviewer later becomes the
 -- target of the SAME already APPROVED request. A request-stage validation
 -- alone cannot protect atomic activation. Existing TL is a neutral Core
 -- Staff identity with a live membership and would otherwise qualify.
 update public.vox_staff_department_requests_v1
    set target_staff_id='00000000-0000-4000-8000-000000000003'
    where id=v_request;
 v_self_denied:=false; v_rejection:=null;
 begin
  perform public.qf_vox_department_activate_v1(
   '00000000-0000-4000-8000-000000000001',v_request,1,
   'TEST_TARGET_SELF_DENIED','00000000-0000-4000-8000-000000000087');
 exception when sqlstate 'P0001' then
  get stacked diagnostics v_rejection=MESSAGE_TEXT;
  v_self_denied:=v_rejection='VOX_DEPT_ACTIVATION_STALE';
 end;
 if not v_self_denied then
  raise exception 'TARGET_SELF_APPROVAL_NOT_ATOMICALLY_DENIED: %',
    coalesce(v_rejection,'no error');
 end if;
 if exists(select 1 from public.vox_staff_department_capabilities_v1
     where request_id=v_request) or
    exists(select 1 from public.vox_staff_department_activations_v1
     where request_id=v_request)
 then raise exception 'SELF_APPROVAL_CREATED_GRANT_OR_ACTIVATION'; end if;
 update public.vox_staff_department_requests_v1
  set target_staff_id='00000000-0000-4000-8000-000000000002'
  where id=v_request;
 -- SQL candidate must enforce the original auditable requestor, even if
 -- a corrupted request row is relabelled to another owner between review
 -- and activation. Test ONLY in disposable synthetic PG17.
 update public.vox_staff_department_requests_v1
  set requested_by='00000000-0000-4000-8000-000000000003'
  where id=v_request;
 begin
  perform public.qf_vox_department_activate_v1(
   '00000000-0000-4000-8000-000000000001',v_request,1,
   'TEST_WRONG_REQUEST_OWNER','00000000-0000-4000-8000-000000000086');
  raise exception 'NON_REQUESTING_OWNER_ACTIVATED' using errcode='XX000';
 exception when sqlstate 'P0001' then null; end;
 update public.vox_staff_department_requests_v1
  set requested_by='00000000-0000-4000-8000-000000000001'
  where id=v_request;
 -- TL may not perform owner activation.
 begin
 perform public.qf_vox_department_activate_v1(
  '00000000-0000-4000-8000-000000000003',v_request,1,
  'TEST_WRONG_OWNER','00000000-0000-4000-8000-000000000025');
 raise exception 'TL_ACTIVATED_ADMIN_GRANT' using errcode='XX000';
 exception when sqlstate 'P0001' then null; end;
 perform public.qf_vox_department_activate_v1(
  '00000000-0000-4000-8000-000000000001',v_request,1,
  'TEST_OWNER_ACTIVATED','00000000-0000-4000-8000-000000000026');
 -- Immutable activation; replay fails.
 begin
 perform public.qf_vox_department_activate_v1(
  '00000000-0000-4000-8000-000000000001',v_request,1,
  'TEST_DUPLICATE_ACT','00000000-0000-4000-8000-000000000027');
 raise exception 'DUPLICATE_ACTIVATION_ALLOWED' using errcode='XX000';
 exception when sqlstate 'P0001' then null; end;
 if (select count(*) from public.vox_staff_department_capabilities_v1
  where auth_user_id='00000000-0000-4000-8000-000000000002'
    and department='client_success' and revoked_at is null)<>1
 then raise exception 'CAPABILITY_NOT_UNIQUE'; end if;
 if (select count(*) from public.vox_staff_department_events_v1
  where request_id=v_request)<>3 then raise exception 'AUDIT_CHAIN_MISSING'; end if;
end $vox_first$;
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
 raise exception 'REVOKE_REPLAY_ALLOWED' using errcode='XX000';
 exception when sqlstate 'P0001' then null; end;
end $$;
select 'VOX_TO02C_ISOLATED_CORE_RPCS_PASS' as result;
