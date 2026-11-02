-- VOX-08L OFFLINE ONLY, run AFTER reviewed candidate SQL chain.
-- Security proof does not create live Auth users or turn on deliveries.
do $test$
declare n integer;fake uuid:='00000000-0000-4000-8000-000000000321';
begin
 select count(*) into n from pg_catalog.pg_class c
 join pg_catalog.pg_namespace s on s.oid=c.relnamespace
 where s.nspname='public' and c.relname='vox_staff_work_notifications_candidate_v1'
  and c.relrowsecurity and c.relforcerowsecurity
  and not pg_catalog.has_table_privilege('anon',c.oid,'SELECT')
  and not pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT')
  and not pg_catalog.has_table_privilege('anon',c.oid,'INSERT')
  and not pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT');
 if n<>1 then raise exception 'VOX08L_FORCE_RLS_OR_GRANTS_FAIL';end if;
 select count(*) into n from pg_catalog.pg_proc f
 join pg_catalog.pg_namespace s on s.oid=f.pronamespace
 where s.nspname='public'
  and f.proname in (
  'qf_vox_staff_notification_scope_v1',
  'qf_vox_staff_notification_enqueue_v1',
  'qf_vox_staff_notification_inbox_v1',
  'qf_vox_staff_notification_mark_read_v1')
  and f.prosecdef
  and array_to_string(f.proconfig,',') like '%search_path%'
  and not pg_catalog.has_function_privilege('anon',f.oid,'EXECUTE')
  and not pg_catalog.has_function_privilege('authenticated',f.oid,'EXECUTE')
  and pg_catalog.has_function_privilege('service_role',f.oid,'EXECUTE');
 if n<>4 then raise exception 'VOX08L_RPC_NOT_ISOLATED (%)',n;end if;
 if public.qf_vox_staff_notification_scope_v1(fake,fake)<>false
 then raise exception 'VOX08L_FORGED_SCOPE_ACCEPTED';end if;
 if exists(select 1 from public.qf_vox_staff_notification_inbox_v1(fake))
 then raise exception 'VOX08L_FORGED_USER_INBOX_NONEMPTY';end if;
 begin
  perform * from public.qf_vox_staff_notification_enqueue_v1(fake,fake);
  raise exception 'VOX08L_FAKE_EVENT_ACCEPTED';
 exception when others then
  if sqlerrm='VOX08L_FAKE_EVENT_ACCEPTED' then raise;end if;
 end;
 begin
  perform * from public.qf_vox_staff_notification_mark_read_v1(fake,fake,fake,0);
  raise exception 'VOX08L_FAKE_RECEIPT_ACCEPTED';
 exception when others then
  if sqlerrm='VOX08L_FAKE_RECEIPT_ACCEPTED' then raise;end if;
 end;
 if (select count(*) from public.vox_staff_work_notifications_candidate_v1)<>0
 then raise exception 'VOX08L_FORGED_USER_CREATED_NOTICE';end if;
 if (select count(*) from supabase_migrations.schema_migrations)<>86
 then raise exception 'VOX08L_HISTORY_CHANGED';end if;
 perform 1;
end $test$;
