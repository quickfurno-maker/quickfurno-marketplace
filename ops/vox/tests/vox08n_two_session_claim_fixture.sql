-- Synthetic fixture ONLY for a fresh disposable network-none staging clone.
-- Must never be installed or run on managed Staging/Production.
begin;
do $fixture$
declare v_city uuid;v_actor uuid;v_team uuid:=gen_random_uuid();
 v_item uuid:=gen_random_uuid();
begin
 select id into v_city from public.cities order by id limit 1;
 select id into v_actor from public.profiles order by id limit 1;
 if v_city is null or v_actor is null then
  raise exception 'VOX08N_NO_ISOLATED_TEST_FIXTURE_PREREQUISITES';end if;
 if exists(select 1 from public.vox_staff_notification_outbox_candidate_v1)
 then raise exception 'VOX08N_TWO_SESSION_TEST_REQUIRES_EMPTY_OUTBOX';end if;
 insert into public.vox_staff_teams_v1
 (id,team_name,city_id,is_active,created_by)
 values(v_team,'vox08n-isolated-2session-'||substring(v_team::text,1,8),
  v_city,false,v_actor);
 insert into public.vox_work_items_candidate_v1
 (id,team_id,city_id,source_kind,source_id,state,revision)
 values(v_item,v_team,v_city,'prospect',gen_random_uuid(),'ASSIGNED',1);
 insert into public.vox_work_events_candidate_v1
 (work_item_id,actor_id,event_nonce,event_type,from_state,
  to_state,from_revision,to_revision,reason)
 values(v_item,v_actor,gen_random_uuid(),'CLAIM','NEW','ASSIGNED',0,1,'');
 if (select count(*) from public.vox_staff_notification_outbox_candidate_v1)<>1
 then raise exception 'VOX08N_TWO_SESSION_TRIGGER_DID_NOT_CREATE_ONE_INTENT';end if;
end $fixture$;
commit;
