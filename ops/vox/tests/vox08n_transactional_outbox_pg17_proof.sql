-- SOURCE-ONLY synthetic proof on the isolated genuine Staging PG17 restore.
-- Deliberately inserts artificial Core rows ONLY into a disposable clone.
-- Outside this script, no Staff or work notifications were created anywhere.
begin;
do $test$
declare city uuid;actor uuid;team uuid:=gen_random_uuid();
 item uuid:=gen_random_uuid();event1 uuid:=gen_random_uuid();
 event2 uuid:=gen_random_uuid();worker uuid:=gen_random_uuid();
 rogue uuid:=gen_random_uuid();nonce uuid:=gen_random_uuid();
 claimed record;served record;failed record;count_rows integer;test_state text;
begin
 select id into city from public.cities order by id limit 1;
 select id into actor from public.profiles order by id limit 1;
 if city is null or actor is null then
  raise exception 'VOX08N_STAGE_BASELINE_MISSING_CITY_OR_PROFILE';end if;
 -- Unrelated disposable synthetic work item; no granted Staff user.
 insert into public.vox_staff_teams_v1(id,team_name,city_id,is_active,created_by)
 values(team,'offline-vox08n-'||substring(team::text,1,8),city,false,actor);
 insert into public.vox_work_items_candidate_v1
 (id,team_id,city_id,source_kind,source_id,state,revision)
 values(item,team,city,'prospect',gen_random_uuid(),'ASSIGNED',1);
 insert into public.vox_work_events_candidate_v1
 (id,work_item_id,actor_id,event_nonce,event_type,from_state,to_state,
  from_revision,to_revision,reason)
 values(event1,item,actor,nonce,'CLAIM','NEW','ASSIGNED',0,1,'');
 select count(*) into count_rows
 from public.vox_staff_notification_outbox_candidate_v1
 where work_event_id=event1;
 if count_rows<>1 then raise exception 'VOX08N_TRIGGER_DID_NOT_RECORD_ATOMIC_OUTBOX';end if;
 -- Service RPCs are NOT granted to anon or an ordinary authenticated JWT.
 select count(*) into count_rows
 from pg_catalog.pg_proc f join pg_catalog.pg_namespace n on n.oid=f.pronamespace
 where n.nspname='public' and f.proname in
 ('qf_vox_staff_notification_outbox_claim_v1',
 'qf_vox_staff_notification_outbox_process_v1',
 'qf_vox_staff_notification_outbox_fail_v1')
 and f.prosecdef
 and not pg_catalog.has_function_privilege('anon',f.oid,'EXECUTE')
 and not pg_catalog.has_function_privilege('authenticated',f.oid,'EXECUTE')
 and pg_catalog.has_function_privilege('service_role',f.oid,'EXECUTE');
 if count_rows<>3 then raise exception 'VOX08N_UNSAFE_WORKER_GRANTS';end if;
 select count(*) into count_rows from pg_catalog.pg_class c
 join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='vox_staff_notification_outbox_candidate_v1'
 and c.relrowsecurity and c.relforcerowsecurity
 and not pg_catalog.has_table_privilege('anon',c.oid,'SELECT')
 and not pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT');
 if count_rows<>1 then raise exception 'VOX08N_OUTBOX_RLS_NOT_FORCED';end if;
 select * into claimed from public.qf_vox_staff_notification_outbox_claim_v1(worker,1,60);
 if not found or claimed.work_event_id<>event1 or claimed.attempt<>1 or claimed.lease_token is null
 then raise exception 'VOX08N_VALID_WORKER_CANNOT_CLAIM';end if;
 -- Wrong worker and wrong lease token fail before writing anything.
 begin
  perform * from public.qf_vox_staff_notification_outbox_process_v1(rogue,claimed.job_id,claimed.lease_token);
  raise exception 'VOX08N_FORGED_WORKER_ACCEPTED';
 exception when others then
  if sqlerrm='VOX08N_FORGED_WORKER_ACCEPTED' then raise;end if;
 end;
 begin
  perform * from public.qf_vox_staff_notification_outbox_process_v1(worker,claimed.job_id,rogue);
  raise exception 'VOX08N_FORGED_TOKEN_ACCEPTED';
 exception when others then
  if sqlerrm='VOX08N_FORGED_TOKEN_ACCEPTED' then raise;end if;
 end;
 select * into served from public.qf_vox_staff_notification_outbox_process_v1(
  worker,claimed.job_id,claimed.lease_token);
 if not found or served.job_id<>claimed.job_id or served.internal_records<>0
 then raise exception 'VOX08N_VALID_PROCESS_INCORRECT';end if;
 if not exists(select 1 from public.vox_staff_notification_outbox_candidate_v1
  where id=claimed.job_id and state='DONE' and attempts=1
   and delivered_internal_count=0 and lease_token is null)
 then raise exception 'VOX08N_NO_ATOMIC_COMPLETE';end if;
 begin
  perform * from public.qf_vox_staff_notification_outbox_process_v1(worker,claimed.job_id,claimed.lease_token);
  raise exception 'VOX08N_REPLAY_PROCESSED_AGAIN';
 exception when others then
  if sqlerrm='VOX08N_REPLAY_PROCESSED_AGAIN' then raise;end if;
 end;
 -- Independent synthetic second event: retry-safe error handling.
 update public.vox_work_items_candidate_v1
 set state='IN_PROGRESS',revision=2 where id=item;
 insert into public.vox_work_events_candidate_v1
 (id,work_item_id,actor_id,event_nonce,event_type,from_state,to_state,
  from_revision,to_revision,reason)
 values(event2,item,actor,gen_random_uuid(),'START','ASSIGNED','IN_PROGRESS',1,2,'');
 select * into claimed from public.qf_vox_staff_notification_outbox_claim_v1(worker,1,60);
 if not found or claimed.work_event_id<>event2
 then raise exception 'VOX08N_SECOND_REAL_EVENT_MISSING';end if;
 select * into failed from public.qf_vox_staff_notification_outbox_fail_v1(
  worker,claimed.job_id,claimed.lease_token,'SQL_TRANSIENT');
 if failed.new_state<>'PENDING' or failed.attempt<>1
 then raise exception 'VOX08N_RETRY_NOT_SCHEDULED';end if;
 select count(*) into count_rows
 from public.qf_vox_staff_notification_outbox_claim_v1(worker,1,60);
 if count_rows<>0 then raise exception 'VOX08N_RETRY_DID_NOT_RESPECT_BACKOFF';end if;
 -- Artificial clock elapse inside disposable DB only.
 update public.vox_staff_notification_outbox_candidate_v1
 set next_attempt_at=clock_timestamp()-interval '1 minute',attempts=4
 where id=claimed.job_id and state='PENDING';
 select * into claimed from public.qf_vox_staff_notification_outbox_claim_v1(worker,1,60);
 if not found or claimed.work_event_id<>event2 or claimed.attempt<>5
 then raise exception 'VOX08N_FINAL_ATTEMPT_NOT_CLAIMED';end if;
 select * into failed from public.qf_vox_staff_notification_outbox_fail_v1(
  worker,claimed.job_id,claimed.lease_token,'SQL_TRANSIENT');
 if failed.new_state<>'DEAD_LETTER' or failed.attempt<>5
 then raise exception 'VOX08N_FINAL_ATTEMPT_NOT_DEAD_LETTERED';end if;
 -- A third real work event: a crashed lease may be reclaimed, and old
 -- lease tokens lose authority. This is an entirely disposable fixture.
 update public.vox_work_items_candidate_v1
 set state='BLOCKED',revision=3 where id=item;
 insert into public.vox_work_events_candidate_v1
 (work_item_id,actor_id,event_nonce,event_type,from_state,to_state,
  from_revision,to_revision,reason)
 values(item,actor,gen_random_uuid(),'BLOCK','IN_PROGRESS','BLOCKED',2,3,
  'Synthetic offline block');
 select * into claimed from public.qf_vox_staff_notification_outbox_claim_v1(worker,1,60);
 if not found or claimed.attempt<>1
 then raise exception 'VOX08N_CRASH_RECOVERY_CLAIM_ABSENT';end if;
 nonce:=claimed.lease_token;
 -- Simulate an expired lease only inside the disposable test database.
 update public.vox_staff_notification_outbox_candidate_v1
 set lease_until=clock_timestamp()-interval '1 minute',
 next_attempt_at=clock_timestamp()-interval '1 minute'
 where id=claimed.job_id;
 select * into claimed from public.qf_vox_staff_notification_outbox_claim_v1(rogue,1,60);
 if not found or claimed.attempt<>2 or claimed.lease_token=nonce
 then raise exception 'VOX08N_EXPIRED_LEASE_NOT_RECLAIMED';end if;
 begin
  perform * from public.qf_vox_staff_notification_outbox_process_v1(worker,claimed.job_id,nonce);
  raise exception 'VOX08N_OLD_LEASE_ACCEPTED';
 exception when others then
  if sqlerrm='VOX08N_OLD_LEASE_ACCEPTED' then raise;end if;
 end;
 select * into served from public.qf_vox_staff_notification_outbox_process_v1(
  rogue,claimed.job_id,claimed.lease_token);
 if not found or served.internal_records<>0
 then raise exception 'VOX08N_RECLAIMED_PROCESS_NOT_ATOMIC';end if;
 -- Trigger rejects unknown transition-event categories as part of the
 -- insertion transaction, rather than silently skipping its outbox intent.
 begin
  insert into public.vox_work_events_candidate_v1
  (work_item_id,actor_id,event_nonce,event_type,from_state,to_state,
    from_revision,to_revision,reason)
  values(item,actor,gen_random_uuid(),'EXTERNAL_MESSAGE','BLOCKED','DONE',3,4,
    'Unsupported synthetic provider event');
  raise exception 'VOX08N_UNKNOWN_EVENT_DID_NOT_ROLLBACK';
 exception when others then
  if sqlerrm='VOX08N_UNKNOWN_EVENT_DID_NOT_ROLLBACK' then raise;end if;
 end;
 select count(*) into count_rows from public.vox_staff_work_notifications_candidate_v1;
 if count_rows<>0 then raise exception 'VOX08N_TEST_CREATED_UNAUTHORIZED_STAFF_NOTIFICATION';end if;
 select count(*) into count_rows from supabase_migrations.schema_migrations;
 if count_rows<>86 then raise exception 'VOX08N_STAGING_MIGRATION_HISTORY_MODIFIED';end if;
 perform 1;
end $test$;
rollback;
