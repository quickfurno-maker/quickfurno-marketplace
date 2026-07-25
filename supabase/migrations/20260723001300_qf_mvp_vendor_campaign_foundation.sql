-- ============================================================================
-- QF-MVP-30.4A — VENDOR CAMPAIGN MANAGEMENT FOUNDATION (SCHEMA/ACL/RPC ONLY)
--
-- Forward-only. Backfills no data, deletes no data, rewrites no applied
-- migration, inserts no template row. STAGING FIRST. Generated and reviewed
-- only; application is a separate, separately authorized phase (QF-MVP-30.4B).
--
-- ---------------------------------------------------------------------------
-- SCOPE (preflight QF-MVP-30.4 §26; owner decisions 1-8 LOCKED)
-- ---------------------------------------------------------------------------
-- Establishes EXACTLY THREE campaign objects:
--   1. vendor_campaigns                  — mutable-before-approval campaign head
--   2. vendor_campaign_audience_members  — IMMUTABLE frozen recipient snapshot
--   3. vendor_campaign_events            — APPEND-ONLY transition/provenance log
-- plus two narrow SECURITY DEFINER RPCs (prepare/freeze and approve) and ONE
-- minimal alignment of the existing communication_templates category authority.
--
-- NOT created here: a second campaign head/version table; a separate audience
-- header (snapshot metadata lives on the head); provider dispatch tables;
-- delivery tables; communication-intent tables; AI tables; audit_logs;
-- admin_notifications; ANY plaintext destination column.
--
-- ---------------------------------------------------------------------------
-- APPROVAL AUTHORISES AN AUDIENCE. IT DOES NOT SEND.
-- ---------------------------------------------------------------------------
-- QF-MVP-30.4 creates NO communication intent, calls NO provider and writes NO
-- delivery result. communication_intents.aggregate_type is deliberately NOT
-- widened here (owner decision 4) — QF-MVP-30.5 owns that separately reviewed
-- change together with dispatch and uncertain-outcome handling.
--
-- ---------------------------------------------------------------------------
-- FREEZE AT PREPARE, NOT AT APPROVAL (owner decision 1)
-- ---------------------------------------------------------------------------
-- qf_prepare_vendor_campaign_v1 resolves the segment against current facts,
-- freezes an immutable recipient snapshot and moves draft -> ready_for_review.
-- The approver therefore authorises an ALREADY-FROZEN, reviewable audience;
-- qf_approve_vendor_campaign_v1 never resolves or alters recipients. Editing a
-- ready_for_review campaign requires an explicit return-to-draft; earlier
-- snapshots and events are never rewritten — a later prepare creates a NEW
-- snapshot revision.
--
-- ---------------------------------------------------------------------------
-- FREQUENCY POLICY IS OUT OF SCOPE (owner decision 6)
-- ---------------------------------------------------------------------------
-- No frequency-cap authority exists anywhere in this codebase and none is
-- created here. Preview, prepare and approval perform NO frequency enforcement
-- and this migration makes no such claim. QF-MVP-30.5 MUST define and enforce a
-- minimal fail-closed frequency rule before any campaign dispatch is enabled;
-- until that gate exists, no campaign may send.
--
-- ---------------------------------------------------------------------------
-- LOCKED AUTHORITY BOUNDARY
-- ---------------------------------------------------------------------------
-- Core stays authoritative for vendor identity, verification, enabled state,
-- geography, categories, package, credits/ledger, lead/assignment history,
-- consent, suppression and communication authorization. This foundation stores
-- campaign definition plus FROZEN EVIDENCE REFERENCES only, and creates no
-- authoritative copy of any Core fact. The existing communication stack
-- (templates, consent events, suppressions, preferences, provider accounts) is
-- REUSED and never duplicated.
--
-- ---------------------------------------------------------------------------
-- PRIVACY (owner decision 8)
-- ---------------------------------------------------------------------------
-- Audience rows carry vendor identity plus enum/code evidence ONLY. There is NO
-- phone, email, whatsapp number, destination or recipient_ref column anywhere in
-- this foundation, so a plaintext destination leak is structurally impossible.
-- Destination resolution remains a later communication-execution concern.
--
-- ---------------------------------------------------------------------------
-- MIGRATION-006 DIVERGENCE (explicit)
-- ---------------------------------------------------------------------------
-- audit_logs and admin_notifications are ABSENT on staging. This migration
-- neither creates nor references them. Provenance is carried by the campaign
-- head's own actor/timestamp columns plus the append-only event table.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. Existing communication authority alignment (owner decision 5).
--    The ONLY authorised change to an existing communication authority in 30.4A.
--    Forward-only: the constraint is replaced, no row is read, updated or
--    inserted, and both existing values are preserved.
-- ---------------------------------------------------------------------------
alter table public.communication_templates
  drop constraint if exists communication_templates_category_check;

alter table public.communication_templates
  add constraint communication_templates_category_check
  check (category in ('authentication', 'business', 'marketing'));

comment on constraint communication_templates_category_check on public.communication_templates is
  'QF-MVP-30.4A: widened to include marketing so a consent_scope=marketing campaign can pin a marketing-category template. No provider mapping activated, no template row inserted.';


-- ---------------------------------------------------------------------------
-- 1. vendor_campaigns — mutable before approval, evidence frozen at prepare.
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_campaigns (
  id                          uuid        not null default gen_random_uuid(),

  name                        text        not null,
  description                 text,
  purpose                     text        not null,
  channel                     text        not null default 'whatsapp',
  consent_scope               text        not null,

  status                      text        not null default 'draft',
  -- optimistic concurrency for every locked transition; never decremented.
  revision                    integer     not null default 1,

  -- source segment reference (the saved question this campaign draws from)
  segment_id                  uuid,

  -- template reference into the existing communication_templates authority
  template_key                text,
  template_version            text,

  -- ---- frozen at PREPARE (owner decision 1). Null while draft. ------------
  prepared_snapshot_id        uuid,
  prepared_snapshot_revision  integer,
  prepared_segment_version    integer,
  prepared_segment_fingerprint text,
  prepared_template_version   text,
  prepared_template_fingerprint text,
  prepared_template_category  text,
  audience_evaluated_at       timestamptz,
  prepared_recipient_count    integer,
  snapshot_fingerprint        text,
  -- sanitized, bounded: reason_code -> count. NEVER vendor ids, never PII.
  exclusion_summary           jsonb       not null default '{}'::jsonb,

  -- ---- provenance ---------------------------------------------------------
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  prepared_at                 timestamptz,
  approved_at                 timestamptz,
  cancelled_at                timestamptz,
  archived_at                 timestamptz,

  created_by                  uuid,
  updated_by                  uuid,
  prepared_by                 uuid,
  approved_by                 uuid,
  cancelled_by                uuid,
  archived_by                 uuid,

  -- deterministic replay
  idempotency_key             text,
  supersedes_campaign_id      uuid,

  constraint vcm_pkey primary key (id),

  -- evidence-preserving FKs: never cascade.
  constraint vcm_segment_fk foreign key (segment_id)
    references public.vendor_segments (id) on update restrict on delete restrict,
  constraint vcm_supersedes_fk foreign key (supersedes_campaign_id)
    references public.vendor_campaigns (id) on update restrict on delete restrict,
  constraint vcm_created_by_fk foreign key (created_by)
    references public.profiles (id) on update restrict on delete set null,
  constraint vcm_updated_by_fk foreign key (updated_by)
    references public.profiles (id) on update restrict on delete set null,
  constraint vcm_prepared_by_fk foreign key (prepared_by)
    references public.profiles (id) on update restrict on delete set null,
  constraint vcm_approved_by_fk foreign key (approved_by)
    references public.profiles (id) on update restrict on delete set null,
  constraint vcm_cancelled_by_fk foreign key (cancelled_by)
    references public.profiles (id) on update restrict on delete set null,
  constraint vcm_archived_by_fk foreign key (archived_by)
    references public.profiles (id) on update restrict on delete set null,

  constraint vcm_name_nonempty check (char_length(btrim(name)) > 0),
  constraint vcm_name_len check (char_length(name) <= 120),
  constraint vcm_description_len check (description is null or char_length(description) <= 2000),

  constraint vcm_status_check check (status in
    ('draft','ready_for_review','approved','cancelled','archived')),
  constraint vcm_purpose_check check (purpose in
    ('onboarding','reactivation','announcement','retention','support_followup')),
  -- MVP channel vocabulary; the applied templates authority permits whatsapp/sms/rcs.
  constraint vcm_channel_check check (channel in ('whatsapp')),
  constraint vcm_consent_scope_check check (consent_scope in ('transactional','marketing')),
  constraint vcm_revision_check check (revision >= 1),
  constraint vcm_snapshot_revision_check check
    (prepared_snapshot_revision is null or prepared_snapshot_revision >= 1),
  constraint vcm_recipient_count_check check
    (prepared_recipient_count is null or prepared_recipient_count >= 0),
  constraint vcm_segment_version_check check
    (prepared_segment_version is null or prepared_segment_version >= 1),

  -- sha256 hex evidence shapes
  constraint vcm_segment_fingerprint_shape check
    (prepared_segment_fingerprint is null or prepared_segment_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint vcm_snapshot_fingerprint_shape check
    (snapshot_fingerprint is null or snapshot_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint vcm_template_fingerprint_shape check
    (prepared_template_fingerprint is null or prepared_template_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint vcm_prepared_template_category_check check
    (prepared_template_category is null
      or prepared_template_category in ('authentication','business','marketing')),

  -- bounded, object-shaped, sanitized exclusion summary (codes -> counts).
  constraint vcm_exclusion_summary_object check (jsonb_typeof(exclusion_summary) = 'object'),
  -- length() over the jsonb text form: IMMUTABLE. pg_column_size() is STABLE and
  -- is rejected outright inside a CHECK constraint.
  constraint vcm_exclusion_summary_size check (length(exclusion_summary::text) <= 4096),

  -- Lifecycle timestamp consistency, stated as IMPLICATIONS, not biconditionals.
  -- These stamps record that an event HAPPENED, so they must survive a later
  -- transition: an approved campaign that is subsequently cancelled keeps its
  -- approved_at, and a cancelled campaign that is archived keeps its
  -- cancelled_at. A biconditional would make those legal transitions violate the
  -- constraint and strand the row.
  constraint vcm_approved_consistency check (status <> 'approved' or approved_at is not null),
  constraint vcm_cancelled_consistency check (status <> 'cancelled' or cancelled_at is not null),
  constraint vcm_archived_consistency check (status <> 'archived' or archived_at is not null),

  -- a prepared/approved campaign MUST carry complete frozen evidence.
  constraint vcm_prepared_evidence_complete check (
    status not in ('ready_for_review','approved')
    or (prepared_snapshot_id is not null
        and prepared_snapshot_revision is not null
        and prepared_segment_version is not null
        and prepared_segment_fingerprint is not null
        and prepared_template_version is not null
        and prepared_template_category is not null
        and audience_evaluated_at is not null
        and prepared_recipient_count is not null
        and snapshot_fingerprint is not null
        and segment_id is not null
        and template_key is not null)
  ),
  -- a marketing campaign may only pin a marketing-category template.
  constraint vcm_marketing_requires_marketing_template check (
    prepared_template_category is null
    or consent_scope <> 'marketing'
    or prepared_template_category = 'marketing'
  ),
  constraint vcm_no_self_supersede check
    (supersedes_campaign_id is null or supersedes_campaign_id <> id)
);

comment on table public.vendor_campaigns is
  'QF-MVP-30.4: campaign head. Mutable while draft; audience evidence is FROZEN at prepare and immutable after approval. Approval authorises an audience — it never sends. No destination, provider, delivery or frequency-policy authority lives here.';
comment on column public.vendor_campaigns.snapshot_fingerprint is
  'sha256 hex over the ordered frozen recipient set. Recomputed and re-checked at approval; a mismatch fails closed.';
comment on column public.vendor_campaigns.exclusion_summary is
  'Sanitized reason_code -> count map. NEVER vendor ids, destinations or PII.';
comment on column public.vendor_campaigns.revision is
  'Optimistic concurrency token for locked transitions. Monotonic; never decremented or reused.';
comment on column public.vendor_campaigns.prepared_snapshot_revision is
  'Monotonic snapshot revision. A return-to-draft then re-prepare creates a NEW revision; earlier snapshots are never rewritten or deleted.';


-- ---------------------------------------------------------------------------
-- 2. vendor_campaign_audience_members — IMMUTABLE frozen recipient snapshot.
--    One row per INCLUDED vendor in one snapshot revision. Excluded vendors are
--    represented only as sanitized counts on the head/event (preflight §17) so
--    no identity is stored for a vendor that was deliberately left out.
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_campaign_audience_members (
  id                      uuid        not null default gen_random_uuid(),
  snapshot_id             uuid        not null,
  campaign_id             uuid        not null,
  snapshot_revision       integer     not null,
  vendor_id               uuid        not null,
  -- deterministic ordering key within the snapshot (0-based, dense).
  ordinal                 integer     not null,

  -- minimum Core-decision evidence, enum/code values only.
  consent_disposition     text        not null,
  consent_reason_code     text        not null,
  consent_policy_version  text        not null,
  suppression_reason      text        not null default 'none',

  evaluated_at            timestamptz not null,
  created_at              timestamptz not null default now(),

  constraint vcam_pkey primary key (id),

  constraint vcam_campaign_fk foreign key (campaign_id)
    references public.vendor_campaigns (id) on update restrict on delete restrict,
  constraint vcam_vendor_fk foreign key (vendor_id)
    references public.vendors (id) on update restrict on delete restrict,

  -- one vendor may appear at most once per snapshot revision.
  constraint vcam_unique_member unique (snapshot_id, vendor_id),
  constraint vcam_unique_ordinal unique (snapshot_id, ordinal),
  constraint vcam_ordinal_check check (ordinal >= 0),
  constraint vcam_snapshot_revision_check check (snapshot_revision >= 1),
  constraint vcam_disposition_check check (consent_disposition in
    ('marketing_opted_in','no_consent_objection','unknown')),
  constraint vcam_suppression_reason_check check (suppression_reason in
    ('none','global','channel','category','vendor_request','compliance'))
);

comment on table public.vendor_campaign_audience_members is
  'QF-MVP-30.4: IMMUTABLE frozen campaign audience. Append-only for every role — no UPDATE, no DELETE, no TRUNCATE. Contains vendor identity plus enum-coded consent evidence ONLY: there is deliberately NO phone, email, destination or recipient_ref column.';
comment on column public.vendor_campaign_audience_members.ordinal is
  'Deterministic 0-based position within the snapshot. Fixes the ordering the snapshot fingerprint is computed over.';


-- ---------------------------------------------------------------------------
-- 3. vendor_campaign_events — APPEND-ONLY transition/provenance log.
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_campaign_events (
  id                  uuid        not null default gen_random_uuid(),
  campaign_id         uuid        not null,
  event_type          text        not null,
  campaign_revision   integer     not null,
  snapshot_id         uuid,
  snapshot_revision   integer,
  actor_id            uuid,
  reason_code         text,
  -- sanitized bounded codes/counts only. NEVER PII or a provider payload.
  metadata            jsonb       not null default '{}'::jsonb,
  occurred_at         timestamptz not null default now(),
  recorded_at         timestamptz not null default now(),
  event_idempotency_key text      not null,

  constraint vce_pkey primary key (id),
  constraint vce_campaign_fk foreign key (campaign_id)
    references public.vendor_campaigns (id) on update restrict on delete restrict,
  constraint vce_actor_fk foreign key (actor_id)
    references public.profiles (id) on update restrict on delete set null,

  constraint vce_event_type_check check (event_type in
    ('created','updated','prepared','returned_to_draft','approved','cancelled','archived')),
  constraint vce_campaign_revision_check check (campaign_revision >= 1),
  constraint vce_snapshot_revision_check check (snapshot_revision is null or snapshot_revision >= 1),
  constraint vce_reason_code_len check (reason_code is null or char_length(reason_code) <= 64),
  constraint vce_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint vce_metadata_size check (length(metadata::text) <= 2048),
  constraint vce_idempotency_unique unique (event_idempotency_key)
);

comment on table public.vendor_campaign_events is
  'QF-MVP-30.4: append-only campaign provenance. INSERT-only for every role. Sanitized codes and counts only — never PII, never a provider payload. Replaces any dependence on the absent audit_logs table.';


-- ---------------------------------------------------------------------------
-- 4. Deterministic indexes.
-- ---------------------------------------------------------------------------
create unique index if not exists uq_vendor_campaigns_live_name
  on public.vendor_campaigns (lower(btrim(name)))
  where status <> 'archived';

create unique index if not exists uq_vendor_campaigns_idempotency
  on public.vendor_campaigns (idempotency_key)
  where idempotency_key is not null;

create index if not exists ix_vendor_campaigns_status_updated
  on public.vendor_campaigns (status, updated_at desc, id);

create index if not exists ix_vendor_campaigns_segment
  on public.vendor_campaigns (segment_id);

create index if not exists ix_vcam_campaign_revision
  on public.vendor_campaign_audience_members (campaign_id, snapshot_revision, ordinal);

create index if not exists ix_vcam_snapshot
  on public.vendor_campaign_audience_members (snapshot_id);

create index if not exists ix_vce_campaign_occurred
  on public.vendor_campaign_events (campaign_id, occurred_at desc, id);


-- ---------------------------------------------------------------------------
-- 5. updated_at maintenance (reuses the 30.1B shared helper).
-- ---------------------------------------------------------------------------
drop trigger if exists trg_vcm_touch on public.vendor_campaigns;
create trigger trg_vcm_touch before update on public.vendor_campaigns
  for each row execute function public.qf_crm_touch_updated_at();


-- ---------------------------------------------------------------------------
-- 6. Immutability guards.
-- ---------------------------------------------------------------------------
create or replace function public.qf_prevent_campaign_audience_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'QF-MVP-30.4: vendor_campaign_audience_members is an immutable frozen snapshot.',
    hint    = 'Return the campaign to draft and prepare again; a new snapshot revision is created.';
end;
$$;

comment on function public.qf_prevent_campaign_audience_mutation() is
  'QF-MVP-30.4: blocks UPDATE/DELETE on the frozen campaign audience for EVERY role, including service_role.';

drop trigger if exists trg_vcam_immutable on public.vendor_campaign_audience_members;
create trigger trg_vcam_immutable
  before update or delete on public.vendor_campaign_audience_members
  for each row execute function public.qf_prevent_campaign_audience_mutation();

create or replace function public.qf_prevent_campaign_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'QF-MVP-30.4: vendor_campaign_events is append-only.';
end;
$$;

comment on function public.qf_prevent_campaign_event_mutation() is
  'QF-MVP-30.4: blocks UPDATE/DELETE on the append-only campaign event log for EVERY role.';

drop trigger if exists trg_vce_immutable on public.vendor_campaign_events;
create trigger trg_vce_immutable
  before update or delete on public.vendor_campaign_events
  for each row execute function public.qf_prevent_campaign_event_mutation();

-- Campaign head: protect frozen evidence and the lifecycle itself.
create or replace function public.qf_guard_vendor_campaign_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  -- the revision token is monotonic and never reused.
  if new.revision < old.revision then
    raise exception using errcode = 'P0001',
      message = 'QF-MVP-30.4: campaign revision must never decrease.';
  end if;

  -- only the locked transitions are legal.
  if new.status is distinct from old.status
     and not (
       (old.status = 'draft'            and new.status in ('ready_for_review','cancelled','archived'))
    or (old.status = 'ready_for_review' and new.status in ('draft','approved','cancelled'))
    or (old.status = 'approved'         and new.status in ('cancelled','archived'))
    or (old.status = 'cancelled'        and new.status = 'archived')
     ) then
    raise exception using errcode = 'P0001',
      message = 'QF-MVP-30.4: illegal campaign lifecycle transition.';
  end if;

  -- once approved, the frozen evidence set is immutable.
  if old.status = 'approved' then
    if new.segment_id is distinct from old.segment_id
       or new.template_key is distinct from old.template_key
       or new.template_version is distinct from old.template_version
       or new.prepared_snapshot_id is distinct from old.prepared_snapshot_id
       or new.prepared_snapshot_revision is distinct from old.prepared_snapshot_revision
       or new.prepared_segment_version is distinct from old.prepared_segment_version
       or new.prepared_segment_fingerprint is distinct from old.prepared_segment_fingerprint
       or new.prepared_template_version is distinct from old.prepared_template_version
       or new.prepared_template_category is distinct from old.prepared_template_category
       or new.audience_evaluated_at is distinct from old.audience_evaluated_at
       or new.prepared_recipient_count is distinct from old.prepared_recipient_count
       or new.snapshot_fingerprint is distinct from old.snapshot_fingerprint
       or new.approved_at is distinct from old.approved_at
       or new.approved_by is distinct from old.approved_by then
      raise exception using errcode = 'P0001',
        message = 'QF-MVP-30.4: approved campaign evidence is immutable.',
        hint    = 'Cancel or archive and create a superseding campaign.';
    end if;
  end if;

  -- a return to draft must NOT erase prior evidence; it only clears the live
  -- pointer set, which the prepare RPC repopulates on the next revision.
  return new;
end;
$$;

comment on function public.qf_guard_vendor_campaign_transition() is
  'QF-MVP-30.4: enforces the locked campaign lifecycle, monotonic revisions and post-approval evidence immutability at the database layer.';

drop trigger if exists trg_vcm_transition_guard on public.vendor_campaigns;
create trigger trg_vcm_transition_guard
  before update on public.vendor_campaigns
  for each row execute function public.qf_guard_vendor_campaign_transition();

-- No hard delete of a campaign head: evidence must remain explicable.
create or replace function public.qf_prevent_vendor_campaign_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception using errcode = 'P0001',
    message = 'QF-MVP-30.4: campaigns are archived, never deleted.';
end;
$$;

drop trigger if exists trg_vcm_no_delete on public.vendor_campaigns;
create trigger trg_vcm_no_delete
  before delete on public.vendor_campaigns
  for each row execute function public.qf_prevent_vendor_campaign_delete();


-- ---------------------------------------------------------------------------
-- 7. RLS + least-privilege grants (server-only; service_role bypasses RLS).
-- ---------------------------------------------------------------------------
alter table public.vendor_campaigns                 enable row level security;
alter table public.vendor_campaign_audience_members enable row level security;
alter table public.vendor_campaign_events           enable row level security;

revoke all privileges on table public.vendor_campaigns                 from public, anon, authenticated, service_role;
revoke all privileges on table public.vendor_campaign_audience_members from public, anon, authenticated, service_role;
revoke all privileges on table public.vendor_campaign_events           from public, anon, authenticated, service_role;

-- head: lifecycle by state — no DELETE, no TRUNCATE.
grant select, insert, update on table public.vendor_campaigns to service_role;
-- frozen snapshot + event log: append-only.
grant select, insert on table public.vendor_campaign_audience_members to service_role;
grant select, insert on table public.vendor_campaign_events           to service_role;


-- ---------------------------------------------------------------------------
-- 8. Narrow SECURITY DEFINER RPCs (owner decision 3).
--    No dynamic SQL. No provider call. No communication intent. No Core write.
-- ---------------------------------------------------------------------------

-- 8.1 PREPARE / FREEZE ------------------------------------------------------
create or replace function public.qf_prepare_vendor_campaign_v1(
  p_campaign_id        uuid,
  p_expected_revision  integer,
  p_actor_id           uuid,
  p_segment_version    integer,
  p_segment_fingerprint text,
  p_template_version   text,
  p_template_fingerprint text,
  p_recipients         jsonb,          -- ordered array of {vendor_id, consent_disposition, consent_reason_code, consent_policy_version, suppression_reason}
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
  v_campaign      public.vendor_campaigns%rowtype;
  v_segment       public.vendor_segments%rowtype;
  v_template      public.communication_templates%rowtype;
  v_snapshot_id   uuid;
  v_revision      integer;
  v_count         integer;
  v_distinct      integer;
begin
  if p_campaign_id is null or p_expected_revision is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  if jsonb_typeof(coalesce(p_recipients, 'null'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_RECIPIENTS');
  end if;
  if p_snapshot_fingerprint is null or p_snapshot_fingerprint !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_SNAPSHOT_FINGERPRINT');
  end if;
  if jsonb_typeof(coalesce(p_exclusion_summary, '{}'::jsonb)) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_EXCLUSION_SUMMARY');
  end if;

  select * into v_campaign from public.vendor_campaigns where id = p_campaign_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'CAMPAIGN_NOT_FOUND');
  end if;

  -- deterministic idempotent replay: the same key on an already-prepared
  -- campaign returns the existing snapshot instead of creating a second one.
  if p_idempotency_key is not null
     and v_campaign.idempotency_key is not distinct from p_idempotency_key
     and v_campaign.status = 'ready_for_review'
     and v_campaign.prepared_snapshot_id is not null then
    return jsonb_build_object('ok', true, 'replayed', true,
      'snapshot_id', v_campaign.prepared_snapshot_id,
      'snapshot_revision', v_campaign.prepared_snapshot_revision,
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

  -- segment must exist, be live, and match the evaluated evidence exactly.
  select * into v_segment from public.vendor_segments where id = v_campaign.segment_id;
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

  -- template must exist, be active, not disabled, and satisfy the consent scope.
  select * into v_template from public.communication_templates
   where template_key = v_campaign.template_key;
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

  update public.vendor_campaigns set
    status                        = 'ready_for_review',
    revision                      = revision + 1,
    prepared_snapshot_id          = v_snapshot_id,
    prepared_snapshot_revision    = v_revision,
    prepared_segment_version      = p_segment_version,
    prepared_segment_fingerprint  = p_segment_fingerprint,
    prepared_template_version     = p_template_version,
    prepared_template_fingerprint = p_template_fingerprint,
    prepared_template_category    = v_template.category,
    audience_evaluated_at         = now(),
    prepared_recipient_count      = v_count,
    snapshot_fingerprint          = p_snapshot_fingerprint,
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
  'QF-MVP-30.4: atomically freezes a campaign audience and moves draft -> ready_for_review. Creates no communication intent, calls no provider and writes no Core table. Enforces no frequency policy (none exists — QF-MVP-30.5 gate).';

-- 8.2 APPROVE ---------------------------------------------------------------
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
  v_campaign public.vendor_campaigns%rowtype;
  v_segment  public.vendor_segments%rowtype;
  v_template public.communication_templates%rowtype;
  v_members  integer;
begin
  if p_campaign_id is null or p_expected_revision is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  select * into v_campaign from public.vendor_campaigns where id = p_campaign_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'CAMPAIGN_NOT_FOUND');
  end if;

  -- deterministic idempotent replay.
  if v_campaign.status = 'approved' then
    return jsonb_build_object('ok', true, 'replayed', true, 'revision', v_campaign.revision);
  end if;

  if v_campaign.status <> 'ready_for_review' then
    return jsonb_build_object('ok', false, 'code', 'CAMPAIGN_NOT_READY');
  end if;
  if v_campaign.revision <> p_expected_revision then
    return jsonb_build_object('ok', false, 'code', 'REVISION_MISMATCH');
  end if;

  -- frozen evidence must be complete.
  if v_campaign.prepared_snapshot_id is null
     or v_campaign.prepared_recipient_count is null
     or v_campaign.snapshot_fingerprint is null
     or v_campaign.prepared_segment_fingerprint is null
     or v_campaign.prepared_template_version is null then
    return jsonb_build_object('ok', false, 'code', 'PREPARED_EVIDENCE_INCOMPLETE');
  end if;

  -- the frozen rows must still match the recorded count exactly.
  select count(*) into v_members from public.vendor_campaign_audience_members
   where snapshot_id = v_campaign.prepared_snapshot_id;
  if v_members <> v_campaign.prepared_recipient_count then
    return jsonb_build_object('ok', false, 'code', 'SNAPSHOT_COUNT_MISMATCH');
  end if;

  -- segment must still exist, be live, and match the prepared evidence.
  select * into v_segment from public.vendor_segments where id = v_campaign.segment_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SEGMENT_MISSING');
  end if;
  if v_segment.status = 'archived' then
    return jsonb_build_object('ok', false, 'code', 'SEGMENT_ARCHIVED');
  end if;
  if v_segment.definition_version is distinct from v_campaign.prepared_segment_version
     or v_segment.definition_fingerprint is distinct from v_campaign.prepared_segment_fingerprint then
    return jsonb_build_object('ok', false, 'code', 'SEGMENT_EVIDENCE_MISMATCH');
  end if;

  -- template must still exist, be usable, and match the pinned evidence.
  select * into v_template from public.communication_templates
   where template_key = v_campaign.template_key;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'TEMPLATE_MISSING');
  end if;
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
  'QF-MVP-30.4: authorises an ALREADY-FROZEN audience. It never resolves or alters recipients, creates no communication intent, calls no provider and writes no Core table. Fails closed on any segment/template/snapshot divergence.';

-- RPC execute posture: service_role only.
revoke all on function public.qf_prepare_vendor_campaign_v1(uuid, integer, uuid, integer, text, text, text, jsonb, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text) from public, anon, authenticated;
grant execute on function public.qf_prepare_vendor_campaign_v1(uuid, integer, uuid, integer, text, text, text, jsonb, text, jsonb, text) to service_role;
grant execute on function public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text) to service_role;

revoke all on function public.qf_prevent_campaign_audience_mutation() from public, anon, authenticated;
revoke all on function public.qf_prevent_campaign_event_mutation()    from public, anon, authenticated;
revoke all on function public.qf_guard_vendor_campaign_transition()   from public, anon, authenticated;
revoke all on function public.qf_prevent_vendor_campaign_delete()     from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 9. Self-verification — catalog/privilege facts and zero-row checks only.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_count integer;
  v_bad   text;
begin
  -- 9.1 exactly the three campaign tables exist with RLS enabled.
  select count(*) into v_count
    from unnest(array['public.vendor_campaigns','public.vendor_campaign_audience_members',
      'public.vendor_campaign_events']) s(t)
   where to_regclass(s.t) is not null
     and exists (select 1 from pg_class c where c.oid = to_regclass(s.t) and c.relrowsecurity);
  if v_count <> 3 then
    raise exception 'QF-MVP-30.4A aborted: the three campaign tables are not all present with RLS (found %).', v_count;
  end if;

  -- 9.2 no untrusted-role policy on any campaign table.
  select count(*) into v_count from pg_policies p
   where p.schemaname = 'public'
     and p.tablename in ('vendor_campaigns','vendor_campaign_audience_members','vendor_campaign_events')
     and (p.roles::text[] && array['public','anon','authenticated']);
  if v_count <> 0 then
    raise exception 'QF-MVP-30.4A aborted: an untrusted-role policy exists on a campaign table (%).', v_count;
  end if;

  -- 9.3 untrusted roles hold ZERO privilege.
  if exists (
    select 1 from unnest(array['public.vendor_campaigns','public.vendor_campaign_audience_members',
        'public.vendor_campaign_events']) s(t)
      cross join unnest(array['public','anon','authenticated']) r(role_name)
      cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
     where has_table_privilege(r.role_name, s.t, p.priv)
  ) then
    raise exception 'QF-MVP-30.4A aborted: an untrusted role holds a privilege on a campaign table.';
  end if;

  -- 9.4 service_role: head SIU; snapshot + events SI only; never DELETE/TRUNCATE.
  if not (has_table_privilege('service_role','public.vendor_campaigns','SELECT')
      and has_table_privilege('service_role','public.vendor_campaigns','INSERT')
      and has_table_privilege('service_role','public.vendor_campaigns','UPDATE')) then
    raise exception 'QF-MVP-30.4A aborted: service_role is missing a required vendor_campaigns privilege.';
  end if;
  if exists (
    select 1 from unnest(array['public.vendor_campaigns','public.vendor_campaign_audience_members',
        'public.vendor_campaign_events']) s(t)
      cross join unnest(array['DELETE','TRUNCATE']) p(priv)
     where has_table_privilege('service_role', s.t, p.priv)
  ) then
    raise exception 'QF-MVP-30.4A aborted: service_role must not hold DELETE/TRUNCATE on a campaign table.';
  end if;
  if has_table_privilege('service_role','public.vendor_campaign_audience_members','UPDATE')
     or has_table_privilege('service_role','public.vendor_campaign_events','UPDATE') then
    raise exception 'QF-MVP-30.4A aborted: the frozen snapshot / event log must not be updatable.';
  end if;

  -- 9.5 immutability + lifecycle triggers present.
  select count(*) into v_count from pg_trigger t
   where not t.tgisinternal
     and t.tgname in ('trg_vcam_immutable','trg_vce_immutable','trg_vcm_transition_guard','trg_vcm_no_delete');
  if v_count <> 4 then
    raise exception 'QF-MVP-30.4A aborted: a campaign immutability/lifecycle trigger is missing (found %).', v_count;
  end if;

  -- 9.6 NO plaintext destination / PII column anywhere in the foundation.
  select string_agg(a.attname, ', ') into v_bad
    from pg_attribute a
   where a.attrelid in (to_regclass('public.vendor_campaigns'),
                        to_regclass('public.vendor_campaign_audience_members'),
                        to_regclass('public.vendor_campaign_events'))
     and a.attnum > 0 and not a.attisdropped
     and (a.attname in ('phone','email','whatsapp_number','msisdn','destination','recipient_ref',
                        'to_address','provider_payload','access_token','api_key')
          or a.attname like '%password%' or a.attname like '%secret%');
  if v_bad is not null then
    raise exception 'QF-MVP-30.4A aborted: a destination/secret column exists on the campaign foundation (%).', v_bad;
  end if;

  -- 9.7 NO copied Core truth on the campaign foundation.
  select string_agg(a.attname, ', ') into v_bad
    from pg_attribute a
   where a.attrelid in (to_regclass('public.vendor_campaigns'),
                        to_regclass('public.vendor_campaign_audience_members'))
     and a.attnum > 0 and not a.attisdropped
     and a.attname in ('is_active','verification_status','city','service_categories','areas_covered',
                       'package_id','package_name','credits','total_credits','remaining_credits',
                       'is_eligible','eligibility','frequency_cap','frequency_policy');
  if v_bad is not null then
    raise exception 'QF-MVP-30.4A aborted: campaign foundation duplicates Core truth (%).', v_bad;
  end if;

  -- 9.8 NO provider / delivery / intent / membership object created here.
  if to_regclass('public.vendor_campaign_deliveries') is not null
     or to_regclass('public.vendor_campaign_dispatches') is not null
     or to_regclass('public.vendor_campaign_intents') is not null
     or to_regclass('public.vendor_campaign_providers') is not null
     or to_regclass('public.vendor_segment_memberships') is not null then
    raise exception 'QF-MVP-30.4A aborted: a provider/delivery/intent/membership table exists (out of 30.4 scope).';
  end if;

  -- 9.9 communication_intents is UNCHANGED — aggregate_type must NOT include campaign.
  if exists (
    select 1 from pg_constraint c
     where c.conrelid = to_regclass('public.communication_intents')
       and c.conname = 'communication_intents_aggregate_type_check'
       and pg_get_constraintdef(c.oid) like '%campaign%'
  ) then
    raise exception 'QF-MVP-30.4A aborted: communication_intents.aggregate_type was widened (owner decision 4 forbids this in 30.4).';
  end if;

  -- 9.10 the marketing template category alignment landed, preserving the rest.
  select pg_get_constraintdef(c.oid) into v_bad
    from pg_constraint c
   where c.conrelid = to_regclass('public.communication_templates')
     and c.conname = 'communication_templates_category_check';
  if v_bad is null
     or v_bad not like '%marketing%'
     or v_bad not like '%authentication%'
     or v_bad not like '%business%' then
    raise exception 'QF-MVP-30.4A aborted: communication_templates category alignment is incorrect (%).', coalesce(v_bad, 'missing');
  end if;

  -- 9.11 the RPCs exist and are service_role-only.
  if to_regprocedure('public.qf_prepare_vendor_campaign_v1(uuid, integer, uuid, integer, text, text, text, jsonb, text, jsonb, text)') is null
     or to_regprocedure('public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text)') is null then
    raise exception 'QF-MVP-30.4A aborted: a campaign RPC is missing.';
  end if;
  if has_function_privilege('anon',
       'public.qf_prepare_vendor_campaign_v1(uuid, integer, uuid, integer, text, text, text, jsonb, text, jsonb, text)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text)', 'EXECUTE') then
    raise exception 'QF-MVP-30.4A aborted: an untrusted role may execute a campaign RPC.';
  end if;

  -- 9.12 the segment foundation and the six CRM tables are intact.
  if to_regclass('public.vendor_segments') is null then
    raise exception 'QF-MVP-30.4A aborted: the QF-MVP-30.3 segment foundation is missing.';
  end if;
  select count(*) into v_count
    from unnest(array['public.vendor_crm_profiles','public.vendor_contacts','public.vendor_tags',
      'public.vendor_tag_assignments','public.vendor_tasks','public.vendor_internal_notes']) s(t)
   where to_regclass(s.t) is not null;
  if v_count <> 6 then
    raise exception 'QF-MVP-30.4A aborted: the six CRM foundation tables are not intact (found %).', v_count;
  end if;

  -- 9.13 SCOPE FENCE — Core/Marketplace authority untouched.
  if to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)') is null then
    raise exception 'QF-MVP-30.4A aborted: canonical assignment authority missing.';
  end if;
  if to_regclass('public.vendor_public_v') is null then
    raise exception 'QF-MVP-30.4A aborted: vendor_public_v is missing.';
  end if;
  if exists (
    select 1 from pg_attribute a
     where a.attrelid = to_regclass('public.vendor_public_v')
       and a.attnum > 0 and not a.attisdropped
       and (a.attname like '%campaign%' or a.attname like '%audience%')
  ) then
    raise exception 'QF-MVP-30.4A aborted: vendor_public_v exposes a campaign column.';
  end if;

  -- 9.14 this migration creates no rows.
  select (select count(*) from public.vendor_campaigns)
       + (select count(*) from public.vendor_campaign_audience_members)
       + (select count(*) from public.vendor_campaign_events)
    into v_count;
  if v_count <> 0 then
    raise exception 'QF-MVP-30.4A aborted: the campaign foundation is not empty after a schema-only migration (%).', v_count;
  end if;
end
$verify$;
