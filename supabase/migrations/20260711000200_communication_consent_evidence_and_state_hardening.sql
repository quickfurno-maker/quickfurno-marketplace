-- ============================================================================
-- QuickFurno — 20260711000200_communication_consent_evidence_and_state_hardening.sql
-- Phase 5F-D2-B — Consent Evidence Schema + Preference-State Hardening +
--                 Suppression-State Hardening   (ADDITIVE / HARDENING, SCHEMA-ONLY)
--
-- WHAT THIS MIGRATION DOES
--   1. Creates public.communication_consent_events — an IMMUTABLE, append-only
--      communication-consent AUDIT LEDGER (evidence + state-transition record).
--   2. HARDENS public.communication_preferences into a clean CURRENT materialized
--      principal-preference projection (principal required; allowed/blocked only;
--      absence means unknown; state/timestamp consistency; policy + evidence link).
--   3. HARDENS public.communication_suppressions into a clean CURRENT materialized
--      destination-prohibition projection (deactivated_at; hash-format fence; extended
--      reason vocabulary; active/deactivated + ordering invariants; policy + evidence).
--
-- WHAT THIS MIGRATION IS NOT
--   • It is NOT domain_events and NOT outbox_events. communication_consent_events is a
--     standalone consent ledger — it triggers NO n8n, emits NO kernel event, and drives
--     NO execution fabric. It stores evidence and state transitions ONLY.
--   • It builds NO decision service, NO transactional writer, NO RPC, NO STOP/START/HELP
--     handling, NO webhook consent mutation, NO reply/send, NO AI/Jarvis, NO conversation
--     or 24h-window logic, and NO Meta activation. D2-B is SCHEMA ONLY.
--   • It stores NO plaintext destination (hash only), NO raw inbound message content, NO
--     raw webhook payload, NO provider error, NO token/secret/signature, NO OTP/password.
--
-- DORMANT-DATA SAFETY. Both current-state tables are dormant foundations (0 rows, no
-- application/RPC reader or writer). This migration HARDENS their invariants, which could
-- silently reinterpret or invalidate real consent truth if rows already existed — so it
-- ABORTS if either table is non-empty and requires a separate REVIEWED backfill migration.
-- It NEVER truncates, deletes, or auto-backfills consent truth.
--
-- TRANSACTION + MANUAL APPLICATION. This migration is transaction-compatible: it contains NO
-- CREATE INDEX CONCURRENTLY and NO other non-transactional statement, so it runs as ONE atomic
-- transaction under the ordinary Supabase migration runner (no explicit BEGIN/COMMIT is added, to
-- avoid conflicting with that runner). The SECTION 0 ACCESS EXCLUSIVE locks are held until the
-- transaction COMMITs, covering every later statement. It is prepared for review and is NOT
-- auto-applied here. If applied manually, run the ENTIRE file as ONE transaction — never copy or
-- execute selected blocks statement-by-statement outside a single transaction, or the guard locks
-- would release early and the empty-table guarantee would be lost.
-- ============================================================================


-- @@ GUARD_BEGIN
-- ============================================================================
-- SECTION 0 — PRECONDITIONS + DORMANT-DATA GUARD (fail loud, never destructive)
-- ============================================================================
do $$
declare
  v_pref_rows bigint;
  v_supp_rows bigint;
begin
  -- Preconditions: the dormant current-state tables (Phase 5F-A) and the D1-A inbound
  -- table (evidence FK target) must already exist.
  if to_regclass('public.communication_preferences') is null then
    raise exception 'Phase 5F-D2-B: public.communication_preferences is missing (apply Phase 5F-A messaging foundation first)'
      using errcode = 'no_data_found';
  end if;
  if to_regclass('public.communication_suppressions') is null then
    raise exception 'Phase 5F-D2-B: public.communication_suppressions is missing (apply Phase 5F-A messaging foundation first)'
      using errcode = 'no_data_found';
  end if;
  if to_regclass('public.communication_inbound_messages') is null then
    raise exception 'Phase 5F-D2-B: public.communication_inbound_messages is missing (apply Phase 5F-D1-A inbound foundation first)'
      using errcode = 'no_data_found';
  end if;

  -- RACE-SAFE GUARD (closes the empty-table TOCTOU). Acquire ACCESS EXCLUSIVE on BOTH current-state
  -- tables in a FIXED order — communication_preferences, then communication_suppressions, NEVER
  -- reversed — AFTER the existence checks and BEFORE any row count / EXISTS / CREATE / ALTER. ACCESS
  -- EXCLUSIVE conflicts with the ROW EXCLUSIVE lock a concurrent INSERT/UPDATE/DELETE takes, so no
  -- writer can slip a row in between the emptiness check and the hardening ALTERs. A LOCK persists
  -- until the migration TRANSACTION COMMITs (a DO block runs in the current transaction), covering
  -- every subsequent statement. The fixed order prevents deadlock with any future concurrent locker.
  lock table public.communication_preferences in access exclusive mode;
  lock table public.communication_suppressions in access exclusive mode;

  -- DORMANT-DATA GUARD. Both current-state tables MUST be empty. D2-B applies stronger
  -- invariants (principal_id NOT NULL, allowed/blocked-only state, allowed/blocked timestamp
  -- consistency, destination-hash format, a mandatory policy_version + last_event_id evidence
  -- link). Applying that to pre-existing rows could silently reinterpret or invalidate real
  -- consent truth. Refuse and require a separate REVIEWED backfill migration. NEVER truncate,
  -- delete, or auto-backfill consent.
  select count(*) into v_pref_rows from public.communication_preferences;
  select count(*) into v_supp_rows from public.communication_suppressions;
  if v_pref_rows > 0 or v_supp_rows > 0 then
    raise exception 'Phase 5F-D2-B: refusing to harden non-empty consent tables (communication_preferences=% row(s), communication_suppressions=% row(s)); a separate reviewed backfill migration is required', v_pref_rows, v_supp_rows
      using errcode = 'invalid_table_definition',
            hint = 'Do NOT truncate or delete consent data. Author a REVIEWED backfill that first appends communication_consent_events and populates policy_version/last_event_id, then applies the hardening invariants.';
  end if;
end
$$;
-- @@ GUARD_END


-- @@ EVIDENCE_TABLE_BEGIN
-- ============================================================================
-- SECTION 1 — IMMUTABLE CONSENT EVIDENCE LEDGER
-- ============================================================================
-- Append-only. No updated_at exists by design; service_role gets SELECT/INSERT only
-- (SECTION 4). One row per consent/suppression state transition, keyed for idempotent
-- replay by a server-generated opaque SHA-256 idempotency_key.
create table if not exists public.communication_consent_events (
  id                   uuid primary key default gen_random_uuid(),
  -- 'preference' → a principal preference transition; 'suppression' → a destination
  -- prohibition transition. Governs the subject + scope + action/state invariants below.
  target_type          text not null check (target_type in ('preference', 'suppression')),
  -- Polymorphic principal (client_accounts.id / vendors.id), no cross-table FK — matches
  -- the communication_messages / inbound convention. anonymous/system are NEVER principals;
  -- an unknown/ambiguous sender is represented by destination_hash, never an invented principal.
  principal_type       text check (principal_type is null or principal_type in ('client', 'vendor', 'admin')),
  principal_id         uuid,
  -- sha256(canonical E.164) lowercase hex (lib/communication/phone.ts hashPhoneE164). NEVER a
  -- plaintext phone / wa_id / MSISDN. Format-fenced whenever present.
  destination_hash     text check (destination_hash is null or destination_hash ~ '^[0-9a-f]{64}$'),
  channel              text not null check (channel in ('whatsapp', 'sms', 'rcs')),
  -- Evidence covers all four scopes (incl. 'global' for destination suppression). The
  -- target/scope compatibility fence below narrows scope per target_type.
  scope                text not null check (scope in ('authentication', 'transactional', 'marketing', 'global')),
  action               text not null check (action in (
                         'grant', 'withdraw', 'reaffirm', 'admin_block', 'admin_unblock',
                         'suppress', 'unsuppress', 'provider_block', 'provider_unblock')),
  -- Generic transition vocabulary; the per-target fences below narrow it. 'absent' is a valid
  -- PRIOR state only (a first grant/suppress) — never a resulting state.
  state_before         text check (state_before is null or state_before in ('absent', 'allowed', 'blocked', 'active', 'inactive')),
  state_after          text not null check (state_after in ('allowed', 'blocked', 'active', 'inactive')),
  reason               text not null check (reason in (
                         'user_grant', 'user_withdrawal', 'user_stop', 'user_start',
                         'provider_block', 'provider_restored', 'hard_bounce', 'complaint',
                         'admin', 'legal', 'abuse', 'import', 'system', 'unspecified')),
  source               text not null check (source in ('system', 'user', 'admin', 'provider', 'import')),
  evidence_type        text not null check (evidence_type in ('inbound_command', 'admin_action', 'provider_signal', 'import', 'system_action')),
  -- Server-set consent policy version (a code constant in D2-C/D2-D). Identifier-shaped,
  -- bounded; NEVER a mutable browser-supplied value; NO database policy catalog in D2-B.
  policy_version       text not null check (policy_version ~ '^[A-Za-z0-9._:-]{1,64}$'),
  actor_type           text not null check (actor_type in ('system', 'user', 'admin', 'provider')),
  -- Server-resolved ADMIN actor id — permitted ONLY when actor_type = 'admin' (see chk); it is
  -- NULL for system/user/provider (a bare uuid would be polymorphically ambiguous between a client
  -- and a vendor). The AFFECTED principal is the typed (principal_type, principal_id) pair. NEVER
  -- accepted directly from a browser or provider payload without future server validation.
  actor_id             uuid,
  -- Bounded, identifier-shaped provenance of the causing event; both required.
  source_event_type    text not null check (source_event_type ~ '^[A-Za-z0-9._:-]{1,64}$'),
  source_event_id      text not null check (char_length(source_event_id) between 1 and 200),
  -- OPTIONAL convenience link to the verified inbound row. ON DELETE SET NULL: the immutable
  -- event OUTLIVES the inbound row and is never deleted with it — so no CHECK may REQUIRE this
  -- column (the permanent inbound-action identity is source_event_id + the provider pair).
  inbound_message_id   uuid references public.communication_inbound_messages(id) on delete set null,
  provider             text,
  provider_message_id  text,
  occurred_at          timestamptz not null,
  -- Bounded sanitized JSON object only (future writers MUST use an allowlist). NEVER a raw
  -- payload, phone, message text, provider error, token/secret, OTP, or free-form note.
  metadata_sanitized   jsonb not null default '{}'::jsonb
                         check (jsonb_typeof(metadata_sanitized) = 'object'
                                and octet_length(metadata_sanitized::text) <= 4096),
  -- Server-generated OPAQUE sha256 hex (never the raw namespaced tuple). The unique fence
  -- below makes a redelivered inbound command an idempotent replay, not a duplicate event.
  idempotency_key      text not null check (idempotency_key ~ '^[0-9a-f]{64}$'),
  created_at           timestamptz not null default now(),

  -- Complete principal-pair invariant: both present or both null (never a partial pair).
  constraint chk_consent_evt_principal_pair check (
    (principal_type is null and principal_id is null)
    or (principal_type is not null and principal_id is not null)
  ),
  -- Subject-presence invariant: a complete principal pair OR a destination_hash. No subjectless event.
  constraint chk_consent_evt_subject_present check (
    (principal_type is not null and principal_id is not null)
    or destination_hash is not null
  ),
  -- Target/subject/scope compatibility fence:
  --   preference  → complete principal pair, destination_hash NULL (strictly principal-scoped:
  --                 destination-level truth belongs to suppression evidence, never a preference),
  --                 scope in (authentication/transactional/marketing)
  --   suppression → destination_hash present (a complete principal pair is OPTIONAL linkage),
  --                 scope in (transactional/marketing/global)
  -- (principal_type is independently limited to client/vendor/admin, so no anonymous/system
  --  preference row is possible. There is deliberately NO 'authentication' suppression scope.)
  constraint chk_consent_evt_target_shape check (
    (target_type = 'preference'
       and principal_type is not null and principal_id is not null
       and destination_hash is null
       and scope in ('authentication', 'transactional', 'marketing'))
    or (target_type = 'suppression'
       and destination_hash is not null
       and scope in ('transactional', 'marketing', 'global'))
  ),
  -- Per-target prior-state fence.
  constraint chk_consent_evt_state_before check (
    state_before is null
    or (target_type = 'preference' and state_before in ('absent', 'allowed', 'blocked'))
    or (target_type = 'suppression' and state_before in ('absent', 'active', 'inactive'))
  ),
  -- Action ⟷ target ⟷ resulting-state fence (forbids nonsensical cross-target combinations):
  --   grant/reaffirm            → preference, allowed
  --   withdraw/admin_block      → preference, blocked
  --   suppress/provider_block   → suppression, active
  --   unsuppress/provider_unblock/admin_unblock → suppression, inactive
  constraint chk_consent_evt_action_state check (
    (action in ('grant', 'reaffirm') and target_type = 'preference' and state_after = 'allowed')
    or (action in ('withdraw', 'admin_block') and target_type = 'preference' and state_after = 'blocked')
    or (action in ('suppress', 'provider_block') and target_type = 'suppression' and state_after = 'active')
    or (action in ('unsuppress', 'provider_unblock', 'admin_unblock') and target_type = 'suppression' and state_after = 'inactive')
  ),
  -- ACTOR IDENTITY IS ADMIN-ONLY (one complete invariant). An admin action carries a server-resolved
  -- admin actor_id; a system/user/provider action carries NO actor_id (a bare uuid would be
  -- polymorphically ambiguous between a client and a vendor). Unknown-user actions remain attributable
  -- via destination_hash + source_event_id + the provider pair + inbound_message_id.
  constraint chk_consent_evt_actor check (
    (actor_type = 'admin' and actor_id is not null)
    or (actor_type <> 'admin' and actor_id is null)
  ),
  -- Provider pair all-or-none.
  constraint chk_consent_evt_provider_pair check (
    (provider is null and provider_message_id is null)
    or (provider is not null and provider_message_id is not null)
  ),
  -- Inbound-command evidence must carry the permanent provider pair (the durable inbound-action
  -- identity). It does NOT require inbound_message_id, whose ON DELETE SET NULL could clear it
  -- without invalidating the immutable event.
  constraint chk_consent_evt_inbound_command check (
    evidence_type <> 'inbound_command'
    or (provider is not null and provider_message_id is not null)
  )
);

comment on table public.communication_consent_events is
  'Phase 5F-D2-B: IMMUTABLE append-only communication-consent audit ledger (evidence + state transitions). NOT domain_events, NOT outbox_events; triggers no n8n and drives no execution. Stores hashed destinations and minimized evidence only — never a plaintext phone, raw inbound content, raw webhook payload, provider error, token/secret/signature, OTP, or password. Append-only: service_role has SELECT/INSERT only (no UPDATE/DELETE/TRUNCATE).';
comment on column public.communication_consent_events.idempotency_key is
  'Phase 5F-D2-B: server-generated OPAQUE sha256 hex (64 lowercase). Derived by a future writer from a canonical namespaced tuple (e.g. qf-consent-v1 | target_type | provider | provider_message_id | action | channel | scope); the raw tuple is never stored. Unique — a redelivered inbound command is an idempotent replay, never a duplicate event.';
comment on column public.communication_consent_events.inbound_message_id is
  'Phase 5F-D2-B: OPTIONAL convenience link to public.communication_inbound_messages(id), ON DELETE SET NULL. The immutable event outlives the inbound row; the permanent inbound-action identity is source_event_id + (provider, provider_message_id), never message text/phone/timestamp/payload hash.';

-- Idempotent-replay fence (server-generated opaque key).
create unique index if not exists uq_comm_consent_event_idempotency
  on public.communication_consent_events (idempotency_key);

-- Defense-in-depth: one provider-originated event per (target, action, channel, scope). A single
-- inbound command may still create SEPARATE preference and suppression evidence (target differs),
-- while a duplicate for the same target/action is rejected even if a key were mis-generated.
create unique index if not exists uq_comm_consent_event_provider_action
  on public.communication_consent_events (provider, provider_message_id, target_type, action, channel, scope)
  where provider is not null and provider_message_id is not null;

-- History/lookup indexes (none redundant with the unique indexes above; provider-message lookup
-- is already served by the leading columns of uq_comm_consent_event_provider_action).
create index if not exists idx_comm_consent_event_principal
  on public.communication_consent_events (principal_type, principal_id, channel, scope, occurred_at desc);
create index if not exists idx_comm_consent_event_destination
  on public.communication_consent_events (destination_hash, channel, scope, occurred_at desc);
create index if not exists idx_comm_consent_event_source_event
  on public.communication_consent_events (source_event_type, source_event_id);
create index if not exists idx_comm_consent_event_inbound
  on public.communication_consent_events (inbound_message_id)
  where inbound_message_id is not null;
-- @@ EVIDENCE_TABLE_END


-- @@ PREFERENCE_HARDENING_BEGIN
-- ============================================================================
-- SECTION 2 — HARDEN communication_preferences (CURRENT materialized state)
-- ============================================================================
-- communication_preferences is the CURRENT materialized principal-preference projection.
-- ABSENCE OF A ROW MEANS UNKNOWN — 'unknown' is never a durable stored state. Authoritative
-- history lives in communication_consent_events. Rows are mutated ONLY by the future D2-D
-- controlled writer (append evidence, then update this projection atomically).
alter table public.communication_preferences
  add column if not exists policy_version text,
  add column if not exists last_event_id  uuid;

do $$
declare
  v_con text;
begin
  -- (1) principal_id becomes REQUIRED — this closes the NULL-uniqueness bypass on
  -- uq_comm_preference (Postgres treats NULLs as distinct). The dormant-data guard guarantees
  -- the table is empty, so SET NOT NULL cannot fail on legacy rows.
  alter table public.communication_preferences alter column principal_id set not null;

  -- (2) principal_type restricted to real principals (client/vendor/admin). anonymous/system
  -- never own a preference — their governance is destination-level suppression evidence.
  for v_con in
    select conname from pg_constraint
    where conrelid = 'public.communication_preferences'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%principal_type%' and pg_get_constraintdef(oid) ilike '%anonymous%'
  loop execute format('alter table public.communication_preferences drop constraint %I', v_con); end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.communication_preferences'::regclass and conname = 'chk_comm_preference_principal_type') then
    alter table public.communication_preferences
      add constraint chk_comm_preference_principal_type check (principal_type in ('client', 'vendor', 'admin'));
  end if;

  -- (3) state limited to allowed/blocked (no durable 'unknown'); drop the default so the writer
  -- must set it explicitly.
  for v_con in
    select conname from pg_constraint
    where conrelid = 'public.communication_preferences'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%state%' and pg_get_constraintdef(oid) ilike '%unknown%'
  loop execute format('alter table public.communication_preferences drop constraint %I', v_con); end loop;
  alter table public.communication_preferences alter column state drop default;
  if not exists (select 1 from pg_constraint where conrelid = 'public.communication_preferences'::regclass and conname = 'chk_comm_preference_state') then
    alter table public.communication_preferences
      add constraint chk_comm_preference_state check (state in ('allowed', 'blocked'));
  end if;

  -- (4) complete state/timestamp consistency (no contradictory combinations):
  --   allowed → consented_at present, withdrawn_at null
  --   blocked → consented_at null,    withdrawn_at present
  if not exists (select 1 from pg_constraint where conrelid = 'public.communication_preferences'::regclass and conname = 'chk_comm_preference_state_time') then
    alter table public.communication_preferences
      add constraint chk_comm_preference_state_time check (
        (state = 'allowed' and consented_at is not null and withdrawn_at is null)
        or (state = 'blocked' and consented_at is null and withdrawn_at is not null)
      );
  end if;

  -- (5) policy_version + last_event_id (evidence link) become REQUIRED. Every current-state row
  -- references its creating/latest immutable evidence event. Empty table → SET NOT NULL is safe.
  alter table public.communication_preferences alter column policy_version set not null;
  alter table public.communication_preferences alter column last_event_id  set not null;
  if not exists (select 1 from pg_constraint where conrelid = 'public.communication_preferences'::regclass and conname = 'chk_comm_preference_policy_version') then
    alter table public.communication_preferences
      add constraint chk_comm_preference_policy_version check (policy_version ~ '^[A-Za-z0-9._:-]{1,64}$');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.communication_preferences'::regclass and conname = 'fk_comm_preference_last_event') then
    alter table public.communication_preferences
      add constraint fk_comm_preference_last_event
      foreign key (last_event_id) references public.communication_consent_events(id) on delete restrict;
  end if;
end
$$;

-- (6) uq_comm_preference (principal_type, principal_id, channel, scope) is preserved unchanged;
-- with principal_id NOT NULL the NULL-uniqueness bypass is now closed.
-- (7) RLS + least-privilege grants preserved: current state is MUTABLE by the writer, so
-- service_role keeps SELECT/INSERT/UPDATE (no DELETE/TRUNCATE). Re-asserted for explicitness.
alter table public.communication_preferences enable row level security;
revoke all on public.communication_preferences from anon;
revoke all on public.communication_preferences from authenticated;
revoke all on public.communication_preferences from service_role;
grant select, insert, update on public.communication_preferences to service_role;

-- (8) documentation.
comment on table public.communication_preferences is
  'Phase 5F-D2-B: CURRENT materialized principal-preference projection (whatsapp/sms/rcs x scope). ABSENCE OF A ROW MEANS UNKNOWN — only allowed/blocked are durable states. Authoritative history is communication_consent_events; rows are mutated ONLY by the future controlled writer. principal_id is required (closes the NULL-uniqueness bypass); anonymous/system never own a preference.';
comment on column public.communication_preferences.last_event_id is
  'Phase 5F-D2-B: FK to the communication_consent_events row that produced this current state (ON DELETE RESTRICT; evidence is immutable).';
comment on column public.communication_preferences.policy_version is
  'Phase 5F-D2-B: consent policy version under which this current state was written. Server-set; never browser-supplied.';
-- @@ PREFERENCE_HARDENING_END


-- @@ SUPPRESSION_HARDENING_BEGIN
-- ============================================================================
-- SECTION 3 — HARDEN communication_suppressions (CURRENT materialized state)
-- ============================================================================
-- communication_suppressions is the CURRENT materialized destination-prohibition projection.
-- A row may remain physically is_active = true after expires_at passes until the future
-- controlled writer or a sweeper deactivates it; readers MUST compute EFFECTIVE activity at read
-- time (see the table comment below) — deterministic column comparisons only, never a wall clock in a CHECK.
alter table public.communication_suppressions
  add column if not exists deactivated_at timestamptz,
  add column if not exists policy_version text,
  add column if not exists last_event_id  uuid;

do $$
declare
  v_con text;
begin
  -- (2) destination_hash format fence: sha256(canonical E.164) lowercase hex.
  if not exists (select 1 from pg_constraint where conrelid = 'public.communication_suppressions'::regclass and conname = 'chk_comm_suppression_destination_hash') then
    alter table public.communication_suppressions
      add constraint chk_comm_suppression_destination_hash check (destination_hash ~ '^[0-9a-f]{64}$');
  end if;

  -- (3) extend the reason vocabulary with legal + abuse (for global safety blocks).
  for v_con in
    select conname from pg_constraint
    where conrelid = 'public.communication_suppressions'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%reason%' and pg_get_constraintdef(oid) ilike '%user_stop%'
  loop execute format('alter table public.communication_suppressions drop constraint %I', v_con); end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.communication_suppressions'::regclass and conname = 'chk_comm_suppression_reason') then
    alter table public.communication_suppressions
      add constraint chk_comm_suppression_reason check (reason in (
        'unspecified', 'user_stop', 'provider_block', 'hard_bounce', 'complaint', 'admin', 'legal', 'abuse'));
  end if;

  -- (4) complete active/deactivated invariant:
  --   is_active = true  → deactivated_at null
  --   is_active = false → deactivated_at present
  if not exists (select 1 from pg_constraint where conrelid = 'public.communication_suppressions'::regclass and conname = 'chk_comm_suppression_active_deactivated') then
    alter table public.communication_suppressions
      add constraint chk_comm_suppression_active_deactivated check (
        (is_active = true and deactivated_at is null)
        or (is_active = false and deactivated_at is not null)
      );
  end if;

  -- (5) ordering fences (no now() in a CHECK — deterministic column comparisons only):
  --   deactivation cannot precede suppression; expiry cannot precede suppression.
  if not exists (select 1 from pg_constraint where conrelid = 'public.communication_suppressions'::regclass and conname = 'chk_comm_suppression_deactivated_order') then
    alter table public.communication_suppressions
      add constraint chk_comm_suppression_deactivated_order check (deactivated_at is null or deactivated_at >= suppressed_at);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.communication_suppressions'::regclass and conname = 'chk_comm_suppression_expiry_order') then
    alter table public.communication_suppressions
      add constraint chk_comm_suppression_expiry_order check (expires_at is null or expires_at > suppressed_at);
  end if;

  -- (1/policy) policy_version + last_event_id (evidence link) become REQUIRED. Empty table → safe.
  alter table public.communication_suppressions alter column policy_version set not null;
  alter table public.communication_suppressions alter column last_event_id  set not null;
  if not exists (select 1 from pg_constraint where conrelid = 'public.communication_suppressions'::regclass and conname = 'chk_comm_suppression_policy_version') then
    alter table public.communication_suppressions
      add constraint chk_comm_suppression_policy_version check (policy_version ~ '^[A-Za-z0-9._:-]{1,64}$');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.communication_suppressions'::regclass and conname = 'fk_comm_suppression_last_event') then
    alter table public.communication_suppressions
      add constraint fk_comm_suppression_last_event
      foreign key (last_event_id) references public.communication_consent_events(id) on delete restrict;
  end if;
end
$$;

-- (6) uq_comm_suppression_active (destination_hash, channel, scope) WHERE is_active is preserved.
-- (8) RLS + least-privilege grants preserved (SELECT/INSERT/UPDATE, no DELETE/TRUNCATE). Re-asserted.
alter table public.communication_suppressions enable row level security;
revoke all on public.communication_suppressions from anon;
revoke all on public.communication_suppressions from authenticated;
revoke all on public.communication_suppressions from service_role;
grant select, insert, update on public.communication_suppressions to service_role;

-- (7) documentation of the effective-expiry read rule + append-only history.
comment on table public.communication_suppressions is
  'Phase 5F-D2-B: CURRENT materialized destination-prohibition projection (hash-keyed, scope-aware). A row may remain physically is_active until a controlled writer/sweeper deactivates it; readers MUST compute effective activity as is_active AND (expires_at IS NULL OR expires_at > evaluatedAt) at read time. Authoritative history is communication_consent_events; rows are mutated ONLY by the future controlled writer.';
comment on column public.communication_suppressions.deactivated_at is
  'Phase 5F-D2-B: when is_active flipped to false (invariant: is_active=false <=> deactivated_at present). Deterministic ordering only; never derived from the wall clock in a CHECK.';
comment on column public.communication_suppressions.last_event_id is
  'Phase 5F-D2-B: FK to the communication_consent_events row that produced this current state (ON DELETE RESTRICT; evidence is immutable).';
-- @@ SUPPRESSION_HARDENING_END


-- @@ EVIDENCE_GRANTS_BEGIN
-- ============================================================================
-- SECTION 4 — EVIDENCE LEDGER RLS + APPEND-ONLY GRANTS (least privilege)
-- ============================================================================
-- RLS on; ZERO anon/authenticated privileges; ZERO browser policies. The evidence ledger is
-- APPEND-ONLY: service_role gets SELECT/INSERT ONLY — deliberately NO UPDATE, NO DELETE, NO
-- TRUNCATE, so a committed evidence row can never be altered or removed by the application.
alter table public.communication_consent_events enable row level security;
-- Defense in depth against altered database default privileges: explicitly strip PUBLIC first.
-- (This does NOT remove the table owner / superuser's inherent administrative powers.)
revoke all on table public.communication_consent_events from public;
revoke all on public.communication_consent_events from anon;
revoke all on public.communication_consent_events from authenticated;
revoke all on public.communication_consent_events from service_role;
grant select, insert on public.communication_consent_events to service_role;
-- @@ EVIDENCE_GRANTS_END

-- ============================================================================
-- Deliberately NOT done in Phase 5F-D2-B (schema only):
--   • no decision service, no transactional writer, no RPC, no SECURITY DEFINER function
--   • no STOP/START/HELP handling; no webhook consent read/mutation; no reply/send
--   • no communication_preferences / communication_suppressions application write
--   • no domain_events / outbox_events / n8n; no AI/Jarvis; no conversation/24h-window
--   • no Meta activation; no env change; no data backfill; not auto-applied
--   • no DELETE / TRUNCATE grant for any role; no anon/authenticated grant or policy
-- ============================================================================
