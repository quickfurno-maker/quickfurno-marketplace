-- VO2 isolated PostgreSQL17 assertions. Synthetic fixture only, never managed DB.
\set ON_ERROR_STOP on
insert into public.vox_work_items_candidate_v1
(id,team_id,city_id,source_kind,source_id,state,assignee_id,revision)
values('00000000-0000-4000-8000-000000000601',
'00000000-0000-4000-8000-000000000201',
'00000000-0000-4000-8000-000000000101',
'prospect','00000000-0000-4000-8000-000000000301','IN_PROGRESS',
'00000000-0000-4000-8000-000000000001',2);
do $test$
declare
 a uuid:='00000000-0000-4000-8000-000000000001';
 t uuid:='00000000-0000-4000-8000-000000000201';
 c uuid:='00000000-0000-4000-8000-000000000101';
 w uuid:='00000000-0000-4000-8000-000000000601';
 receipt record; first_event uuid; failed boolean;
begin
 -- Verify no browser can smuggle money or identity; function signature is fixed.
 select * into strict receipt from public.qf_vox_staff_time_atomic_candidate_v1(
 a,t,c,'CLOCK_IN','00000000-0000-4000-8000-000000000701',0,null);
 if receipt.revision<>1 or receipt.actor_id<>a or receipt.applied<>true or
    receipt.external_messages_sent<>0 or receipt.money_minor_units<>0 or
    receipt.work_item_id is not null
 then raise exception 'CLOCK_IN receipt invalid';end if;
 first_event:=receipt.event_id;
 -- Same original nonce => same committed receipt, no duplicated event.
 select * into strict receipt from public.qf_vox_staff_time_atomic_candidate_v1(
 a,t,c,'CLOCK_IN','00000000-0000-4000-8000-000000000701',0,null);
 if receipt.event_id<>first_event or receipt.revision<>1 then
  raise exception 'NONCE replay duplicated';end if;
 if (select count(*) from public.vox_vo2_staff_time_events_candidate_v1
     where staff_id=a)<>1 then raise exception 'REPLAY created another event';end if;
 -- Malicious re-use of original nonce with different command fails.
 failed:=false;
 begin
 perform public.qf_vox_staff_time_atomic_candidate_v1(
  a,t,c,'CLOCK_OUT','00000000-0000-4000-8000-000000000701',0,null);
 exception when others then failed:=true;end;
 if not failed then raise exception 'NONCE conflict accepted';end if;
 -- Original revision stale for another nonce also denied.
 failed:=false;
 begin
 perform public.qf_vox_staff_time_atomic_candidate_v1(
  a,t,c,'CLOCK_OUT','00000000-0000-4000-8000-000000000702',0,null);
 exception when others then failed:=true;end;
 if not failed then raise exception 'STALE revision accepted';end if;
 -- A different city or team cannot inject presence or time.
 failed:=false;
 begin
 perform public.qf_vox_staff_time_atomic_candidate_v1(
  a,t,'00000000-0000-4000-8000-000000000102','CLOCK_OUT',
  '00000000-0000-4000-8000-000000000703',1,null);
 exception when others then failed:=true;end;
 if not failed then raise exception 'CROSS_CITY accepted';end if;
 -- A bound, assigned Core task may be timed.
 select * into strict receipt from public.qf_vox_staff_time_atomic_candidate_v1(
 a,t,c,'TASK_START','00000000-0000-4000-8000-000000000704',1,w);
 if receipt.revision<>2 or receipt.work_item_id<>w then
  raise exception 'TASK_START receipt invalid';end if;
 -- Multiple active task timers are forbidden, even for same work item.
 failed:=false;
 begin
 perform public.qf_vox_staff_time_atomic_candidate_v1(
 a,t,c,'TASK_START','00000000-0000-4000-8000-000000000705',2,w);
 exception when others then failed:=true;end;
 if not failed then raise exception 'OVERLAPPING timer accepted';end if;
 select * into strict receipt from public.qf_vox_staff_time_atomic_candidate_v1(
 a,t,c,'TASK_PAUSE','00000000-0000-4000-8000-000000000706',2,w);
 if receipt.revision<>3 then raise exception 'TASK_PAUSE revision invalid';end if;
 select * into strict receipt from public.qf_vox_staff_time_atomic_candidate_v1(
 a,t,c,'BREAK_START','00000000-0000-4000-8000-000000000707',3,null);
 if receipt.revision<>4 then raise exception 'BREAK_START invalid';end if;
 failed:=false;
 begin
 perform public.qf_vox_staff_time_atomic_candidate_v1(
 a,t,c,'TASK_RESUME','00000000-0000-4000-8000-000000000708',4,w);
 exception when others then failed:=true;end;
 if not failed then raise exception 'TASK during break accepted';end if;
 select * into strict receipt from public.qf_vox_staff_time_atomic_candidate_v1(
 a,t,c,'BREAK_END','00000000-0000-4000-8000-000000000709',4,null);
 if receipt.revision<>5 then raise exception 'BREAK_END invalid';end if;
 select * into strict receipt from public.qf_vox_staff_time_atomic_candidate_v1(
 a,t,c,'CLOCK_OUT','00000000-0000-4000-8000-000000000710',5,null);
 if receipt.revision<>6 then raise exception 'CLOCK_OUT invalid';end if;
 if (select revision from public.vox_vo2_staff_time_state_candidate_v1
     where staff_id=a)<>6 or
    (select count(*) from public.vox_vo2_staff_time_events_candidate_v1
     where staff_id=a)<>6 then raise exception 'EVENT_LEDGER missed or duplicated';end if;
 -- Revoked Staff membership prevents any further shift, including nonce replay.
 update public.vox_staff_memberships_v1 set revoked_at=clock_timestamp()
 where auth_user_id=a;
 failed:=false;
 begin
 perform public.qf_vox_staff_time_atomic_candidate_v1(
 a,t,c,'CLOCK_IN','00000000-0000-4000-8000-000000000711',6,null);
 exception when others then failed:=true;end;
 if not failed then raise exception 'REVOKED Staff recorded attendance';end if;
 -- No direct read/write of sensitive time records from ordinary browser roles.
 if has_table_privilege('authenticated',
   'public.vox_vo2_staff_time_state_candidate_v1','SELECT') or
    has_table_privilege('anon',
   'public.vox_vo2_staff_time_events_candidate_v1','INSERT') or
    has_function_privilege('authenticated',
   'public.qf_vox_staff_time_atomic_candidate_v1(uuid,uuid,uuid,text,uuid,integer,uuid)',
   'EXECUTE') then raise exception 'TIME ledger ACL is overly permissive';end if;
 if (select count(*) from pg_class where oid in (
    'public.vox_vo2_staff_time_state_candidate_v1'::regclass,
    'public.vox_vo2_staff_time_events_candidate_v1'::regclass)
    and relrowsecurity and relforcerowsecurity)<>2 then
  raise exception 'ROW LEVEL SECURITY not enforced';end if;
end;
$test$;
select 'VO2_PG17_ATOMIC_TIME_SOURCE_PASS' as result;
