-- Disposable Postgres 17, synthetic IDs only. Not a managed migration.
\set ON_ERROR_STOP on
insert into public.vox_work_items_candidate_v1
(id,team_id,city_id,source_kind,source_id,state,assignee_id,revision)
values
('00000000-0000-4000-8000-000000000601',
 '00000000-0000-4000-8000-000000000201',
 '00000000-0000-4000-8000-000000000101',
 'prospect','00000000-0000-4000-8000-000000000301','NEW',null,0),
('00000000-0000-4000-8000-000000000602',
 '00000000-0000-4000-8000-000000000201',
 '00000000-0000-4000-8000-000000000101',
 'prospect','00000000-0000-4000-8000-000000000301','NEW',null,0),
('00000000-0000-4000-8000-000000000603',
 '00000000-0000-4000-8000-000000000201',
 '00000000-0000-4000-8000-000000000101',
 'prospect','00000000-0000-4000-8000-000000000301','NEW',null,0);
do $proof$
declare
 tl uuid:='00000000-0000-4000-8000-000000000003';
 staff uuid:='00000000-0000-4000-8000-000000000001';
 item uuid:='00000000-0000-4000-8000-000000000601';
 nonce_id uuid:='00000000-0000-4000-8000-000000000701';
 receipt record; failed boolean;
begin
 select * into strict receipt from public.qf_vox_tl_assign_work_candidate_v1(
  tl,staff,item,0,nonce_id,'');
 if receipt.new_state<>'ASSIGNED' or receipt.item_id<>item or
  receipt.target_id<>staff or receipt.leader_id<>tl or
  receipt.revision<>1 or receipt.nonce<>nonce_id or
  receipt.external_messages_sent<>0 or
  receipt.vendor_assignments_changed<>0 or
  receipt.money_minor_units<>0 then
  raise exception 'TEAM_LEADER_RECEIPT_INVALID';end if;
 if (select count(*) from public.vox_work_events_candidate_v1
  where work_item_id=item and event_type='TEAM_ASSIGN')<>1 then
   raise exception 'CANONICAL_WORK_EVENT_MISSING';end if;
 select * into strict receipt from public.qf_vox_tl_assign_work_candidate_v1(
  tl,staff,item,0,nonce_id,'');
 if receipt.revision<>1 then raise exception 'ORIGINAL_REPLAY_FAILED';end if;
 if (select count(*) from public.vox_vo4_tl_assignment_receipts_candidate_v1
  where work_item_id=item)<>1 then raise exception 'REPLAY_DUPLICATED';end if;
 failed:=false;
 begin
  perform public.qf_vox_tl_assign_work_candidate_v1(
   tl,staff,item,0,nonce_id,'Different reason');
 exception when others then failed:=true;end;
 if not failed then raise exception 'NONCE_MUTATION_ACCEPTED';end if;
 failed:=false;
 begin
  perform public.qf_vox_tl_assign_work_candidate_v1(
   tl,staff,item,0,'00000000-0000-4000-8000-000000000702','');
 exception when others then failed:=true;end;
 if not failed then raise exception 'STALE_SECOND_ASSIGNMENT_ACCEPTED';end if;
 failed:=false;
 begin
  perform public.qf_vox_tl_assign_work_candidate_v1(
   staff,tl,'00000000-0000-4000-8000-000000000602',0,
   '00000000-0000-4000-8000-000000000703','');
 exception when others then failed:=true;end;
 if not failed then raise exception 'SELF_OR_WRONG_LEADER_ACCEPTED';end if;
 failed:=false;
 begin
  perform public.qf_vox_tl_assign_work_candidate_v1(
   tl,'00000000-0000-4000-8000-000000000004',
   '00000000-0000-4000-8000-000000000602',0,
   '00000000-0000-4000-8000-000000000704','');
 exception when others then failed:=true;end;
 if not failed then raise exception 'CROSS_CITY_STAFF_ACCEPTED';end if;
 update public.vox_staff_object_scopes_v1
 set revoked_at=clock_timestamp() where auth_user_id=staff and scope_kind='prospect';
 failed:=false;
 begin
  perform public.qf_vox_tl_assign_work_candidate_v1(
   tl,staff,'00000000-0000-4000-8000-000000000602',0,
   '00000000-0000-4000-8000-000000000705','');
 exception when others then failed:=true;end;
 if not failed then raise exception 'REVOKED_OBJECT_GRANT_ACCEPTED';end if;
 update public.vox_staff_object_scopes_v1
 set revoked_at=null where auth_user_id=staff and scope_kind='prospect';
 update public.vox_staff_memberships_v1
 set revoked_at=clock_timestamp() where auth_user_id=staff;
 failed:=false;
 begin
  perform public.qf_vox_tl_assign_work_candidate_v1(
   tl,staff,'00000000-0000-4000-8000-000000000602',0,
   '00000000-0000-4000-8000-000000000706','');
 exception when others then failed:=true;end;
 if not failed then raise exception 'REVOKED_TARGET_MEMBERSHIP_ACCEPTED';end if;
 update public.vox_staff_memberships_v1
 set revoked_at=null where auth_user_id=staff;
 if has_table_privilege('anon',
  'public.vox_vo4_tl_assignment_receipts_candidate_v1','SELECT') or
  has_table_privilege('authenticated',
  'public.vox_vo4_tl_assignment_receipts_candidate_v1','INSERT') or
  has_function_privilege('authenticated',
  'public.qf_vox_tl_assign_work_candidate_v1(uuid,uuid,uuid,integer,uuid,text)',
  'EXECUTE')then raise exception 'TL_ASSIGNMENT_ACL_BYPASS';end if;
 if not exists(
  select 1 from pg_class where oid=
   'public.vox_vo4_tl_assignment_receipts_candidate_v1'::regclass
    and relrowsecurity and relforcerowsecurity)
 then raise exception 'TL_RECEIPTS_RLS_NOT_FORCED';end if;
end;
$proof$;
select 'VO4_TL_SOURCE_ASSERTIONS_PASS' as result;
