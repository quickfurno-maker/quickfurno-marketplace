-- VOX-08R actual SQL proof inside disposable Staging PostgreSQL17 ONLY.
-- All writes are to a single test transaction ROLLED BACK.
begin;
do $verify$
declare v_metric jsonb;v_city uuid;v_actor uuid;v_team uuid:=gen_random_uuid();
 v_item uuid:=gen_random_uuid();v_event uuid:=gen_random_uuid();
 n integer;
begin
 select count(*) into n from pg_catalog.pg_proc p
 join pg_catalog.pg_namespace s on s.oid=p.pronamespace
 where s.nspname='public'
 and p.proname='qf_vox_staff_notification_outbox_metrics_v1'
 and p.prosecdef
 and not pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
 and not pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
 and pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE');
 if n<>1 then raise exception 'VOX08R_METRICS_RPC_GRANTS_FAILED';end if;
 v_metric:=public.qf_vox_staff_notification_outbox_metrics_v1();
 if v_metric->>'schema'<>'qf.vox.internal-notification-outbox.metrics.v1'
  or v_metric->>'source'<>'QUICKFURNO_CORE'
  or v_metric->>'totalKnown'<>'false'
  or v_metric->>'includesExternalProviderDelivery'<>'false'
  or (v_metric->>'pending')::integer<>0
  or v_metric->'oldestPendingAgeSeconds'<>'null'::jsonb
 then raise exception 'VOX08R_INITIAL_AGGREGATION_FAILED';end if;
 if (v_metric ? 'clientId') or (v_metric ? 'staffUserId') or
  (v_metric ? 'jobId') or (v_metric ? 'providerSent') or
  (select count(*) from jsonb_object_keys(v_metric))<>12
 then raise exception 'VOX08R_UNSAFE_METRICS_SCHEMA';end if;
 select id into v_city from public.cities limit 1;
 select id into v_actor from public.profiles limit 1;
 if v_city is null or v_actor is null then
  raise exception 'VOX08R_BASELINE_STAGING_FIXTURE_MISSING';end if;
 insert into public.vox_staff_teams_v1(id,team_name,city_id,is_active,created_by)
 values(v_team,'vox08r-synthetic-'||left(v_team::text,8),v_city,false,v_actor);
 insert into public.vox_work_items_candidate_v1
 (id,team_id,city_id,source_kind,source_id,state,revision)
 values(v_item,v_team,v_city,'prospect',gen_random_uuid(),'ASSIGNED',1);
 insert into public.vox_work_events_candidate_v1
 (id,work_item_id,actor_id,event_nonce,event_type,from_state,to_state,
  from_revision,to_revision,reason)
 values(v_event,v_item,v_actor,gen_random_uuid(),
 'CLAIM','NEW','ASSIGNED',0,1,'');
 v_metric:=public.qf_vox_staff_notification_outbox_metrics_v1();
 if (v_metric->>'pending')::integer<>1 or
    (v_metric->>'leased')::integer<>0 or
    (v_metric->>'completed')::integer<>0 or
    (v_metric->>'deadLetter')::integer<>0 or
    (v_metric->>'oldestPendingAgeSeconds')::integer<0
 then raise exception 'VOX08R_PENDING_OUTBOX_AGGREGATION_FAILED';end if;
 update public.vox_staff_notification_outbox_candidate_v1
 set state='DEAD_LETTER',attempts=5,completed_at=clock_timestamp(),
  last_error_code='RETRY_TIMEOUT'
 where work_event_id=v_event;
 v_metric:=public.qf_vox_staff_notification_outbox_metrics_v1();
 if (v_metric->>'pending')::integer<>0 or
    (v_metric->>'deadLetter')::integer<>1 or
    (v_metric->>'maxAttemptsObserved')::integer<>5 or
    v_metric->'oldestPendingAgeSeconds'<>'null'::jsonb
 then raise exception 'VOX08R_DEAD_LETTER_AGGREGATION_FAILED';end if;
 if (select count(*) from supabase_migrations.schema_migrations)<>86
 then raise exception 'VOX08R_MODIFIED_STAGING_MIGRATION_HISTORY';end if;
end $verify$;
rollback;
