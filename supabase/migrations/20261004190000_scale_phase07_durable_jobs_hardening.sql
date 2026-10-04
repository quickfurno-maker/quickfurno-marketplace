-- ============================================================================
-- SCALE-P07 — Durable Jobs, Outbox & Idempotency hardening
--
-- ADDITIVE ONLY. PostgreSQL remains durable authority. Redis/Valkey may wake
-- workers but cannot create, own, complete, retry or delete durable work.
--
-- Adds:
--   1. per-replica worker heartbeat/drain observations;
--   2. durable scheduler occurrence identity + expiring owner lease/fence;
--   3. read-only queue age/depth health for backpressure/SLO observation.
-- ============================================================================

begin;

create extension if not exists "pgcrypto";

create table if not exists public.scale_worker_heartbeats (
  worker_role text not null,
  worker_id text not null,
  state text not null,
  accepting_work boolean not null default true,
  in_flight integer not null default 0,
  started_at timestamptz not null,
  heartbeat_at timestamptz not null,
  drain_started_at timestamptz,
  last_safe_code text,
  primary key (worker_role, worker_id),
  constraint scale_worker_heartbeats_role_check
    check (worker_role ~ '^[a-z][a-z0-9:_-]{1,63}$'),
  constraint scale_worker_heartbeats_worker_check
    check (worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),
  constraint scale_worker_heartbeats_state_check
    check (state in ('starting','running','idle','degraded','draining','stopped')),
  constraint scale_worker_heartbeats_in_flight_check
    check (in_flight between 0 and 100000),
  constraint scale_worker_heartbeats_drain_check
    check (
      (state = 'draining' and accepting_work = false and drain_started_at is not null)
      or state <> 'draining'
    ),
  constraint scale_worker_heartbeats_safe_code_check
    check (
      last_safe_code is null
      or last_safe_code ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
    )
);

comment on table public.scale_worker_heartbeats is
  'SCALE-P07 per-replica operational heartbeat only. Not business authority; safe to expire from observability later.';

alter table public.scale_worker_heartbeats enable row level security;
revoke all on table public.scale_worker_heartbeats from public, anon, authenticated, service_role;
grant select on table public.scale_worker_heartbeats to service_role;

create or replace function public.qf_scale_worker_heartbeat_v1(
  p_worker_role text,
  p_worker_id text,
  p_state text,
  p_accepting_work boolean,
  p_in_flight integer,
  p_started_at timestamptz,
  p_drain_started_at timestamptz default null,
  p_last_safe_code text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_worker_role is null or p_worker_role !~ '^[a-z][a-z0-9:_-]{1,63}$' then
    raise exception 'SCALE_WORKER_ROLE_INVALID' using errcode='P0001';
  end if;
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$' then
    raise exception 'SCALE_WORKER_ID_INVALID' using errcode='P0001';
  end if;
  if p_state not in ('starting','running','idle','degraded','draining','stopped') then
    raise exception 'SCALE_WORKER_STATE_INVALID' using errcode='P0001';
  end if;
  if p_in_flight is null or p_in_flight < 0 or p_in_flight > 100000 then
    raise exception 'SCALE_WORKER_IN_FLIGHT_INVALID' using errcode='P0001';
  end if;
  if p_started_at is null then
    raise exception 'SCALE_WORKER_STARTED_AT_REQUIRED' using errcode='P0001';
  end if;
  if p_state = 'draining' and (p_accepting_work or p_drain_started_at is null) then
    raise exception 'SCALE_WORKER_DRAIN_SHAPE_INVALID' using errcode='P0001';
  end if;

  insert into public.scale_worker_heartbeats (
    worker_role, worker_id, state, accepting_work, in_flight, started_at,
    heartbeat_at, drain_started_at, last_safe_code
  ) values (
    p_worker_role, p_worker_id, p_state, p_accepting_work, p_in_flight, p_started_at,
    clock_timestamp(), p_drain_started_at, nullif(trim(p_last_safe_code),'')
  )
  on conflict (worker_role, worker_id) do update
    set state = excluded.state,
        accepting_work = excluded.accepting_work,
        in_flight = excluded.in_flight,
        heartbeat_at = excluded.heartbeat_at,
        drain_started_at = excluded.drain_started_at,
        last_safe_code = excluded.last_safe_code;
end;
$$;

revoke all on function public.qf_scale_worker_heartbeat_v1(text,text,text,boolean,integer,timestamptz,timestamptz,text)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_scale_worker_heartbeat_v1(text,text,text,boolean,integer,timestamptz,timestamptz,text)
  to service_role;

create table if not exists public.scale_scheduler_occurrences (
  scheduler_key text not null,
  occurrence_key text not null,
  state text not null default 'claimed',
  worker_id text not null,
  lease_token uuid not null,
  fence bigint not null default 1,
  attempt_count integer not null default 1,
  claimed_at timestamptz not null default clock_timestamp(),
  lease_expires_at timestamptz not null,
  completed_at timestamptz,
  last_safe_code text,
  primary key (scheduler_key, occurrence_key),
  constraint scale_scheduler_key_check
    check (scheduler_key ~ '^[a-z][a-z0-9:_-]{1,95}$'),
  constraint scale_scheduler_occurrence_key_check
    check (occurrence_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),
  constraint scale_scheduler_worker_check
    check (worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),
  constraint scale_scheduler_state_check check (state in ('claimed','completed')),
  constraint scale_scheduler_fence_check check (fence >= 1),
  constraint scale_scheduler_attempt_check check (attempt_count >= 1),
  constraint scale_scheduler_time_check check (lease_expires_at > claimed_at),
  constraint scale_scheduler_completion_check
    check (
      (state='claimed' and completed_at is null)
      or (state='completed' and completed_at is not null)
    ),
  constraint scale_scheduler_safe_code_check
    check (
      last_safe_code is null
      or last_safe_code ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
    )
);

comment on table public.scale_scheduler_occurrences is
  'SCALE-P07 durable schedule occurrence identity. Unique occurrence keys prevent duplicate scheduled work across replicas; expired incomplete leases may be fenced and reclaimed.';

create index if not exists idx_scale_scheduler_occurrences_lease
  on public.scale_scheduler_occurrences(state, lease_expires_at)
  where state='claimed';

alter table public.scale_scheduler_occurrences enable row level security;
revoke all on table public.scale_scheduler_occurrences from public, anon, authenticated, service_role;
grant select on table public.scale_scheduler_occurrences to service_role;

create or replace function public.qf_claim_scale_scheduler_occurrence_v1(
  p_scheduler_key text,
  p_occurrence_key text,
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns table (
  claim_status text,
  lease_token uuid,
  fence bigint,
  attempt_count integer,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_token uuid := gen_random_uuid();
  v_row public.scale_scheduler_occurrences%rowtype;
begin
  if p_scheduler_key is null or p_scheduler_key !~ '^[a-z][a-z0-9:_-]{1,95}$' then
    raise exception 'SCALE_SCHEDULER_KEY_INVALID' using errcode='P0001';
  end if;
  if p_occurrence_key is null or p_occurrence_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$' then
    raise exception 'SCALE_OCCURRENCE_KEY_INVALID' using errcode='P0001';
  end if;
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$' then
    raise exception 'SCALE_SCHEDULER_WORKER_INVALID' using errcode='P0001';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'SCALE_SCHEDULER_LEASE_INVALID' using errcode='P0001';
  end if;

  insert into public.scale_scheduler_occurrences (
    scheduler_key, occurrence_key, state, worker_id, lease_token, fence,
    attempt_count, claimed_at, lease_expires_at
  ) values (
    p_scheduler_key, p_occurrence_key, 'claimed', p_worker_id, v_token, 1,
    1, v_now, v_now + make_interval(secs => p_lease_seconds)
  )
  on conflict do nothing
  returning * into v_row;

  if v_row.scheduler_key is not null then
    return query select 'acquired'::text, v_row.lease_token, v_row.fence,
      v_row.attempt_count, v_row.lease_expires_at;
    return;
  end if;

  select * into v_row
    from public.scale_scheduler_occurrences
   where scheduler_key=p_scheduler_key and occurrence_key=p_occurrence_key;

  if v_row.state='completed' then
    return query select 'completed'::text, null::uuid, v_row.fence,
      v_row.attempt_count, v_row.lease_expires_at;
    return;
  end if;

  update public.scale_scheduler_occurrences as occurrence
     set worker_id=p_worker_id,
         lease_token=v_token,
         fence=occurrence.fence+1,
         attempt_count=occurrence.attempt_count+1,
         claimed_at=v_now,
         lease_expires_at=v_now + make_interval(secs => p_lease_seconds),
         last_safe_code='LEASE_RECLAIMED'
   where occurrence.scheduler_key=p_scheduler_key
     and occurrence.occurrence_key=p_occurrence_key
     and occurrence.state='claimed'
     and occurrence.lease_expires_at <= v_now
   returning occurrence.* into v_row;

  if v_row.scheduler_key is not null and v_row.worker_id=p_worker_id and v_row.lease_token=v_token then
    return query select 'acquired'::text, v_row.lease_token, v_row.fence,
      v_row.attempt_count, v_row.lease_expires_at;
    return;
  end if;

  select * into v_row
    from public.scale_scheduler_occurrences
   where scheduler_key=p_scheduler_key and occurrence_key=p_occurrence_key;

  return query select
    case when v_row.state='completed' then 'completed' else 'busy' end::text,
    null::uuid, v_row.fence, v_row.attempt_count, v_row.lease_expires_at;
end;
$$;

revoke all on function public.qf_claim_scale_scheduler_occurrence_v1(text,text,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_claim_scale_scheduler_occurrence_v1(text,text,text,integer)
  to service_role;

create or replace function public.qf_complete_scale_scheduler_occurrence_v1(
  p_scheduler_key text,
  p_occurrence_key text,
  p_worker_id text,
  p_lease_token uuid,
  p_fence bigint,
  p_safe_code text default 'COMPLETED'
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.scale_scheduler_occurrences
     set state='completed',
         completed_at=clock_timestamp(),
         last_safe_code=nullif(trim(p_safe_code),'')
   where scheduler_key=p_scheduler_key
     and occurrence_key=p_occurrence_key
     and state='claimed'
     and worker_id=p_worker_id
     and lease_token=p_lease_token
     and fence=p_fence;
  get diagnostics v_count = row_count;
  return v_count=1;
end;
$$;

revoke all on function public.qf_complete_scale_scheduler_occurrence_v1(text,text,text,uuid,bigint,text)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_complete_scale_scheduler_occurrence_v1(text,text,text,uuid,bigint,text)
  to service_role;

create or replace function public.qf_scale_queue_health_v1()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
    'observedAt', clock_timestamp(),
    'automationJobs', jsonb_build_object(
      'ready', (select count(*) from public.automation_jobs
                 where status='pending' and available_at <= clock_timestamp()),
      'retryDue', (select count(*) from public.automation_jobs
                    where status='retry_scheduled' and next_retry_at <= clock_timestamp()),
      'processing', (select count(*) from public.automation_jobs where status='processing'),
      'deadLetter', (select count(*) from public.automation_jobs where status='dead_letter'),
      'oldestReadyAgeSeconds', coalesce((
        select greatest(0, floor(extract(epoch from (clock_timestamp()-min(available_at)))))
          from public.automation_jobs where status='pending' and available_at <= clock_timestamp()
      ),0)
    ),
    'conversationOutbox', jsonb_build_object(
      'pending', (select count(*) from public.communication_conversation_outbox where status='pending'),
      'oldestPendingAgeSeconds', coalesce((
        select greatest(0, floor(extract(epoch from (clock_timestamp()-min(created_at)))))
          from public.communication_conversation_outbox where status='pending'
      ),0)
    ),
    'jarvisTurnOutbox', jsonb_build_object(
      'ready', (select count(*) from public.communication_jarvis_turn_outbox
                 where status in ('pending','retry_scheduled')
                   and (next_retry_at is null or next_retry_at <= clock_timestamp())),
      'oldestReadyAgeSeconds', coalesce((
        select greatest(0, floor(extract(epoch from (clock_timestamp()-min(created_at)))))
          from public.communication_jarvis_turn_outbox
         where status in ('pending','retry_scheduled')
           and (next_retry_at is null or next_retry_at <= clock_timestamp())
      ),0)
    ),
    'workerReplicas', jsonb_build_object(
      'fresh', (select count(*) from public.scale_worker_heartbeats
                 where heartbeat_at >= clock_timestamp()-interval '45 seconds'),
      'draining', (select count(*) from public.scale_worker_heartbeats where state='draining')
    )
  );
$$;

comment on function public.qf_scale_queue_health_v1() is
  'SCALE-P07 read-only depth/age/worker observation for backpressure and queue-age SLOs. It grants no claim or execution authority.';

revoke all on function public.qf_scale_queue_health_v1() from public, anon, authenticated, service_role;
grant execute on function public.qf_scale_queue_health_v1() to service_role;

commit;
