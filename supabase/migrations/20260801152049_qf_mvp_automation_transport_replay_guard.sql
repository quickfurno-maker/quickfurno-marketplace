-- ============================================================================
-- QF-MVP-50.1C — SECURE N8N TRANSPORT REPLAY / CLAIM GUARD
--
-- PURPOSE
--   Persist one-shot transport request identities so a replayed signed n8n claim
--   request can NEVER obtain a second executable envelope.
--
-- AUTHORITY
--   Core remains sole DB/business authority.
--   n8n never receives Supabase credentials and never writes this table.
--
-- CRITICAL UNCERTAINTY RULE
--   If Core claims a job and the HTTP response becomes ambiguous, replaying the
--   SAME transport request returns is_replay=true. The route suppresses the
--   executable envelope. The already-processing job is left for QF-MVP-50.5
--   uncertainty reconciliation. It is NOT blindly resent.
--
-- NON-ACTIONS
--   No HTTP call, webhook activation, n8n workflow, Meta/provider call,
--   communication send, assignment/credit/package/consent mutation, or seed row.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Fail-closed dependency / drift preflight
-- ---------------------------------------------------------------------------
do $preflight$
begin
  if to_regclass('public.automation_action_requests') is null
     or to_regclass('public.automation_jobs') is null
     or to_regclass('public.automation_execution_attempts') is null then
    raise exception
      'QF-MVP-50.1C aborted: QF-MVP-50.1B automation persistence is incomplete.';
  end if;

  if to_regprocedure('public.qf_claim_automation_job_v1(text)') is null then
    raise exception
      'QF-MVP-50.1C aborted: qf_claim_automation_job_v1(text) is missing.';
  end if;

  if to_regclass('public.automation_transport_requests') is not null then
    raise exception
      'QF-MVP-50.1C aborted: target table already exists; reconcile instead of masking drift.';
  end if;

  if exists (
    select 1 from pg_extension where extname in ('pg_net', 'http', 'dblink')
  ) then
    raise exception
      'QF-MVP-50.1C aborted: database network extension present; transport must remain application-layer only.';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. One-shot inbound n8n transport request ledger
-- ---------------------------------------------------------------------------
create table public.automation_transport_requests (
  id uuid primary key,

  transport_version integer not null default 1,
  direction text not null default 'n8n_to_core',
  route_key text not null default 'claim_v1',

  worker_id text not null,
  body_sha256 text not null,

  state text not null default 'processing',

  job_id uuid references public.automation_jobs(id) on delete restrict,
  action_request_id uuid
    references public.automation_action_requests(id) on delete restrict,
  attempt_id uuid
    references public.automation_execution_attempts(id) on delete restrict,
  attempt_number integer,
  max_attempts integer,

  created_at timestamptz not null default now(),
  finalized_at timestamptz,

  constraint automation_transport_requests_version_check
    check (transport_version = 1),

  constraint automation_transport_requests_direction_check
    check (direction = 'n8n_to_core'),

  constraint automation_transport_requests_route_check
    check (route_key = 'claim_v1'),

  constraint automation_transport_requests_worker_check
    check (worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),

  constraint automation_transport_requests_body_hash_check
    check (body_sha256 ~ '^[0-9a-f]{64}$'),

  constraint automation_transport_requests_state_check
    check (state in ('processing', 'claimed', 'empty')),

  constraint automation_transport_requests_attempt_number_check
    check (attempt_number is null or attempt_number > 0),

  constraint automation_transport_requests_max_attempts_check
    check (max_attempts is null or max_attempts between 1 and 10),

  constraint automation_transport_requests_shape_check
    check (
      (
        state = 'processing'
        and job_id is null
        and action_request_id is null
        and attempt_id is null
        and attempt_number is null
        and max_attempts is null
        and finalized_at is null
      )
      or (
        state = 'empty'
        and job_id is null
        and action_request_id is null
        and attempt_id is null
        and attempt_number is null
        and max_attempts is null
        and finalized_at is not null
      )
      or (
        state = 'claimed'
        and job_id is not null
        and action_request_id is not null
        and attempt_id is not null
        and attempt_number is not null
        and max_attempts is not null
        and finalized_at is not null
      )
    )
);

comment on table public.automation_transport_requests is
  'QF-MVP-50.1C one-shot n8n->Core signed claim request ledger. A duplicate request UUID is a replay and must never receive an executable envelope again.';

comment on column public.automation_transport_requests.body_sha256 is
  'SHA-256 of the exact authenticated HTTP request body. No secret or authorization material is stored.';

create unique index uq_automation_transport_requests_job
  on public.automation_transport_requests(job_id)
  where job_id is not null;

create index idx_automation_transport_requests_created
  on public.automation_transport_requests(created_at desc);

create index idx_automation_transport_requests_state
  on public.automation_transport_requests(state, created_at);

-- ---------------------------------------------------------------------------
-- 2. Universal insert/update/history guards
-- ---------------------------------------------------------------------------
create or replace function public.qf_guard_automation_transport_request_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.transport_version <> 1
     or new.direction <> 'n8n_to_core'
     or new.route_key <> 'claim_v1'
     or new.state <> 'processing'
     or new.job_id is not null
     or new.action_request_id is not null
     or new.attempt_id is not null
     or new.attempt_number is not null
     or new.max_attempts is not null
     or new.finalized_at is not null then
    raise exception
      'QF-MVP-50.1C: transport requests must be inserted as pristine n8n_to_core claim_v1 processing rows.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create or replace function public.qf_guard_automation_transport_request_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if old.state <> 'processing' then
    raise exception
      'QF-MVP-50.1C: finalized transport request history is immutable.'
      using errcode = 'check_violation';
  end if;

  if new.id is distinct from old.id
     or new.transport_version is distinct from old.transport_version
     or new.direction is distinct from old.direction
     or new.route_key is distinct from old.route_key
     or new.worker_id is distinct from old.worker_id
     or new.body_sha256 is distinct from old.body_sha256
     or new.created_at is distinct from old.created_at then
    raise exception
      'QF-MVP-50.1C: transport request identity/evidence is immutable.'
      using errcode = 'check_violation';
  end if;

  if new.state not in ('claimed', 'empty') then
    raise exception
      'QF-MVP-50.1C: processing may finalize only to claimed or empty.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create or replace function public.qf_prevent_automation_transport_history_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception
    'QF-MVP-50.1C: automation transport request history cannot be deleted or truncated.'
    using errcode = 'check_violation';
  return null;
end;
$$;

create trigger trg_automation_transport_request_insert_guard
  before insert on public.automation_transport_requests
  for each row execute function public.qf_guard_automation_transport_request_insert();

create trigger trg_automation_transport_request_update_guard
  before update on public.automation_transport_requests
  for each row execute function public.qf_guard_automation_transport_request_update();

create trigger trg_automation_transport_requests_no_delete
  before delete on public.automation_transport_requests
  for each row execute function public.qf_prevent_automation_transport_history_delete();

create trigger trg_automation_transport_requests_no_truncate
  before truncate on public.automation_transport_requests
  for each statement execute function public.qf_prevent_automation_transport_history_delete();

-- ---------------------------------------------------------------------------
-- 3. One-shot transport claim RPC
-- ---------------------------------------------------------------------------
create or replace function public.qf_claim_automation_job_transport_v1(
  p_request_id uuid,
  p_worker_id text,
  p_body_sha256 text
)
returns table (
  request_id uuid,
  state text,
  is_replay boolean,
  job_id uuid,
  action_request_id uuid,
  attempt_id uuid,
  attempt_number integer,
  max_attempts integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_request public.automation_transport_requests%rowtype;
  v_claim record;
  v_inserted boolean := false;
begin
  if p_request_id is null then
    raise exception 'AUTOMATION_TRANSPORT_REQUEST_ID_REQUIRED'
      using errcode = 'P0001';
  end if;

  if p_worker_id is null
     or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$' then
    raise exception 'AUTOMATION_TRANSPORT_WORKER_ID_INVALID'
      using errcode = 'P0001';
  end if;

  if p_body_sha256 is null
     or p_body_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'AUTOMATION_TRANSPORT_BODY_HASH_INVALID'
      using errcode = 'P0001';
  end if;

  insert into public.automation_transport_requests (
    id,
    worker_id,
    body_sha256
  ) values (
    p_request_id,
    p_worker_id,
    p_body_sha256
  )
  on conflict (id) do nothing
  returning * into v_request;

  v_inserted := v_request.id is not null;

  if not v_inserted then
    -- INSERT ON CONFLICT waits for a concurrent inserter to finish before
    -- returning. The row is then locked so exact replay evidence is stable.
    select * into v_request
      from public.automation_transport_requests
     where id = p_request_id
     for update;

    if v_request.id is null then
      raise exception 'AUTOMATION_TRANSPORT_REPLAY_STATE_MISSING'
        using errcode = 'P0001';
    end if;

    if v_request.transport_version <> 1
       or v_request.direction <> 'n8n_to_core'
       or v_request.route_key <> 'claim_v1'
       or v_request.worker_id is distinct from p_worker_id
       or v_request.body_sha256 is distinct from p_body_sha256 then
      raise exception 'AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT'
        using errcode = 'P0001';
    end if;

    if v_request.state = 'processing' then
      raise exception 'AUTOMATION_TRANSPORT_REQUEST_INCOMPLETE_INVARIANT'
        using errcode = 'P0001';
    end if;

    return query
    select
      v_request.id,
      v_request.state,
      true,
      v_request.job_id,
      v_request.action_request_id,
      v_request.attempt_id,
      v_request.attempt_number,
      v_request.max_attempts;
    return;
  end if;

  -- First and only execution opportunity for this signed request identity.
  select * into v_claim
    from public.qf_claim_automation_job_v1(p_worker_id);

  if v_claim.job_id is null then
    update public.automation_transport_requests
       set state = 'empty',
           finalized_at = now()
     where id = p_request_id
     returning * into v_request;
  else
    update public.automation_transport_requests
       set state = 'claimed',
           job_id = v_claim.job_id,
           action_request_id = v_claim.action_request_id,
           attempt_id = v_claim.attempt_id,
           attempt_number = v_claim.attempt_number,
           max_attempts = v_claim.max_attempts,
           finalized_at = now()
     where id = p_request_id
     returning * into v_request;
  end if;

  return query
  select
    v_request.id,
    v_request.state,
    false,
    v_request.job_id,
    v_request.action_request_id,
    v_request.attempt_id,
    v_request.attempt_number,
    v_request.max_attempts;
end;
$$;

comment on function public.qf_claim_automation_job_transport_v1(uuid, text, text) is
  'QF-MVP-50.1C one-shot signed transport claim. A duplicate request UUID returns is_replay=true and MUST NOT be turned back into an executable envelope.';

-- ---------------------------------------------------------------------------
-- 4. RLS + exact privileges
-- ---------------------------------------------------------------------------
alter table public.automation_transport_requests enable row level security;

revoke all on table public.automation_transport_requests
  from public, anon, authenticated, service_role;
grant select on table public.automation_transport_requests to service_role;

revoke all on function public.qf_guard_automation_transport_request_insert()
  from public, anon, authenticated, service_role;
revoke all on function public.qf_guard_automation_transport_request_update()
  from public, anon, authenticated, service_role;
revoke all on function public.qf_prevent_automation_transport_history_delete()
  from public, anon, authenticated, service_role;

revoke all on function public.qf_claim_automation_job_transport_v1(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_claim_automation_job_transport_v1(uuid, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Self-verification
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_count integer;
  v_sig text :=
    'public.qf_claim_automation_job_transport_v1(uuid,text,text)';
begin
  if to_regclass('public.automation_transport_requests') is null then
    raise exception 'QF-MVP-50.1C aborted: transport ledger missing.';
  end if;

  if not (
    select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public'
       and c.relname='automation_transport_requests'
       and c.relkind='r'
  ) then
    raise exception 'QF-MVP-50.1C aborted: RLS missing.';
  end if;

  if not has_table_privilege(
       'service_role',
       'public.automation_transport_requests',
       'select'
     )
     or has_table_privilege(
       'service_role',
       'public.automation_transport_requests',
       'insert'
     )
     or has_table_privilege(
       'service_role',
       'public.automation_transport_requests',
       'update'
     )
     or has_table_privilege(
       'service_role',
       'public.automation_transport_requests',
       'delete'
     )
     or has_table_privilege(
       'service_role',
       'public.automation_transport_requests',
       'truncate'
     )
     or has_table_privilege(
       'anon',
       'public.automation_transport_requests',
       'select'
     )
     or has_table_privilege(
       'authenticated',
       'public.automation_transport_requests',
       'select'
     ) then
    raise exception 'QF-MVP-50.1C aborted: transport table ACL invalid.';
  end if;

  if to_regprocedure(v_sig) is null then
    raise exception 'QF-MVP-50.1C aborted: transport claim RPC missing.';
  end if;

  if not (
    select p.prosecdef
      from pg_proc p
     where p.oid = to_regprocedure(v_sig)
  ) then
    raise exception 'QF-MVP-50.1C aborted: transport claim RPC is not SECURITY DEFINER.';
  end if;

  if not (
    select array_to_string(coalesce(p.proconfig,array[]::text[]), ',')
             like '%search_path=pg_catalog, public, pg_temp%'
      from pg_proc p
     where p.oid = to_regprocedure(v_sig)
  ) then
    raise exception 'QF-MVP-50.1C aborted: transport claim RPC lacks fixed search_path.';
  end if;

  if not has_function_privilege('service_role', v_sig, 'execute')
     or has_function_privilege('anon', v_sig, 'execute')
     or has_function_privilege('authenticated', v_sig, 'execute') then
    raise exception 'QF-MVP-50.1C aborted: transport RPC ACL invalid.';
  end if;

  select count(*) into v_count
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public'
     and c.relname='automation_transport_requests'
     and not t.tgisinternal
     and t.tgname in (
       'trg_automation_transport_request_insert_guard',
       'trg_automation_transport_request_update_guard',
       'trg_automation_transport_requests_no_delete',
       'trg_automation_transport_requests_no_truncate'
     );

  if v_count <> 4 then
    raise exception
      'QF-MVP-50.1C aborted: expected 4 transport history/lifecycle triggers, found %.',
      v_count;
  end if;

  select count(*) into v_count
    from public.automation_transport_requests;
  if v_count <> 0 then
    raise exception
      'QF-MVP-50.1C aborted: transport ledger unexpectedly seeded.';
  end if;

  if exists (
    select 1 from pg_extension where extname in ('pg_net', 'http', 'dblink')
  ) then
    raise exception
      'QF-MVP-50.1C aborted: database network extension appeared.';
  end if;
end;
$verify$;

commit;
