-- VO6 real disposable PG17 assertions; synthetic, no managed DB.
\set ON_ERROR_STOP on
do $verify$
declare
 actor uuid:='00000000-0000-4000-8000-000000000001';
 leader uuid:='00000000-0000-4000-8000-000000000003';
 team uuid:='00000000-0000-4000-8000-000000000201';
 record_row record;
 denied boolean;
begin
 select * into strict record_row
 from public.qf_vox_staff_presence_signal_candidate_v1(actor,team,'ONLINE');
 if record_row.staff_id<>actor or record_row.team_id<>team or
    record_row.city_id<>'00000000-0000-4000-8000-000000000101' or
    record_row.state<>'ONLINE' or record_row.seen_at is null
 then raise exception 'VO6_PRESENCE_WRONG_RECEIPT';end if;
 select * into strict record_row
 from public.qf_vox_staff_presence_signal_candidate_v1(actor,team,'AWAY');
 if record_row.state<>'AWAY' or
  (select count(*) from public.vox_vo6_staff_presence_observations_candidate_v1
   where staff_id=actor)<>1
 then raise exception 'VO6_PRESENCE_NOT_ATOMIC_UPSERT';end if;
 select * into strict record_row
 from public.qf_vox_staff_presence_signal_candidate_v1(leader,team,'BUSY');
 if record_row.staff_id<>leader then raise exception 'VO6_TL_SIGNAL_WRONG_ACTOR';end if;
 denied:=false;
 begin perform public.qf_vox_staff_presence_signal_candidate_v1(
  actor,'00000000-0000-4000-8000-000000000202','ONLINE');
 exception when others then denied:=true;end;
 if not denied then raise exception 'VO6_CROSS_TEAM_ALLOWED';end if;
 denied:=false;
 begin perform public.qf_vox_staff_presence_signal_candidate_v1(
  '00000000-0000-4000-8000-000000000002',team,'ONLINE');
 exception when others then denied:=true;end;
 if not denied then raise exception 'VO6_OWNER_ADMIN_IMPERSONATED_STAFF';end if;
 denied:=false;
 begin perform public.qf_vox_staff_presence_signal_candidate_v1(
  actor,team,'OFFLINE');
 exception when others then denied:=true;end;
 if not denied then raise exception 'VO6_FAKE_OFFLINE_WRITE_ALLOWED';end if;
 denied:=false;
 begin perform public.qf_vox_staff_presence_signal_candidate_v1(
  actor,team,'PAYROLL_APPROVED');
 exception when others then denied:=true;end;
 if not denied then raise exception 'VO6_PAYROLL_STATUS_ALLOWED';end if;
 update public.vox_staff_memberships_v1 set revoked_at=clock_timestamp()
 where auth_user_id=actor;
 denied:=false;
 begin perform public.qf_vox_staff_presence_signal_candidate_v1(
  actor,team,'ONLINE');
 exception when others then denied:=true;end;
 if not denied then raise exception 'VO6_REVOKED_STAFF_ALLOWED';end if;
 update public.vox_staff_memberships_v1 set revoked_at=null where auth_user_id=actor;
 if has_table_privilege('anon',
  'public.vox_vo6_staff_presence_observations_candidate_v1','SELECT') or
  has_table_privilege('authenticated',
  'public.vox_vo6_staff_presence_observations_candidate_v1','UPDATE') or
  has_function_privilege('authenticated',
  'public.qf_vox_staff_presence_signal_candidate_v1(uuid,uuid,text)','EXECUTE')
 then raise exception 'VO6_PUBLIC_ROLE_PRIVILEGE_EXPOSED';end if;
 if not exists(select 1 from pg_class where oid=
  'public.vox_vo6_staff_presence_observations_candidate_v1'::regclass
  and relrowsecurity and relforcerowsecurity)
 then raise exception 'VO6_PRESENCE_RLS_NOT_FORCED';end if;
end;
$verify$;
select 'VO6_PRESENCE_SQL_AUTHORITATIVE_GATES_PASS' as result;
