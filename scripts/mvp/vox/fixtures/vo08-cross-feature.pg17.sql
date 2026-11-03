-- VO8 disposable PostgreSQL17 cross-feature proof; synthetic identities only.
\set ON_ERROR_STOP on
insert into public.vox_work_items_candidate_v1
(id,team_id,city_id,source_kind,source_id,state,assignee_id,revision)
values ('00000000-0000-4000-8000-000000000601',
'00000000-0000-4000-8000-000000000201',
'00000000-0000-4000-8000-000000000101',
'prospect','00000000-0000-4000-8000-000000000301','NEW',null,0);
-- Team Leader assigns once; same Staff subsequently logs task time and presence.
select item_id,revision from public.qf_vox_tl_assign_work_candidate_v1(
'00000000-0000-4000-8000-000000000003',
'00000000-0000-4000-8000-000000000001',
'00000000-0000-4000-8000-000000000601',0,
'00000000-0000-4000-8000-000000000701','');
-- A Team Leader's ASSIGNED state is not the Staff TASK_START authority.
-- Canonical Core work progress must move to IN_PROGRESS first.
update public.vox_work_items_candidate_v1 set state='IN_PROGRESS',revision=revision+1
where id='00000000-0000-4000-8000-000000000601'
 and state='ASSIGNED' and assignee_id='00000000-0000-4000-8000-000000000001';
select revision from public.qf_vox_staff_time_atomic_candidate_v1(
'00000000-0000-4000-8000-000000000001',
'00000000-0000-4000-8000-000000000201',
'00000000-0000-4000-8000-000000000101','CLOCK_IN',
'00000000-0000-4000-8000-000000000801',0,null);
select revision from public.qf_vox_staff_time_atomic_candidate_v1(
'00000000-0000-4000-8000-000000000001',
'00000000-0000-4000-8000-000000000201',
'00000000-0000-4000-8000-000000000101','TASK_START',
'00000000-0000-4000-8000-000000000802',1,
'00000000-0000-4000-8000-000000000601');
select state from public.qf_vox_staff_presence_signal_candidate_v1(
'00000000-0000-4000-8000-000000000001',
'00000000-0000-4000-8000-000000000201','BUSY');
select revision from public.qf_vox_staff_time_atomic_candidate_v1(
'00000000-0000-4000-8000-000000000001',
'00000000-0000-4000-8000-000000000201',
'00000000-0000-4000-8000-000000000101','TASK_STOP',
'00000000-0000-4000-8000-000000000803',2,
'00000000-0000-4000-8000-000000000601');
update public.vox_work_items_candidate_v1 set state='DONE',revision=revision+1
where id='00000000-0000-4000-8000-000000000601'
  and state='ASSIGNED' and assignee_id='00000000-0000-4000-8000-000000000001';
-- Original TL nonce must reconcile after progress without a second assignment.
select revision from public.qf_vox_tl_assign_work_candidate_v1(
'00000000-0000-4000-8000-000000000003',
'00000000-0000-4000-8000-000000000001',
'00000000-0000-4000-8000-000000000601',0,
'00000000-0000-4000-8000-000000000701','');
do $proof$
declare actor uuid:='00000000-0000-4000-8000-000000000001';
begin
 if (select count(*) from public.vox_vo4_tl_assignment_receipts_candidate_v1
     where target_staff_id=actor)<>1 then
   raise exception 'VO8_DUPLICATE_TL_RECEIPT';end if;
 if (select count(*) from public.vox_vo7_staff_task_intervals_candidate_v1
     where staff_id=actor and work_item_id='00000000-0000-4000-8000-000000000601'
     and closed_by_event_nonce='00000000-0000-4000-8000-000000000803')<>1 then
   raise exception 'VO8_TASK_INTERVAL_ATTRIBUTION_FAILED';end if;
 if (select count(*) from public.vox_vo6_staff_presence_observations_candidate_v1
     where staff_id=actor and state='BUSY')<>1 then
   raise exception 'VO8_PRESENCE_CROSS_FEATURE_FAILED';end if;
 if (select count(*) from public.vox_vo2_staff_time_events_candidate_v1
     where staff_id=actor)<>3 then
   raise exception 'VO8_TIME_NONCE_CROSS_FEATURE_FAILED';end if;
 if (select count(*) from public.vox_work_events_candidate_v1
     where work_item_id='00000000-0000-4000-8000-000000000601'
     and event_type='TEAM_ASSIGN')<>1 then
   raise exception 'VO8_CANONICAL_TEAM_EVENT_DUPLICATED';end if;
 if has_table_privilege('authenticated',
   'public.vox_vo7_staff_task_intervals_candidate_v1','SELECT') or
   has_table_privilege('authenticated',
   'public.vox_vo6_staff_presence_observations_candidate_v1','SELECT') then
   raise exception 'VO8_COMBINED_RLS_LEAK';end if;
end;
$proof$;
select 'VO8_CROSS_FEATURE_DISPOSABLE_PG17_PASS' as result;
