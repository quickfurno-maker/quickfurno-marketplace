-- Disposable PG17-only integrated baseline; no live Staff, Auth or DB used.
-- Seed exactly 3 permitted active claims BEFORE the 50-distinct-item race.
insert into public.vox_work_items_candidate_v1
 (id,team_id,city_id,source_kind,source_id)
select ('00000000-0000-4000-8000-' || lpad((750+n)::text,12,'0'))::uuid,
 '00000000-0000-4000-8000-000000000201'::uuid,
 '00000000-0000-4000-8000-000000000101'::uuid,
 'prospect','00000000-0000-4000-8000-000000000301'::uuid
from generate_series(0,2) as n;
do $vox_baseline$
declare v_id uuid;
begin
 for v_id in select id from public.vox_work_items_candidate_v1
   where right(id::text,12)::bigint between 750 and 752 order by id
 loop
  perform public.qf_vox_work_transition_candidate_v1(
   '00000000-0000-4000-8000-000000000001'::uuid,
   v_id,0,gen_random_uuid(),'CLAIM','');
 end loop;
 if (select count(*) from public.vox_work_items_candidate_v1
   where assignee_id='00000000-0000-4000-8000-000000000001'
   and state<>'DONE')<>3
 then raise exception 'TO04H_BASELINE_ACTIVE_ITEMS_NOT_THREE'; end if;
end
$vox_baseline$;
select 'VOX_TO04H_THREE_ACTIVE_TASKS_SYNTHETIC_BASELINE_PASS' as result;
