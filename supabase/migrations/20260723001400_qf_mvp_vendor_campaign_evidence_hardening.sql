-- ============================================================================
-- QF-MVP-30.4C1 — VENDOR CAMPAIGN APPROVAL-EVIDENCE HARDENING
--
-- FORWARD-ONLY correction. It does NOT edit, rewrite, rename, delete or replace
-- the applied migration 20260723001300 — that migration remains immutable and
-- applied exactly once. This migration adds two canonical fingerprint
-- authorities, replaces the BODIES of the two existing campaign RPCs through
-- `create or replace`, and tightens one existing CHECK constraint.
--
-- ---------------------------------------------------------------------------
-- WHY (two real approval-evidence defects, reproduced before this was written)
-- ---------------------------------------------------------------------------
-- DEFECT 1 — the snapshot fingerprint was never database-verified.
--   20260723001300 accepted p_snapshot_fingerprint from the caller, stored it
--   verbatim after only a ^[0-9a-f]{64}$ shape check, and approval compared row
--   COUNT alone. No SQL in either RPC computed a hash of the frozen rows, so a
--   shape-valid but semantically unrelated fingerprint survived prepare AND
--   approval. The column comment already claimed "Recomputed and re-checked at
--   approval; a mismatch fails closed" — this migration makes that comment TRUE
--   in executable SQL. The declared SNAPSHOT_FINGERPRINT_MISMATCH failure code
--   was unreachable from SQL; it is now reachable.
--
-- DEFECT 2 — the template fingerprint was missing entirely.
--   prepared_template_fingerprint was nullable, absent from the prepared-evidence
--   completeness CHECK, written from an unverified caller value, and never read
--   at approval. The accepted runtime passed NULL on every prepare. Approval
--   compared only version / category / readiness / is_active, so any of
--   {template_key, channel, description, language, provider_template_name,
--   provider_template_id} could change with the version unchanged and go
--   undetected — e.g. repointing provider_template_name at a different approved
--   provider template silently re-targets an already-approved frozen audience.
--
-- ---------------------------------------------------------------------------
-- SCOPE FENCE
-- ---------------------------------------------------------------------------
-- Creates NO table, NO second audience header, NO provider table, NO
-- communication-intent state, NO frequency policy, NO dispatch state, NO
-- plaintext destination column, NO audit_logs / admin_notifications. It writes
-- no row, backfills nothing and fabricates no fingerprint for any pre-existing
-- prepared row. It performs no Core financial, assignment, consent, suppression
-- or package mutation, creates no communication intent and calls no provider.
--
-- ---------------------------------------------------------------------------
-- WHAT IS *NOT* CLAIMED
-- ---------------------------------------------------------------------------
-- qf_communication_template_fingerprint_v1 is the canonical fingerprint of the
-- existing TEMPLATE-CATALOG authority (public.communication_templates) and
-- nothing more. It is NOT a provider-mapping fingerprint and NOT a message-body
-- fingerprint: this schema stores neither, and inventing one would be fabricated
-- evidence. Provider-mapping fingerprinting and send-time rechecks remain a
-- QF-MVP-30.5 dispatch concern.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. Fail-closed preflight. Nothing below runs against an unexpected shape.
-- ---------------------------------------------------------------------------
do $preflight$
declare
  v_missing text;
  v_bad     integer;
begin
  -- 0.1 the 20260723001300 objects this migration hardens must all be present.
  if to_regclass('public.vendor_campaigns') is null
     or to_regclass('public.vendor_campaign_audience_members') is null
     or to_regclass('public.vendor_campaign_events') is null then
    raise exception 'QF-MVP-30.4C1 aborted: the QF-MVP-30.4A campaign tables are missing; apply 20260723001300 first.';
  end if;
  if to_regprocedure('public.qf_prepare_vendor_campaign_v1(uuid, integer, uuid, integer, text, text, text, jsonb, text, jsonb, text)') is null
     or to_regprocedure('public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text)') is null then
    raise exception 'QF-MVP-30.4C1 aborted: a QF-MVP-30.4A campaign RPC is missing or has a different signature.';
  end if;
  if to_regclass('public.communication_templates') is null then
    raise exception 'QF-MVP-30.4C1 aborted: public.communication_templates is missing.';
  end if;

  -- 0.2 EXACTLY the dispatch-critical template columns this fingerprint is
  --     defined over must exist. A silently absent column would change the
  --     canonical input and produce a different, undetectably wrong hash.
  select string_agg(c.col, ', ' order by c.col) into v_missing
    from unnest(array['template_key','version','channel','category','language',
                      'readiness_status','is_active','provider_template_name',
                      'provider_template_id','description']) as c(col)
   where not exists (
     select 1 from pg_attribute a
      where a.attrelid = to_regclass('public.communication_templates')
        and a.attname = c.col and a.attnum > 0 and not a.attisdropped);
  if v_missing is not null then
    raise exception 'QF-MVP-30.4C1 aborted: communication_templates is missing dispatch-critical column(s): %.', v_missing;
  end if;

  -- 0.3 PRODUCTION SAFETY. The tightened completeness constraint requires a
  --     non-null prepared_template_fingerprint for ready_for_review/approved.
  --     Refuse LOUDLY rather than fabricate a fingerprint for an existing row.
  select count(*) into v_bad
    from public.vendor_campaigns
   where status in ('ready_for_review', 'approved')
     and prepared_template_fingerprint is null;
  if v_bad > 0 then
    raise exception
      'QF-MVP-30.4C1 aborted: % campaign row(s) are ready_for_review/approved with a NULL prepared_template_fingerprint. Return them to draft and re-prepare; this migration will not fabricate evidence.', v_bad;
  end if;

  -- 0.4 Likewise refuse a pre-existing prepared row whose stored snapshot
  --     fingerprint cannot be trusted because its snapshot pointer is absent.
  select count(*) into v_bad
    from public.vendor_campaigns
   where status in ('ready_for_review', 'approved')
     and (prepared_snapshot_id is null or prepared_snapshot_revision is null or snapshot_fingerprint is null);
  if v_bad > 0 then
    raise exception
      'QF-MVP-30.4C1 aborted: % campaign row(s) are ready_for_review/approved with incomplete snapshot evidence.', v_bad;
  end if;
end;
$preflight$;


-- ---------------------------------------------------------------------------
-- 1. Canonical field encoder (the one small deterministic helper).
--
--    LENGTH-PREFIXED so the encoding is unambiguous for ANY content: a NULL is
--    '-1:', and a present value is '<octets>:<value>'. Concatenating
--    length-prefixed fields cannot be made ambiguous by a value that happens to
--    contain a separator, which matters because communication_templates.
--    description is free text.
-- ---------------------------------------------------------------------------
create or replace function public.qf_canonical_text_field_v1(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, public, pg_temp
as $$
  select case
           when p_value is null then '-1:'
           else octet_length(p_value)::text || ':' || p_value
         end;
$$;

comment on function public.qf_canonical_text_field_v1(text) is
  'QF-MVP-30.4C1: length-prefixed canonical field encoder. NULL -> ''-1:''; present -> ''<octets>:<value>''. Deterministic, immutable, no dynamic SQL. Mirrored byte-for-byte by lib/crm/campaignValidation.ts.';


-- ---------------------------------------------------------------------------
-- 2. CANONICAL SNAPSHOT FINGERPRINT — the database authority.
--
--    Canonical input, in strict ordinal order:
--      'qf-campaign-snapshot-v1'
--      then, for each row: RS(0x1E)
--        ordinal US(0x1F) vendor_id US consent_disposition US
--        consent_reason_code US consent_policy_version US suppression_reason
--
--    A FIXED-POSITION tuple encoding is used deliberately: it is not sensitive
--    to JSON object key ordering, unlike the previous JSON-object form.
--
--    DELIBERATELY EXCLUDED: the generated row id, created_at / evaluated_at
--    wall-clock values, every mutable campaign metadata field, any destination
--    or PII (none exists) and any provider payload.
--
--    Returns NULL — never a partial or misleading hash — when the set is empty,
--    when ordinals are not dense 0..count-1, when the snapshot id is
--    contaminated by a row belonging to another campaign or revision, or when
--    any field falls outside the closed charset the separator encoding assumes.
-- ---------------------------------------------------------------------------
create or replace function public.qf_campaign_snapshot_fingerprint_v1(
  p_campaign_id       uuid,
  p_snapshot_id       uuid,
  p_snapshot_revision integer
)
returns text
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count     integer;
  v_distinct  integer;
  v_min       integer;
  v_max       integer;
  v_canonical text;
begin
  if p_campaign_id is null or p_snapshot_id is null or p_snapshot_revision is null then
    return null;
  end if;

  -- (a) contamination fence: this snapshot id must belong to exactly this
  --     campaign and exactly this revision. A filtered read alone would SILENTLY
  --     exclude a foreign row instead of refusing.
  if exists (
    select 1 from public.vendor_campaign_audience_members m
     where m.snapshot_id = p_snapshot_id
       and (m.campaign_id is distinct from p_campaign_id
            or m.snapshot_revision is distinct from p_snapshot_revision)
  ) then
    return null;
  end if;

  -- (b) dense 0..count-1 ordinals. A sparse or duplicated ordinal set has no
  --     well-defined order, so it has no well-defined fingerprint.
  select count(*), count(distinct m.ordinal), min(m.ordinal), max(m.ordinal)
    into v_count, v_distinct, v_min, v_max
    from public.vendor_campaign_audience_members m
   where m.campaign_id = p_campaign_id
     and m.snapshot_id = p_snapshot_id
     and m.snapshot_revision = p_snapshot_revision;

  if v_count is null or v_count = 0 then return null; end if;
  if v_distinct <> v_count or v_min <> 0 or v_max <> v_count - 1 then return null; end if;

  -- (c) closed-charset fence. The separator encoding is only unambiguous while
  --     no field can contain a separator; every one of these values comes from a
  --     closed Core vocabulary, so this is an assertion, not a transformation.
  if exists (
    select 1 from public.vendor_campaign_audience_members m
     where m.campaign_id = p_campaign_id
       and m.snapshot_id = p_snapshot_id
       and m.snapshot_revision = p_snapshot_revision
       and (m.vendor_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            or m.consent_disposition    !~ '^[A-Za-z0-9._:-]{1,64}$'
            or m.consent_reason_code    !~ '^[A-Za-z0-9._:-]{1,64}$'
            or m.consent_policy_version !~ '^[A-Za-z0-9._:-]{1,64}$'
            or m.suppression_reason     !~ '^[A-Za-z0-9._:-]{1,64}$')
  ) then
    return null;
  end if;

  -- (d) canonical tuple stream, strictly ordered by ordinal.
  select 'qf-campaign-snapshot-v1' || coalesce(string_agg(
           chr(30)
           || m.ordinal::text
           || chr(31) || m.vendor_id::text
           || chr(31) || m.consent_disposition
           || chr(31) || m.consent_reason_code
           || chr(31) || m.consent_policy_version
           || chr(31) || m.suppression_reason,
           '' order by m.ordinal), '')
    into v_canonical
    from public.vendor_campaign_audience_members m
   where m.campaign_id = p_campaign_id
     and m.snapshot_id = p_snapshot_id
     and m.snapshot_revision = p_snapshot_revision;

  if v_canonical is null then return null; end if;
  return encode(sha256(convert_to(v_canonical, 'UTF8')), 'hex');
end;
$$;

comment on function public.qf_campaign_snapshot_fingerprint_v1(uuid, uuid, integer) is
  'QF-MVP-30.4C1: THE database authority for a frozen campaign audience fingerprint. Fixed-position tuple encoding over (ordinal, vendor_id, consent_disposition, consent_reason_code, consent_policy_version, suppression_reason) in ordinal order; lowercase sha256 hex. Excludes row ids, wall-clock values, mutable campaign metadata, PII and provider payloads. Returns NULL on an empty, sparse, duplicated, contaminated or out-of-charset set — never a misleading hash.';


-- ---------------------------------------------------------------------------
-- 3. CANONICAL TEMPLATE-CATALOG FINGERPRINT — the database authority.
--
--    Canonical input:
--      'qf-template-catalog-v1'
--      then, in this EXACT fixed order, each preceded by US(0x1F) and encoded
--      length-prefixed:
--        1 template_key   2 version              3 channel
--        4 category       5 language             6 readiness_status
--        7 is_active      8 provider_template_name
--        9 provider_template_id                 10 description
--
--    DELIBERATELY EXCLUDED: the row id, created_at / updated_at, and anything
--    not stored on this authority. There is no secret and no provider payload on
--    this table to exclude.
--
--    Returns NULL when the template does not exist — callers must fail closed.
-- ---------------------------------------------------------------------------
create or replace function public.qf_communication_template_fingerprint_v1(p_template_key text)
returns text
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  t           public.communication_templates%rowtype;
  v_canonical text;
begin
  if p_template_key is null then return null; end if;

  select * into t from public.communication_templates where template_key = p_template_key;
  if not found then return null; end if;

  v_canonical := 'qf-template-catalog-v1'
    || chr(31) || public.qf_canonical_text_field_v1(t.template_key)
    || chr(31) || public.qf_canonical_text_field_v1(t.version)
    || chr(31) || public.qf_canonical_text_field_v1(t.channel)
    || chr(31) || public.qf_canonical_text_field_v1(t.category)
    || chr(31) || public.qf_canonical_text_field_v1(t.language)
    || chr(31) || public.qf_canonical_text_field_v1(t.readiness_status)
    || chr(31) || public.qf_canonical_text_field_v1(
                    case when t.is_active is null then null else t.is_active::text end)
    || chr(31) || public.qf_canonical_text_field_v1(t.provider_template_name)
    || chr(31) || public.qf_canonical_text_field_v1(t.provider_template_id)
    || chr(31) || public.qf_canonical_text_field_v1(t.description);

  return encode(sha256(convert_to(v_canonical, 'UTF8')), 'hex');
end;
$$;

comment on function public.qf_communication_template_fingerprint_v1(text) is
  'QF-MVP-30.4C1: THE database authority for the canonical fingerprint of the existing TEMPLATE-CATALOG row. Length-prefixed, fixed-order encoding over template_key, version, channel, category, language, readiness_status, is_active, provider_template_name, provider_template_id, description; lowercase sha256 hex. Excludes the row id and created_at/updated_at. This is NOT a provider-mapping or message-body fingerprint — this schema stores neither, and QF-MVP-30.5 owns provider-mapping and send-time rechecks.';


-- ---------------------------------------------------------------------------
-- 4. PREPARE / FREEZE — body replaced. Signature and parameter NAMES unchanged.
--
--    p_snapshot_fingerprint and p_template_fingerprint are now EXPECTED values
--    supplied by the trusted server for cross-checking. THE DATABASE COMPUTES
--    AND STORES ITS OWN; the caller is never the authority.
-- ---------------------------------------------------------------------------
create or replace function public.qf_prepare_vendor_campaign_v1(
  p_campaign_id        uuid,
  p_expected_revision  integer,
  p_actor_id           uuid,
  p_segment_version    integer,
  p_segment_fingerprint text,
  p_template_version   text,
  p_template_fingerprint text,
  p_recipients         jsonb,
  p_snapshot_fingerprint text,
  p_exclusion_summary  jsonb,
  p_idempotency_key    text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_campaign        public.vendor_campaigns%rowtype;
  v_segment         public.vendor_segments%rowtype;
  v_template        public.communication_templates%rowtype;
  v_snapshot_id     uuid;
  v_revision        integer;
  v_count           integer;
  v_distinct        integer;
  v_tmpl_actual     text;
  v_snap_actual     text;
  v_fail            text;
  v_rows            integer;
  v_ord_distinct    integer;
  v_ord_min         integer;
  v_ord_max         integer;
begin
  if p_campaign_id is null or p_expected_revision is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  if jsonb_typeof(coalesce(p_recipients, 'null'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_RECIPIENTS');
  end if;
  -- the EXPECTED snapshot fingerprint is mandatory and must be well shaped: a
  -- caller that supplies nothing cannot be cross-checked.
  if p_snapshot_fingerprint is null or p_snapshot_fingerprint !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_SNAPSHOT_FINGERPRINT');
  end if;
  if jsonb_typeof(coalesce(p_exclusion_summary, '{}'::jsonb)) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_EXCLUSION_SUMMARY');
  end if;

  -- QF-MVP-30.4C2: LOCK ORDER 1 of 3 — the campaign head.
  select * into v_campaign from public.vendor_campaigns where id = p_campaign_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'CAMPAIGN_NOT_FOUND');
  end if;

  -- deterministic idempotent replay: the same key on an already-prepared
  -- campaign returns the existing snapshot instead of creating a second one.
  -- Evaluated BEFORE the evidence locks: a replay changes nothing, so it must
  -- not block a concurrent segment/template edit.
  if p_idempotency_key is not null
     and v_campaign.idempotency_key is not distinct from p_idempotency_key
     and v_campaign.status = 'ready_for_review'
     and v_campaign.prepared_snapshot_id is not null then
    return jsonb_build_object('ok', true, 'replayed', true,
      'snapshot_id', v_campaign.prepared_snapshot_id,
      'snapshot_revision', v_campaign.prepared_snapshot_revision,
      'recipient_count', v_campaign.prepared_recipient_count,
      'revision', v_campaign.revision);
  end if;

  if v_campaign.status <> 'draft' then
    return jsonb_build_object('ok', false, 'code', 'CAMPAIGN_NOT_DRAFT');
  end if;
  if v_campaign.revision <> p_expected_revision then
    return jsonb_build_object('ok', false, 'code', 'REVISION_MISMATCH');
  end if;
  if v_campaign.segment_id is null or v_campaign.template_key is null then
    return jsonb_build_object('ok', false, 'code', 'CAMPAIGN_INCOMPLETE');
  end if;

  -- ---------------------------------------------------------------------
  -- QF-MVP-30.4C2: LOCK ORDER 2 of 3 — the source SEGMENT row.
  --
  -- FOR SHARE, not a bare read: a bare read leaves the pinned evidence free to
  -- change between this check and COMMIT, so the freeze could persist evidence
  -- that was already stale when it was written. FOR SHARE conflicts with both
  -- FOR NO KEY UPDATE (what a plain non-key UPDATE takes) and FOR UPDATE (what
  -- a DELETE takes), so every UPDATE and DELETE of this row blocks until this
  -- transaction ends. FOR KEY SHARE would NOT conflict with FOR NO KEY UPDATE
  -- and is therefore insufficient. FOR SHARE is the MINIMUM sufficient mode: it
  -- still permits another reader to take FOR SHARE, so two campaigns pinning the
  -- same segment do not serialise against each other.
  --
  -- `not found` behaviour is unchanged — a locking clause does not alter which
  -- rows match, so an absent segment still returns SEGMENT_MISSING.
  -- ---------------------------------------------------------------------
  select * into v_segment from public.vendor_segments
   where id = v_campaign.segment_id
     for share;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SEGMENT_MISSING');
  end if;
  if v_segment.status = 'archived' then
    return jsonb_build_object('ok', false, 'code', 'SEGMENT_ARCHIVED');
  end if;
  if v_segment.definition_version is distinct from p_segment_version
     or v_segment.definition_fingerprint is distinct from p_segment_fingerprint then
    return jsonb_build_object('ok', false, 'code', 'SEGMENT_EVIDENCE_MISMATCH');
  end if;

  -- ---------------------------------------------------------------------
  -- QF-MVP-30.4C2: LOCK ORDER 3 of 3 — the source TEMPLATE row.
  -- Same reasoning and same mode. Acquired AFTER the segment so that prepare
  -- and approve take campaign -> segment -> template in the identical order and
  -- can never deadlock against one another.
  -- ---------------------------------------------------------------------
  select * into v_template from public.communication_templates
   where template_key = v_campaign.template_key
     for share;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_MISSING');
  end if;
  if v_template.is_active is not true or v_template.readiness_status = 'disabled' then
    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_NOT_USABLE');
  end if;
  if v_template.version is distinct from p_template_version then
    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_VERSION_MISMATCH');
  end if;
  if v_campaign.consent_scope = 'marketing' and v_template.category <> 'marketing' then
    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_CATEGORY_MISMATCH');
  end if;

  -- QF-MVP-30.4C1: the DATABASE computes the canonical template fingerprint.
  -- A supplied value is treated ONLY as an expectation to cross-check.
  v_tmpl_actual := public.qf_communication_template_fingerprint_v1(v_campaign.template_key);
  if v_tmpl_actual is null or v_tmpl_actual !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_FINGERPRINT_UNAVAILABLE');
  end if;
  if p_template_fingerprint is null
     or p_template_fingerprint is distinct from v_tmpl_actual then
    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_FINGERPRINT_MISMATCH');
  end if;

  -- recipients: bounded, distinct, well-shaped.
  select count(*) into v_count from jsonb_array_elements(p_recipients);
  if v_count = 0 then
    return jsonb_build_object('ok', false, 'code', 'EMPTY_AUDIENCE');
  end if;
  if v_count > 5000 then
    return jsonb_build_object('ok', false, 'code', 'AUDIENCE_TOO_LARGE');
  end if;
  select count(distinct (e ->> 'vendor_id')) into v_distinct
    from jsonb_array_elements(p_recipients) e;
  if v_distinct <> v_count then
    return jsonb_build_object('ok', false, 'code', 'DUPLICATE_RECIPIENT');
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_recipients) e
     where (e ->> 'vendor_id') is null
        or (e ->> 'consent_disposition') is null
        or (e ->> 'consent_reason_code') is null
        or (e ->> 'consent_policy_version') is null
  ) then
    return jsonb_build_object('ok', false, 'code', 'INCOMPLETE_RECIPIENT_EVIDENCE');
  end if;

  v_snapshot_id := gen_random_uuid();
  v_revision    := coalesce(v_campaign.prepared_snapshot_revision, 0) + 1;

  -- ---------------------------------------------------------------------
  -- FREEZE + DATABASE VERIFICATION, inside an explicit subtransaction.
  --
  -- The fingerprint is computed FROM THE INSERTED ROWS, not from the input
  -- array, so it certifies what was actually persisted. A verification failure
  -- raises a dedicated SQLSTATE so the subtransaction ROLLS BACK every inserted
  -- audience row; plpgsql variables survive the rollback, so v_fail carries the
  -- stable code out. Only 'QFC01' is caught — a genuine constraint or trigger
  -- error still propagates and aborts the whole transaction, and is never
  -- mis-reported as a fingerprint mismatch.
  -- ---------------------------------------------------------------------
  begin
    insert into public.vendor_campaign_audience_members (
      snapshot_id, campaign_id, snapshot_revision, vendor_id, ordinal,
      consent_disposition, consent_reason_code, consent_policy_version,
      suppression_reason, evaluated_at
    )
    select
      v_snapshot_id, p_campaign_id, v_revision,
      (e.value ->> 'vendor_id')::uuid,
      (e.ordinality - 1)::integer,
      e.value ->> 'consent_disposition',
      e.value ->> 'consent_reason_code',
      e.value ->> 'consent_policy_version',
      coalesce(e.value ->> 'suppression_reason', 'none'),
      now()
    from jsonb_array_elements(p_recipients) with ordinality as e(value, ordinality);

    -- persisted row count, ownership and dense-ordinal verification.
    select count(*), count(distinct m.ordinal), min(m.ordinal), max(m.ordinal)
      into v_rows, v_ord_distinct, v_ord_min, v_ord_max
      from public.vendor_campaign_audience_members m
     where m.campaign_id = p_campaign_id
       and m.snapshot_id = v_snapshot_id
       and m.snapshot_revision = v_revision;

    if v_rows is distinct from v_count then
      v_fail := 'SNAPSHOT_COUNT_MISMATCH';
    elsif v_ord_distinct is distinct from v_rows
       or v_ord_min is distinct from 0
       or v_ord_max is distinct from v_rows - 1 then
      v_fail := 'SNAPSHOT_ORDINAL_INVALID';
    else
      v_snap_actual := public.qf_campaign_snapshot_fingerprint_v1(p_campaign_id, v_snapshot_id, v_revision);
      if v_snap_actual is null or v_snap_actual !~ '^[0-9a-f]{64}$' then
        v_fail := 'SNAPSHOT_ORDINAL_INVALID';
      elsif v_snap_actual <> p_snapshot_fingerprint then
        v_fail := 'SNAPSHOT_FINGERPRINT_MISMATCH';
      end if;
    end if;

    if v_fail is not null then
      raise exception using errcode = 'QFC01', message = 'QF-MVP-30.4C1 snapshot verification failed';
    end if;
  exception
    when sqlstate 'QFC01' then
      null;   -- the inserted rows are rolled back; v_fail carries the reason.
  end;

  if v_fail is not null then
    return jsonb_build_object('ok', false, 'code', v_fail);
  end if;

  update public.vendor_campaigns set
    status                        = 'ready_for_review',
    revision                      = revision + 1,
    prepared_snapshot_id          = v_snapshot_id,
    prepared_snapshot_revision    = v_revision,
    prepared_segment_version      = p_segment_version,
    prepared_segment_fingerprint  = p_segment_fingerprint,
    prepared_template_version     = p_template_version,
    -- DATABASE-COMPUTED, never the caller-supplied expectation.
    prepared_template_fingerprint = v_tmpl_actual,
    prepared_template_category    = v_template.category,
    audience_evaluated_at         = now(),
    prepared_recipient_count      = v_count,
    -- DATABASE-COMPUTED, never the caller-supplied expectation.
    snapshot_fingerprint          = v_snap_actual,
    exclusion_summary             = coalesce(p_exclusion_summary, '{}'::jsonb),
    prepared_at                   = now(),
    prepared_by                   = p_actor_id,
    updated_by                    = p_actor_id,
    idempotency_key               = coalesce(p_idempotency_key, idempotency_key)
  where id = p_campaign_id;

  insert into public.vendor_campaign_events (
    campaign_id, event_type, campaign_revision, snapshot_id, snapshot_revision,
    actor_id, reason_code, metadata, event_idempotency_key
  ) values (
    p_campaign_id, 'prepared', v_campaign.revision + 1, v_snapshot_id, v_revision,
    p_actor_id, 'prepared',
    jsonb_build_object('recipient_count', v_count, 'exclusions', coalesce(p_exclusion_summary, '{}'::jsonb)),
    'prepare:' || p_campaign_id::text || ':' || v_revision::text
  );

  return jsonb_build_object('ok', true, 'replayed', false,
    'snapshot_id', v_snapshot_id, 'snapshot_revision', v_revision,
    'recipient_count', v_count, 'revision', v_campaign.revision + 1);
end;
$$;

comment on function public.qf_prepare_vendor_campaign_v1 is
  'QF-MVP-30.4 (hardened by 30.4C1): atomically freezes a campaign audience and moves draft -> ready_for_review. The DATABASE recomputes the canonical snapshot fingerprint FROM THE INSERTED ROWS and the canonical template-catalog fingerprint from the authoritative template row, cross-checks both against the server-supplied expectations, stores only its own values, and rolls the freeze back on any mismatch. Creates no communication intent, calls no provider and writes no Core table. Enforces no frequency policy (none exists — QF-MVP-30.5 gate).';


-- ---------------------------------------------------------------------------
-- 5. APPROVE — body replaced. Signature and parameter NAMES unchanged.
--
--    Approval now RECOMPUTES both fingerprints under the existing row lock and
--    fails closed on any divergence. It still never resolves recipients, never
--    alters audience rows, creates no intent and calls no provider.
-- ---------------------------------------------------------------------------
create or replace function public.qf_approve_vendor_campaign_v1(
  p_campaign_id       uuid,
  p_expected_revision integer,
  p_actor_id          uuid,
  p_idempotency_key   text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_campaign     public.vendor_campaigns%rowtype;
  v_segment      public.vendor_segments%rowtype;
  v_template     public.communication_templates%rowtype;
  v_members      integer;
  v_ord_distinct integer;
  v_ord_min      integer;
  v_ord_max      integer;
  v_foreign      integer;
  v_snap_actual  text;
  v_tmpl_actual  text;
begin
  if p_campaign_id is null or p_expected_revision is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  -- QF-MVP-30.4C2: LOCK ORDER 1 of 3 — the campaign head.
  select * into v_campaign from public.vendor_campaigns where id = p_campaign_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'CAMPAIGN_NOT_FOUND');
  end if;

  -- deterministic idempotent replay. Evaluated BEFORE the evidence locks: an
  -- already-approved campaign changes nothing, so a replay must not block a
  -- concurrent segment/template edit.
  if v_campaign.status = 'approved' then
    return jsonb_build_object('ok', true, 'replayed', true, 'revision', v_campaign.revision);
  end if;

  if v_campaign.status <> 'ready_for_review' then
    return jsonb_build_object('ok', false, 'code', 'CAMPAIGN_NOT_READY');
  end if;
  if v_campaign.revision <> p_expected_revision then
    return jsonb_build_object('ok', false, 'code', 'REVISION_MISMATCH');
  end if;

  -- frozen evidence must be complete. 30.4C1 additionally requires the
  -- template fingerprint, which was previously absent entirely. This reads only
  -- the ALREADY-LOCKED head, so it is a precondition, not an evidence check.
  if v_campaign.prepared_snapshot_id is null
     or v_campaign.prepared_snapshot_revision is null
     or v_campaign.prepared_recipient_count is null
     or v_campaign.snapshot_fingerprint is null
     or v_campaign.prepared_segment_fingerprint is null
     or v_campaign.prepared_template_version is null
     or v_campaign.prepared_template_fingerprint is null then
    return jsonb_build_object('ok', false, 'code', 'PREPARED_EVIDENCE_INCOMPLETE');
  end if;

  -- =====================================================================
  -- QF-MVP-30.4C2: ACQUIRE BOTH SOURCE-EVIDENCE LOCKS **BEFORE** ANY
  -- EVIDENCE CHECK, and hold them through the approval UPDATE and the event
  -- INSERT until this transaction commits.
  --
  -- Without them the head lock alone left a real race: approval could verify
  -- the segment and template, a concurrent transaction could then commit a
  -- non-key UPDATE to a dispatch-critical field (e.g. provider_template_name,
  -- definition_fingerprint), and this transaction would still commit — thereby
  -- approving evidence that was ALREADY STALE at commit time.
  --
  -- FOR SHARE is the MINIMUM sufficient mode. It conflicts with FOR NO KEY
  -- UPDATE (taken by a plain non-key UPDATE) and with FOR UPDATE (taken by a
  -- DELETE or key-changing UPDATE), so every UPDATE and DELETE of these rows
  -- blocks until we finish. FOR KEY SHARE does NOT conflict with FOR NO KEY
  -- UPDATE and would leave exactly the field class at issue unprotected.
  --
  -- The order campaign -> segment -> template is IDENTICAL to the order
  -- qf_prepare_vendor_campaign_v1 uses, so prepare and approve can never
  -- deadlock against each other.
  --
  -- A locking clause does not change which rows match, so the stable
  -- SEGMENT_MISSING / TEMPLATE_MISSING behaviour is preserved exactly.
  --
  -- These locks require UPDATE privilege on the locked tables in addition to
  -- SELECT. That holds because this function is SECURITY DEFINER and runs as
  -- its owner, not as service_role — §9.13 asserts the owner really has it.
  -- =====================================================================

  -- LOCK ORDER 2 of 3 — the source SEGMENT row.
  select * into v_segment from public.vendor_segments
   where id = v_campaign.segment_id
     for share;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SEGMENT_MISSING');
  end if;

  -- LOCK ORDER 3 of 3 — the source TEMPLATE row.
  select * into v_template from public.communication_templates
   where template_key = v_campaign.template_key
     for share;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_MISSING');
  end if;

  -- (1) exact rows for campaign id + snapshot id + snapshot revision.
  select count(*), count(distinct m.ordinal), min(m.ordinal), max(m.ordinal)
    into v_members, v_ord_distinct, v_ord_min, v_ord_max
    from public.vendor_campaign_audience_members m
   where m.campaign_id = p_campaign_id
     and m.snapshot_id = v_campaign.prepared_snapshot_id
     and m.snapshot_revision = v_campaign.prepared_snapshot_revision;

  if v_members <> v_campaign.prepared_recipient_count then
    return jsonb_build_object('ok', false, 'code', 'SNAPSHOT_COUNT_MISMATCH');
  end if;

  -- (2) ownership: no row may share this snapshot id under another campaign or
  --     revision. A filtered count alone would silently ignore contamination.
  select count(*) into v_foreign
    from public.vendor_campaign_audience_members m
   where m.snapshot_id = v_campaign.prepared_snapshot_id
     and (m.campaign_id is distinct from p_campaign_id
          or m.snapshot_revision is distinct from v_campaign.prepared_snapshot_revision);
  if v_foreign > 0 then
    return jsonb_build_object('ok', false, 'code', 'SNAPSHOT_OWNERSHIP_MISMATCH');
  end if;

  -- (3) dense ordinals.
  if v_members = 0
     or v_ord_distinct is distinct from v_members
     or v_ord_min is distinct from 0
     or v_ord_max is distinct from v_members - 1 then
    return jsonb_build_object('ok', false, 'code', 'SNAPSHOT_ORDINAL_INVALID');
  end if;

  -- (4) RECOMPUTE the canonical snapshot fingerprint from the immutable rows and
  --     compare it with the stored evidence. This is the check 20260723001300
  --     documented but never performed.
  v_snap_actual := public.qf_campaign_snapshot_fingerprint_v1(
                     p_campaign_id, v_campaign.prepared_snapshot_id, v_campaign.prepared_snapshot_revision);
  if v_snap_actual is null then
    return jsonb_build_object('ok', false, 'code', 'SNAPSHOT_ORDINAL_INVALID');
  end if;
  if v_snap_actual <> v_campaign.snapshot_fingerprint then
    return jsonb_build_object('ok', false, 'code', 'SNAPSHOT_FINGERPRINT_MISMATCH');
  end if;

  -- segment must still be live and match the prepared evidence. The row was
  -- already loaded UNDER FOR SHARE above, so no concurrent transaction can have
  -- changed it since, and none can change it before we commit.
  if v_segment.status = 'archived' then
    return jsonb_build_object('ok', false, 'code', 'SEGMENT_ARCHIVED');
  end if;
  if v_segment.definition_version is distinct from v_campaign.prepared_segment_version
     or v_segment.definition_fingerprint is distinct from v_campaign.prepared_segment_fingerprint then
    return jsonb_build_object('ok', false, 'code', 'SEGMENT_EVIDENCE_MISMATCH');
  end if;

  -- template must still be usable and match the pinned evidence. Likewise
  -- already loaded UNDER FOR SHARE above.
  if v_template.is_active is not true or v_template.readiness_status = 'disabled' then
    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_NOT_USABLE');
  end if;
  if v_template.version is distinct from v_campaign.prepared_template_version then
    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_VERSION_MISMATCH');
  end if;
  if v_template.category is distinct from v_campaign.prepared_template_category then
    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_CATEGORY_MISMATCH');
  end if;
  if v_campaign.consent_scope = 'marketing' and v_template.category <> 'marketing' then
    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_CATEGORY_MISMATCH');
  end if;

  -- (5) RECOMPUTE the canonical template-catalog fingerprint and compare it with
  --     the pinned evidence. This catches drift in EVERY dispatch-critical field
  --     the catalog stores, including changes made without a version bump.
  v_tmpl_actual := public.qf_communication_template_fingerprint_v1(v_campaign.template_key);
  if v_tmpl_actual is null then
    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_FINGERPRINT_UNAVAILABLE');
  end if;
  if v_tmpl_actual <> v_campaign.prepared_template_fingerprint then
    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_FINGERPRINT_MISMATCH');
  end if;

  update public.vendor_campaigns set
    status      = 'approved',
    revision    = revision + 1,
    approved_at = now(),
    approved_by = p_actor_id,
    updated_by  = p_actor_id
  where id = p_campaign_id;

  insert into public.vendor_campaign_events (
    campaign_id, event_type, campaign_revision, snapshot_id, snapshot_revision,
    actor_id, reason_code, metadata, event_idempotency_key
  ) values (
    p_campaign_id, 'approved', v_campaign.revision + 1,
    v_campaign.prepared_snapshot_id, v_campaign.prepared_snapshot_revision,
    p_actor_id, 'approved',
    jsonb_build_object('recipient_count', v_campaign.prepared_recipient_count),
    coalesce(p_idempotency_key, 'approve:' || p_campaign_id::text || ':' || (v_campaign.revision + 1)::text)
  );

  return jsonb_build_object('ok', true, 'replayed', false, 'revision', v_campaign.revision + 1);
end;
$$;

comment on function public.qf_approve_vendor_campaign_v1 is
  'QF-MVP-30.4 (hardened by 30.4C1): authorises an ALREADY-FROZEN audience. Under the row lock it verifies row count, snapshot ownership and dense ordinals, RECOMPUTES the canonical snapshot fingerprint from the immutable rows and the canonical template-catalog fingerprint from the authoritative template row, and fails closed on any divergence. It never resolves or alters recipients, creates no communication intent, calls no provider and writes no Core table.';


-- ---------------------------------------------------------------------------
-- 6. Prepared-evidence completeness now REQUIRES the template fingerprint.
--    Forward-only: the old constraint is dropped and replaced. §0.3 already
--    refused to proceed if any existing row would violate it.
-- ---------------------------------------------------------------------------
alter table public.vendor_campaigns
  drop constraint if exists vcm_prepared_evidence_complete;

alter table public.vendor_campaigns
  add constraint vcm_prepared_evidence_complete check (
    status not in ('ready_for_review','approved')
    or (prepared_snapshot_id is not null
        and prepared_snapshot_revision is not null
        and prepared_segment_version is not null
        and prepared_segment_fingerprint is not null
        and prepared_template_version is not null
        and prepared_template_category is not null
        and prepared_template_fingerprint is not null
        and audience_evaluated_at is not null
        and prepared_recipient_count is not null
        and snapshot_fingerprint is not null
        and segment_id is not null
        and template_key is not null)
  );

comment on constraint vcm_prepared_evidence_complete on public.vendor_campaigns is
  'QF-MVP-30.4C1: a ready_for_review or approved campaign must carry COMPLETE frozen evidence, now including a non-null prepared_template_fingerprint. Draft rows are unaffected.';


-- ---------------------------------------------------------------------------
-- 7. Correct the two comments that previously over-claimed.
-- ---------------------------------------------------------------------------
comment on column public.vendor_campaigns.snapshot_fingerprint is
  'QF-MVP-30.4C1: lowercase sha256 hex over the ORDERED frozen recipient set, COMPUTED BY THE DATABASE at prepare via qf_campaign_snapshot_fingerprint_v1 and RECOMPUTED and compared at approval. A caller-supplied value is only an expectation to cross-check and is never stored. A mismatch fails closed at both boundaries.';

comment on column public.vendor_campaigns.prepared_template_fingerprint is
  'QF-MVP-30.4C1: lowercase sha256 hex over the canonical TEMPLATE-CATALOG row, COMPUTED BY THE DATABASE at prepare via qf_communication_template_fingerprint_v1 and RECOMPUTED and compared at approval. Mandatory for ready_for_review/approved. NOT a provider-mapping or message-body fingerprint — QF-MVP-30.5 owns those.';


-- ---------------------------------------------------------------------------
-- 8. Execute posture.
--
--    The two fingerprint authorities and the field encoder are NOT externally
--    callable: only the SECURITY DEFINER campaign RPCs invoke them, and those
--    run as the owner. Untrusted roles and service_role hold no EXECUTE.
--    The two campaign RPCs keep their existing service_role-only posture, which
--    is re-asserted idempotently here.
-- ---------------------------------------------------------------------------
revoke all on function public.qf_canonical_text_field_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function public.qf_campaign_snapshot_fingerprint_v1(uuid, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.qf_communication_template_fingerprint_v1(text)
  from public, anon, authenticated, service_role;

revoke all on function public.qf_prepare_vendor_campaign_v1(uuid, integer, uuid, integer, text, text, text, jsonb, text, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text)
  from public, anon, authenticated;
grant execute on function public.qf_prepare_vendor_campaign_v1(uuid, integer, uuid, integer, text, text, text, jsonb, text, jsonb, text)
  to service_role;
grant execute on function public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text)
  to service_role;


-- ---------------------------------------------------------------------------
-- 9. Self-verification — catalog/privilege facts and executed determinism only.
--    Writes nothing, reads no campaign row and creates no fixture.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_count integer;
  v_a     text;
  v_b     text;
  v_src   text;
begin
  -- 9.1 all three new functions exist with the expected volatility/security.
  select count(*) into v_count
    from pg_proc p
   where p.oid in (
     to_regprocedure('public.qf_canonical_text_field_v1(text)'),
     to_regprocedure('public.qf_campaign_snapshot_fingerprint_v1(uuid, uuid, integer)'),
     to_regprocedure('public.qf_communication_template_fingerprint_v1(text)'))
     and not p.prosecdef;
  if v_count <> 3 then
    raise exception 'QF-MVP-30.4C1 aborted: the three canonical helpers are not all present as SECURITY INVOKER (found %).', v_count;
  end if;

  -- 9.2 the two campaign RPCs remain SECURITY DEFINER with a pinned search_path.
  if exists (
    select 1 from pg_proc p
     where p.oid in (
       to_regprocedure('public.qf_prepare_vendor_campaign_v1(uuid, integer, uuid, integer, text, text, text, jsonb, text, jsonb, text)'),
       to_regprocedure('public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text)'))
       and (not p.prosecdef
            or p.proconfig is null
            or not (p.proconfig::text like '%search_path=%'))
  ) then
    raise exception 'QF-MVP-30.4C1 aborted: a campaign RPC lost SECURITY DEFINER or its pinned search_path.';
  end if;

  -- 9.3 the hardened bodies actually contain the new verification contract.
  select pg_get_functiondef(to_regprocedure(
    'public.qf_prepare_vendor_campaign_v1(uuid, integer, uuid, integer, text, text, text, jsonb, text, jsonb, text)')) into v_src;
  if v_src not like '%qf_campaign_snapshot_fingerprint_v1%'
     or v_src not like '%qf_communication_template_fingerprint_v1%'
     or v_src not like '%snapshot_fingerprint          = v_snap_actual%'
     or v_src not like '%prepared_template_fingerprint = v_tmpl_actual%' then
    raise exception 'QF-MVP-30.4C1 aborted: the prepare RPC does not compute and store database-authoritative fingerprints.';
  end if;
  select pg_get_functiondef(to_regprocedure(
    'public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text)')) into v_src;
  if v_src not like '%qf_campaign_snapshot_fingerprint_v1%'
     or v_src not like '%qf_communication_template_fingerprint_v1%'
     or v_src not like '%SNAPSHOT_FINGERPRINT_MISMATCH%'
     or v_src not like '%TEMPLATE_FINGERPRINT_MISMATCH%' then
    raise exception 'QF-MVP-30.4C1 aborted: the approve RPC does not recompute and compare both fingerprints.';
  end if;

  -- 9.4 untrusted roles hold ZERO execute on every campaign/fingerprint function.
  if exists (
    select 1
      from unnest(array[
        'public.qf_canonical_text_field_v1(text)',
        'public.qf_campaign_snapshot_fingerprint_v1(uuid, uuid, integer)',
        'public.qf_communication_template_fingerprint_v1(text)',
        'public.qf_prepare_vendor_campaign_v1(uuid, integer, uuid, integer, text, text, text, jsonb, text, jsonb, text)',
        'public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text)']) s(fn)
      cross join unnest(array['public','anon','authenticated']) r(role_name)
     where has_function_privilege(r.role_name, s.fn, 'EXECUTE')
  ) then
    raise exception 'QF-MVP-30.4C1 aborted: an untrusted role holds EXECUTE on a campaign or fingerprint function.';
  end if;

  -- 9.5 the fingerprint helpers are NOT externally callable by service_role.
  if has_function_privilege('service_role', 'public.qf_campaign_snapshot_fingerprint_v1(uuid, uuid, integer)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.qf_communication_template_fingerprint_v1(text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.qf_canonical_text_field_v1(text)', 'EXECUTE') then
    raise exception 'QF-MVP-30.4C1 aborted: a fingerprint helper is externally callable; only the SECURITY DEFINER RPCs may invoke it.';
  end if;

  -- 9.6 service_role retains EXECUTE on exactly the two campaign RPCs.
  if not (has_function_privilege('service_role', 'public.qf_prepare_vendor_campaign_v1(uuid, integer, uuid, integer, text, text, text, jsonb, text, jsonb, text)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text)', 'EXECUTE')) then
    raise exception 'QF-MVP-30.4C1 aborted: service_role lost EXECUTE on a campaign RPC.';
  end if;

  -- 9.7 EXECUTED determinism: the canonical field encoder distinguishes NULL
  --     from empty and is stable across calls.
  if public.qf_canonical_text_field_v1(null) <> '-1:'
     or public.qf_canonical_text_field_v1('') <> '0:'
     or public.qf_canonical_text_field_v1('ab') <> '2:ab'
     or public.qf_canonical_text_field_v1('ab') <> public.qf_canonical_text_field_v1('ab') then
    raise exception 'QF-MVP-30.4C1 aborted: the canonical field encoder is not deterministic or conflates NULL with empty.';
  end if;

  -- 9.8 EXECUTED determinism: sha256 of a known canonical string is stable and
  --     lowercase hex (proves the digest path works without pgcrypto).
  v_a := encode(sha256(convert_to('qf-campaign-snapshot-v1', 'UTF8')), 'hex');
  v_b := encode(sha256(convert_to('qf-campaign-snapshot-v1', 'UTF8')), 'hex');
  if v_a <> v_b or v_a !~ '^[0-9a-f]{64}$' then
    raise exception 'QF-MVP-30.4C1 aborted: the sha256 canonical digest path is not deterministic lowercase hex.';
  end if;

  -- 9.9 an empty / unknown snapshot yields NULL, never a misleading hash.
  if public.qf_campaign_snapshot_fingerprint_v1(
       '00000000-0000-4000-8000-000000000000'::uuid,
       '00000000-0000-4000-8000-000000000001'::uuid, 1) is not null then
    raise exception 'QF-MVP-30.4C1 aborted: an unknown snapshot did not fingerprint to NULL.';
  end if;
  if public.qf_communication_template_fingerprint_v1('__qf_no_such_template__') is not null then
    raise exception 'QF-MVP-30.4C1 aborted: an unknown template did not fingerprint to NULL.';
  end if;

  -- 9.10 the tightened completeness constraint is in force.
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = to_regclass('public.vendor_campaigns')
       and c.conname = 'vcm_prepared_evidence_complete'
       and pg_get_constraintdef(c.oid) like '%prepared_template_fingerprint IS NOT NULL%'
  ) then
    raise exception 'QF-MVP-30.4C1 aborted: prepared-evidence completeness does not require prepared_template_fingerprint.';
  end if;

  -- 9.11 EXACTLY the three campaign tables still exist; nothing new was created.
  select count(*) into v_count from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'vendor_campaign%';
  if v_count <> 3 then
    raise exception 'QF-MVP-30.4C1 aborted: expected exactly 3 vendor_campaign* tables, found %.', v_count;
  end if;

  -- 9.12 no plaintext destination / PII column was introduced anywhere.
  if exists (
    select 1 from pg_attribute a
     where a.attrelid in (to_regclass('public.vendor_campaigns'),
                          to_regclass('public.vendor_campaign_audience_members'),
                          to_regclass('public.vendor_campaign_events'))
       and a.attnum > 0 and not a.attisdropped
       and (a.attname in ('phone','email','whatsapp_number','msisdn','destination','recipient_ref',
                          'to_address','provider_payload','access_token','api_key')
            or a.attname like '%password%' or a.attname like '%secret%')
  ) then
    raise exception 'QF-MVP-30.4C1 aborted: a destination/secret column exists on a campaign table.';
  end if;

  -- =====================================================================
  -- 9.13 QF-MVP-30.4C2 — THE EXECUTABLE SOURCE-EVIDENCE LOCK CONTRACT.
  --
  -- Asserted against the INSTALLED definitions via pg_get_functiondef, with
  -- comments stripped first, so a comment mentioning FOR SHARE can never
  -- satisfy this check while the executable SQL stays unlocked.
  -- =====================================================================
  declare
    v_prep text;
    v_appr text;
    v_cam  integer;
    v_seg  integer;
    v_tpl  integer;
  begin
    -- Comment-stripped, lower-cased executable text of each installed function.
    -- Stripping comments FIRST is the whole point: a comment that merely
    -- mentions FOR SHARE must never satisfy a lock assertion.
    select lower(regexp_replace(pg_get_functiondef(to_regprocedure(
             'public.qf_prepare_vendor_campaign_v1(uuid, integer, uuid, integer, text, text, text, jsonb, text, jsonb, text)')),
           '--[^\n]*', ' ', 'g')) into v_prep;
    select lower(regexp_replace(pg_get_functiondef(to_regprocedure(
             'public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text)')),
           '--[^\n]*', ' ', 'g')) into v_appr;

    -- (a) the campaign head is still locked FOR UPDATE in both RPCs.
    if v_prep !~* 'from\s+public\.vendor_campaigns\s+where\s+id\s*=\s*p_campaign_id\s+for\s+update'
       or v_appr !~* 'from\s+public\.vendor_campaigns\s+where\s+id\s*=\s*p_campaign_id\s+for\s+update' then
      raise exception 'QF-MVP-30.4C2 aborted: a campaign RPC no longer locks the campaign head FOR UPDATE.';
    end if;

    -- (b) BOTH source evidence rows are locked in BOTH RPCs, with a mode that
    --     conflicts with a plain UPDATE. FOR KEY SHARE does not and is refused.
    if v_prep !~* 'from\s+public\.vendor_segments[^;]*\sfor\s+share\s*;' then
      raise exception 'QF-MVP-30.4C2 aborted: prepare does not lock the source vendor_segments row FOR SHARE.';
    end if;
    if v_prep !~* 'from\s+public\.communication_templates[^;]*\sfor\s+share\s*;' then
      raise exception 'QF-MVP-30.4C2 aborted: prepare does not lock the source communication_templates row FOR SHARE.';
    end if;
    if v_appr !~* 'from\s+public\.vendor_segments[^;]*\sfor\s+share\s*;' then
      raise exception 'QF-MVP-30.4C2 aborted: approve does not lock the source vendor_segments row FOR SHARE.';
    end if;
    if v_appr !~* 'from\s+public\.communication_templates[^;]*\sfor\s+share\s*;' then
      raise exception 'QF-MVP-30.4C2 aborted: approve does not lock the source communication_templates row FOR SHARE.';
    end if;

    -- (c) FOR KEY SHARE is insufficient for a non-key UPDATE and must not appear.
    if v_prep ~* 'for\s+key\s+share' or v_appr ~* 'for\s+key\s+share' then
      raise exception 'QF-MVP-30.4C2 aborted: FOR KEY SHARE does not conflict with FOR NO KEY UPDATE and cannot protect a non-key evidence field.';
    end if;

    -- (d) DETERMINISTIC LOCK ORDER campaign -> segment -> template in BOTH RPCs,
    --     so prepare and approve can never deadlock against one another.
    --
    --     Anchored on 'from public.<table>' — the LOCKING READS — never on the
    --     bare table name, because every one of these tables also appears in the
    --     DECLARE block as `public.<table>%rowtype`, in declare order. Anchoring
    --     on the bare name would measure the declarations and pass vacuously
    --     whatever the real lock order turned out to be.
    v_cam := position('from public.vendor_campaigns' in v_prep);
    v_seg := position('from public.vendor_segments' in v_prep);
    v_tpl := position('from public.communication_templates' in v_prep);
    if v_cam = 0 or v_seg = 0 or v_tpl = 0 or v_cam > v_seg or v_seg > v_tpl then
      raise exception 'QF-MVP-30.4C2 aborted: prepare does not acquire locks in the order campaign -> segment -> template.';
    end if;
    v_cam := position('from public.vendor_campaigns' in v_appr);
    v_seg := position('from public.vendor_segments' in v_appr);
    v_tpl := position('from public.communication_templates' in v_appr);
    if v_cam = 0 or v_seg = 0 or v_tpl = 0 or v_cam > v_seg or v_seg > v_tpl then
      raise exception 'QF-MVP-30.4C2 aborted: approve does not acquire locks in the order campaign -> segment -> template.';
    end if;

    -- (e) approval must acquire BOTH evidence locks BEFORE its first evidence
    --     check, and still hold them at the approving UPDATE.
    if position('for share' in v_appr) > position('snapshot_count_mismatch' in v_appr) then
      raise exception 'QF-MVP-30.4C2 aborted: approve performs an evidence check before acquiring the source-evidence locks.';
    end if;
    if v_tpl > position('update public.vendor_campaigns set' in v_appr) then
      raise exception 'QF-MVP-30.4C2 aborted: approve does not hold the source-evidence locks through the approving UPDATE.';
    end if;

    -- (f) SELECT ... FOR SHARE needs UPDATE privilege in addition to SELECT.
    --     Both RPCs are SECURITY DEFINER, so the OWNER must hold it — not
    --     service_role. A missing owner privilege would make every prepare and
    --     approve fail at runtime, so it is asserted here rather than assumed.
    if not exists (
      select 1 from pg_proc p join pg_roles r on r.oid = p.proowner
       where p.oid = to_regprocedure('public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text)')
         and has_table_privilege(r.rolname, 'public.vendor_segments', 'UPDATE')
         and has_table_privilege(r.rolname, 'public.communication_templates', 'UPDATE')
    ) then
      raise exception 'QF-MVP-30.4C2 aborted: the campaign RPC owner lacks the UPDATE privilege that SELECT ... FOR SHARE requires on an evidence table.';
    end if;
  end;

  raise notice 'QF-MVP-30.4C1/C2: campaign approval evidence hardened — fingerprints are database-computed at prepare and recomputed at approval, and both source evidence rows are held FOR SHARE in the deterministic order campaign -> segment -> template.';
end;
$verify$;
