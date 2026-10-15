-- Real PostgreSQL17 synthetic transaction tests; no real Auth or messaging.
\set ON_ERROR_STOP on
DO $$
DECLARE v_request uuid; v_cap uuid;
BEGIN
 v_request:=public.qf_vox_request_department_v1(
  '00000000-0000-4000-8000-000000000001'::uuid,
  '00000000-0000-4000-8000-000000000002'::uuid,
  '00000000-0000-4000-8000-000000000005'::uuid,
  'client_success',now()+interval '1 day','Approved synthetic client responsibility',
  '00000000-0000-4000-8000-000000000011'::uuid);
 if v_request is null then raise exception 'REQUEST_WAS_NULL'; end if;
 if not exists(select 1 from public.vox_staff_department_requests_v1 where id=v_request and
   state='PENDING' and revision=0 and department='client_success')
 then raise exception 'REQUEST_NOT_PERSISTED'; end if;

 -- Admin cannot stand in for distinct Team Leader review.
 begin
  perform public.qf_vox_review_department_v1(
   v_request,'00000000-0000-4000-8000-000000000001'::uuid,0,
   'APPROVE','invalid-owner-review','00000000-0000-4000-8000-000000000012'::uuid);
  raise exception 'OWNER_SELF_REVIEW_ACCEPTED' using errcode='P9999';
 exception when sqlstate 'P0001' then null; end;

 -- No activation before review.
 begin
  perform public.qf_vox_activate_department_v1(
    v_request,'00000000-0000-4000-8000-000000000001'::uuid,1,
    'premature-activation','00000000-0000-4000-8000-000000000013'::uuid);
  raise exception 'UNREVIEWED_ACTIVATION_ACCEPTED' using errcode='P9999';
 exception when sqlstate 'P0001' then null; end;

 if public.qf_vox_review_department_v1(
   v_request,'00000000-0000-4000-8000-000000000003'::uuid,0,
   'APPROVE','team-leader-reviewed','00000000-0000-4000-8000-000000000014'::uuid)
   is distinct from v_request then raise exception 'REVIEW_NOT_PERSISTED'; end if;
 if not exists(select 1 from public.vox_staff_department_decisions_v1
   where request_id=v_request and decision='APPROVED') then
   raise exception 'REVIEW_DECISION_MISSING'; end if;

 -- Stale review/replay must be rejected.
 begin
  perform public.qf_vox_review_department_v1(
   v_request,'00000000-0000-4000-8000-000000000003'::uuid,0,
   'APPROVE','repeat-review-denied','00000000-0000-4000-8000-000000000015'::uuid);
  raise exception 'DUPLICATE_REVIEW_ACCEPTED' using errcode='P9999';
 exception when sqlstate 'P0001' then null; end;

 v_cap:=public.qf_vox_activate_department_v1(
    v_request,'00000000-0000-4000-8000-000000000001'::uuid,1,
    'independent-activation','00000000-0000-4000-8000-000000000016'::uuid);
 if not exists(select 1 from public.vox_staff_department_capabilities_v1
     where id=v_cap and revision=2 and department='client_success' and revoked_at is null)
 then raise exception 'ACTIVATION_NOT_ATOMIC'; end if;
 if not exists(select 1 from public.vox_staff_department_activations_v1
    where request_id=v_request and capability_id=v_cap) then
   raise exception 'ACTIVATION_RECEIPT_MISSING'; end if;
 begin
  perform public.qf_vox_activate_department_v1(
    v_request,'00000000-0000-4000-8000-000000000001'::uuid,1,
    'duplicate-activation','00000000-0000-4000-8000-000000000017'::uuid);
  raise exception 'DUPLICATE_ACTIVATION_ACCEPTED' using errcode='P9999';
 exception when sqlstate 'P0001' then null; end;

 -- Staff or TL cannot revoke owner-governed capabilities.
 begin
  perform public.qf_vox_revoke_department_v1(
    v_cap,'00000000-0000-4000-8000-000000000003'::uuid,2,
    'unauthorized-revoke-attempt','00000000-0000-4000-8000-000000000018'::uuid);
  raise exception 'TEAM_LEADER_REVOKE_ACCEPTED' using errcode='P9999';
 exception when sqlstate 'P0001' then null; end;

 if public.qf_vox_revoke_department_v1(
   v_cap,'00000000-0000-4000-8000-000000000001'::uuid,2,
   'governed-test-revocation','00000000-0000-4000-8000-000000000019'::uuid)
   is distinct from v_cap then raise exception 'REVOKE_FAILED'; end if;
 if not exists(select 1 from public.vox_staff_department_capabilities_v1
    where id=v_cap and revision=3 and revoked_at is not null)
 then raise exception 'REVOKE_NOT_PERSISTED'; end if;
 begin
  perform public.qf_vox_revoke_department_v1(
    v_cap,'00000000-0000-4000-8000-000000000001'::uuid,2,
    'duplicate-revoke-denied','00000000-0000-4000-8000-000000000020'::uuid);
  raise exception 'DUPLICATE_REVOKE_ACCEPTED' using errcode='P9999';
 exception when sqlstate 'P0001' then null; end;
 if (select count(*) from public.vox_staff_department_events_v1 where request_id=v_request)<>4
 then raise exception 'AUDIT_EVENT_SEQUENCE_INVALID'; end if;
END $$;

DO $$
DECLARE fn text;
BEGIN
 foreach fn in array array[
  'qf_vox_request_department_v1(uuid,uuid,uuid,text,timestamptz,text,uuid)',
  'qf_vox_review_department_v1(uuid,uuid,integer,text,text,uuid)',
  'qf_vox_activate_department_v1(uuid,uuid,integer,text,uuid)',
  'qf_vox_revoke_department_v1(uuid,uuid,integer,text,uuid)'
 ] loop
  if has_function_privilege('anon','public.'||fn,'EXECUTE') or
     has_function_privilege('authenticated','public.'||fn,'EXECUTE') then
    raise exception 'PUBLIC_RPC_EXECUTE_GRANT_%',fn; end if;
  if not has_function_privilege('service_role','public.'||fn,'EXECUTE') then
    raise exception 'SERVICE_ROLE_RPC_EXECUTE_MISSING_%',fn; end if;
 end loop;
END $$;
select 'VOX_TO02C_ATOMIC_CORE_CANDIDATE_PG17_PASS' as result;
