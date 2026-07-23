-- ============================================================================
-- QuickFurno — QF-MVP-20.3B1 — MIGRATION A2 — Historical assignment lineage backfill
--
-- PHASE
--   QF-MVP-20.3B1. This file is Migration A2 of three.
--   Release order: A -> A2 -> B1 -> R1 (runtime) -> B2 -> C -> D -> E.
--
-- PURPOSE
--   Reconstruct append-only lifetime lineage for assignments that already
--   existed before the canonical authority was deployed, so that lifetime-six
--   has a truthful history to count. This is a REVIEWED DATA MIGRATION, not
--   DDL. It requires founder sign-off before production application.
--
-- CLASSIFICATION
--   DATA. Fully idempotent. Creates only assignment_operations rows and
--   lead_assignment_events rows. Changes NO existing business outcome.
--
-- DEPENDENCIES
--   • Migration A (20260723000100) applied: assignment_operations and
--     lead_assignment_events exist, and lead_assignments.lifecycle_status
--     exists.
--   • No dependency on Migration B1. A2 runs BEFORE any canonical RPC exists,
--     so every lead_assignments row present at this moment is by definition
--     historical.
--
-- AUTHORITATIVE SOURCES
--   docs/QF-MVP-20-3A1-DECISION-CLOSURE.md  (sections 5, 7)
--   docs/QF-MVP-20-3A-SCHEMA-CONTRACT.md    (section 10b)
--   QF-MVP-20.3B1 founder decisions 1 and 3 (recorded below).
--
-- FOUNDER DECISION 1 — OPERATION MODEL (supersedes the single global batch row)
--   assignment_operations.lead_id stays uuid NOT NULL. A single global batch
--   row is therefore structurally impossible, because the historical
--   assignments span many leads. Instead A2 creates ONE deterministic
--   assignment_operations row PER DISTINCT LEAD that has historical
--   assignments requiring a lineage seed:
--
--     idempotency_key = 'qf_mvp_20_a2_lineage_backfill_v1:' || lead_id
--     mode            = 'recovery_replay'
--     actor_kind      = 'worker'
--     actor_id        = NULL
--     reason_code     = 'migration_backfill'
--
--   Every seeded event references the operation belonging to ITS OWN lead. The
--   shared batch identity 'qf_mvp_20_a2_lineage_backfill_v1' is retained in
--   metadata/result so the whole backfill remains one auditable unit.
--
-- FOUNDER DECISION 3 — VOCABULARY
--   source_kind      = 'migration_backfill'   (never 'backfill')
--   source_reference = 'legacy_assignment_seed_v1:' || assignment_id
--
-- EVENT CONTRACT (per qualifying historical assignment, exactly one event)
--   event_type            = 'assignment_created'
--   lifecycle_from        = NULL
--   lifecycle_to          = 'assigned'
--   occurred_at           = lead_assignments.assigned_at   (never now())
--   recorded_at           = the single deterministic migration timestamp
--   actor_kind            = 'worker'
--   actor_id              = NULL
--   reason_code           = 'lineage_backfill'
--   event_idempotency_key = 'legacy_assignment_seed_v1:' || assignment_id
--   written with ON CONFLICT (event_idempotency_key) DO NOTHING
--
--   NEVER ON CONFLICT (lead_id, vendor_id). No such constraint exists on
--   lead_assignment_events and none may ever be created (QF-MVP-20.3A1R):
--   the table is an append-only lifecycle event stream in which one
--   (lead, vendor) pair legitimately records many events.
--
-- THE SEED SET (defined once, used identically by both INSERTs and by
-- verification, so the migration is safe to re-run at any later time)
--
--     la.lead_id     is not null
--     and la.vendor_id   is not null
--     and la.assigned_at is not null
--     and not exists (select 1 from public.lead_assignment_events e
--                      where e.assignment_id = la.id)
--
--   The "has no lineage at all" clause is what makes re-running safe. On a
--   re-run every historical assignment already carries its seed event, so the
--   set is empty. It also means that once Migration B1 and the R1 runtime are
--   live, assignments created by the canonical authority — which always write
--   their own assignment_event:... lineage — are NEVER re-seeded as legacy
--   rows by a later re-run of this file.
--
-- NO HARDCODED COUNTS
--   Every count is derived from the live table. The frozen production evidence
--   (46 assignments across 24 distinct leads, 0 duplicate pairs, 0 orphans, all
--   credit_deducted = true) is recorded for review only and is NOT asserted,
--   NOT assumed and NOT written anywhere. Correct behaviour is required in all
--   three situations:
--     • empty staging          -> 0 operations, 0 events, no application data
--     • production-shaped data -> 1 operation per distinct qualifying lead,
--                                 1 event per qualifying assignment
--     • re-run                 -> 0 new operations, 0 new events, 0 other change
--
-- LIFECYCLE BACKFILL METHOD (deliberately NOT an UPDATE)
--   Migration A added lifecycle_status as NOT NULL DEFAULT 'assigned', so every
--   pre-existing row already carries 'assigned' through the column default.
--   That IS the reviewed backfill (QF-MVP-20.3A1 section 5: all historical rows
--   map to 'assigned', exhaustive matrix, zero ambiguity). A2 therefore performs
--   NO bulk UPDATE of lifecycle_status; it VERIFIES the outcome instead. No
--   unreviewed convenience UPDATE is introduced.
--
-- INCOMPLETE HISTORY
--   A row with a NULL lead_id, vendor_id or assigned_at cannot be truthfully
--   reconstructed. It is SKIPPED and REPORTED, never guessed at and never
--   partially seeded. Production evidence shows zero such rows.
--
-- THIS MIGRATION DELIBERATELY DOES NOT
--   • create any vendor_credit_logs row, or change any credit balance
--   • claim that a credit debit was PROVEN (credit_deducted is carried as a
--     claim only; the 27-row missing-evidence gap stays open for QF-MVP-20.4)
--   • create any communication_intents row, send any message, or touch any
--     provider state
--   • change lifecycle_status, vendor_status, assignment_type, credit_deducted,
--     is_bad_lead_reported or any other existing column value
--   • convert the pending bad-lead report into 'invalid' or any other state
--     (its bad_lead_reports row is status='Pending', admin_decision=NULL, so no
--     admin decision exists; it stays 'assigned')
--   • create any table, column, constraint, index, function or trigger
--   • touch leads, vendors, replacement_requests or credit_restoration_approvals
--
-- ROLLBACK BOUNDARY
--   delete from public.lead_assignment_events
--    where source_kind = 'migration_backfill'
--      and event_idempotency_key like 'legacy_assignment_seed_v1:%';
--   delete from public.assignment_operations
--    where idempotency_key like 'qf_mvp_20_a2_lineage_backfill_v1:%';
--   (Executed in that order, as a reviewed forward step. Re-running A2
--   afterwards reproduces the identical seed, because every key is derived
--   deterministically from existing row identifiers.)
-- ============================================================================

do $backfill$
declare
  v_recorded_at     timestamptz := now();  -- ONE deterministic stamp for the whole batch
  v_batch_key       text        := 'qf_mvp_20_a2_lineage_backfill_v1';
  v_total_rows      bigint;
  v_incomplete_rows bigint;
  v_seed_rows       bigint;   -- assignments needing a seed, measured BEFORE inserting
  v_seed_leads      bigint;   -- distinct leads across that set
  v_ops_before      bigint;
  v_ops_after       bigint;
  v_events_before   bigint;
  v_events_after    bigint;
  v_ledger_before   bigint;
  v_ledger_after    bigint;
  v_intents_before  bigint;
  v_intents_after   bigint;
  v_remaining       bigint;
  v_bad_lifecycle   bigint;
begin
  -- -------------------------------------------------------------------------
  -- 0. Preconditions and "before" measurements (all derived, none assumed)
  -- -------------------------------------------------------------------------
  select count(*) into v_total_rows from public.lead_assignments;

  select count(*) into v_incomplete_rows
    from public.lead_assignments
   where lead_id is null or vendor_id is null or assigned_at is null;

  select count(*), count(distinct lead_id) into v_seed_rows, v_seed_leads
    from public.lead_assignments la
   where la.lead_id is not null
     and la.vendor_id is not null
     and la.assigned_at is not null
     and not exists (select 1 from public.lead_assignment_events e where e.assignment_id = la.id);

  select count(*) into v_ops_before     from public.assignment_operations;
  select count(*) into v_events_before  from public.lead_assignment_events;
  select count(*) into v_ledger_before  from public.vendor_credit_logs;
  select count(*) into v_intents_before from public.communication_intents;

  raise notice 'QF-MVP-20.3B1 A2: % assignment row(s) present; % require a lineage seed across % distinct lead(s); % incomplete row(s) skipped.',
    v_total_rows, v_seed_rows, v_seed_leads, v_incomplete_rows;

  if v_incomplete_rows > 0 then
    raise notice 'QF-MVP-20.3B1 A2: % assignment row(s) SKIPPED because lead_id, vendor_id or assigned_at is NULL. Incomplete history is never guessed. These rows receive NO lineage event and must be reconciled under QF-MVP-20.4.',
      v_incomplete_rows;
  end if;

  -- On an empty database both statements below select from lead_assignments and
  -- therefore create nothing at all, by construction.

  -- -------------------------------------------------------------------------
  -- 1. One deterministic backfill operation per DISTINCT qualifying lead
  -- -------------------------------------------------------------------------
  insert into public.assignment_operations (
    idempotency_key, request_fingerprint, lead_id, mode, actor_kind, actor_id,
    replacement_request_id, reason_code, status, result, created_at, completed_at
  )
  select
    v_batch_key || ':' || la.lead_id::text,
    -- Deterministic request fingerprint, built with the SAME canonical encoding
    -- the canonical authority uses (QF-MVP-20.3B1R): version, lead, mode,
    -- sorted candidate list (empty for a backfill), reason code, replacement
    -- reference and actor. No timestamp, no random value, no volatile state, so
    -- re-running A2 reproduces byte-identical fingerprints.
    encode(sha256(convert_to(jsonb_build_object(
      'v',               1,
      'lead_id',         la.lead_id::text,
      'mode',            'recovery_replay',
      'candidates',      '[]'::jsonb,
      'reason_code',     'migration_backfill',
      'replacement_ref', '',
      'actor_kind',      'worker',
      'actor_id',        ''
    )::text, 'UTF8')), 'hex'),
    la.lead_id,
    'recovery_replay',
    'worker',
    null,
    null,
    'migration_backfill',
    'applied',
    jsonb_build_object(
      'backfill_batch_key',  v_batch_key,
      'phase',               'QF-MVP-20.3B1-A2',
      'seeded_from',         'lead_assignments',
      'seeded_assignments',  count(*),
      'credit_debit_proven', false,
      'note',                'Reconstructed lineage only. No ledger row was written and no credit debit is proven by this operation.'
    ),
    v_recorded_at,
    v_recorded_at
  from public.lead_assignments la
  where la.lead_id is not null
    and la.vendor_id is not null
    and la.assigned_at is not null
    and not exists (select 1 from public.lead_assignment_events e where e.assignment_id = la.id)
  group by la.lead_id
  on conflict (idempotency_key) do nothing;

  -- -------------------------------------------------------------------------
  -- 2. Exactly one initial event per qualifying historical assignment
  --
  --    Each event is anchored to the operation row of ITS OWN lead.
  --    Replay guard: event_idempotency_key. NEVER (lead_id, vendor_id).
  -- -------------------------------------------------------------------------
  insert into public.lead_assignment_events (
    assignment_id, lead_id, vendor_id, operation_id,
    event_type, lifecycle_from, lifecycle_to,
    occurred_at, recorded_at,
    actor_kind, actor_id, reason_code,
    source_kind, source_reference, event_idempotency_key,
    metadata
  )
  select
    la.id,
    la.lead_id,
    la.vendor_id,
    op.id,
    'assignment_created',
    null,
    'assigned',
    la.assigned_at,
    v_recorded_at,
    'worker',
    null,
    'lineage_backfill',
    'migration_backfill',
    'legacy_assignment_seed_v1:' || la.id::text,
    'legacy_assignment_seed_v1:' || la.id::text,
    jsonb_build_object(
      'backfill_batch_key',      v_batch_key,
      'assignment_type',         la.assignment_type,
      'credit_deducted_claimed', coalesce(la.credit_deducted, false),
      'credit_debit_proven',     false,
      'seeded_from',             'lead_assignments'
    )
  from public.lead_assignments la
  join public.assignment_operations op
    on op.idempotency_key = v_batch_key || ':' || la.lead_id::text
  where la.lead_id is not null
    and la.vendor_id is not null
    and la.assigned_at is not null
    and not exists (select 1 from public.lead_assignment_events e where e.assignment_id = la.id)
  on conflict (event_idempotency_key) do nothing;

  -- -------------------------------------------------------------------------
  -- 3. Verification — derived, never hardcoded. Fail closed on any deviation.
  -- -------------------------------------------------------------------------
  select count(*) into v_ops_after     from public.assignment_operations;
  select count(*) into v_events_after  from public.lead_assignment_events;
  select count(*) into v_ledger_after  from public.vendor_credit_logs;
  select count(*) into v_intents_after from public.communication_intents;

  -- 3.1 A2 must never fabricate a credit ledger row.
  if v_ledger_after <> v_ledger_before then
    raise exception 'QF-MVP-20.3B1 A2 aborted: vendor_credit_logs changed from % to %. The lineage backfill must never write a ledger row.',
      v_ledger_before, v_ledger_after;
  end if;

  -- 3.2 A2 must never create a communication intent.
  if v_intents_after <> v_intents_before then
    raise exception 'QF-MVP-20.3B1 A2 aborted: communication_intents changed from % to %. The lineage backfill must never create an intent.',
      v_intents_before, v_intents_after;
  end if;

  -- 3.3 Exactly the measured seed set was created — one event per qualifying
  --     assignment, one operation per distinct qualifying lead. Derived counts.
  if (v_events_after - v_events_before) <> v_seed_rows then
    raise exception 'QF-MVP-20.3B1 A2 aborted: inserted % lineage event(s) but % assignment(s) required a seed.',
      v_events_after - v_events_before, v_seed_rows;
  end if;

  if (v_ops_after - v_ops_before) <> v_seed_leads then
    raise exception 'QF-MVP-20.3B1 A2 aborted: inserted % operation row(s) but % distinct lead(s) required one.',
      v_ops_after - v_ops_before, v_seed_leads;
  end if;

  -- 3.4 Nothing complete is left unseeded.
  select count(*) into v_remaining
    from public.lead_assignments la
   where la.lead_id is not null
     and la.vendor_id is not null
     and la.assigned_at is not null
     and not exists (select 1 from public.lead_assignment_events e where e.assignment_id = la.id);

  if v_remaining > 0 then
    raise exception 'QF-MVP-20.3B1 A2 aborted: % qualifying assignment(s) still have no lineage event.', v_remaining;
  end if;

  -- 3.5 Every seeded event matches the frozen historical contract exactly.
  if exists (
    select 1 from public.lead_assignment_events e
     where e.event_idempotency_key like 'legacy_assignment_seed_v1:%'
       and ( e.event_type       is distinct from 'assignment_created'
          or e.lifecycle_to     is distinct from 'assigned'
          or e.lifecycle_from   is not null
          or e.actor_kind       is distinct from 'worker'
          or e.actor_id         is not null
          or e.source_kind      is distinct from 'migration_backfill'
          or e.reason_code      is distinct from 'lineage_backfill'
          or e.source_reference is distinct from e.event_idempotency_key
          or e.operation_id     is null
          or e.assignment_id    is null )
  ) then
    raise exception 'QF-MVP-20.3B1 A2 aborted: at least one seeded lineage event does not match the frozen historical event contract.';
  end if;

  -- 3.6 The event key is derived from its own assignment, and the anchoring
  --     operation belongs to that same assignment's lead.
  if exists (
    select 1
      from public.lead_assignment_events e
      join public.assignment_operations op on op.id = e.operation_id
     where e.event_idempotency_key like 'legacy_assignment_seed_v1:%'
       and ( op.lead_id is distinct from e.lead_id
          or e.event_idempotency_key is distinct from 'legacy_assignment_seed_v1:' || e.assignment_id::text )
  ) then
    raise exception 'QF-MVP-20.3B1 A2 aborted: a seeded event has a mismatched idempotency key or is anchored to another lead''s operation.';
  end if;

  -- 3.7 The lifecycle column default did its job; no UPDATE was needed. Scoped
  --     to seeded historical rows so a later re-run never judges canonical rows.
  select count(*) into v_bad_lifecycle
    from public.lead_assignments la
   where la.lifecycle_status is distinct from 'assigned'
     and exists (
       select 1 from public.lead_assignment_events e
        where e.assignment_id = la.id
          and e.event_idempotency_key like 'legacy_assignment_seed_v1:%'
     );

  if v_bad_lifecycle > 0 and (v_events_after - v_events_before) > 0 then
    raise exception 'QF-MVP-20.3B1 A2 aborted: % freshly seeded historical row(s) do not carry lifecycle_status = assigned. Migration A''s NOT NULL DEFAULT should have covered every historical row; investigate rather than issuing an unreviewed bulk UPDATE.',
      v_bad_lifecycle;
  end if;

  raise notice 'QF-MVP-20.3B1 A2 complete: operations % -> % (+%), lineage events % -> % (+%). Ledger unchanged (%). Intents unchanged (%).',
    v_ops_before, v_ops_after, v_ops_after - v_ops_before,
    v_events_before, v_events_after, v_events_after - v_events_before,
    v_ledger_after, v_intents_after;
end
$backfill$;
