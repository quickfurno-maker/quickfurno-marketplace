-- Run *after* application of actual work candidate SQL.
-- This exercises a real reviewed vendor_success grant produced by the
-- department RPC against the real (synthetic) Core work RPC.
insert into public.vox_work_items_candidate_v1(
 id,team_id,city_id,source_kind,source_id)
 values('00000000-0000-4000-8000-000000000971',
  '00000000-0000-4000-8000-000000000005',
  '00000000-0000-4000-8000-000000000004',
  'vendor','00000000-0000-4000-8000-000000000911');
do $vox_to05a$
declare
 v_item uuid:='00000000-0000-4000-8000-000000000971';
 v_staff uuid:='00000000-0000-4000-8000-000000000002';
 v_owner uuid:='00000000-0000-4000-8000-000000000001';
 v_cap uuid;
 v_count integer; v_err text; v_denied boolean:=false;
begin
 select id into v_cap from public.vox_staff_department_capabilities_v1
  where auth_user_id=v_staff and department='vendor_success'
    and revoked_at is null;
 if v_cap is null then raise exception 'MISSING_REAL_REVIEWED_VENDOR_CAPABILITY'; end if;
 perform public.qf_vox_work_transition_candidate_v1(
  v_staff,v_item,0,'00000000-0000-4000-8000-000000000972','CLAIM','');
 if(select revision from public.vox_work_items_candidate_v1 where id=v_item)<>1
 then raise exception 'CROSS_MODULE_WORK_CLAIM_NOT_COMMITTED'; end if;
 if(select count(*) from public.vox_work_events_candidate_v1 where work_item_id=v_item)<>1
 then raise exception 'CROSS_MODULE_CLAIM_LEDGER_WRONG'; end if;
 perform public.qf_vox_department_revoke_v1(
  v_owner,v_cap,2,'TO05A_REVOKE_TEST','00000000-0000-4000-8000-000000000973');
 begin
  perform public.qf_vox_work_transition_candidate_v1(
   v_staff,v_item,1,'00000000-0000-4000-8000-000000000974','START','');
 exception when sqlstate 'P0001' then
  get stacked diagnostics v_err=MESSAGE_TEXT;
  v_denied:=v_err='VOX_WORK_DEPARTMENT_NOT_REVIEWED';
 end;
 if not v_denied then
  raise exception 'REVOKED_DEPARTMENT_EXECUTED_WORK: %',coalesce(v_err,'no rejection')
   using errcode='XX000';
 end if;
 if(select revision from public.vox_work_items_candidate_v1 where id=v_item)<>1
 then raise exception 'DENIED_START_CHANGED_WORK_REVISION'; end if;
 if(select count(*) from public.vox_work_events_candidate_v1 where work_item_id=v_item)<>1
 then raise exception 'DENIED_START_WRITTEN_AUDIT_EVENT'; end if;
 if exists(select 1 from public.vox_staff_department_capabilities_v1
  where id=v_cap and revoked_at is null) then
  raise exception 'REVOKED_CAPABILITY_STILL_ACTIVE';
 end if;
end $vox_to05a$;
select 'VOX_TO05A_REAL_CANDIDATES_SAME_DB_REVOKE_PASS' as result;
