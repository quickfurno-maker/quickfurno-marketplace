-- VOX VO2 REVIEW-ONLY candidate. DO NOT ADD TO supabase/migrations.
-- Never apply to managed Staging/Production. Core must verify real Staff AAL2;
-- this SQL must additionally recheck current neutral Staff, team/city/lease,
-- current canonical work-item assignment and Core object grant in one transaction.
-- Any unresolved original histories/ACLs require independent DBA/AppSec review.
begin;
create table public.vox_vo2_staff_time_state_candidate_v1 (
 staff_id uuid primary key references public.vox_staff_memberships_v1(auth_user_id),
 team_id uuid not null references public.vox_staff_teams_v1(id),
 city_id uuid not null references public.cities(id),
 revision integer not null default 0 check(revision>=0),
 clocked_in_at timestamptz,
 clocked_out_at timestamptz,
 break_started_at timestamptz,
 total_break_ms bigint not null default 0 check(total_break_ms>=0),
 active_work_item_id uuid references public.vox_work_items_candidate_v1(id),
 task_started_at timestamptz,
 last_work_item_id uuid references public.vox_work_items_candidate_v1(id),
 task_time_ms bigint not null default 0 check(task_time_ms>=0),
 last_event_at timestamptz,
 constraint vox_vo2_timer_pair check ((active_work_item_id is null)=(task_started_at is null)),
 constraint vox_vo2_break_timer_exclusive check (break_started_at is null or active_work_item_id is null),
 constraint vox_vo2_clockout_closed check (clocked_out_at is null or
  (break_started_at is null and active_work_item_id is null))
);
create table public.vox_vo2_staff_time_events_candidate_v1 (
 event_id uuid primary key default gen_random_uuid(),
 staff_id uuid not null references public.vox_vo2_staff_time_state_candidate_v1(staff_id),
 event_nonce uuid not null unique,
 action text not null check(action in
  ('CLOCK_IN','CLOCK_OUT','BREAK_START','BREAK_END',
   'TASK_START','TASK_PAUSE','TASK_RESUME','TASK_SWITCH','TASK_STOP')),
 work_item_id uuid,
 expected_revision integer not null check(expected_revision>=0),
 revision integer not null check(revision>0),
 occurred_at timestamptz not null,
 unique(staff_id,revision)
);
create index vox_vo2_staff_time_events_actor_time_idx
 on public.vox_vo2_staff_time_events_candidate_v1(staff_id,occurred_at,revision);
alter table public.vox_vo2_staff_time_state_candidate_v1 enable row level security;
alter table public.vox_vo2_staff_time_state_candidate_v1 force row level security;
alter table public.vox_vo2_staff_time_events_candidate_v1 enable row level security;
alter table public.vox_vo2_staff_time_events_candidate_v1 force row level security;
revoke all on public.vox_vo2_staff_time_state_candidate_v1,
 public.vox_vo2_staff_time_events_candidate_v1 from public,anon,authenticated;
grant select,insert,update on public.vox_vo2_staff_time_state_candidate_v1 to service_role;
grant select,insert on public.vox_vo2_staff_time_events_candidate_v1 to service_role;

create or replace function public.qf_vox_staff_time_atomic_candidate_v1(
 p_actor uuid,p_team uuid,p_city uuid,p_action text,p_nonce uuid,
 p_expected_revision integer,p_work_item uuid
) returns table (
 nonce uuid,actor_id uuid,event_id uuid,revision integer,applied boolean,
 occurred_at timestamptz,work_item_id uuid,external_messages_sent integer,
 money_minor_units integer
) language plpgsql security definer set search_path='' as $function$
declare
 v_member public.vox_staff_memberships_v1%rowtype;
 v_work public.vox_work_items_candidate_v1%rowtype;
 v_state public.vox_vo2_staff_time_state_candidate_v1%rowtype;
 v_replay public.vox_vo2_staff_time_events_candidate_v1%rowtype;
 v_now timestamptz;
 v_event uuid;
 v_elapsed bigint;
 v_pack text;
begin
 if p_actor is null or p_team is null or p_city is null or p_nonce is null or
    p_action is null or p_expected_revision is null or p_expected_revision<0 or
    p_expected_revision>2147483646 or
    p_action not in ('CLOCK_IN','CLOCK_OUT','BREAK_START','BREAK_END',
                     'TASK_START','TASK_PAUSE','TASK_RESUME','TASK_SWITCH','TASK_STOP')
 then raise exception 'VO2_TIME_INVALID_COMMAND' using errcode='P0001'; end if;
 if (left(p_action,5)='TASK_' and p_work_item is null) or
    (left(p_action,5)<>'TASK_' and p_work_item is not null)
 then raise exception 'VO2_TIME_WORK_ITEM_SHAPE' using errcode='P0001'; end if;

 -- The membership lock serializes first CLOCK_IN, team changes and all
 -- Staff writes, including cross-device attempts with distinct nonces.
 select * into v_member from public.vox_staff_memberships_v1
 where auth_user_id=p_actor for update;
 if not found or v_member.team_id<>p_team or v_member.staff_role in
   ('team_leader','auditor') or v_member.is_active<>true or
   v_member.revoked_at is not null or v_member.expires_at<=clock_timestamp()
 then raise exception 'VO2_TIME_CURRENT_STAFF_DENIED' using errcode='P0001'; end if;
 if not exists(
  select 1 from public.profiles p join auth.users au on au.id=p.id
  join public.vox_staff_teams_v1 t on t.id=v_member.team_id
  join public.cities c on c.id=t.city_id
  where p.id=p_actor and p.role is null and p.is_active=true
   and au.raw_app_meta_data->>'qf_principal'='vox_staff'
   and au.raw_app_meta_data->>'admin_role' is null
   and t.id=p_team and t.city_id=p_city and t.is_active=true
   and c.id=p_city and c.is_active=true
 ) then raise exception 'VO2_TIME_IDENTITY_OR_CITY_DENIED' using errcode='P0001'; end if;

 -- The original nonce is an immutable historical receipt, not permission
 -- to issue a fresh task command. Reconcile it after current identity/team
 -- checks, but BEFORE requiring a task still be IN_PROGRESS. Core may have
 -- legitimately completed the work while the first HTTP response was lost.
 -- The membership row lock serializes this path with other Staff writes.
 select * into v_replay from public.vox_vo2_staff_time_events_candidate_v1 e
  where e.event_nonce=p_nonce;
 if found then
  if v_replay.staff_id<>p_actor or v_replay.action<>p_action or
     v_replay.expected_revision<>p_expected_revision or
     v_replay.work_item_id is distinct from p_work_item
  then raise exception 'VO2_TIME_NONCE_CONFLICT' using errcode='P0001'; end if;
  return query select p_nonce,p_actor,v_replay.event_id,v_replay.revision,true,
   v_replay.occurred_at,v_replay.work_item_id,0,0;
  return;
 end if;

 if left(p_action,5)='TASK_' then
  -- Work objects, unlike browser payloads, are owned by Core. Lock this
  -- assignment while updating the timer. Do not mutate vendor assignments.
  select * into v_work from public.vox_work_items_candidate_v1
   where id=p_work_item for share;
  if not found or v_work.assignee_id<>p_actor or
    v_work.team_id<>p_team or v_work.city_id<>p_city or
    v_work.state<>'IN_PROGRESS'
  then raise exception 'VO2_TIME_CURRENT_TASK_DENIED' using errcode='P0001'; end if;
  if not exists(
    select 1 from public.vox_staff_object_scopes_v1 g
    where g.auth_user_id=p_actor and g.scope_kind=v_work.source_kind
     and g.object_id=v_work.source_id and g.revoked_at is null
     and g.expires_at>clock_timestamp()
  ) then raise exception 'VO2_TIME_SOURCE_GRANT_DENIED' using errcode='P0001'; end if;
  if v_work.source_kind='support_thread' and not exists(
    select 1 from public.vox_staff_object_scopes_v1 g
     where g.auth_user_id=p_actor and g.scope_kind='vendor'
      and g.object_id=v_work.related_vendor_id and g.revoked_at is null
      and g.expires_at>clock_timestamp()
  ) then raise exception 'VO2_TIME_SUPPORT_DUAL_GRANT_DENIED' using errcode='P0001'; end if;
  v_pack:=case v_work.source_kind
    when 'prospect' then 'acquisition'
    when 'vendor' then 'vendor_success'
    when 'support_thread' then 'service_support'
    else null end;
  if v_pack is null then raise exception 'VO2_TIME_UNSUPPORTED_WORK_DOMAIN' using errcode='P0001'; end if;
  -- Existing Core department approval records must remain active.
  if not exists(
   select 1 from public.vox_staff_department_capabilities_v1 cap
   join public.vox_staff_department_requests_v1 req on req.id=cap.request_id
   join public.vox_staff_department_decisions_v1 dec on dec.request_id=req.id
   join public.vox_staff_department_activations_v1 act
    on act.request_id=req.id and act.capability_id=cap.id
   join public.profiles reviewer on reviewer.id=req.decided_by
   join auth.users review_user on review_user.id=reviewer.id
   join public.vox_staff_memberships_v1 tl on tl.auth_user_id=reviewer.id
   where cap.auth_user_id=p_actor and cap.team_id=p_team and cap.city_id=p_city
    and cap.department=v_pack and cap.revoked_at is null
    and cap.expires_at>clock_timestamp() and cap.revision=2
    and req.target_staff_id=p_actor and req.team_id=p_team and req.city_id=p_city
    and req.department=v_pack and req.state='APPROVED' and req.revision=1
    and req.expires_at>clock_timestamp() and req.decided_by<>req.requested_by
    and req.decided_by<>req.target_staff_id
    and dec.reviewer_id=req.decided_by and dec.decision='APPROVED'
    and dec.decision_reference=req.decision_reference
    and act.activated_by=req.requested_by and cap.granted_by=req.requested_by
    and reviewer.role is null and reviewer.is_active=true
    and review_user.raw_app_meta_data->>'qf_principal'='vox_staff'
    and review_user.raw_app_meta_data->>'vox_role'='team_leader'
    and review_user.raw_app_meta_data->>'admin_role' is null
    and tl.staff_role='team_leader' and tl.is_active=true
    and tl.revoked_at is null and tl.expires_at>clock_timestamp()
    and tl.team_id=p_team
  ) then raise exception 'VO2_TIME_DEPARTMENT_UNREVIEWED' using errcode='P0001'; end if;
 end if;

 if p_action='CLOCK_IN' then
  insert into public.vox_vo2_staff_time_state_candidate_v1(staff_id,team_id,city_id)
  values(p_actor,p_team,p_city) on conflict(staff_id) do nothing;
 end if;
 select * into v_state from public.vox_vo2_staff_time_state_candidate_v1
  where staff_id=p_actor for update;
 if not found or v_state.team_id<>p_team or v_state.city_id<>p_city
 then raise exception 'VO2_TIME_LEDGER_NOT_ACTIVE' using errcode='P0001'; end if;
 if v_state.revision<>p_expected_revision
 then raise exception 'VO2_TIME_STALE_REVISION' using errcode='P0001'; end if;
 v_now:=clock_timestamp();
 if v_state.last_event_at is not null and v_now<v_state.last_event_at
 then raise exception 'VO2_TIME_CLOCK_REGRESSION' using errcode='P0001'; end if;

 if p_action='CLOCK_IN' then
  if v_state.clocked_in_at is not null and v_state.clocked_out_at is null
  then raise exception 'VO2_TIME_SHIFT_OPEN' using errcode='P0001'; end if;
  v_state.clocked_in_at:=v_now;v_state.clocked_out_at:=null;
  v_state.break_started_at:=null;v_state.total_break_ms:=0;
  v_state.active_work_item_id:=null;v_state.task_started_at:=null;
  v_state.last_work_item_id:=null;v_state.task_time_ms:=0;
 elsif p_action='CLOCK_OUT' then
  if v_state.clocked_in_at is null or v_state.clocked_out_at is not null or
     v_state.break_started_at is not null
  then raise exception 'VO2_TIME_CLOCKOUT_DENIED' using errcode='P0001'; end if;
  if v_state.active_work_item_id is not null then
   v_elapsed:=floor(extract(epoch from(v_now-v_state.task_started_at))*1000)::bigint;
   if v_elapsed<0 then raise exception 'VO2_TIME_NEGATIVE_DURATION' using errcode='P0001'; end if;
   v_state.task_time_ms:=v_state.task_time_ms+v_elapsed;
   v_state.last_work_item_id:=v_state.active_work_item_id;
   v_state.active_work_item_id:=null;v_state.task_started_at:=null;
  end if;
  v_state.clocked_out_at:=v_now;
 elsif p_action='BREAK_START' then
  if v_state.clocked_in_at is null or v_state.clocked_out_at is not null or
     v_state.break_started_at is not null
  then raise exception 'VO2_TIME_BREAK_DENIED' using errcode='P0001'; end if;
  if v_state.active_work_item_id is not null then
   v_elapsed:=floor(extract(epoch from(v_now-v_state.task_started_at))*1000)::bigint;
   if v_elapsed<0 then raise exception 'VO2_TIME_NEGATIVE_DURATION' using errcode='P0001'; end if;
   v_state.task_time_ms:=v_state.task_time_ms+v_elapsed;
   v_state.last_work_item_id:=v_state.active_work_item_id;
   v_state.active_work_item_id:=null;v_state.task_started_at:=null;
  end if;
  v_state.break_started_at:=v_now;
 elsif p_action='BREAK_END' then
  if v_state.clocked_in_at is null or v_state.clocked_out_at is not null or
     v_state.break_started_at is null
  then raise exception 'VO2_TIME_NO_ACTIVE_BREAK' using errcode='P0001'; end if;
  v_elapsed:=floor(extract(epoch from(v_now-v_state.break_started_at))*1000)::bigint;
  if v_elapsed<0 then raise exception 'VO2_TIME_NEGATIVE_DURATION' using errcode='P0001'; end if;
  v_state.total_break_ms:=v_state.total_break_ms+v_elapsed;
  v_state.break_started_at:=null;
 else
  if v_state.clocked_in_at is null or v_state.clocked_out_at is not null or
     v_state.break_started_at is not null
  then raise exception 'VO2_TIME_TASK_REQUIRES_ACTIVE_SHIFT' using errcode='P0001'; end if;
  if p_action='TASK_START' then
   if v_state.active_work_item_id is not null then
    raise exception 'VO2_TIME_ALREADY_TRACKING' using errcode='P0001'; end if;
   v_state.active_work_item_id:=p_work_item;v_state.task_started_at:=v_now;
  elsif p_action='TASK_RESUME' then
   if v_state.active_work_item_id is not null or
      v_state.last_work_item_id is distinct from p_work_item
   then raise exception 'VO2_TIME_RESUME_DENIED' using errcode='P0001'; end if;
   v_state.active_work_item_id:=p_work_item;v_state.task_started_at:=v_now;
  elsif p_action='TASK_SWITCH' then
   if v_state.active_work_item_id is null or v_state.active_work_item_id=p_work_item
   then raise exception 'VO2_TIME_SWITCH_DENIED' using errcode='P0001'; end if;
   v_elapsed:=floor(extract(epoch from(v_now-v_state.task_started_at))*1000)::bigint;
   if v_elapsed<0 then raise exception 'VO2_TIME_NEGATIVE_DURATION' using errcode='P0001'; end if;
   v_state.task_time_ms:=v_state.task_time_ms+v_elapsed;
   v_state.last_work_item_id:=v_state.active_work_item_id;
   v_state.active_work_item_id:=p_work_item;v_state.task_started_at:=v_now;
  elsif p_action in ('TASK_PAUSE','TASK_STOP') then
   if v_state.active_work_item_id is distinct from p_work_item then
    raise exception 'VO2_TIME_NO_CURRENT_TASK' using errcode='P0001'; end if;
   v_elapsed:=floor(extract(epoch from(v_now-v_state.task_started_at))*1000)::bigint;
   if v_elapsed<0 then raise exception 'VO2_TIME_NEGATIVE_DURATION' using errcode='P0001'; end if;
   v_state.task_time_ms:=v_state.task_time_ms+v_elapsed;
   v_state.last_work_item_id:=case when p_action='TASK_PAUSE'
       then p_work_item else null end;
   v_state.active_work_item_id:=null;v_state.task_started_at:=null;
  end if;
 end if;
 if v_state.clocked_out_at is not null and
    v_state.task_time_ms>floor(extract(epoch from
    (v_state.clocked_out_at-v_state.clocked_in_at))*1000)::bigint
     - v_state.total_break_ms
 then raise exception 'VO2_TIME_TOTAL_EXCEEDS_NET_SHIFT' using errcode='P0001'; end if;
 v_state.revision:=v_state.revision+1;v_state.last_event_at:=v_now;
 update public.vox_vo2_staff_time_state_candidate_v1 set
  revision=v_state.revision,clocked_in_at=v_state.clocked_in_at,
  clocked_out_at=v_state.clocked_out_at,break_started_at=v_state.break_started_at,
  total_break_ms=v_state.total_break_ms,active_work_item_id=v_state.active_work_item_id,
  task_started_at=v_state.task_started_at,last_work_item_id=v_state.last_work_item_id,
  task_time_ms=v_state.task_time_ms,last_event_at=v_now
 where staff_id=p_actor;
 insert into public.vox_vo2_staff_time_events_candidate_v1
 (staff_id,event_nonce,action,work_item_id,expected_revision,revision,occurred_at)
 values(p_actor,p_nonce,p_action,p_work_item,p_expected_revision,v_state.revision,v_now)
 returning vox_vo2_staff_time_events_candidate_v1.event_id into v_event;
 return query select p_nonce,p_actor,v_event,v_state.revision,true,v_now,p_work_item,0,0;
end;
$function$;
revoke all on function public.qf_vox_staff_time_atomic_candidate_v1(
 uuid,uuid,uuid,text,uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.qf_vox_staff_time_atomic_candidate_v1(
 uuid,uuid,uuid,text,uuid,integer,uuid) to service_role;
commit;
