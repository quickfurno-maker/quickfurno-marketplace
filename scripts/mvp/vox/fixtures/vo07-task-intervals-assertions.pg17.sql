-- Disposable PG17 only; all identities and sources are synthetic.
\set ON_ERROR_STOP on
insert into public.vox_work_items_candidate_v1
(id,team_id,city_id,source_kind,source_id,state,assignee_id,revision)
values
('00000000-0000-4000-8000-000000000601',
 '00000000-0000-4000-8000-000000000201',
 '00000000-0000-4000-8000-000000000101',
 'prospect','00000000-0000-4000-8000-000000000301','IN_PROGRESS',
 '00000000-0000-4000-8000-000000000001',2),
('00000000-0000-4000-8000-000000000602',
 '00000000-0000-4000-8000-000000000201',
 '00000000-0000-4000-8000-000000000101',
 'prospect','00000000-0000-4000-8000-000000000301','IN_PROGRESS',
 '00000000-0000-4000-8000-000000000001',2);
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
select revision from public.qf_vox_staff_time_atomic_candidate_v1(
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000201',
 '00000000-0000-4000-8000-000000000101','TASK_SWITCH',
 '00000000-0000-4000-8000-000000000803',2,
 '00000000-0000-4000-8000-000000000602');
select revision from public.qf_vox_staff_time_atomic_candidate_v1(
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000201',
 '00000000-0000-4000-8000-000000000101','TASK_PAUSE',
 '00000000-0000-4000-8000-000000000804',3,
 '00000000-0000-4000-8000-000000000602');
select revision from public.qf_vox_staff_time_atomic_candidate_v1(
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000201',
 '00000000-0000-4000-8000-000000000101','TASK_RESUME',
 '00000000-0000-4000-8000-000000000805',4,
 '00000000-0000-4000-8000-000000000602');
select revision from public.qf_vox_staff_time_atomic_candidate_v1(
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000201',
 '00000000-0000-4000-8000-000000000101','BREAK_START',
 '00000000-0000-4000-8000-000000000806',5,null);
select revision from public.qf_vox_staff_time_atomic_candidate_v1(
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000201',
 '00000000-0000-4000-8000-000000000101','BREAK_END',
 '00000000-0000-4000-8000-000000000807',6,null);
select revision from public.qf_vox_staff_time_atomic_candidate_v1(
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000201',
 '00000000-0000-4000-8000-000000000101','TASK_RESUME',
 '00000000-0000-4000-8000-000000000808',7,
 '00000000-0000-4000-8000-000000000602');
select revision from public.qf_vox_staff_time_atomic_candidate_v1(
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000201',
 '00000000-0000-4000-8000-000000000101','CLOCK_OUT',
 '00000000-0000-4000-8000-000000000809',8,null);
-- The original TASK_SWITCH nonce must remain replayable even after clockout.
select revision from public.qf_vox_staff_time_atomic_candidate_v1(
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000201',
 '00000000-0000-4000-8000-000000000101','TASK_SWITCH',
 '00000000-0000-4000-8000-000000000803',2,
 '00000000-0000-4000-8000-000000000602');
do $proof$
declare
 actor uuid:='00000000-0000-4000-8000-000000000001';
 work1 uuid:='00000000-0000-4000-8000-000000000601';
 work2 uuid:='00000000-0000-4000-8000-000000000602';
begin
 if (select count(*) from public.vox_vo7_staff_task_intervals_candidate_v1
     where staff_id=actor)<>4 then
  raise exception 'VO7_INTERVAL_COUNT_INVALID';end if;
 if (select count(*) from public.vox_vo7_staff_task_intervals_candidate_v1
     where work_item_id=work1 and closing_action='TASK_SWITCH')<>1 or
    (select count(*) from public.vox_vo7_staff_task_intervals_candidate_v1
     where work_item_id=work2)<>3 then
  raise exception 'VO7_WORK_ITEM_ATTRIBUTION_INVALID';end if;
 if (select count(*) from public.vox_vo7_staff_task_intervals_candidate_v1
     where closed_by_event_nonce in(
      '00000000-0000-4000-8000-000000000803',
      '00000000-0000-4000-8000-000000000804',
      '00000000-0000-4000-8000-000000000806',
      '00000000-0000-4000-8000-000000000809'))<>4 then
  raise exception 'VO7_ORIGINAL_NONCES_NOT_BOUND';end if;
 if (select sum(elapsed_ms) from public.vox_vo7_staff_task_intervals_candidate_v1
     where staff_id=actor) <>
    (select task_time_ms from public.vox_vo2_staff_time_state_candidate_v1
     where staff_id=actor)then
  raise exception 'VO7_SEGMENTS_NOT_EQUAL_CANONICAL_TOTAL';end if;
 if has_table_privilege('authenticated',
   'public.vox_vo7_staff_task_intervals_candidate_v1','SELECT') or
   has_table_privilege('service_role',
   'public.vox_vo7_staff_task_intervals_candidate_v1','DELETE') or
   has_table_privilege('service_role',
   'public.vox_vo7_staff_task_intervals_candidate_v1','UPDATE')
 then raise exception 'VO7_INTERVAL_ACL_TOO_BROAD';end if;
 if not exists(select 1 from pg_class where oid=
   'public.vox_vo7_staff_task_intervals_candidate_v1'::regclass
   and relrowsecurity and relforcerowsecurity)
 then raise exception 'VO7_INTERVAL_RLS_DISABLED';end if;
end;
$proof$;
select 'VO7_TASK_INTERVALS_PG17_PASS' as result;
