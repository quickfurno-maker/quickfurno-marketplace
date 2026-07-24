-- ============================================================================
-- QF-MVP-20.4 — HISTORICAL CREDIT-LEDGER RECONCILIATION — PRODUCTION AUDIT PACK
--
--   *** SELECT-ONLY. READ-ONLY. THIS FILE MUST NEVER WRITE. ***
--
-- This pack is EVIDENCE COLLECTION ONLY. It is designed to be run, in a later
-- and separately founder-authorized phase, against PRODUCTION under a
-- PROCESS-ENFORCED SELECT-ONLY ALLOWLIST (the connection is technically
-- writable; safety is enforced by the operator, not the connection).
--
-- IT CONTAINS NO INSERT / UPDATE / DELETE / UPSERT / MERGE / CREATE / ALTER /
-- DROP / TRUNCATE / GRANT / REVOKE / CALL / DO / COPY / SELECT INTO, no writable
-- CTE, no transaction control, and it invokes NO state-changing function. It
-- reads only base tables and read-only catalog builtins (to_regclass,
-- to_regprocedure, pg_get_functiondef, md5, count/sum, generate_series-free).
--
-- IT DECIDES NOTHING. It separates RAW FACTS from a deliberately CONSERVATIVE
-- `sql_proposed_class`. The SQL never emits PROVEN_DEBIT_ALREADY_APPLIED nor
-- PROVEN_NO_DEBIT — those require a STRONG human-reviewed proof path and founder
-- approval (see the design doc §5–§6). credit_deducted, current
-- remaining_credits, current package remaining_leads, assignment existence and
-- source type are PROHIBITED as sole proof and are emitted as facts only.
--
-- The observed QF-MVP-10 counts (46 credit_deducted assignments, 19 canonical
-- assignment-debit ledger rows, 27 missing: admin 5 / automatic 16 /
-- client-selected 6) are HISTORICAL OBSERVATIONS, not invariants. This pack
-- reports whatever the live data actually shows and flags any divergence.
--
-- Output feeds the EMPTY evidence manifest (no live rows in Git). Every result
-- set is deterministically ordered. PII is minimised: only UUIDs, timestamps,
-- source/type, ledger reference facts and integer balances are exposed — never
-- name / phone / email / address.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- R00 — AUDIT-RUN FINGERPRINT (derived only from query version + schema facts;
--       NO secret, NO project ref, NO connection string).
-- ---------------------------------------------------------------------------
select
  'R00_audit_fingerprint'                             as result_set,
  'qf_mvp_20_4_historical_credit_ledger_audit'        as audit_pack,
  'v1'                                                as audit_pack_version,
  -- fingerprint of the model this pack expects: the definitions of the tables
  -- and the canonical credit function. A reviewer compares this to the design
  -- doc to prove the audit ran against the expected production model.
  md5(concat_ws('|',
    coalesce(md5(pg_get_functiondef(to_regprocedure(
      'public.qf_apply_vendor_credit_delta(uuid, integer, text, text, text, text, text, boolean)'))), 'ABSENT'),
    (select coalesce(string_agg(a.attname::text, ',' order by a.attname::text), 'ABSENT')
       from pg_attribute a where a.attrelid = to_regclass('public.vendor_credit_logs')
        and a.attnum > 0 and not a.attisdropped),
    (select coalesce(string_agg(a.attname::text, ',' order by a.attname::text), 'ABSENT')
       from pg_attribute a where a.attrelid = to_regclass('public.lead_assignments')
        and a.attnum > 0 and not a.attisdropped)
  ))                                                  as model_fingerprint;


-- ---------------------------------------------------------------------------
-- R01 — MIGRATION-HISTORY FACTS (report only; NEVER repair). Production is
--       known-drifted; this documents the drift, it does not act on it.
-- ---------------------------------------------------------------------------
select
  'R01_migration_history' as result_set,
  count(*)                as recorded_migration_rows,
  min(version)            as earliest_version,
  max(version)            as latest_version
from supabase_migrations.schema_migrations;


-- ---------------------------------------------------------------------------
-- R02 — SCHEMA FINGERPRINT of the objects the reconciliation depends on. Proves
--       the audit ran against the expected credit/assignment model.
-- ---------------------------------------------------------------------------
select 'R02_schema_fingerprint' as result_set, obj, present, fingerprint
from (
  select 1 as ord, 'table public.lead_assignments' as obj,
    (to_regclass('public.lead_assignments') is not null) as present,
    (select md5(coalesce(string_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod), ',' order by a.attnum), ''))
       from pg_attribute a where a.attrelid = to_regclass('public.lead_assignments')
        and a.attnum > 0 and not a.attisdropped) as fingerprint
  union all
  select 2, 'table public.vendor_credit_logs',
    (to_regclass('public.vendor_credit_logs') is not null),
    (select md5(coalesce(string_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod), ',' order by a.attnum), ''))
       from pg_attribute a where a.attrelid = to_regclass('public.vendor_credit_logs')
        and a.attnum > 0 and not a.attisdropped)
  union all
  select 3, 'table public.vendors',
    (to_regclass('public.vendors') is not null),
    (select md5(coalesce(string_agg(a.attname::text, ',' order by a.attname::text), ''))
       from pg_attribute a where a.attrelid = to_regclass('public.vendors')
        and a.attnum > 0 and not a.attisdropped and a.attname::text in ('id','total_credits','remaining_credits'))
  union all
  select 4, 'index uq_vendor_credit_logs_reference',
    exists (select 1 from pg_class c where c.relname::text = 'uq_vendor_credit_logs_reference' and c.relkind = 'i'),
    coalesce((select md5(pg_get_indexdef(c.oid)) from pg_class c where c.relname::text = 'uq_vendor_credit_logs_reference' and c.relkind='i'), 'ABSENT')
  union all
  select 5, 'function public.qf_apply_vendor_credit_delta',
    (to_regprocedure('public.qf_apply_vendor_credit_delta(uuid, integer, text, text, text, text, text, boolean)') is not null),
    coalesce(md5(pg_get_functiondef(to_regprocedure(
      'public.qf_apply_vendor_credit_delta(uuid, integer, text, text, text, text, text, boolean)'))), 'ABSENT')
  union all
  select 6, 'function public.deduct_vendor_credit (legacy, no ledger)',
    (to_regprocedure('public.deduct_vendor_credit(uuid)') is not null),
    coalesce(md5(pg_get_functiondef(to_regprocedure('public.deduct_vendor_credit(uuid)'))), 'ABSENT_OR_OTHER_SIGNATURE')
) s
order by ord;


-- ---------------------------------------------------------------------------
-- R03 — CANONICAL LEDGER COVERAGE totals (the raw arithmetic of the gap). No
--       row is decided here; these are counts only.
--       Canonical assignment-debit evidence for assignment A is EXACTLY:
--         vendor_credit_logs
--           WHERE reference_type = 'lead_assignment'
--             AND reference_id   = A.id::text
--             AND change_type    = 'lead_assignment_debit'.
-- ---------------------------------------------------------------------------
select
  'R03_coverage_totals' as result_set,
  (select count(*) from public.lead_assignments)                                          as total_assignments,
  (select count(*) from public.lead_assignments where credit_deducted is true)            as credit_deducted_assignments,
  (select count(*) from public.vendor_credit_logs where change_type = 'lead_assignment_debit') as assignment_debit_logs,
  (select count(*) from public.vendor_credit_logs where reference_id is null)              as logs_without_reference_id,
  (select count(*)
     from public.lead_assignments la
     join public.vendor_credit_logs vcl
       on vcl.reference_type = 'lead_assignment'
      and vcl.reference_id   = la.id::text
      and vcl.change_type    = 'lead_assignment_debit'
    where la.credit_deducted is true)                                                     as candidates_with_canonical_ledger,
  '46/19/27 were the QF-MVP-10 observation on 2026-07-22; these are historical, not invariants' as note;


-- ---------------------------------------------------------------------------
-- R04 — THE CANDIDATE POPULATION (raw facts, one row per candidate). A row is a
--       candidate iff: the assignment exists, credit_deducted is true, and NO
--       canonical assignment-debit ledger row exists for it. No proof of debit
--       is asserted. Deterministic order.
-- ---------------------------------------------------------------------------
select
  'R04_candidate' as result_set,
  la.id                                   as assignment_id,
  la.vendor_id                            as vendor_id,
  la.lead_id                              as lead_id,
  la.assignment_type                      as assignment_type,
  la.assignment_source                    as assignment_source,
  la.assigned_at                          as assigned_at,
  la.credit_deducted                      as credit_deducted_flag_PROHIBITED_AS_PROOF,
  'no canonical lead_assignment_debit ledger row for this assignment id' as reason_entered_population
from public.lead_assignments la
where la.credit_deducted is true
  and not exists (
    select 1 from public.vendor_credit_logs vcl
     where vcl.reference_type = 'lead_assignment'
       and vcl.reference_id   = la.id::text
       and vcl.change_type    = 'lead_assignment_debit')
order by la.assigned_at nulls last, la.id;


-- ---------------------------------------------------------------------------
-- R05 — CANDIDATE SOURCE BREAKDOWN + observed count (compare to 27 historically).
-- ---------------------------------------------------------------------------
select
  'R05_candidate_breakdown' as result_set,
  coalesce(la.assignment_source, la.assignment_type, 'unknown') as source_bucket,
  count(*)                                                      as candidate_count
from public.lead_assignments la
where la.credit_deducted is true
  and not exists (
    select 1 from public.vendor_credit_logs vcl
     where vcl.reference_type = 'lead_assignment'
       and vcl.reference_id   = la.id::text
       and vcl.change_type    = 'lead_assignment_debit')
group by coalesce(la.assignment_source, la.assignment_type, 'unknown')
order by source_bucket;


-- ---------------------------------------------------------------------------
-- R06 — LEGACY / EQUIVALENT LEDGER SIGNALS (SUPPORTING ONLY, never sole proof).
--       For each candidate, count unreferenced lead_assignment_debit logs for
--       the SAME vendor. This is AMBIGUOUS by construction (no reference_id to
--       link deterministically), so it is emitted as a SUPPORTING signal with an
--       explicit ambiguity flag — never as ALREADY_HAS_EQUIVALENT_LEDGER_EVIDENCE
--       unless a reviewer proves a deterministic 1:1 link out-of-band.
-- ---------------------------------------------------------------------------
select
  'R06_legacy_signal' as result_set,
  la.id       as assignment_id,
  la.vendor_id as vendor_id,
  la.assigned_at as assigned_at,
  (select count(*) from public.vendor_credit_logs vcl
     where vcl.vendor_id = la.vendor_id
       and vcl.change_type = 'lead_assignment_debit'
       and vcl.reference_id is null) as unreferenced_debit_logs_same_vendor,
  'SUPPORTING_ONLY: no reference_id means no deterministic 1:1 link; ambiguous' as caveat
from public.lead_assignments la
where la.credit_deducted is true
  and not exists (
    select 1 from public.vendor_credit_logs vcl
     where vcl.reference_type = 'lead_assignment'
       and vcl.reference_id   = la.id::text
       and vcl.change_type    = 'lead_assignment_debit')
order by la.vendor_id, la.assigned_at nulls last, la.id;


-- ---------------------------------------------------------------------------
-- R07 — DUPLICATE / REFERENCE CONFLICTS. Any (reference_type, reference_id)
--       carrying more than one ledger row, or any assignment id referenced by
--       more than one lead_assignment_debit row. Either is a
--       DUPLICATE_OR_REFERENCE_CONFLICT the reviewer must resolve first.
-- ---------------------------------------------------------------------------
select
  'R07_reference_conflict' as result_set,
  vcl.reference_type       as reference_type,
  vcl.reference_id         as reference_id,
  count(*)                 as ledger_rows_for_reference
from public.vendor_credit_logs vcl
where vcl.reference_id is not null
group by vcl.reference_type, vcl.reference_id
having count(*) > 1
order by count(*) desc, vcl.reference_type, vcl.reference_id;


-- ---------------------------------------------------------------------------
-- R08 — DATA-INVARIANT VIOLATIONS in the ledger arithmetic
--       (credits_before + credits_delta <> credits_after). Any row here is a
--       DATA_INVARIANT_VIOLATION that blocks reconciliation of that vendor until
--       resolved. Emits IDs only, no balances-as-proof.
-- ---------------------------------------------------------------------------
select
  'R08_arithmetic_violation' as result_set,
  vcl.id         as ledger_id,
  vcl.vendor_id  as vendor_id,
  vcl.change_type as change_type,
  vcl.credits_before, vcl.credits_delta, vcl.credits_after,
  (vcl.credits_before + vcl.credits_delta) as expected_after
from public.vendor_credit_logs vcl
where (vcl.credits_before + vcl.credits_delta) <> vcl.credits_after
order by vcl.vendor_id, vcl.created_at, vcl.id;


-- ---------------------------------------------------------------------------
-- R09 — PER-CANDIDATE-VENDOR STATE FACTS (PROHIBITED AS SOLE PROOF; labelled).
--       Current balances/package leads are shown so a reviewer can attempt a
--       full arithmetic reconstruction — they must NEVER be used alone to infer
--       a historical debit. One row per distinct candidate vendor.
-- ---------------------------------------------------------------------------
select
  'R09_vendor_state_facts' as result_set,
  v.id                     as vendor_id,
  v.total_credits          as total_credits_CURRENT_NOT_PROOF,
  v.remaining_credits      as remaining_credits_CURRENT_NOT_PROOF,
  (select count(*) from public.vendor_credit_logs vcl where vcl.vendor_id = v.id) as ledger_rows_for_vendor,
  (select coalesce(sum(vcl.credits_delta),0) from public.vendor_credit_logs vcl where vcl.vendor_id = v.id) as ledger_delta_sum
from public.vendors v
where v.id in (
  select la.vendor_id from public.lead_assignments la
   where la.credit_deducted is true
     and la.vendor_id is not null
     and not exists (
       select 1 from public.vendor_credit_logs vcl
        where vcl.reference_type = 'lead_assignment'
          and vcl.reference_id   = la.id::text
          and vcl.change_type    = 'lead_assignment_debit'))
order by v.id;


-- ---------------------------------------------------------------------------
-- R10 — UNRECONCILABLE-WITH-CURRENT-SCHEMA candidates: assignment has a null
--       vendor_id, or the referenced vendor row is absent. These cannot be
--       reconciled to a vendor balance and must be recorded as
--       INSUFFICIENT_EVIDENCE / DATA_INVARIANT_VIOLATION exceptions.
-- ---------------------------------------------------------------------------
select
  'R10_unreconcilable' as result_set,
  la.id        as assignment_id,
  la.vendor_id as vendor_id,
  case when la.vendor_id is null then 'null_vendor_id'
       when not exists (select 1 from public.vendors v where v.id = la.vendor_id) then 'vendor_row_absent'
       else 'other' end as reason
from public.lead_assignments la
where la.credit_deducted is true
  and not exists (
    select 1 from public.vendor_credit_logs vcl
     where vcl.reference_type = 'lead_assignment'
       and vcl.reference_id   = la.id::text
       and vcl.change_type    = 'lead_assignment_debit')
  and (la.vendor_id is null
       or not exists (select 1 from public.vendors v where v.id = la.vendor_id))
order by la.id;


-- ---------------------------------------------------------------------------
-- R11 — CONSERVATIVE SQL-PROPOSED CLASS (facts-only classifier). The SQL may
--       ONLY ever propose the following, and NEVER PROVEN_DEBIT / PROVEN_NO_DEBIT
--       (which need a strong human-reviewed proof path + founder approval):
--         * DATA_INVARIANT_VIOLATION       — an arithmetic-broken ledger touches this vendor
--         * DUPLICATE_OR_REFERENCE_CONFLICT — a conflicting reference exists
--         * INSUFFICIENT_EVIDENCE          — the safe default for every other candidate
--       This column is a HINT for triage only; the reviewer/founder decides.
-- ---------------------------------------------------------------------------
select
  'R11_sql_proposed_class' as result_set,
  la.id        as assignment_id,
  la.vendor_id as vendor_id,
  case
    when exists (select 1 from public.vendor_credit_logs vcl
                  where vcl.vendor_id = la.vendor_id
                    and (vcl.credits_before + vcl.credits_delta) <> vcl.credits_after)
      then 'DATA_INVARIANT_VIOLATION'
    when exists (select 1 from public.vendor_credit_logs vcl
                  where vcl.reference_id is not null
                  group by vcl.reference_type, vcl.reference_id
                 having count(*) > 1
                    and vcl.reference_id = la.id::text)
      then 'DUPLICATE_OR_REFERENCE_CONFLICT'
    else 'INSUFFICIENT_EVIDENCE'
  end          as sql_proposed_class_HINT_ONLY,
  'human review + founder approval required; SQL never proposes PROVEN_DEBIT/PROVEN_NO_DEBIT' as decision_note
from public.lead_assignments la
where la.credit_deducted is true
  and not exists (
    select 1 from public.vendor_credit_logs vcl
     where vcl.reference_type = 'lead_assignment'
       and vcl.reference_id   = la.id::text
       and vcl.change_type    = 'lead_assignment_debit')
order by la.assigned_at nulls last, la.id;
