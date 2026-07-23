-- ============================================================================
-- QuickFurno — QF-MVP-20.3B1 — MIGRATION A — Marketplace authority foundation
--
-- PHASE
--   QF-MVP-20.3B1 (Generate foundation, historical lineage backfill and
--   canonical authority migrations). This file is Migration A of three.
--   Release order: A -> A2 -> B1 -> R1 (runtime) -> B2 -> C -> D -> E.
--
-- PURPOSE
--   Create the ADDITIVE schema substrate the canonical marketplace authority
--   needs. Nothing is enforced and no behaviour changes. Legacy assignment and
--   credit RPCs continue to operate exactly as before.
--
-- CLASSIFICATION
--   ADDITIVE ONLY. No DROP of any table, column, function or grant. No data
--   statement. No behaviour change. The single constraint replacement
--   (vendor_credit_logs.change_type) is a strict superset of the existing
--   vocabulary, so every historical row stays valid.
--
-- DEPENDENCIES
--   • Reviewed staging baseline 20260722000100 applied and verified
--     (40/40 PASS, SHA256 920a4aa0...).
--   • public.leads, public.vendors, public.lead_assignments and
--     public.vendor_credit_logs exist with the baseline shape.
--   • No dependency on Migration A2 or B1.
--
-- AUTHORITATIVE SOURCES
--   docs/QF-MVP-20-3A-SCHEMA-CONTRACT.md  (sections 1-7, 10b)
--   docs/QF-MVP-20-3A-REMEDIATION-MIGRATION-DESIGN.md  (sections 1, 2, 3)
--   docs/QF-MVP-20-3A1-DECISION-CLOSURE.md  (sections 6, 8, 11)
--
-- LOCKED CONTRACTS IMPLEMENTED HERE
--   • Lifecycle vocabulary (10): requested, assigned, delivered, accepted,
--     rejected, expired, cancelled, invalid, replaced, completed.
--   • ACTIVE SET = {assigned, delivered, accepted}. 'in_progress' is NOT a
--     lifecycle status (it is CRM-only, on lead_assignments.vendor_status).
--   • lead_assignment_events is an APPEND-ONLY lifecycle event stream. Its only
--     non-primary business uniqueness is UNIQUE (event_idempotency_key).
--     There is deliberately NO UNIQUE (lead_id, vendor_id) on that table
--     (QF-MVP-20.3A1R). Lifetime-six is a QUERY, not a constraint.
--   • Lineage retention: lead_id -> leads RESTRICT, vendor_id -> vendors
--     RESTRICT, assignment_id -> lead_assignments SET NULL,
--     operation_id -> assignment_operations SET NULL.
--   • The existing lead_assignments UNIQUE (lead_id, vendor_id) is preserved
--     untouched. It remains the assignment-row idempotency boundary.
--   • New tables are RLS-enabled with NO policies (fail closed for anon and
--     authenticated) and granted to service_role only.
--
-- PROHIBITED PRODUCTION ASSUMPTIONS
--   • This file assumes NO row count. It is pure DDL and is correct against an
--     empty staging database and against a production-shaped database alike.
--   • It does NOT assume production has 46 assignments, 24 leads or 28 vendors.
--   • It does NOT assume public.audit_logs exists. That table is absent from
--     the applied baseline (62 tables) and is deliberately NOT created here
--     (founder decision, QF-MVP-20.3B1). Domain audit evidence is carried by
--     assignment_operations, lead_assignment_events, vendor_credit_logs,
--     credit_restoration_approvals and communication_intents.
--
-- FAIL CLOSED ON DRIFT
--   Deliberately NO "IF NOT EXISTS" on new tables, columns or constraints, and
--   NO exception-swallowing DO block. A same-named pre-existing object with a
--   different definition must abort this transaction rather than be silently
--   accepted. A verification block at the end re-asserts the delivered shape.
--
-- DELIBERATELY NOT DONE IN THIS MIGRATION
--   • NO enforcement trigger of any kind (active-3, lifetime-6 and
--     lineage-immutable are Migration B2, after the R1 consumer release).
--   • NO canonical RPC (Migration B1).
--   • NO data backfill (Migration A2).
--   • NO public.audit_logs table.
--   • NO vendor_public_v and NO vendor_wallet_package_divergence_v: the design
--     assigns the divergence view to "Migration C or a later ops migration",
--     not to A.
--   • NO suspension or restoration MUTATION path. The five vendors suspension
--     columns are added as inert storage only; no function, trigger, policy or
--     grant here can set them. An audited administrative path is R1/B2 or a
--     later reviewed migration.
--   • NO revoke of any legacy function and NO broadening of any legacy grant.
--   • NO grant of any mutation authority to PUBLIC, anon or authenticated.
--   • NO change to leads/vendors RLS policies, no anon privilege change.
--   • NO auth.users trigger. NO provider activation. NO n8n/Jarvis change.
--   • NO change to lead_assignments.vendor_status and NO NOT NULL tightening
--     of lead_assignments.lead_id/vendor_id (proven safe, deliberately
--     deferred).
--
-- ROLLBACK BOUNDARY
--   Fully reversible WHILE THE NEW TABLES ARE EMPTY:
--     drop table public.communication_intents;
--     drop table public.lead_assignment_events;
--     drop table public.credit_restoration_approvals;
--     drop table public.replacement_requests;
--     drop table public.assignment_operations;
--     alter table public.lead_assignments
--       drop column replaced_by_assignment_id, drop column operation_id,
--       drop column lifecycle_updated_at, drop column lifecycle_status;
--     alter table public.vendor_credit_logs
--       drop column actor_id, drop column actor_kind,
--       drop column idempotency_key, drop column approval_reference;
--     -- then restore vendor_credit_logs_change_type_check to the 11 legacy values
--     alter table public.vendors
--       drop column assignment_suspension_reference,
--       drop column assignment_suspended_by,
--       drop column assignment_suspension_reason,
--       drop column assignment_suspended_until,
--       drop column assignment_suspended_at;
--   Once lineage/operation rows exist the tables are business truth and MUST
--   NOT be dropped to roll back code (rollback rule 6): stop using them
--   instead.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. assignment_operations — operation-level idempotency and result contract
-- ---------------------------------------------------------------------------

create table public.assignment_operations (
  id                     uuid primary key default gen_random_uuid(),
  idempotency_key        text        not null,
  lead_id                uuid        not null,
  mode                   text        not null,
  actor_kind             text        not null,
  actor_id               uuid,
  replacement_request_id uuid,
  reason_code            text,
  status                 text        not null default 'in_progress',
  result                 jsonb       not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  completed_at           timestamptz,
  constraint uq_assignment_operations_idempotency unique (idempotency_key),
  constraint assignment_operations_mode_check
    check (mode = any (array['automatic','client_selected','admin_manual','delayed_fill','replacement','recovery_replay'])),
  constraint assignment_operations_actor_kind_check
    check (actor_kind = any (array['system','client','admin','worker'])),
  constraint assignment_operations_status_check
    check (status = any (array['in_progress','applied','already_applied','partial','rejected','failed'])),
  constraint assignment_operations_replacement_ref_check
    check ((mode = 'replacement') = (replacement_request_id is not null)),
  constraint assignment_operations_lead_id_fkey
    foreign key (lead_id) references public.leads (id) on delete restrict
);

create index idx_assignment_operations_lead
  on public.assignment_operations (lead_id, created_at desc);

comment on table public.assignment_operations is
  'QF-MVP-20 canonical authority: one row per logical assignment operation. idempotency_key is the operation-level replay guard; result replays the sanitized return contract verbatim.';

-- ---------------------------------------------------------------------------
-- 2. replacement_requests — approval-gated, one open request per lead
-- ---------------------------------------------------------------------------

create table public.replacement_requests (
  id                        uuid primary key default gen_random_uuid(),
  lead_id                   uuid        not null,
  original_assignment_id    uuid        not null,
  original_vendor_id        uuid        not null,
  replacement_assignment_id uuid,
  reason_code               text        not null,
  evidence_reference        text,
  status                    text        not null default 'requested',
  requested_by              uuid,
  approved_by               uuid,
  decided_at                timestamptz,
  failure_reason            text,
  idempotency_key           text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint replacement_requests_status_check
    check (status = any (array['requested','approved','activating','completed','rejected','failed'])),
  constraint replacement_requests_approved_by_check
    check (status not in ('approved','activating','completed') or approved_by is not null),
  constraint replacement_requests_lead_id_fkey
    foreign key (lead_id) references public.leads (id) on delete restrict,
  constraint replacement_requests_original_assignment_id_fkey
    foreign key (original_assignment_id) references public.lead_assignments (id) on delete restrict,
  constraint replacement_requests_original_vendor_id_fkey
    foreign key (original_vendor_id) references public.vendors (id) on delete restrict,
  constraint replacement_requests_replacement_assignment_id_fkey
    foreign key (replacement_assignment_id) references public.lead_assignments (id) on delete set null
);

-- The DATABASE, not application logic, is the one-replacement-at-a-time authority.
create unique index uq_replacement_requests_open_per_lead
  on public.replacement_requests (lead_id)
  where status in ('requested','approved','activating');

create unique index uq_replacement_requests_idempotency
  on public.replacement_requests (idempotency_key)
  where idempotency_key is not null;

create index idx_replacement_requests_lead
  on public.replacement_requests (lead_id, created_at desc);

comment on table public.replacement_requests is
  'QF-MVP-20 replacement authority. uq_replacement_requests_open_per_lead is the one-at-a-time guarantee; approval is a row, never a caller-supplied boolean.';

-- assignment_operations -> replacement_requests closes the mutual reference.
alter table public.assignment_operations
  add constraint assignment_operations_replacement_request_id_fkey
  foreign key (replacement_request_id) references public.replacement_requests (id) on delete restrict;

-- ---------------------------------------------------------------------------
-- 3. credit_restoration_approvals — approval evidence for restorations
-- ---------------------------------------------------------------------------

create table public.credit_restoration_approvals (
  id                     uuid primary key default gen_random_uuid(),
  original_assignment_id uuid        not null,
  vendor_id              uuid        not null,
  lead_id                uuid        not null,
  evidence_type          text        not null,
  evidence_reference     text        not null,
  reason_code            text        not null,
  requested_by           uuid,
  status                 text        not null default 'requested',
  approved_by            uuid,
  decided_at             timestamptz,
  restoration_ledger_id  uuid,
  supersedes_approval_id uuid,
  idempotency_key        text        not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint uq_credit_restoration_approvals_idempotency unique (idempotency_key),
  constraint credit_restoration_approvals_evidence_type_check
    check (evidence_type = any (array['bad_lead_report','admin_request','reconciliation_finding'])),
  constraint credit_restoration_approvals_status_check
    check (status = any (array['requested','approved','rejected','applied','failed'])),
  constraint credit_restoration_approvals_approved_by_check
    check (status not in ('approved','applied') or approved_by is not null),
  constraint credit_restoration_approvals_applied_ledger_check
    check (status <> 'applied' or restoration_ledger_id is not null),
  constraint credit_restoration_approvals_original_assignment_id_fkey
    foreign key (original_assignment_id) references public.lead_assignments (id) on delete restrict,
  constraint credit_restoration_approvals_vendor_id_fkey
    foreign key (vendor_id) references public.vendors (id) on delete restrict,
  constraint credit_restoration_approvals_lead_id_fkey
    foreign key (lead_id) references public.leads (id) on delete restrict,
  constraint credit_restoration_approvals_supersedes_approval_id_fkey
    foreign key (supersedes_approval_id) references public.credit_restoration_approvals (id) on delete restrict
);

create unique index uq_restoration_per_assignment_reason
  on public.credit_restoration_approvals (original_assignment_id, reason_code)
  where status in ('requested','approved','applied');

comment on table public.credit_restoration_approvals is
  'QF-MVP-20 credit restoration approval evidence. An approval never mutates a balance by itself; the restoration ledger row is written in the same transaction that flips status to applied.';

-- ---------------------------------------------------------------------------
-- 4. lead_assignment_events — APPEND-ONLY lifetime lineage
--
--    QF-MVP-20.3A1R: this is a lifecycle EVENT STREAM. One (lead, vendor) pair
--    legitimately records many events over time. Therefore:
--      * the ONLY non-primary business uniqueness is UNIQUE (event_idempotency_key)
--      * there is NO UNIQUE (lead_id, vendor_id) here, and none may be added
--      * lifetime-six is COUNT(DISTINCT vendor_id) over qualifying events
-- ---------------------------------------------------------------------------

create table public.lead_assignment_events (
  id                    uuid primary key default gen_random_uuid(),
  assignment_id         uuid,
  lead_id               uuid        not null,
  vendor_id             uuid        not null,
  operation_id          uuid,
  event_type            text        not null,
  lifecycle_from        text,
  lifecycle_to          text        not null,
  occurred_at           timestamptz not null,
  recorded_at           timestamptz not null default now(),
  actor_kind            text        not null,
  actor_id              uuid,
  reason_code           text        not null,
  source_kind           text        not null,
  source_reference      text        not null,
  event_idempotency_key text        not null,
  metadata              jsonb       not null default '{}'::jsonb,
  constraint uq_lead_assignment_events_idempotency unique (event_idempotency_key),
  constraint lead_assignment_events_event_type_check
    check (event_type = any (array['assignment_created','lifecycle_transition','replacement_linked','reconciliation_note'])),
  constraint lead_assignment_events_lifecycle_from_check
    check (lifecycle_from is null or lifecycle_from = any (array['requested','assigned','delivered','accepted','rejected','expired','cancelled','invalid','replaced','completed'])),
  constraint lead_assignment_events_lifecycle_to_check
    check (lifecycle_to = any (array['requested','assigned','delivered','accepted','rejected','expired','cancelled','invalid','replaced','completed'])),
  constraint lead_assignment_events_actor_kind_check
    check (actor_kind = any (array['system','client','admin','worker'])),
  constraint lead_assignment_events_source_kind_check
    check (source_kind = any (array['canonical_authority','migration_backfill','reconciliation'])),
  constraint lead_assignment_events_created_from_null_check
    check (event_type <> 'assignment_created' or lifecycle_from is null),
  -- Retention: lineage must survive lead/vendor deletion (deliberately NOT cascading),
  -- and must survive assignment-row cleanup (SET NULL, never delete).
  constraint lead_assignment_events_lead_id_fkey
    foreign key (lead_id) references public.leads (id) on delete restrict,
  constraint lead_assignment_events_vendor_id_fkey
    foreign key (vendor_id) references public.vendors (id) on delete restrict,
  constraint lead_assignment_events_assignment_id_fkey
    foreign key (assignment_id) references public.lead_assignments (id) on delete set null,
  constraint lead_assignment_events_operation_id_fkey
    foreign key (operation_id) references public.assignment_operations (id) on delete set null
);

create index idx_lead_assignment_events_lead
  on public.lead_assignment_events (lead_id);

-- Serves the lifetime-six query exactly.
create index idx_lead_assignment_events_lifetime
  on public.lead_assignment_events (lead_id, vendor_id)
  where event_type = 'assignment_created' and lifecycle_to = 'assigned';

create index idx_lead_assignment_events_assignment
  on public.lead_assignment_events (assignment_id);

comment on table public.lead_assignment_events is
  'QF-MVP-20 append-only assignment lineage. Immutable lifetime-six authority. Event replay is guarded by event_idempotency_key ONLY; there is deliberately no (lead_id, vendor_id) uniqueness here because one pair records many lifecycle events (QF-MVP-20.3A1R). Stores identifiers, transitions, actor and provenance only - never personal data.';

comment on column public.lead_assignment_events.event_idempotency_key is
  'Authority-generated, never caller-supplied. Historical seed: legacy_assignment_seed_v1:<assignment_id>. Canonical runtime: assignment_event:<operation_id>:<assignment_id>:<event_type>[:<ordinal>].';

comment on column public.lead_assignment_events.metadata is
  'Provenance only (e.g. original assignment_type, claimed credit_deducted). No personal-data snapshots.';

-- ---------------------------------------------------------------------------
-- 5. communication_intents — authoritative outbox (intent, never a send)
-- ---------------------------------------------------------------------------

create table public.communication_intents (
  id                uuid primary key default gen_random_uuid(),
  aggregate_type    text        not null,
  aggregate_id      uuid        not null,
  channel           text        not null,
  template_purpose  text        not null,
  recipient_ref     text        not null,
  payload_ref       jsonb       not null default '{}'::jsonb,
  idempotency_key   text        not null,
  status            text        not null default 'pending',
  available_at      timestamptz not null default now(),
  attempt_count     integer     not null default 0,
  uncertain_outcome boolean     not null default false,
  uncertain_reason  text,
  created_at        timestamptz not null default now(),
  dispatched_at     timestamptz,
  constraint uq_communication_intents_idempotency unique (idempotency_key),
  constraint communication_intents_aggregate_type_check
    check (aggregate_type = any (array['lead_assignment','replacement','credit_restoration','lead'])),
  constraint communication_intents_channel_check
    check (channel = any (array['whatsapp','sms','email','dashboard'])),
  constraint communication_intents_status_check
    check (status = any (array['pending','claimed','dispatched','delivered','failed','uncertain'])),
  constraint communication_intents_attempt_count_check
    check (attempt_count >= 0),
  -- An uncertain outcome is TERMINAL and is never blindly retried.
  constraint communication_intents_uncertain_terminal_check
    check (uncertain_outcome is false or status = 'uncertain')
);

create index idx_communication_intents_claimable
  on public.communication_intents (status, available_at)
  where status = 'pending';

create index idx_communication_intents_aggregate
  on public.communication_intents (aggregate_type, aggregate_id);

comment on table public.communication_intents is
  'QF-MVP-20 communication outbox. Marketplace authority writes an INTENT only. It never calls a provider, never sends, and never writes a delivery result. Uncertain outcomes are terminal.';

comment on column public.communication_intents.recipient_ref is
  'Opaque/hashed destination reference. NEVER a plaintext phone number or email address.';

-- ---------------------------------------------------------------------------
-- 6. lead_assignments — additive lifecycle and operation columns
--
--    lifecycle_status is added NOT NULL DEFAULT 'assigned'. Every pre-existing
--    row therefore receives 'assigned' through the column default, which is the
--    reviewed backfill method (QF-MVP-20.3A1 section 5: all historical rows map
--    to 'assigned', zero ambiguity). Migration A2 deliberately performs NO bulk
--    UPDATE of this column; it verifies the outcome instead.
--
--    The existing UNIQUE (lead_id, vendor_id) is NOT touched.
-- ---------------------------------------------------------------------------

alter table public.lead_assignments
  add column lifecycle_status           text        not null default 'assigned',
  add column lifecycle_updated_at       timestamptz not null default now(),
  add column operation_id               uuid,
  add column replaced_by_assignment_id  uuid;

alter table public.lead_assignments
  add constraint lead_assignments_lifecycle_status_check
    check (lifecycle_status = any (array['requested','assigned','delivered','accepted','rejected','expired','cancelled','invalid','replaced','completed'])),
  add constraint lead_assignments_operation_id_fkey
    foreign key (operation_id) references public.assignment_operations (id) on delete set null,
  add constraint lead_assignments_replaced_by_assignment_id_fkey
    foreign key (replaced_by_assignment_id) references public.lead_assignments (id) on delete set null;

-- Hot path for the active-three count. ACTIVE = {assigned, delivered, accepted}.
create index idx_lead_assignments_active
  on public.lead_assignments (lead_id)
  where lifecycle_status in ('assigned','delivered','accepted');

create index idx_lead_assignments_operation
  on public.lead_assignments (operation_id);

comment on column public.lead_assignments.lifecycle_status is
  'QF-MVP-20 canonical assignment lifecycle. ACTIVE = {assigned, delivered, accepted}. This is NOT vendor_status, which is the orthogonal vendor CRM pipeline. in_progress is deliberately not a lifecycle value.';

-- ---------------------------------------------------------------------------
-- 7. vendor_credit_logs — additive authority evidence + widened vocabulary
-- ---------------------------------------------------------------------------

alter table public.vendor_credit_logs
  add column approval_reference uuid,
  add column idempotency_key    text,
  add column actor_kind         text,
  add column actor_id           uuid;

alter table public.vendor_credit_logs
  add constraint vendor_credit_logs_actor_kind_check
    check (actor_kind is null or actor_kind = any (array['system','client','admin','worker'])),
  add constraint vendor_credit_logs_approval_reference_fkey
    foreign key (approval_reference) references public.credit_restoration_approvals (id) on delete restrict,
  -- A restoration must carry its approval evidence.
  add constraint vendor_credit_logs_restoration_approval_check
    check (change_type <> 'approved_bad_lead_restoration' or approval_reference is not null);

create unique index uq_vendor_credit_logs_idempotency
  on public.vendor_credit_logs (idempotency_key)
  where idempotency_key is not null;

-- change_type vocabulary widened ADDITIVELY: all 11 legacy values are retained
-- so every historical row stays valid, plus the 4 new canonical values.
-- (lead_assignment_debit already exists and is reused unchanged.)
alter table public.vendor_credit_logs
  drop constraint vendor_credit_logs_change_type_check;

alter table public.vendor_credit_logs
  add constraint vendor_credit_logs_change_type_check
  check (change_type = any (array[
    -- legacy, retained for historical rows
    'package_purchase','admin_credit_grant','lead_assignment_debit','invalid_lead_refund',
    'manual_adjustment','manual_add','manual_set','manual_remove','package_credit',
    'preview_test','correction',
    -- new canonical vocabulary
    'approved_bad_lead_restoration','package_purchase_credit',
    'authorized_manual_adjustment','migration_reconciliation_adjustment'
  ]));

-- credit_restoration_approvals -> vendor_credit_logs closes the mutual reference.
alter table public.credit_restoration_approvals
  add constraint credit_restoration_approvals_restoration_ledger_id_fkey
  foreign key (restoration_ledger_id) references public.vendor_credit_logs (id) on delete restrict;

comment on column public.vendor_credit_logs.idempotency_key is
  'QF-MVP-20 secondary ledger replay guard. uq_vendor_credit_logs_reference (reference_type, reference_id) remains the primary guard and is unchanged.';

-- ---------------------------------------------------------------------------
-- 8. vendors — additive temporary assignment-suspension storage
--
--    INERT STORAGE ONLY. No function, trigger, policy or grant in A/A2/B1 can
--    set these columns. B1 READS them as a hard eligibility gate. An audited
--    administrative mutation path is R1/B2 or a later reviewed migration.
--
--    Suspended predicate, evaluated at READ time (no scheduled job, no
--    background mutation):
--      assignment_suspended_at is not null
--      and (assignment_suspended_until is null or assignment_suspended_until > now())
--
--    vendors.status = 'Suspended' remains the separate PERMANENT legal/security
--    block that no admin override may ever bypass.
-- ---------------------------------------------------------------------------

alter table public.vendors
  add column assignment_suspended_at         timestamptz,
  add column assignment_suspended_until      timestamptz,
  add column assignment_suspension_reason    text,
  add column assignment_suspended_by         uuid,
  add column assignment_suspension_reference text;

create index idx_vendors_assignment_suspended
  on public.vendors (id)
  where assignment_suspended_at is not null;

comment on column public.vendors.assignment_suspended_at is
  'QF-MVP-20 temporary assignment suspension (hard eligibility gate). Distinct from vendors.status = Suspended, which is the permanent legal/security block. Never exposed in any public projection.';

-- ---------------------------------------------------------------------------
-- 9. RLS and least-privilege grants
--
--    Every new table: RLS ENABLED with NO policy. That is fail-closed for anon
--    and authenticated (PostgREST returns nothing and writes nothing). Only
--    service_role, which bypasses RLS, may reach these tables.
--
--    No grant is issued to PUBLIC, anon or authenticated anywhere in this file.
-- ---------------------------------------------------------------------------

alter table public.assignment_operations          enable row level security;
alter table public.replacement_requests           enable row level security;
alter table public.credit_restoration_approvals   enable row level security;
alter table public.lead_assignment_events         enable row level security;
alter table public.communication_intents          enable row level security;

revoke all on table public.assignment_operations         from public, anon, authenticated;
revoke all on table public.replacement_requests          from public, anon, authenticated;
revoke all on table public.credit_restoration_approvals  from public, anon, authenticated;
revoke all on table public.lead_assignment_events        from public, anon, authenticated;
revoke all on table public.communication_intents         from public, anon, authenticated;

grant select, insert, update, delete on table public.assignment_operations        to service_role;
grant select, insert, update, delete on table public.replacement_requests         to service_role;
grant select, insert, update, delete on table public.credit_restoration_approvals to service_role;
-- lead_assignment_events is append-only: no UPDATE and no DELETE is granted,
-- to any role. Migration B2 adds the immutability trigger as defence in depth.
grant select, insert                 on table public.lead_assignment_events       to service_role;
grant select, insert, update, delete on table public.communication_intents        to service_role;

-- ---------------------------------------------------------------------------
-- 10. Verification — re-assert the delivered shape, fail closed on any drift
-- ---------------------------------------------------------------------------

do $verify$
declare
  v_missing text := '';
begin
  -- 10.1 all five new tables exist
  if (select count(*) from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and c.relname in ('assignment_operations','replacement_requests',
                           'credit_restoration_approvals','lead_assignment_events',
                           'communication_intents')) <> 5 then
    v_missing := v_missing || ' [five new tables]';
  end if;

  -- 10.2 event uniqueness is on event_idempotency_key, NOT on (lead_id, vendor_id)
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.lead_assignment_events'::regclass
       and contype = 'u'
       and conkey = array[(select attnum from pg_catalog.pg_attribute
                            where attrelid = 'public.lead_assignment_events'::regclass
                              and attname = 'event_idempotency_key')]
  ) then
    v_missing := v_missing || ' [uq_lead_assignment_events_idempotency]';
  end if;

  if exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.lead_assignment_events'::regclass
       and contype = 'u'
       and conkey @> array[(select attnum from pg_catalog.pg_attribute
                             where attrelid = 'public.lead_assignment_events'::regclass
                               and attname = 'lead_id')]
       and conkey @> array[(select attnum from pg_catalog.pg_attribute
                             where attrelid = 'public.lead_assignment_events'::regclass
                               and attname = 'vendor_id')]
  ) then
    raise exception
      'QF-MVP-20.3B1 Migration A aborted: a UNIQUE (lead_id, vendor_id) constraint exists on lead_assignment_events. That model was withdrawn by QF-MVP-20.3A1R and must never be created.';
  end if;

  -- 10.3 event_idempotency_key is NOT NULL
  if not exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.lead_assignment_events'::regclass
       and attname = 'event_idempotency_key' and attnotnull
  ) then
    v_missing := v_missing || ' [event_idempotency_key NOT NULL]';
  end if;

  -- 10.4 the pre-existing lead_assignments UNIQUE (lead_id, vendor_id) survived
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.lead_assignments'::regclass
       and contype = 'u'
       and conkey @> array[(select attnum from pg_catalog.pg_attribute
                             where attrelid = 'public.lead_assignments'::regclass and attname = 'lead_id')]
       and conkey @> array[(select attnum from pg_catalog.pg_attribute
                             where attrelid = 'public.lead_assignments'::regclass and attname = 'vendor_id')]
  ) then
    raise exception
      'QF-MVP-20.3B1 Migration A aborted: the existing lead_assignments UNIQUE (lead_id, vendor_id) is missing. It must be preserved.';
  end if;

  -- 10.5 lineage retention actions are exactly as contracted
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'lead_assignment_events_lead_id_fkey' and confdeltype = 'r') then
    v_missing := v_missing || ' [lineage lead FK RESTRICT]';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'lead_assignment_events_vendor_id_fkey' and confdeltype = 'r') then
    v_missing := v_missing || ' [lineage vendor FK RESTRICT]';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'lead_assignment_events_assignment_id_fkey' and confdeltype = 'n') then
    v_missing := v_missing || ' [lineage assignment FK SET NULL]';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'lead_assignment_events_operation_id_fkey' and confdeltype = 'n') then
    v_missing := v_missing || ' [lineage operation FK SET NULL]';
  end if;

  -- 10.6 additive columns landed
  if (select count(*) from pg_catalog.pg_attribute
       where attrelid = 'public.lead_assignments'::regclass
         and attname in ('lifecycle_status','lifecycle_updated_at','operation_id','replaced_by_assignment_id')
         and not attisdropped) <> 4 then
    v_missing := v_missing || ' [lead_assignments additive columns]';
  end if;

  if (select count(*) from pg_catalog.pg_attribute
       where attrelid = 'public.vendor_credit_logs'::regclass
         and attname in ('approval_reference','idempotency_key','actor_kind','actor_id')
         and not attisdropped) <> 4 then
    v_missing := v_missing || ' [vendor_credit_logs additive columns]';
  end if;

  if (select count(*) from pg_catalog.pg_attribute
       where attrelid = 'public.vendors'::regclass
         and attname in ('assignment_suspended_at','assignment_suspended_until',
                         'assignment_suspension_reason','assignment_suspended_by',
                         'assignment_suspension_reference')
         and not attisdropped) <> 5 then
    v_missing := v_missing || ' [vendors suspension columns]';
  end if;

  -- 10.7 the widened ledger vocabulary retained every legacy value
  if not (
    select pg_catalog.pg_get_constraintdef(oid) like '%''package_purchase''%'
       and pg_catalog.pg_get_constraintdef(oid) like '%''correction''%'
       and pg_catalog.pg_get_constraintdef(oid) like '%''migration_reconciliation_adjustment''%'
      from pg_catalog.pg_constraint
     where conrelid = 'public.vendor_credit_logs'::regclass
       and conname = 'vendor_credit_logs_change_type_check'
  ) then
    v_missing := v_missing || ' [vendor_credit_logs change_type vocabulary]';
  end if;

  -- 10.8 RLS is on for all five new tables
  if (select count(*) from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relrowsecurity
         and c.relname in ('assignment_operations','replacement_requests',
                           'credit_restoration_approvals','lead_assignment_events',
                           'communication_intents')) <> 5 then
    v_missing := v_missing || ' [RLS on new tables]';
  end if;

  -- 10.9 no enforcement trigger was created (B2 owns those)
  if exists (
    select 1 from pg_catalog.pg_trigger
     where tgrelid in ('public.lead_assignments'::regclass, 'public.lead_assignment_events'::regclass)
       and not tgisinternal
  ) then
    raise exception
      'QF-MVP-20.3B1 Migration A aborted: an enforcement trigger exists on lead_assignments or lead_assignment_events. Those belong to Migration B2, after the R1 consumer release.';
  end if;

  if v_missing <> '' then
    raise exception 'QF-MVP-20.3B1 Migration A verification failed:%', v_missing;
  end if;
end
$verify$;
