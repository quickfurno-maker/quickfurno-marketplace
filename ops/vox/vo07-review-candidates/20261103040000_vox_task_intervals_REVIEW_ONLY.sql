-- VO7 REVIEW ONLY: immutable per-task intervals from the review-only VO2
-- writer. Never install in managed Supabase without DBA/AppSec, recovery signoff.
begin;
create table public.vox_vo7_staff_task_intervals_candidate_v1(
 closed_by_event_nonce uuid primary key
  references public.vox_vo2_staff_time_events_candidate_v1(event_nonce),
 staff_id uuid not null
  references public.vox_staff_memberships_v1(auth_user_id),
 team_id uuid not null references public.vox_staff_teams_v1(id),
 city_id uuid not null references public.cities(id),
 work_item_id uuid not null references public.vox_work_items_candidate_v1(id),
 started_at timestamptz not null,
 ended_at timestamptz not null,
 elapsed_ms bigint not null check(elapsed_ms>=0),
 state_revision integer not null check(state_revision>0),
 closing_action text not null check(closing_action in
  ('TASK_PAUSE','TASK_STOP','TASK_SWITCH','BREAK_START','CLOCK_OUT')),
 constraint vox_vo7_interval_chronology check(ended_at>=started_at),
 unique(staff_id,state_revision)
);
create index vox_vo7_staff_task_interval_actor_idx
 on public.vox_vo7_staff_task_intervals_candidate_v1
 (staff_id,started_at,ended_at);
alter table public.vox_vo7_staff_task_intervals_candidate_v1 enable row level security;
alter table public.vox_vo7_staff_task_intervals_candidate_v1 force row level security;
revoke all on public.vox_vo7_staff_task_intervals_candidate_v1
 from public,anon,authenticated,service_role;
grant select on public.vox_vo7_staff_task_intervals_candidate_v1 to service_role;

create or replace function public.qf_vox_vo7_capture_task_interval_candidate_v1()
 returns trigger language plpgsql security definer set search_path='' as $trigger$
declare
 ev public.vox_vo2_staff_time_events_candidate_v1%rowtype;
 ms bigint;
begin
 if old.active_work_item_id is null or
    (old.active_work_item_id is not distinct from new.active_work_item_id
     and old.task_started_at is not distinct from new.task_started_at)
 then return null; end if;
 if old.task_started_at is null or new.last_event_at is null or
   new.last_event_at<old.task_started_at or
   new.revision<>old.revision+1 or
   new.team_id<>old.team_id or new.city_id<>old.city_id
 then raise exception 'VO7_INVALID_TASK_CLOSURE' using errcode='P0001'; end if;
 -- Deferred until transaction end, after the original VO2 nonce is inserted.
 select * into strict ev
  from public.vox_vo2_staff_time_events_candidate_v1 e
  where e.staff_id=new.staff_id and e.revision=new.revision;
 if ev.action not in('TASK_PAUSE','TASK_STOP','TASK_SWITCH',
                     'BREAK_START','CLOCK_OUT') or
   ev.occurred_at is distinct from new.last_event_at
 then raise exception 'VO7_UNPROVEN_TASK_CLOSURE' using errcode='P0001';end if;
 if ev.action in('TASK_PAUSE','TASK_STOP') and
    ev.work_item_id is distinct from old.active_work_item_id
 then raise exception 'VO7_MISMATCHED_TASK_CLOSURE' using errcode='P0001';end if;
 if ev.action='TASK_SWITCH' and
    (ev.work_item_id is distinct from new.active_work_item_id or
     new.active_work_item_id is null)
 then raise exception 'VO7_MISMATCHED_TASK_SWITCH' using errcode='P0001';end if;
 if ev.action in('CLOCK_OUT','BREAK_START') and ev.work_item_id is not null
 then raise exception 'VO7_NON_TASK_EVENT_SPOOF' using errcode='P0001';end if;
 ms:=floor(extract(epoch from(new.last_event_at-old.task_started_at))*1000)::bigint;
 if ms<0 then raise exception 'VO7_NEGATIVE_TASK_INTERVAL' using errcode='P0001';end if;
 insert into public.vox_vo7_staff_task_intervals_candidate_v1(
  closed_by_event_nonce,staff_id,team_id,city_id,work_item_id,
  started_at,ended_at,elapsed_ms,state_revision,closing_action)
 values(ev.event_nonce,new.staff_id,new.team_id,new.city_id,
  old.active_work_item_id,old.task_started_at,new.last_event_at,ms,
  new.revision,ev.action);
 return null;
end;
$trigger$;
revoke all on function public.qf_vox_vo7_capture_task_interval_candidate_v1()
 from public,anon,authenticated;
create constraint trigger vox_vo7_capture_task_interval
 after update on public.vox_vo2_staff_time_state_candidate_v1
 deferrable initially deferred
 for each row execute function public.qf_vox_vo7_capture_task_interval_candidate_v1();
commit;
