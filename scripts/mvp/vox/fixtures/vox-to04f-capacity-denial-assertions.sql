-- Disposable PG17-only, executes after 50 distinct concurrent claims.
-- Check actual committed rows; inspect SQLSTATE *inside* PostgreSQL.
do $vox_capacity$
declare
 target uuid;
 error_message text;
 denied boolean:=false;
begin
 if (select count(*) from public.vox_work_items_candidate_v1
     where assignee_id='00000000-0000-4000-8000-000000000001'
       and state<>'DONE')<>24
 then raise exception 'CAPACITY_TOTAL_NOT_24'; end if;
 if (select count(*) from public.vox_work_items_candidate_v1
     where right(id::text,12)::bigint between 2001 and 2050
       and state='ASSIGNED' and revision=1)<>21
 then raise exception 'CAPACITY_WINNERS_NOT_21'; end if;
 if (select count(*) from public.vox_work_items_candidate_v1
     where right(id::text,12)::bigint between 2001 and 2050
       and state='NEW' and assignee_id is null and revision=0)<>29
 then raise exception 'CAPACITY_UNASSIGNED_NOT_29'; end if;
 if (select count(*) from public.vox_work_events_candidate_v1 e
     join public.vox_work_items_candidate_v1 w on w.id=e.work_item_id
     where right(w.id::text,12)::bigint between 2001 and 2050)<>21
 then raise exception 'CAPACITY_EVENT_LEDGER_NOT_21'; end if;
 select id into target
 from public.vox_work_items_candidate_v1
 where right(id::text,12)::bigint between 2001 and 2050
   and state='NEW' and revision=0
 order by id limit 1;
 if target is null then raise exception 'NO_UNASSIGNED_ITEM'; end if;
 begin
   perform public.qf_vox_work_transition_candidate_v1(
    '00000000-0000-4000-8000-000000000001',
    target,0,gen_random_uuid(),'CLAIM','');
 exception when sqlstate 'P0001' then
   get stacked diagnostics error_message=MESSAGE_TEXT;
   if error_message='VOX_WORK_STAFF_CAPACITY_REACHED' then
     denied:=true;
   else
     raise exception 'WRONG_REJECTION_ERROR: %',error_message;
   end if;
 end;
 if not denied then raise exception 'OVER_CAPACITY_CLAIM_ACCEPTED'; end if;
 if (select count(*) from public.vox_work_events_candidate_v1
    where work_item_id=target)<>0
 then raise exception 'DENIED_CLAIM_APPENDED_AUDIT'; end if;
 if (select revision from public.vox_work_items_candidate_v1
    where id=target)<>0
 then raise exception 'DENIED_CLAIM_CHANGED_WORK'; end if;
end
$vox_capacity$;
select 'VOX_TO04F_DISTINCT_ITEM_CAPACITY_PG17_AND_ERROR_CODE_PASS' as result;
