-- ============================================================================
-- QF-MVP-30.3A — DETERMINISTIC VENDOR SEGMENT FOUNDATION (SCHEMA/ACL ONLY)
--
-- Forward-only. SCHEMA/ACL ONLY. Backfills no data, deletes no data, alters no
-- Core table, rewrites no applied migration. STAGING FIRST. Generated and
-- reviewed only; application is a separate, separately authorized phase
-- (QF-MVP-30.3B preflight, then apply).
--
-- ---------------------------------------------------------------------------
-- SCOPE (blueprint QF-MVP-30 §8/§20; QF-MVP-30.3 owner decisions LOCKED)
-- ---------------------------------------------------------------------------
-- Establishes EXACTLY ONE capability:
--   1. vendor_segments — deterministic, saved segment DEFINITIONS.
--
-- A segment is a saved QUESTION, never an authorization. A row here stores a
-- canonical rule document plus its version and content fingerprint. It stores
-- NO members, NO recipients and NO eligibility decision.
--
-- NOT created here (owner decision 1): vendor_segment_memberships or any
-- audience-member table, cached membership truth, recipient lists, campaign
-- audience snapshots, provider execution tables, campaigns, campaign/engagement
-- events, Meta/n8n/Jarvis tables, AI scoring, KYC/document storage, owner
-- binding, audit_logs, admin_notifications.
--
-- ---------------------------------------------------------------------------
-- WHY MEMBERSHIP IS NOT PERSISTED
-- ---------------------------------------------------------------------------
-- Every useful predicate reads Core facts that change continuously (credits,
-- is_active, status). A stored membership row is stale the moment Core moves,
-- and a stale row that LOOKS authoritative is the exact failure this boundary
-- forbids. Determinism comes from the canonical rule + fingerprint, not from a
-- stored row. QF-MVP-30.4 owns the single immutable frozen recipient set
-- (vendor_campaign_audiences); creating membership here would establish a second,
-- competing audience authority.
--
-- ---------------------------------------------------------------------------
-- LOCKED AUTHORITY BOUNDARY
-- ---------------------------------------------------------------------------
-- QuickFurno Core stays authoritative for vendor identity, verification,
-- enabled/disabled state, city/service areas, categories, package, credits/
-- ledger, lead/assignment history, consent, suppression, communication
-- authorization and campaign eligibility. This table owns ONLY the rule
-- document and creates NO authoritative copy of any Core fact (§4 prohibited
-- column list, enforced by the offline validator and this self-verification).
--
-- Consent and suppression are deliberately NOT segment inputs: a segment that
-- could read them would begin to look like a send-authorization. Consent and
-- suppression are re-checked by Core at campaign approval time in QF-MVP-30.4.
--
-- ---------------------------------------------------------------------------
-- ACCESS MODEL — A (SERVER-ONLY), identical to the 30.1B foundation
-- ---------------------------------------------------------------------------
-- PUBLIC / anon / authenticated receive ZERO direct privileges; RLS is enabled
-- with no untrusted-role policy (default-deny). service_role — which bypasses
-- RLS — is the only writer, with SELECT + INSERT + UPDATE only. NO role receives
-- DELETE / TRUNCATE / REFERENCES / TRIGGER. Segments are archived by state, never
-- removed: an approved campaign must always be able to name the definition that
-- produced its frozen audience.
--
-- ---------------------------------------------------------------------------
-- HOW AN APPROVED CAMPAIGN AUDIENCE CANNOT SILENTLY CHANGE
-- ---------------------------------------------------------------------------
-- definition_version increases monotonically and definition_fingerprint is the
-- sha256 of the canonical rule JSON. QF-MVP-30.4 records BOTH on the campaign at
-- approval time and freezes the resolved recipients separately. Editing a segment
-- therefore changes the fingerprint, the approved campaign still points at the old
-- one, and execution fails closed on mismatch. A single table is sufficient for
-- that guarantee; a second version-history table would only add a forensic copy of
-- the superseded rule BODY, which no safety property depends on.
--
-- ---------------------------------------------------------------------------
-- MIGRATION-006 DIVERGENCE (explicit)
-- ---------------------------------------------------------------------------
-- The staging baseline omits the whole migration-006 table set: audit_logs and
-- admin_notifications are ABSENT on staging. This migration neither creates nor
-- references them. Provenance is carried by this table's own actor/timestamp
-- columns plus definition_version/definition_fingerprint — the same evidence
-- model QF-MVP-30.2 already uses.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. vendor_segments — deterministic saved segment definitions.
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_segments (
  id                     uuid        not null default gen_random_uuid(),
  name                   text        not null,
  description            text,
  status                 text        not null default 'draft',

  -- the canonical rule document (see lib/crm/segmentRuleContracts.ts)
  schema_version         integer     not null default 1,
  definition             jsonb       not null,
  definition_version     integer     not null default 1,
  definition_fingerprint text        not null,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  archived_at            timestamptz,

  created_by             uuid,
  updated_by             uuid,
  archived_by            uuid,

  constraint vsg_pkey primary key (id),

  -- actor provenance: never CASCADE (losing an admin must not lose the segment).
  constraint vsg_created_by_fk foreign key (created_by)
    references public.profiles (id) on update restrict on delete set null,
  constraint vsg_updated_by_fk foreign key (updated_by)
    references public.profiles (id) on update restrict on delete set null,
  constraint vsg_archived_by_fk foreign key (archived_by)
    references public.profiles (id) on update restrict on delete set null,

  constraint vsg_name_nonempty check (char_length(btrim(name)) > 0),
  constraint vsg_name_len check (char_length(name) <= 120),
  constraint vsg_description_len check (description is null or char_length(description) <= 2000),

  constraint vsg_status_check check (status in ('draft','active','archived')),
  constraint vsg_archived_consistency check ((status = 'archived') = (archived_at is not null)),

  -- MVP rule contract is schema_version 1; a future version bump is an explicit
  -- migration, never an implicit reinterpretation of stored rules.
  constraint vsg_schema_version_check check (schema_version = 1),
  constraint vsg_definition_version_check check (definition_version >= 1),

  -- the rule document is a JSON object, bounded, and never an array/scalar.
  constraint vsg_definition_is_object check (jsonb_typeof(definition) = 'object'),
  -- length(definition::text) — NOT pg_column_size(), which is STABLE (it inspects
  -- the stored/TOASTed representation) and is therefore rejected outright in a
  -- CHECK constraint: "functions in check constraint must be marked IMMUTABLE".
  -- jsonb_out and length() are immutable, so this form is valid and deterministic.
  constraint vsg_definition_size check (length(definition::text) <= 8192),

  -- sha256 hex, lower-case, exactly 64 chars.
  constraint vsg_fingerprint_shape check (definition_fingerprint ~ '^[0-9a-f]{64}$')
);

comment on table public.vendor_segments is
  'QF-MVP-30.3: deterministic saved segment DEFINITIONS. A saved question, never an authorization. Stores no members, no recipients, no eligibility decision. Core stays authoritative for identity/verification/enabled/geo/categories/package/credits/consent/suppression.';
comment on column public.vendor_segments.definition is
  'Canonical deterministic rule AST (schema_version 1). Closed field + operator registry only; no free text, no raw SQL, no PostgREST filter grammar, no PII.';
comment on column public.vendor_segments.definition_fingerprint is
  'sha256 hex of the canonical rule JSON. QF-MVP-30.4 records this at campaign approval; a later edit changes it so execution fails closed instead of silently re-targeting.';
comment on column public.vendor_segments.definition_version is
  'Monotonic revision of this segment definition. Increases on every definition change; never reused, never decremented.';
comment on column public.vendor_segments.status is
  'draft | active | archived. Archive-only lifecycle: rows are never deleted so an approved campaign can always name its origin.';


-- ---------------------------------------------------------------------------
-- 2. Deterministic indexes.
-- ---------------------------------------------------------------------------
-- one live segment per case-insensitive name; archived names are reusable.
create unique index if not exists uq_vendor_segments_live_name
  on public.vendor_segments (lower(btrim(name)))
  where status <> 'archived';

-- bounded, deterministically ordered admin listing.
create index if not exists ix_vendor_segments_status_updated
  on public.vendor_segments (status, updated_at desc, id);

-- duplicate-definition detection (same population saved twice under two names).
create index if not exists ix_vendor_segments_fingerprint
  on public.vendor_segments (definition_fingerprint);


-- ---------------------------------------------------------------------------
-- 3. updated_at maintenance (reuses the 30.1B shared helper).
-- ---------------------------------------------------------------------------
drop trigger if exists trg_vsg_touch on public.vendor_segments;
create trigger trg_vsg_touch before update on public.vendor_segments
  for each row execute function public.qf_crm_touch_updated_at();


-- ---------------------------------------------------------------------------
-- 4. RLS + least-privilege grants (server-only; service_role bypasses RLS).
-- ---------------------------------------------------------------------------
alter table public.vendor_segments enable row level security;

-- untrusted roles: ZERO privilege (deterministic reset, then a minimal grant).
revoke all privileges on table public.vendor_segments from public, anon, authenticated, service_role;

-- lifecycle table: archive via state — no DELETE, no TRUNCATE, no REFERENCES/TRIGGER.
grant select, insert, update on table public.vendor_segments to service_role;


-- ---------------------------------------------------------------------------
-- 5. Self-verification — catalog facts only, no data read, no mutation.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_count integer;
  v_bad   text;
begin
  -- 5.1 the table exists with RLS enabled.
  if to_regclass('public.vendor_segments') is null then
    raise exception 'QF-MVP-30.3A aborted: public.vendor_segments is missing.';
  end if;
  if not exists (
    select 1 from pg_class c
     where c.oid = to_regclass('public.vendor_segments') and c.relrowsecurity
  ) then
    raise exception 'QF-MVP-30.3A aborted: RLS is not enabled on vendor_segments.';
  end if;

  -- 5.2 no policy exists for an untrusted role (default-deny must hold).
  select count(*) into v_count
    from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'vendor_segments'
     and (p.roles::text[] && array['public','anon','authenticated']);
  if v_count <> 0 then
    raise exception 'QF-MVP-30.3A aborted: an untrusted-role policy exists on vendor_segments (%).', v_count;
  end if;

  -- 5.3 untrusted roles hold ZERO privilege.
  if exists (
    select 1 from unnest(array['public','anon','authenticated']) r(role_name)
      cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
     where has_table_privilege(r.role_name, 'public.vendor_segments', p.priv)
  ) then
    raise exception 'QF-MVP-30.3A aborted: an untrusted role holds a privilege on vendor_segments.';
  end if;

  -- 5.4 service_role holds exactly SELECT+INSERT+UPDATE — never DELETE/TRUNCATE.
  if not (has_table_privilege('service_role','public.vendor_segments','SELECT')
      and has_table_privilege('service_role','public.vendor_segments','INSERT')
      and has_table_privilege('service_role','public.vendor_segments','UPDATE')) then
    raise exception 'QF-MVP-30.3A aborted: service_role is missing a required vendor_segments privilege.';
  end if;
  if has_table_privilege('service_role','public.vendor_segments','DELETE')
     or has_table_privilege('service_role','public.vendor_segments','TRUNCATE') then
    raise exception 'QF-MVP-30.3A aborted: service_role must not hold DELETE/TRUNCATE on vendor_segments.';
  end if;

  -- 5.5 NO membership / campaign / audience / provider object was created here.
  if to_regclass('public.vendor_segment_memberships') is not null
     or to_regclass('public.vendor_segment_members') is not null
     or to_regclass('public.vendor_campaigns') is not null
     or to_regclass('public.vendor_campaign_audiences') is not null
     or to_regclass('public.vendor_campaign_events') is not null
     or to_regclass('public.vendor_engagement_events') is not null then
    raise exception 'QF-MVP-30.3A aborted: a membership/campaign/audience table exists (out of 30.3 scope).';
  end if;

  -- 5.6 NO authoritative Core copy on vendor_segments.
  select string_agg(a.attname, ', ') into v_bad
    from pg_attribute a
   where a.attrelid = to_regclass('public.vendor_segments')
     and a.attnum > 0 and not a.attisdropped
     and (a.attname = any (array[
       'vendor_id','verification_status','is_active','enabled','city','service_categories',
       'areas_covered','package_id','package_name','package_status','credits','total_credits',
       'remaining_credits','eligibility','is_eligible','consent','consent_status','is_suppressed',
       'suppression','suppressed','communication_authorization','member_count','members',
       'recipient_count','recipients','approved_audience'
     ]::text[]));
  if v_bad is not null then
    raise exception 'QF-MVP-30.3A aborted: vendor_segments duplicates Core truth or stores membership (%).', v_bad;
  end if;

  -- 5.7 the six 30.1B CRM foundation tables are untouched and still present.
  select count(*) into v_count
    from unnest(array['public.vendor_crm_profiles','public.vendor_contacts','public.vendor_tags',
      'public.vendor_tag_assignments','public.vendor_tasks','public.vendor_internal_notes']) s(t)
   where to_regclass(s.t) is not null;
  if v_count <> 6 then
    raise exception 'QF-MVP-30.3A aborted: the six CRM foundation tables are not intact (found %).', v_count;
  end if;

  -- 5.8 SCOPE FENCE — Core/Marketplace authority untouched.
  if to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)') is null then
    raise exception 'QF-MVP-30.3A aborted: canonical assignment authority missing.';
  end if;
  if to_regclass('public.vendor_public_v') is null then
    raise exception 'QF-MVP-30.3A aborted: vendor_public_v is missing.';
  end if;

  -- 5.9 the public projection must not expose any segment column.
  if exists (
    select 1 from pg_attribute a
     where a.attrelid = to_regclass('public.vendor_public_v')
       and a.attnum > 0 and not a.attisdropped
       and (a.attname like '%segment%' or a.attname like '%definition%')
  ) then
    raise exception 'QF-MVP-30.3A aborted: vendor_public_v exposes a segment column.';
  end if;

  -- 5.10 this migration creates no rows.
  select count(*) into v_count from public.vendor_segments;
  if v_count <> 0 then
    raise exception 'QF-MVP-30.3A aborted: vendor_segments is not empty after a schema-only migration (%).', v_count;
  end if;
end
$verify$;
