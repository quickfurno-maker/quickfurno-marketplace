-- ============================================================================
-- QuickFurno — Phase 5F-D4-C
-- Durable asynchronous consent-command acknowledgement delivery.
--
-- WHY THIS TABLE EXISTS.
--   D4-B sends the STOP/START/HELP acknowledgement INLINE, awaited inside the Meta webhook request. Once the
--   three acknowledgement templates are seeded that inline call becomes a real outbound HTTP call to Meta,
--   INSIDE the request Meta is waiting on — a slow provider then pushes the webhook past Meta's tolerance and
--   Meta REDELIVERS. This table replaces that inline await with a durable intent: the webhook persists one
--   row and returns; a Core-owned worker delivers later.
--
-- WHY NOT communication_messages.
--   An acknowledgement is forced by existing constraints into lane='authentication' +
--   destination_source='ephemeral_auth_destination'. `chk_comm_message_ephemeral_never_scheduled` forbids
--   scheduling such a row, and CommunicationService.dispatchPersistedMessage() explicitly refuses BOTH
--   AUTH_LANE_NOT_REDISPATCHABLE and EPHEMERAL_DESTINATION_NOT_REDISPATCHABLE. The ledger has already ruled
--   this class of message undeliverable after the request ends. It cannot be the queue.
--
-- WHY NOT the workflow-kernel outbox_events.
--   No expiry column; `payload_json` is documented "never store secrets" so it cannot hold a sealed
--   destination; no foreign key to the authoritative consent-command receipt. Not used, and NOT a dependency.
--
-- THE DESTINATION PROBLEM.
--   D1-B stores ONLY sha256(sender) — "there is deliberately no phone_e164 column". communication_messages
--   likewise stores only a hash + mask. So the plaintext number does NOT survive the request, and an async
--   worker cannot recover it from anything already persisted. This table therefore carries a SHORT-LIVED
--   AES-256-GCM SEALED destination, bound by AAD to this exact intent, purged on every terminal transition.
--   There is no plaintext phone column here and never will be.
--
-- AUTHORITY. D2-C remains the sole consent/suppression decision authority (re-evaluated by the worker
-- immediately before dispatch). D2-D remains the sole STOP/START writer. QuickFurno Core is authoritative.
-- n8n and Jarvis can neither authorize nor own this path.
--
-- AT MOST ONE PROVIDER ATTEMPT. provider_attempt_count is constrained to 0 or 1. An outcome that is
-- uncertain after the attempt is reserved becomes TERMINAL `uncertain` and is NEVER automatically resent.
--
-- SERVICE-ROLE ONLY. RLS on, no anon/authenticated policy, privileges revoked. Nothing in this file seeds a
-- template row, activates a provider, or configures cron.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The durable acknowledgement intent
-- ----------------------------------------------------------------------------
create table if not exists public.communication_consent_ack_intents (
  id                            uuid primary key default gen_random_uuid(),

  -- The D4-B rate-limit fence, verbatim: `ack:<ack_type>:<destination_hash>:<bucket>`. UNIQUE, so a webhook
  -- REPLAY (same persisted received_at ⇒ same bucket) can never create a second intent.
  idempotency_key               text not null,

  -- REAL binding to the AUTHORITATIVE consent-command receipt written by D2-D.
  -- HELP writes NO consent state (D2-D policy P3) and therefore has NO receipt row — the receipts table only
  -- accepts normalized_command in ('stop','start'). So this is NULL for help and NOT NULL for stop/start,
  -- enforced by ck_ack_intent_receipt_binding below. ON DELETE RESTRICT: an intent may never outlive the
  -- authoritative result it claims to acknowledge.
  consent_command_receipt_id    uuid references public.communication_consent_command_receipts(id) on delete restrict,

  -- REAL binding to the durably persisted inbound message (D1-B).
  inbound_message_id            uuid not null references public.communication_inbound_messages(id) on delete restrict,

  ack_type                      text not null
                                  check (ack_type in (
                                    'consent_stop_acknowledgement',
                                    'consent_start_acknowledgement',
                                    'consent_help_response')),
  command                       text not null check (command in ('stop', 'start', 'help')),

  -- The AUTHORITATIVE D2-D disposition this acknowledgement answers. Closed to the eligible set only: an
  -- ineligible disposition (writer failure, integrity violation, start_blocked_by_stronger_suppression) can
  -- never be enqueued at all.
  authoritative_disposition     text not null
                                  check (authoritative_disposition in (
                                    'stop_applied', 'stop_already_effective',
                                    'start_applied', 'start_partially_applied', 'start_no_reversible_stop',
                                    'help_acknowledged')),

  provider                      text not null check (provider in ('meta_whatsapp', 'exotel_sms', 'system')),
  -- The CANONICAL provider message identity (the sha256 digest D2-E gives D2-D) — never the raw wamid.
  canonical_provider_message_hash text not null check (canonical_provider_message_hash ~ '^[0-9a-f]{64}$'),

  -- sha256 of the canonical E.164 destination. The worker recomputes this from the OPENED sealed value and
  -- requires an exact match, so a substituted destination can never be silently used.
  destination_hash              text not null check (destination_hash ~ '^[0-9a-f]{64}$'),

  -- ── THE SEALED DESTINATION (AES-256-GCM) ────────────────────────────────────────────────────────────
  -- base64url. NEVER a plaintext phone. Cleared on EVERY terminal transition, in the same statement.
  sealed_destination_ciphertext text,
  sealed_destination_nonce      text,   -- 12 bytes, base64url
  sealed_destination_auth_tag   text,   -- 16 bytes, base64url
  encryption_key_id             text,   -- versioned key id; the key itself lives ONLY in the environment
  aad_schema_version            integer not null default 1 check (aad_schema_version >= 1),

  -- D1-B's persisted capture time. Expiry derives from it (stop/start +15 min, help +24 h).
  received_at                   timestamptz not null,
  expires_at                    timestamptz not null,

  status                        text not null default 'pending'
                                  check (status in (
                                    'pending', 'claimed', 'dispatching',
                                    'sent', 'suppressed', 'expired', 'failed', 'uncertain')),

  locked_by                     text,
  locked_at                     timestamptz,
  claim_count                   integer not null default 0 check (claim_count >= 0),

  -- AT MOST ONE PROVIDER ATTEMPT, EVER. Reserved atomically with claimed → dispatching.
  provider_attempt_count        integer not null default 0 check (provider_attempt_count in (0, 1)),

  terminal_code                 text,

  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  completed_at                  timestamptz,

  constraint uq_consent_ack_intent_idempotency unique (idempotency_key),

  -- HELP has no authoritative receipt; STOP/START must have one.
  constraint ck_ack_intent_receipt_binding check (
    (command = 'help' and consent_command_receipt_id is null)
    or (command in ('stop', 'start') and consent_command_receipt_id is not null)
  ),

  -- The acknowledgement type is DERIVED from the command. A swapped pairing can never be stored.
  constraint ck_ack_intent_type_matches_command check (
    (command = 'stop'  and ack_type = 'consent_stop_acknowledgement')
    or (command = 'start' and ack_type = 'consent_start_acknowledgement')
    or (command = 'help'  and ack_type = 'consent_help_response')
  ),

  -- The disposition must belong to the command it claims to answer.
  constraint ck_ack_intent_disposition_matches_command check (
    (command = 'stop'  and authoritative_disposition in ('stop_applied', 'stop_already_effective'))
    or (command = 'start' and authoritative_disposition in ('start_applied', 'start_partially_applied', 'start_no_reversible_stop'))
    or (command = 'help'  and authoritative_disposition = 'help_acknowledged')
  ),

  constraint ck_ack_intent_expiry_after_receipt check (expires_at > received_at),

  -- The sealed envelope is ALL-OR-NOTHING. A half-populated envelope is unopenable and must be unstorable.
  constraint ck_ack_intent_seal_all_or_nothing check (
    (sealed_destination_ciphertext is not null
      and sealed_destination_nonce is not null
      and sealed_destination_auth_tag is not null
      and encryption_key_id is not null)
    or (sealed_destination_ciphertext is null
      and sealed_destination_nonce is null
      and sealed_destination_auth_tag is null
      and encryption_key_id is null)
  ),

  -- NO TERMINAL ROW MAY RETAIN RECOVERABLE DESTINATION MATERIAL. This is the last line of defence behind the
  -- purge in every terminal transition below: a terminal row carrying a sealed field cannot even be written.
  constraint ck_ack_intent_terminal_is_purged check (
    status in ('pending', 'claimed', 'dispatching')
    or (sealed_destination_ciphertext is null
      and sealed_destination_nonce is null
      and sealed_destination_auth_tag is null
      and encryption_key_id is null)
  ),

  -- A live (non-terminal) row must still be openable.
  constraint ck_ack_intent_live_is_sealed check (
    status not in ('pending', 'claimed', 'dispatching')
    or sealed_destination_ciphertext is not null
  ),

  -- The provider may only have been attempted from a dispatching or terminal state.
  constraint ck_ack_intent_attempt_requires_dispatch check (
    provider_attempt_count = 0 or status not in ('pending', 'claimed')
  ),

  -- COMPLETION TIMESTAMP CONSISTENCY. A terminal row has completed; a live row has not. This makes a
  -- half-written transition (terminal status with no completion time, or a live row that claims to be
  -- finished) unstorable, and it is the second reason a purged terminal row can never be revived: setting
  -- status back to 'pending' would also have to clear completed_at, and clearing it while the row is still
  -- terminal is itself a violation.
  constraint ck_ack_intent_completed_at_matches_status check (
    (status in ('pending', 'claimed', 'dispatching') and completed_at is null)
    or (status in ('sent', 'suppressed', 'expired', 'failed', 'uncertain') and completed_at is not null)
  )
);

comment on table public.communication_consent_ack_intents is
  'Phase 5F-D4-C: durable, service-role-only acknowledgement intents for inbound consent commands. Replaces '
  'the D4-B inline webhook send. Carries a SHORT-LIVED AES-256-GCM sealed destination (never plaintext), '
  'purged on every terminal transition. AT MOST ONE provider attempt; an uncertain outcome is terminal and is '
  'never automatically resent. Not consent truth: D2-C decides, D2-D writes.';
comment on column public.communication_consent_ack_intents.sealed_destination_ciphertext is
  'AES-256-GCM ciphertext of the canonical E.164 destination, base64url. AAD-bound to this exact intent. '
  'NEVER a plaintext phone. Cleared in the same statement as every terminal transition.';
comment on column public.communication_consent_ack_intents.provider_attempt_count is
  'AT MOST ONE. Reserved atomically with claimed -> dispatching. After reservation there is no reclaim and no '
  'automatic retry: a timeout, throw or ambiguous result becomes TERMINAL uncertain.';

create index if not exists idx_ack_intents_claimable
  on public.communication_consent_ack_intents(status, expires_at)
  where status in ('pending', 'claimed');
create index if not exists idx_ack_intents_dispatching
  on public.communication_consent_ack_intents(status, locked_at)
  where status = 'dispatching';
create index if not exists idx_ack_intents_inbound
  on public.communication_consent_ack_intents(inbound_message_id);

alter table public.communication_consent_ack_intents enable row level security;
revoke all on table public.communication_consent_ack_intents from public;
revoke all on table public.communication_consent_ack_intents from anon;
revoke all on table public.communication_consent_ack_intents from authenticated;
grant select, insert, update on table public.communication_consent_ack_intents to service_role;
-- NO anon policy. NO authenticated policy. Service-role only, deliberately.

-- ============================================================================
-- CLAIM — atomic, FOR UPDATE SKIP LOCKED
--
-- Claims ONLY:
--   • pending + unexpired; or
--   • STALE claimed + unexpired + provider_attempt_count = 0  (crash BEFORE the provider was ever reserved).
--
-- NEVER claims:
--   • dispatching  (the provider attempt is reserved — reclaiming it could double-send);
--   • provider_attempt_count = 1;
--   • terminal rows;
--   • expired rows.
--
-- A stale DISPATCHING row never returns to pending/claimed. It is recovered to TERMINAL `uncertain` by
-- qf_recover_stale_dispatching_consent_ack_intents() below — a separate, safe path.
-- ============================================================================
create or replace function public.qf_claim_consent_ack_intents(
  p_worker_id       text,
  p_limit           integer  default 25,
  p_stale_lease     interval default interval '2 minutes'
)
returns setof public.communication_consent_ack_intents
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_limit integer;
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'WORKER_ID_REQUIRED' using errcode = 'P0001';
  end if;
  if p_stale_lease is null or p_stale_lease <= interval '0 seconds' or p_stale_lease > interval '1 hour' then
    raise exception 'INVALID_STALE_LEASE' using errcode = 'P0001';
  end if;

  -- Bounded batch: never more than 25, never less than 1.
  v_limit := least(greatest(coalesce(p_limit, 25), 1), 25);

  return query
  update public.communication_consent_ack_intents t
     set status      = 'claimed',
         locked_by   = trim(p_worker_id),
         locked_at   = now(),
         claim_count = t.claim_count + 1,
         updated_at  = now()
   where t.id in (
     select c.id
       from public.communication_consent_ack_intents c
      where c.expires_at > now()
        and c.provider_attempt_count = 0
        and (
              c.status = 'pending'
           or (c.status = 'claimed' and c.locked_at is not null and c.locked_at < now() - p_stale_lease)
        )
      order by c.received_at
      limit v_limit
      for update skip locked
   )
  returning t.*;
end;
$$;

comment on function public.qf_claim_consent_ack_intents(text, integer, interval) is
  'Atomically claims up to 25 due acknowledgement intents (FOR UPDATE SKIP LOCKED). Claims pending or STALE '
  'claimed rows only while provider_attempt_count = 0. NEVER claims dispatching, attempted, terminal or '
  'expired rows. Service-role only.';

-- ============================================================================
-- PROVIDER-ATTEMPT RESERVATION — compare-and-set, claimed -> dispatching, 0 -> 1
--
-- The provider MUST NOT be called unless this returns true. Exactly one worker can win: the WHERE clause
-- pins the current status, the lease owner AND provider_attempt_count = 0, so a loser updates zero rows.
-- ============================================================================
create or replace function public.qf_reserve_consent_ack_provider_attempt(
  p_intent_id text,
  p_worker_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_updated integer;
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'WORKER_ID_REQUIRED' using errcode = 'P0001';
  end if;

  update public.communication_consent_ack_intents
     set status                 = 'dispatching',
         provider_attempt_count = 1,
         updated_at             = now()
   where id                     = p_intent_id::uuid
     and status                 = 'claimed'          -- compare-and-set on the exact prior state
     and locked_by              = trim(p_worker_id)  -- only the lease owner
     and provider_attempt_count = 0                  -- at most one attempt, ever
     and expires_at             > now();             -- never reserve an expired intent

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

comment on function public.qf_reserve_consent_ack_provider_attempt(text, text) is
  'Compare-and-set reservation of THE single provider attempt: claimed -> dispatching and '
  'provider_attempt_count 0 -> 1, for the lease owner only. Returns false if another worker won, the lease '
  'moved, the attempt was already reserved, or the intent expired. The provider must not be called on false.';

-- ============================================================================
-- TERMINALIZE — and PURGE the sealed destination in the SAME statement
--
-- Every terminal transition clears ciphertext, nonce, auth tag and key id atomically with the status write.
-- No terminal row can retain recoverable destination material (ck_ack_intent_terminal_is_purged also refuses
-- to store one).
-- ============================================================================
create or replace function public.qf_terminalize_consent_ack_intent(
  p_intent_id     text,
  p_status        text,
  p_terminal_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_updated integer;
begin
  if p_status is null or p_status not in ('sent', 'suppressed', 'expired', 'failed', 'uncertain') then
    raise exception 'INVALID_TERMINAL_STATUS' using errcode = 'P0001';
  end if;

  update public.communication_consent_ack_intents
     set status                        = p_status,
         terminal_code                 = left(coalesce(p_terminal_code, p_status), 64),
         -- PURGE. Same statement, always.
         sealed_destination_ciphertext = null,
         sealed_destination_nonce      = null,
         sealed_destination_auth_tag   = null,
         encryption_key_id             = null,
         locked_by                     = null,
         locked_at                     = null,
         completed_at                  = now(),
         updated_at                    = now()
   where id     = p_intent_id::uuid
     and status in ('pending', 'claimed', 'dispatching');   -- terminal rows are immutable

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

comment on function public.qf_terminalize_consent_ack_intent(text, text, text) is
  'Terminalizes an intent and PURGES every sealed-destination field in the SAME statement. Terminal rows are '
  'immutable. Service-role only.';

-- ============================================================================
-- EXPIRY SWEEP — expired, NON-dispatching rows become terminal `expired`, sealed fields purged.
-- A dispatching row is NOT touched here: its provider attempt is already reserved, so it is recovered as
-- `uncertain` (never `expired`, never resent) by the function below.
-- ============================================================================
create or replace function public.qf_expire_consent_ack_intents(
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count integer;
begin
  with due as (
    select id
      from public.communication_consent_ack_intents
     where status in ('pending', 'claimed')
       and expires_at <= now()
     order by expires_at
     limit least(greatest(coalesce(p_limit, 100), 1), 500)
     for update skip locked
  )
  update public.communication_consent_ack_intents t
     set status                        = 'expired',
         terminal_code                 = 'expired',
         sealed_destination_ciphertext = null,
         sealed_destination_nonce      = null,
         sealed_destination_auth_tag   = null,
         encryption_key_id             = null,
         locked_by                     = null,
         locked_at                     = null,
         completed_at                  = now(),
         updated_at                    = now()
    from due
   where t.id = due.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.qf_expire_consent_ack_intents(integer) is
  'Terminalizes EXPIRED pending/claimed intents as `expired` and purges the sealed destination. Never touches '
  'a dispatching row (its provider attempt is already reserved).';

-- ============================================================================
-- STALE-DISPATCHING RECOVERY — the ONLY safe path out of `dispatching`.
--
-- A worker that crashed AFTER reserving the provider attempt leaves a dispatching row whose provider outcome
-- is UNKNOWN. It must never go back to pending/claimed and must never be resent. It becomes TERMINAL
-- `uncertain`, sealed fields purged, so no future worker can address it.
-- ============================================================================
create or replace function public.qf_recover_stale_dispatching_consent_ack_intents(
  p_stale_after interval default interval '180 seconds',
  p_limit       integer  default 100
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count integer;
begin
  -- THE SAFETY FLOOR. The application's provider timeout is 60s and the reviewed safety margin is 60s, so
  -- the invariant is STRICT:
  --
  --     recovery threshold  >  provider timeout (60s) + safety margin (60s)   ⇒   > 120 seconds
  --
  -- 120 seconds is therefore NOT safe: at exactly the boundary, recovery could terminalize an attempt a
  -- worker is still legitimately awaiting. Hence `<=`, not `<`. An unsafe threshold cannot be selected —
  -- not by accident, and not even by a service-role caller.
  if p_stale_after is null
     or p_stale_after <= interval '120 seconds'
     or p_stale_after > interval '1 hour' then
    raise exception 'UNSAFE_RECOVERY_THRESHOLD' using errcode = 'P0001';
  end if;

  with stuck as (
    select id
      from public.communication_consent_ack_intents
     where status = 'dispatching'
       -- EXPLICIT. A dispatching row should always carry a reserved attempt, but this must not be left to
       -- an implication of the status: only a row whose SINGLE provider attempt was actually reserved may be
       -- recovered as `uncertain`. Anything else is not an ambiguous provider outcome.
       and provider_attempt_count = 1
       and locked_at is not null
       and locked_at < now() - p_stale_after
     order by locked_at
     limit least(greatest(coalesce(p_limit, 100), 1), 500)
     for update skip locked
  )
  update public.communication_consent_ack_intents t
     set status                        = 'uncertain',
         terminal_code                 = 'worker_crashed_after_attempt_reserved',
         sealed_destination_ciphertext = null,
         sealed_destination_nonce      = null,
         sealed_destination_auth_tag   = null,
         encryption_key_id             = null,
         locked_by                     = null,
         locked_at                     = null,
         completed_at                  = now(),
         updated_at                    = now()
    from stuck
   where t.id = stuck.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.qf_recover_stale_dispatching_consent_ack_intents(interval, integer) is
  'Recovers STALE dispatching intents to TERMINAL `uncertain` (never back to pending/claimed, never resent) '
  'and purges the sealed destination. The provider outcome is unknown, so at-most-once is preserved by '
  'refusing to try again.';

-- ----------------------------------------------------------------------------
-- Privileges: service-role only, for every function.
-- ----------------------------------------------------------------------------
revoke all on function public.qf_claim_consent_ack_intents(text, integer, interval) from public;
revoke all on function public.qf_claim_consent_ack_intents(text, integer, interval) from anon;
revoke all on function public.qf_claim_consent_ack_intents(text, integer, interval) from authenticated;
grant execute on function public.qf_claim_consent_ack_intents(text, integer, interval) to service_role;

revoke all on function public.qf_reserve_consent_ack_provider_attempt(text, text) from public;
revoke all on function public.qf_reserve_consent_ack_provider_attempt(text, text) from anon;
revoke all on function public.qf_reserve_consent_ack_provider_attempt(text, text) from authenticated;
grant execute on function public.qf_reserve_consent_ack_provider_attempt(text, text) to service_role;

revoke all on function public.qf_terminalize_consent_ack_intent(text, text, text) from public;
revoke all on function public.qf_terminalize_consent_ack_intent(text, text, text) from anon;
revoke all on function public.qf_terminalize_consent_ack_intent(text, text, text) from authenticated;
grant execute on function public.qf_terminalize_consent_ack_intent(text, text, text) to service_role;

revoke all on function public.qf_expire_consent_ack_intents(integer) from public;
revoke all on function public.qf_expire_consent_ack_intents(integer) from anon;
revoke all on function public.qf_expire_consent_ack_intents(integer) from authenticated;
grant execute on function public.qf_expire_consent_ack_intents(integer) to service_role;

revoke all on function public.qf_recover_stale_dispatching_consent_ack_intents(interval, integer) from public;
revoke all on function public.qf_recover_stale_dispatching_consent_ack_intents(interval, integer) from anon;
revoke all on function public.qf_recover_stale_dispatching_consent_ack_intents(interval, integer) from authenticated;
grant execute on function public.qf_recover_stale_dispatching_consent_ack_intents(interval, integer) to service_role;
