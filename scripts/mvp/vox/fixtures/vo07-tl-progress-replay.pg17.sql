-- Disposable PG17 integration: a valid original assignment receipt remains
-- reconcilable after ordinary subsequent Core work progress. No managed SQL.
\set ON_ERROR_STOP on
update public.vox_work_items_candidate_v1
 set state='IN_PROGRESS',revision=revision+1
 where id='00000000-0000-4000-8000-000000000601'
  and state='ASSIGNED' and assignee_id='00000000-0000-4000-8000-000000000001';
select revision from public.qf_vox_tl_assign_work_candidate_v1(
 '00000000-0000-4000-8000-000000000003',
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000601',0,
 '00000000-0000-4000-8000-000000000701','');
update public.vox_work_items_candidate_v1
 set state='DONE',revision=revision+1
 where id='00000000-0000-4000-8000-000000000601'
  and state='IN_PROGRESS' and assignee_id='00000000-0000-4000-8000-000000000001';
select revision from public.qf_vox_tl_assign_work_candidate_v1(
 '00000000-0000-4000-8000-000000000003',
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000601',0,
 '00000000-0000-4000-8000-000000000701','');
do $proof$
declare denied boolean:=false;
begin
 if (select count(*) from public.vox_vo4_tl_assignment_receipts_candidate_v1
  where work_item_id='00000000-0000-4000-8000-000000000601')<>1 or
  (select count(*) from public.vox_work_events_candidate_v1
   where work_item_id='00000000-0000-4000-8000-000000000601'
    and event_type='TEAM_ASSIGN')<>1 then
  raise exception 'VO7_TL_ORIGINAL_NONCE_CREATED_DUPLICATE';end if;
 begin
  perform public.qf_vox_tl_assign_work_candidate_v1(
   '00000000-0000-4000-8000-000000000003',
   '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000601',0,
   '00000000-0000-4000-8000-000000000799','');
 exception when others then denied:=true;end;
 if not denied then raise exception 'VO7_TL_NEW_NONCE_REASSIGNED_DONE_ITEM';end if;
end;
$proof$;
select 'VO7_TL_PROGRESS_REPLAY_PG17_PASS' as result;
