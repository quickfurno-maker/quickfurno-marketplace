-- Genuine isolated PG17 transaction/denial tests. No live identities.
insert into public.vox_work_items_candidate_v1
 (id,team_id,city_id,source_kind,source_id,state,assignee_id,revision)
values('00000000-0000-4000-8000-000000000601',
 '00000000-0000-4000-8000-000000000201',
 '00000000-0000-4000-8000-000000000101','prospect',
 '00000000-0000-4000-8000-000000000301','NEW',null,0);
do $$
declare r record; fail boolean;
begin
 select * into r from public.qf_vox_work_transition_candidate_v1(
  '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000601',
  0,gen_random_uuid(),'CLAIM','');
 if r.new_state<>'ASSIGNED' or r.new_revision<>1 then raise exception 'CLAIM_WRONG'; end if;
 fail:=false;
 begin perform public.qf_vox_work_transition_candidate_v1(
  '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000601',
  0,gen_random_uuid(),'CLAIM','');
 exception when sqlstate 'P0001' then fail:=true; end;
 if not fail then raise exception 'DUPLICATE_CLAIM_SUCCEEDED'; end if;
 select * into r from public.qf_vox_work_transition_candidate_v1(
  '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000601',
  1,gen_random_uuid(),'START','');
 if r.new_state<>'IN_PROGRESS' or r.new_revision<>2 then raise exception 'START_WRONG'; end if;
 select * into r from public.qf_vox_work_transition_candidate_v1(
  '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000601',
  2,gen_random_uuid(),'COMPLETE','Resolved synthetic work');
 if r.new_state<>'DONE' or r.new_revision<>3 then raise exception 'COMPLETE_WRONG'; end if;
 if (select count(*) from public.vox_work_events_candidate_v1
  where work_item_id='00000000-0000-4000-8000-000000000601')<>3
 then raise exception 'EVENT_LEDGER_MISSING'; end if;
 if (select assignee_id from public.vox_work_items_candidate_v1
  where id='00000000-0000-4000-8000-000000000601')
  <>'00000000-0000-4000-8000-000000000001'
 then raise exception 'CLAIMED_ASSIGNEE_WRONG'; end if;
end $$;
insert into public.vox_work_items_candidate_v1
(id,team_id,city_id,source_kind,source_id)
values ('00000000-0000-4000-8000-000000000602',
 '00000000-0000-4000-8000-000000000201',
 '00000000-0000-4000-8000-000000000101','prospect',
 '00000000-0000-4000-8000-000000000301');
do $$
declare fail boolean;begin
 -- Core owner cannot act as ordinary Staff.
 fail:=false; begin perform public.qf_vox_work_transition_candidate_v1(
  '00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000602',
  0,gen_random_uuid(),'CLAIM','');
 exception when sqlstate 'P0001' then fail:=true;end;
 if not fail then raise exception 'OWNER_STAFF_BYPASS';end if;
 -- Team Leader cannot claim even with review authority.
 fail:=false;begin perform public.qf_vox_work_transition_candidate_v1(
  '00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000602',
  0,gen_random_uuid(),'CLAIM','');
 exception when sqlstate 'P0001' then fail:=true;end;
 if not fail then raise exception 'TEAM_LEADER_CLAIM_BYPASS';end if;
 -- Unrelated city Staff is denied.
 fail:=false;begin perform public.qf_vox_work_transition_candidate_v1(
  '00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000602',
  0,gen_random_uuid(),'CLAIM','');
 exception when sqlstate 'P0001' then fail:=true;end;
 if not fail then raise exception 'CROSS_CITY_BYPASS';end if;
 -- Revoked pack makes actor ineligible immediately.
 update public.vox_staff_department_capabilities_v1 set revoked_at=now()
 where id='00000000-0000-4000-8000-000000000501';
 fail:=false;begin perform public.qf_vox_work_transition_candidate_v1(
  '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000602',
  0,gen_random_uuid(),'CLAIM','');
 exception when sqlstate 'P0001' then fail:=true;end;
 if not fail then raise exception 'REVOKED_PACK_BYPASS';end if;
 update public.vox_staff_department_capabilities_v1 set revoked_at=null
 where id='00000000-0000-4000-8000-000000000501';
 -- Reviewer TL loses membership; approved capability unusable.
 update public.vox_staff_memberships_v1 set revoked_at=now()
 where auth_user_id='00000000-0000-4000-8000-000000000003';
 fail:=false;begin perform public.qf_vox_work_transition_candidate_v1(
  '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000602',
  0,gen_random_uuid(),'CLAIM','');
 exception when sqlstate 'P0001' then fail:=true;end;
 if not fail then raise exception 'REVOKED_TL_BYPASS';end if;
 update public.vox_staff_memberships_v1 set revoked_at=null
 where auth_user_id='00000000-0000-4000-8000-000000000003';
 -- Source scope revoke blocks work even with pack.
 update public.vox_staff_object_scopes_v1 set revoked_at=now()
 where auth_user_id='00000000-0000-4000-8000-000000000001';
 fail:=false;begin perform public.qf_vox_work_transition_candidate_v1(
  '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000602',
  0,gen_random_uuid(),'CLAIM','');
 exception when sqlstate 'P0001' then fail:=true;end;
 if not fail then raise exception 'REVOKED_SUBJECT_BYPASS';end if;
 update public.vox_staff_object_scopes_v1 set revoked_at=null
 where auth_user_id='00000000-0000-4000-8000-000000000001';
 if has_function_privilege('anon','public.qf_vox_work_transition_candidate_v1(uuid,uuid,integer,uuid,text,text)','execute')
 or has_function_privilege('authenticated','public.qf_vox_work_transition_candidate_v1(uuid,uuid,integer,uuid,text,text)','execute')
 or not has_function_privilege('service_role','public.qf_vox_work_transition_candidate_v1(uuid,uuid,integer,uuid,text,text)','execute')
 then raise exception 'PUBLIC_RPC_PRIVILEGE_BYPASS';end if;
 if (select count(*) from public.vox_work_events_candidate_v1
  where work_item_id='00000000-0000-4000-8000-000000000602')<>0
 then raise exception 'FAILED_ACTION_EMITTED_EVENT';end if;
end $$;
-- Proof against out-of-city canonical source laundering, even when the
-- staff has a manually inserted object grant for the wrong source.
insert into public.vox_staff_object_scopes_v1 values
 ('00000000-0000-4000-8000-000000000001','prospect',
  '00000000-0000-4000-8000-000000000302',now()+interval '7 days',null);
insert into public.vox_work_items_candidate_v1
 (id,team_id,city_id,source_kind,source_id)
 values('00000000-0000-4000-8000-000000000603',
 '00000000-0000-4000-8000-000000000201',
 '00000000-0000-4000-8000-000000000101','prospect',
 '00000000-0000-4000-8000-000000000302');
do $vox_negative$
declare denied boolean:=false;
begin
 begin
  perform public.qf_vox_work_transition_candidate_v1(
   '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000603',
   0,gen_random_uuid(),'CLAIM','');
 exception when sqlstate 'P0001' then denied:=true; end;
 if not denied then raise exception 'CROSS_CITY_SOURCE_LAUNDERING'; end if;
 if (select count(*) from public.vox_work_events_candidate_v1
  where work_item_id='00000000-0000-4000-8000-000000000603')<>0
 then raise exception 'INVALID_SOURCE_EMITTED_EVENT';end if;
end $vox_negative$;
select 'VOX_TO02E_SYNTHETIC_PG17_PASS' as result;
