-- VOX-08N SOURCE-ONLY. NOT a managed Supabase migration.
-- Zero external provider transport: queues only a persisted Core work event and
-- later fans out to currently eligible neutral Staff inbox records.
-- Critical predecessor: independently reviewed single Staff/department/08L SQL.
begin;
create table public.vox_staff_notification_outbox_candidate_v1(
 id uuid primary key default gen_random_uuid(),
 work_event_id uuid not null unique references public.vox_work_events_candidate_v1(id) on delete restrict,
 work_item_id uuid not null references public.vox_work_items_candidate_v1(id) on delete restrict,
 team_id uuid not null references public.vox_staff_teams_v1(id) on delete restrict,
 city_id uuid not null references public.cities(id) on delete restrict,
 state text not null default 'PENDING'
  check(state in ('PENDING','LEASED','DONE','DEAD_LETTER')),
 attempts integer not null default 0 check(attempts between 0 and 5),
 next_attempt_at timestamptz not null default clock_timestamp(),
 lease_owner uuid,
 lease_token uuid unique,
 lease_until timestamptz,
 delivered_internal_count integer not null default 0 check(delivered_internal_count between 0 and 100),
 last_error_code text check(last_error_code in
  ('SQL_TRANSIENT','SCOPE_REVOKED','RETRY_TIMEOUT','REPLAY_CONFLICT','INTERNAL_ONLY')),
 completed_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 constraint vox_notif_outbox_lease_state check(
  (state='PENDING' and lease_owner is null and lease_token is null
   and lease_until is null and completed_at is null)
  or (state='LEASED' and lease_owner is not null and lease_token is not null
   and lease_until is not null and completed_at is null)
  or (state in ('DONE','DEAD_LETTER') and lease_owner is null
   and lease_token is null and lease_until is null and completed_at is not null)
 )
);
create index vox_notif_outbox_due_v1
 on public.vox_staff_notification_outbox_candidate_v1
 (next_attempt_at,created_at,id)
 where state in ('PENDING','LEASED');

alter table public.vox_staff_notification_outbox_candidate_v1 enable row level security;
alter table public.vox_staff_notification_outbox_candidate_v1 force row level security;
revoke all on public.vox_staff_notification_outbox_candidate_v1
 from public,anon,authenticated;
grant select on public.vox_staff_notification_outbox_candidate_v1 to service_role;

-- A work-event INSERT atomically creates an IN-APP ONLY outbox intention.
-- As the table exists ONLY in an unapproved candidate, this trigger is not
-- live in protected Staging or Production.
create function public.qf_vox_staff_notification_outbox_event_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare w record;
begin
 if new.event_type not in
 ('CLAIM','START','COMPLETE','BLOCK','REQUEST_APPROVAL','WAIT_EXTERNAL','RESUME')
 then raise exception 'VOX_NOTIF_OUTBOX_UNSUPPORTED_EVENT';end if;
 select id,team_id,city_id into w
 from public.vox_work_items_candidate_v1 where id=new.work_item_id;
 if not found then raise exception 'VOX_NOTIF_OUTBOX_SOURCE_MISSING';end if;
 insert into public.vox_staff_notification_outbox_candidate_v1
 (work_event_id,work_item_id,team_id,city_id)
 values(new.id,w.id,w.team_id,w.city_id);
 return new;
end;
$$;
create trigger qf_vox_staff_notification_outbox_on_event_v1
 after insert on public.vox_work_events_candidate_v1
 for each row execute function public.qf_vox_staff_notification_outbox_event_v1();

-- A lease owner is only a Core service-role worker identity, never a Staff JWT.
-- SKIP LOCKED prevents duplicate claims. Crashed final attempt becomes DLQ.
create function public.qf_vox_staff_notification_outbox_claim_v1(
 p_worker uuid,p_batch integer,p_lease_seconds integer
) returns table(job_id uuid,work_event_id uuid,lease_token uuid,attempt integer)
language plpgsql security definer set search_path='' as $$
begin
 if p_worker is null or p_batch is null or p_batch not between 1 and 10
  or p_lease_seconds is null or p_lease_seconds not between 30 and 300
 then raise exception 'VOX_NOTIF_BAD_CLAIM_WINDOW';end if;
 update public.vox_staff_notification_outbox_candidate_v1 j
 set state='DEAD_LETTER',completed_at=clock_timestamp(),
  last_error_code='RETRY_TIMEOUT',lease_owner=null,lease_token=null,lease_until=null
 where j.state='LEASED' and j.lease_until<clock_timestamp()
  and j.attempts>=5;
 return query
 with chosen as (
  select j.id from public.vox_staff_notification_outbox_candidate_v1 j
  where j.attempts<5 and j.next_attempt_at<=clock_timestamp()
   and (j.state='PENDING' or
    (j.state='LEASED' and j.lease_until<clock_timestamp()))
  order by j.next_attempt_at,j.created_at,j.id
  for update skip locked limit p_batch
 ), claimed as (
  update public.vox_staff_notification_outbox_candidate_v1 j
  set state='LEASED',lease_owner=p_worker,lease_token=gen_random_uuid(),
   lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),
   attempts=j.attempts+1
  from chosen where j.id=chosen.id
  returning j.id,j.work_event_id,j.lease_token,j.attempts
 )
 select c.id,c.work_event_id,c.lease_token,c.attempts from claimed c;
end;
$$;

-- Process one OWNED, UNEXPIRED job. All recipient inserts + DONE marker commit
-- together, and no external transport leaves PostgreSQL.
-- Current Staff/membership/team/city, *independently approved department*,
-- original object and dual vendor support rights are rechecked by 08L helper.
create function public.qf_vox_staff_notification_outbox_process_v1(
 p_worker uuid,p_job uuid,p_token uuid
) returns table(job_id uuid,internal_records integer)
language plpgsql security definer set search_path='' as $$
declare j public.vox_staff_notification_outbox_candidate_v1%rowtype;
 ev record; target record; count_internal integer:=0; count_candidates integer:=0;
 receipt record;
begin
 if p_worker is null or p_job is null or p_token is null
 then raise exception 'VOX_NOTIF_INVALID_LEASE';end if;
 select * into j from public.vox_staff_notification_outbox_candidate_v1
 where id=p_job for update;
 if not found or j.state<>'LEASED' or j.lease_owner<>p_worker
  or j.lease_token<>p_token or j.lease_until<=clock_timestamp()
 then raise exception 'VOX_NOTIF_STALE_OR_FOREIGN_LEASE';end if;
 select e.id,e.actor_id,e.work_item_id,e.event_type,
  w.team_id,w.city_id into ev
 from public.vox_work_events_candidate_v1 e
 join public.vox_work_items_candidate_v1 w on w.id=e.work_item_id
 where e.id=j.work_event_id and e.work_item_id=j.work_item_id
  and w.team_id=j.team_id and w.city_id=j.city_id
  and e.event_type in
   ('CLAIM','START','COMPLETE','BLOCK','REQUEST_APPROVAL','WAIT_EXTERNAL','RESUME');
 if not found then raise exception 'VOX_NOTIF_INVALID_EVENT_PROVENANCE';end if;
 for target in select m.auth_user_id from public.vox_staff_memberships_v1 m
  where m.team_id=j.team_id and m.auth_user_id<>ev.actor_id
  order by m.auth_user_id
 loop
  count_candidates:=count_candidates+1;
  if count_candidates>100
  then raise exception 'VOX_NOTIF_RECIPIENT_OVERFLOW';end if;
  if public.qf_vox_staff_notification_scope_v1(target.auth_user_id,ev.work_item_id)
  then
   select * into receipt from public.qf_vox_staff_notification_enqueue_v1(
    target.auth_user_id,ev.id);
   if not found or receipt.notification_id is null
   then raise exception 'VOX_NOTIF_INTERNAL_ENQUEUE_UNVERIFIED';end if;
   count_internal:=count_internal+1;
  end if;
 end loop;
 update public.vox_staff_notification_outbox_candidate_v1
 set state='DONE',delivered_internal_count=count_internal,
  completed_at=clock_timestamp(),lease_owner=null,lease_token=null,lease_until=null,
  last_error_code=null
 where id=j.id and state='LEASED';
 return query select j.id,count_internal;
end;
$$;

-- A worker safely retries known transient failures with capped exponential
-- delay; final failures go to a human-reviewable dead letter state. No raw
-- exception string (potential PII) is stored.
create function public.qf_vox_staff_notification_outbox_fail_v1(
 p_worker uuid,p_job uuid,p_token uuid,p_code text
) returns table(job_id uuid,new_state text,attempt integer)
language plpgsql security definer set search_path='' as $$
declare j public.vox_staff_notification_outbox_candidate_v1%rowtype;
 v_final boolean;v_state text;
begin
 if p_worker is null or p_job is null or p_token is null
  or p_code is null or p_code not in
   ('SQL_TRANSIENT','SCOPE_REVOKED','REPLAY_CONFLICT','INTERNAL_ONLY')
 then raise exception 'VOX_NOTIF_BAD_FAILURE_COMMAND';end if;
 select * into j from public.vox_staff_notification_outbox_candidate_v1
 where id=p_job for update;
 if not found or j.state<>'LEASED' or j.lease_owner<>p_worker
  or j.lease_token<>p_token or j.lease_until<=clock_timestamp()
 then raise exception 'VOX_NOTIF_STALE_OR_FOREIGN_LEASE';end if;
 v_final:=j.attempts>=5;
 v_state:=case when v_final then 'DEAD_LETTER' else 'PENDING' end;
 update public.vox_staff_notification_outbox_candidate_v1
 set state=v_state,lease_owner=null,lease_token=null,lease_until=null,
  next_attempt_at=clock_timestamp()+make_interval(
   secs=>least(3600,5*(2^least(j.attempts,9))::integer)),
  last_error_code=p_code,
  completed_at=case when v_final then clock_timestamp() else null end
 where id=j.id;
 return query select j.id,v_state,j.attempts;
end;
$$;

-- Not directly exposed to browsers. Human DBA must review function ownership,
-- execution role and clock/race behavior before enabling any worker.
revoke all on function public.qf_vox_staff_notification_outbox_event_v1()
 from public,anon,authenticated;
revoke all on function public.qf_vox_staff_notification_outbox_claim_v1(uuid,integer,integer)
 from public,anon,authenticated;
revoke all on function public.qf_vox_staff_notification_outbox_process_v1(uuid,uuid,uuid)
 from public,anon,authenticated;
revoke all on function public.qf_vox_staff_notification_outbox_fail_v1(uuid,uuid,uuid,text)
 from public,anon,authenticated;
grant execute on function public.qf_vox_staff_notification_outbox_claim_v1(uuid,integer,integer)
 to service_role;
grant execute on function public.qf_vox_staff_notification_outbox_process_v1(uuid,uuid,uuid)
 to service_role;
grant execute on function public.qf_vox_staff_notification_outbox_fail_v1(uuid,uuid,uuid,text)
 to service_role;
commit;
