-- VOX-08J synthetic/offline-only authorization assertions. Run as
-- isolated PG17 postgres AFTER six candidate foundation/department/work/EOD/chat files.
-- This test intentionally includes no real user identities or credentials.
do $test$
declare n int; x uuid:='00000000-0000-4000-8000-000000000321';
begin
 select count(*) into n from pg_catalog.pg_class c
 join pg_catalog.pg_namespace s on s.oid=c.relnamespace
 where s.nspname='public' and c.relname in
 ('vox_staff_eod_reports_candidate_v1',
  'vox_staff_eod_review_events_candidate_v1',
  'vox_staff_team_messages_candidate_v1')
 and c.relrowsecurity and c.relforcerowsecurity;
 if n<>3 then raise exception 'VOX08J_RLS_NOT_FORCED (%)',n;end if;

 select count(*) into n from pg_catalog.pg_class c
 join pg_catalog.pg_namespace s on s.oid=c.relnamespace
 where s.nspname='public' and c.relname in
 ('vox_staff_eod_reports_candidate_v1',
  'vox_staff_eod_review_events_candidate_v1',
  'vox_staff_team_messages_candidate_v1')
 and (pg_catalog.has_table_privilege('anon',c.oid,'SELECT') or
      pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT') or
      pg_catalog.has_table_privilege('anon',c.oid,'INSERT') or
      pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT'));
 if n<>0 then raise exception 'VOX08J_PUBLIC_TABLE_GRANTS (%)',n;end if;

 select count(*) into n from pg_catalog.pg_proc f
 join pg_catalog.pg_namespace s on s.oid=f.pronamespace
 where s.nspname='public' and f.proname in
 ('qf_vox_eod_submit_candidate_v1','qf_vox_eod_review_candidate_v1',
  'qf_vox_staff_team_chat_send_candidate_v1')
 and f.prosecdef
 and f.proconfig is not null
 and array_to_string(f.proconfig,',') like '%search_path%'
 and not pg_catalog.has_function_privilege('anon',f.oid,'EXECUTE')
 and not pg_catalog.has_function_privilege('authenticated',f.oid,'EXECUTE')
 and pg_catalog.has_function_privilege('service_role',f.oid,'EXECUTE');
 if n<>3 then raise exception 'VOX08J_RPC_GRANTS_OR_SEARCH_PATH (%)',n;end if;

 if (select count(*) from public.vox_staff_eod_reports_candidate_v1)<>0
 or (select count(*) from public.vox_staff_eod_review_events_candidate_v1)<>0
 or (select count(*) from public.vox_staff_team_messages_candidate_v1)<>0
 then raise exception 'VOX08J_TEST_NOT_ISOLATED';end if;

 begin
 perform * from public.qf_vox_eod_submit_candidate_v1(x,x,
   (clock_timestamp() at time zone 'Asia/Kolkata')::date);
 raise exception 'VOX08J_EOD_FAKE_ACTOR_ACCEPTED';
 exception when others then
  if sqlerrm='VOX08J_EOD_FAKE_ACTOR_ACCEPTED' then raise;end if;
 end;

 begin
 perform * from public.qf_vox_eod_review_candidate_v1(x,x,0,x,'ACKNOWLEDGED');
 raise exception 'VOX08J_FAKE_TL_ACCEPTED';
 exception when others then
  if sqlerrm='VOX08J_FAKE_TL_ACCEPTED' then raise;end if;
 end;

 begin
 perform * from public.qf_vox_staff_team_chat_send_candidate_v1(x,x,x,'Hi internal team');
 raise exception 'VOX08J_FAKE_CHAT_ACCEPTED';
 exception when others then
  if sqlerrm='VOX08J_FAKE_CHAT_ACCEPTED' then raise;end if;
 end;

 if (select count(*) from public.vox_staff_eod_reports_candidate_v1)<>0
 or (select count(*) from public.vox_staff_eod_review_events_candidate_v1)<>0
 or (select count(*) from public.vox_staff_team_messages_candidate_v1)<>0
 then raise exception 'VOX08J_FAKE_ACTOR_CREATED_ROWS';end if;

 if (select count(*) from supabase_migrations.schema_migrations)<>86
 then raise exception 'VOX08J_ORIGINAL_MIGRATION_HISTORY_TOUCHED';end if;
 -- Successful DO completion verifies all assertions; avoid emitting a NOTICE
 -- to PowerShell's strict native-stderr policy.
 perform 1;
end $test$;
