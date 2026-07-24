-- ============================================================================
-- QF-MVP-30.1B — VENDOR CRM V1 FOUNDATION (SCHEMA/ACL ONLY)
--
-- Forward-only. SCHEMA/ACL ONLY. Backfills no Core data, deletes no data,
-- rewrites no note content. STAGING FIRST. Generated and reviewed only;
-- application is a separate, separately authorized phase (preflight, then apply).
--
-- ---------------------------------------------------------------------------
-- SCOPE (blueprint QF-MVP-30, §4/§7; refinements #1-#6 LOCKED)
-- ---------------------------------------------------------------------------
-- Establishes ONLY the six Vendor CRM foundation capabilities:
--   1. vendor_crm_profiles      — 1:1 CRM relationship/enrichment extension
--   2. vendor_contacts          — private decision-maker contacts (PII)
--   3. vendor_tags              — normalized tag catalog
--   4. vendor_tag_assignments   — vendor <-> tag (active-assignment uniqueness)
--   5. vendor_internal_notes    — CANONICAL notes authority (evolved in place)
--   6. vendor_tasks             — follow-up / onboarding / renewal tasks
--
-- NOT created here: segments, campaigns, audiences, campaign/engagement events,
-- Meta/n8n/Jarvis tables, AI scoring, KYC/document storage, owner binding.
--
-- ---------------------------------------------------------------------------
-- LOCKED AUTHORITY BOUNDARY
-- ---------------------------------------------------------------------------
-- QuickFurno Core stays authoritative for vendor identity, verification,
-- enabled/disabled state, city/service areas, categories, package, credits/
-- ledger, lead/assignment history, consent, suppression, communication
-- authorization and campaign eligibility. This foundation owns ONLY relationship
-- extensions and creates NO authoritative copy of any Core fact (§9 prohibited
-- column list; enforced by the offline validator and this self-verification).
--
-- ---------------------------------------------------------------------------
-- ACCESS MODEL — A (SERVER-ONLY)
-- ---------------------------------------------------------------------------
-- Admin CRM access runs through authorized server code using service_role (the
-- existing adminClient pattern). PUBLIC / anon / authenticated (generic and
-- vendor-self) receive ZERO direct privileges on every CRM table; RLS is enabled
-- with no untrusted-role policy (default-deny), and service_role — which bypasses
-- RLS — is the only writer, with a table-specific minimal grant. No role receives
-- DELETE / TRUNCATE / REFERENCES / TRIGGER / MAINTAIN. The service-role key never
-- reaches the browser, Jarvis or n8n.
--
-- ---------------------------------------------------------------------------
-- HISTORY PRESERVATION (refinements #1, #2, #6)
-- ---------------------------------------------------------------------------
-- Every CRM-record -> Core-vendor FK is ON DELETE RESTRICT (a vendor with CRM
-- history cannot be silently erased; vendors are soft-deleted by status anyway).
-- Every actor FK -> profiles is ON DELETE SET NULL (removing an admin never
-- erases CRM history). No application role may DELETE/TRUNCATE any CRM row;
-- notes are append-only; tags/assignments/tasks/contacts archive via state.
--
-- ---------------------------------------------------------------------------
-- CANONICAL NOTES DECISION (refinement #3) — SINGLE AUTHORITY, PRESENCE-IDEMPOTENT
-- ---------------------------------------------------------------------------
-- public.vendor_internal_notes is the SINGLE canonical Vendor CRM notes authority
-- (migration 20260621000006: id/created_at/vendor_id/note/created_by + RLS + a
-- legacy "vendor notes admin all" authenticated policy; ZERO runtime readers/
-- writers/types). HOWEVER the staging baseline squash (20260722000100_..269c9265)
-- OMITS the whole migration-006 table set, so the table is ABSENT on staging but
-- PRESENT (minimal shape) on production. Section 5 is therefore a TWO-PATH
-- BOOTSTRAP: CREATE the legacy-equivalent base shape when absent (staging), else a
-- no-op (production), then converge BOTH paths losslessly to ONE exact final
-- contract (add category + supersession + NOT-VALID required/format checks,
-- retarget the vendor FK to RESTRICT, keep created_by SET NULL, drop the legacy
-- policy, add append-only immutability). No second `vendor_notes` table; no note
-- row is created, deleted or rewritten; existing production rows are preserved.
-- Rejected alternative: a new vendor_notes table — it would leave a competing
-- writable notes path.
-- No explicit transaction control, no ALTER DEFAULT PRIVILEGES, no broad schema
-- grant, no migration-history write, no project ref/secret.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. Shared helpers.
-- ---------------------------------------------------------------------------
create or replace function public.qf_crm_touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.qf_crm_touch_updated_at() is
  'QF-MVP-30.1B: maintains updated_at on Vendor CRM lifecycle tables (profile/contacts/tags/tasks).';


-- ---------------------------------------------------------------------------
-- 1. vendor_crm_profiles — one CRM extension row per vendor (no Core copies).
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_crm_profiles (
  vendor_id                   uuid        not null,
  onboarding_stage            text        not null default 'new',
  relationship_status         text        not null default 'prospect',
  account_manager_profile_id  uuid,
  next_follow_up_at           timestamptz,
  last_interaction_at         timestamptz,
  inactive_reason             text,
  company_type                text,
  years_in_business           integer,
  team_size                   text,
  capability_notes            text,
  residential_commercial_scope text,
  budget_band                 text,
  monthly_capacity_notes      text,
  material_notes              text,
  warranty_notes              text,
  preferred_localities        text[]      not null default '{}',
  excluded_localities         text[]      not null default '{}',
  travel_radius_km            integer,
  campaign_notes              text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  created_by                  uuid,
  updated_by                  uuid,

  constraint vcp_pkey primary key (vendor_id),
  constraint vcp_vendor_fk foreign key (vendor_id)
    references public.vendors (id) on update restrict on delete restrict,
  constraint vcp_account_manager_fk foreign key (account_manager_profile_id)
    references public.profiles (id) on update restrict on delete set null,
  constraint vcp_created_by_fk foreign key (created_by)
    references public.profiles (id) on update restrict on delete set null,
  constraint vcp_updated_by_fk foreign key (updated_by)
    references public.profiles (id) on update restrict on delete set null,
  constraint vcp_onboarding_stage_check check (onboarding_stage in
    ('new','contacted','onboarding','active','dormant','churned')),
  constraint vcp_relationship_status_check check (relationship_status in
    ('prospect','active','at_risk','inactive','blacklisted')),
  constraint vcp_res_com_scope_check check (residential_commercial_scope is null
    or residential_commercial_scope in ('residential','commercial','both')),
  constraint vcp_years_nonneg check (years_in_business is null or years_in_business >= 0),
  constraint vcp_travel_nonneg check (travel_radius_km is null or travel_radius_km >= 0)
);

comment on table public.vendor_crm_profiles is
  'QF-MVP-30.1B Vendor CRM extension (1 per vendor). Relationship/enrichment only — NO authoritative Core facts (verification/enabled/city/service-area/categories/package/credits/eligibility/consent/suppression). Server-only (service_role); RLS default-deny for untrusted roles.';


-- ---------------------------------------------------------------------------
-- 2. vendor_contacts — private decision-maker contacts (PII, never public).
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_contacts (
  id                uuid        not null default gen_random_uuid(),
  vendor_id         uuid        not null,
  name              text        not null,
  role_title        text,
  phone             text,
  email             text,
  preferred_channel text,
  is_primary        boolean     not null default false,
  is_active         boolean     not null default true,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,

  constraint vco_pkey primary key (id),
  constraint vco_vendor_fk foreign key (vendor_id)
    references public.vendors (id) on update restrict on delete restrict,
  constraint vco_created_by_fk foreign key (created_by)
    references public.profiles (id) on update restrict on delete set null,
  constraint vco_updated_by_fk foreign key (updated_by)
    references public.profiles (id) on update restrict on delete set null,
  constraint vco_name_nonempty check (char_length(btrim(name)) > 0),
  constraint vco_channel_check check (preferred_channel is null
    or preferred_channel in ('phone','whatsapp','email')),
  -- A CRM contact record is enrichment only; it does NOT grant communication
  -- consent (Core owns consent/suppression). No consent field is stored here.
  constraint vco_contactable check (phone is not null or email is not null)
);

-- one ACTIVE primary contact per vendor (partial unique; nullable-safe).
create unique index if not exists uq_vendor_contacts_active_primary
  on public.vendor_contacts (vendor_id) where is_primary and is_active;
-- de-dup active contacts by normalized phone (only where phone present).
create unique index if not exists uq_vendor_contacts_active_phone
  on public.vendor_contacts (vendor_id, lower(btrim(phone)))
  where is_active and phone is not null;
create index if not exists idx_vendor_contacts_vendor on public.vendor_contacts (vendor_id);

comment on table public.vendor_contacts is
  'QF-MVP-30.1B private Vendor CRM contacts (PII). Never public, never on vendor_public_v. A contact field never grants consent — Core owns consent/suppression.';


-- ---------------------------------------------------------------------------
-- 3. vendor_tags — normalized tag catalog.
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_tags (
  id               uuid        not null default gen_random_uuid(),
  name             text        not null,
  normalized_name  text        not null,
  description      text,
  is_active        boolean     not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,

  constraint vtg_pkey primary key (id),
  constraint vtg_created_by_fk foreign key (created_by)
    references public.profiles (id) on update restrict on delete set null,
  constraint vtg_name_nonempty check (char_length(btrim(name)) > 0),
  constraint vtg_normalized_nonempty check (char_length(btrim(normalized_name)) > 0),
  constraint vtg_normalized_unique unique (normalized_name)
);

comment on table public.vendor_tags is
  'QF-MVP-30.1B normalized Vendor CRM tag catalog; normalized_name is unique. Archive via is_active — no hard delete.';


-- ---------------------------------------------------------------------------
-- 4. vendor_tag_assignments — vendor <-> tag (active-assignment uniqueness).
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_tag_assignments (
  id           uuid        not null default gen_random_uuid(),
  vendor_id    uuid        not null,
  tag_id       uuid        not null,
  assigned_by  uuid,
  assigned_at  timestamptz not null default now(),
  removed_by   uuid,
  removed_at   timestamptz,

  constraint vta_pkey primary key (id),
  constraint vta_vendor_fk foreign key (vendor_id)
    references public.vendors (id) on update restrict on delete restrict,
  constraint vta_tag_fk foreign key (tag_id)
    references public.vendor_tags (id) on update restrict on delete restrict,
  constraint vta_assigned_by_fk foreign key (assigned_by)
    references public.profiles (id) on update restrict on delete set null,
  constraint vta_removed_by_fk foreign key (removed_by)
    references public.profiles (id) on update restrict on delete set null,
  constraint vta_removed_consistency check ((removed_at is null) = (removed_by is null))
);

-- exactly one ACTIVE (not-removed) assignment per (vendor, tag).
create unique index if not exists uq_vendor_tag_active
  on public.vendor_tag_assignments (vendor_id, tag_id) where removed_at is null;
create index if not exists idx_vendor_tag_assignments_vendor on public.vendor_tag_assignments (vendor_id);
create index if not exists idx_vendor_tag_assignments_tag on public.vendor_tag_assignments (tag_id);

comment on table public.vendor_tag_assignments is
  'QF-MVP-30.1B Vendor CRM tag assignments. Remove by setting removed_at/removed_by (archive) — no hard delete; one active assignment per (vendor,tag).';


-- ---------------------------------------------------------------------------
-- 5. vendor_internal_notes — CANONICAL notes authority (PRESENCE-IDEMPOTENT).
--
--    TWO-PATH BOOTSTRAP. The staging baseline squash (20260722000100_..269c9265)
--    OMITS the whole migration-006 table set, so vendor_internal_notes is ABSENT
--    on staging but PRESENT (minimal 006 shape) on production. Both paths converge
--    to ONE exact final contract. No second notes table; no note row is created,
--    deleted or rewritten.
--
--      Path A (ABSENT — staging): the CREATE below builds the legacy-equivalent
--        base shape; the shared convergence then adds the CRM columns, retargets
--        the FKs, adds the checks, drops the legacy policy, grants and triggers.
--      Path B (LEGACY_MINIMAL present — production): CREATE TABLE IF NOT EXISTS is
--        a no-op; ALL rows/ids/timestamps/body/author/vendor are preserved; the
--        shared convergence adds the same CRM columns and retargets the same
--        constraints, ending at the identical final contract.
--
--    Legacy-compatible base shape (matches 20260621000006 exactly, so the CREATE
--    is a true no-op on production): id uuid pk / created_at timestamptz default
--    now() / vendor_id uuid / note text not null / created_by uuid. Required-ness
--    is enforced going forward via NOT VALID checks so no legacy row is rejected.
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_internal_notes (
  id         uuid        default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  vendor_id  uuid,
  note       text        not null,
  created_by uuid
);

-- CONVERGE (identical on both paths): CRM columns.
alter table public.vendor_internal_notes add column if not exists category           text;
alter table public.vendor_internal_notes add column if not exists supersedes_note_id  uuid;

-- Required/format contracts as NOT VALID: enforced for NEW notes; existing legacy
-- rows are never validated, rejected or rewritten (append-only is preserved).
alter table public.vendor_internal_notes drop constraint if exists vin_note_nonempty;
alter table public.vendor_internal_notes add constraint vin_note_nonempty
  check (char_length(btrim(note)) > 0) not valid;
alter table public.vendor_internal_notes drop constraint if exists vin_vendor_required;
alter table public.vendor_internal_notes add constraint vin_vendor_required
  check (vendor_id is not null) not valid;
alter table public.vendor_internal_notes drop constraint if exists vin_category_check;
alter table public.vendor_internal_notes add constraint vin_category_check
  check (category is null or category in
    ('general','call','meeting','onboarding','support','payment','complaint','campaign')) not valid;

-- FK convergence. drop-if-exists covers BOTH the legacy auto-named constraints
-- (…_vendor_id_fkey CASCADE, …_created_by_fkey SET NULL) and any re-run, so both
-- paths end with exactly: vendor RESTRICT, created_by SET NULL, self-FK RESTRICT.
alter table public.vendor_internal_notes drop constraint if exists vendor_internal_notes_vendor_id_fkey;
alter table public.vendor_internal_notes drop constraint if exists vin_vendor_fk;
alter table public.vendor_internal_notes add constraint vin_vendor_fk foreign key (vendor_id)
  references public.vendors (id) on update restrict on delete restrict;

alter table public.vendor_internal_notes drop constraint if exists vendor_internal_notes_created_by_fkey;
alter table public.vendor_internal_notes drop constraint if exists vin_created_by_fk;
alter table public.vendor_internal_notes add constraint vin_created_by_fk foreign key (created_by)
  references public.profiles (id) on update restrict on delete set null;

alter table public.vendor_internal_notes drop constraint if exists vin_supersedes_fk;
alter table public.vendor_internal_notes add constraint vin_supersedes_fk foreign key (supersedes_note_id)
  references public.vendor_internal_notes (id) on update restrict on delete restrict;
alter table public.vendor_internal_notes drop constraint if exists vin_no_self_supersede;
alter table public.vendor_internal_notes add constraint vin_no_self_supersede
  check (supersedes_note_id is null or supersedes_note_id <> id);

-- server-only model: drop the legacy authenticated-facing policy (no-op when the
-- table was just created on the absent path).
drop policy if exists "vendor notes admin all" on public.vendor_internal_notes;

create index if not exists idx_vendor_internal_notes_vendor on public.vendor_internal_notes (vendor_id, created_at desc);

comment on table public.vendor_internal_notes is
  'QF-MVP-30.1B CANONICAL Vendor CRM notes authority (presence-idempotent: created if absent on staging, evolved losslessly if the legacy 006 minimal table exists on production; both paths converge to one contract). Append-only (UPDATE/DELETE/TRUNCATE blocked for every role); private (server-only); corrections are NEW notes via supersedes_note_id. Body column = note.';


-- ---------------------------------------------------------------------------
-- 6. vendor_tasks — follow-up / onboarding / renewal tasks.
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_tasks (
  id                 uuid        not null default gen_random_uuid(),
  vendor_id          uuid        not null,
  task_type          text        not null,
  title              text        not null,
  description        text,
  owner_profile_id   uuid,
  due_at             timestamptz,
  priority           text        not null default 'medium',
  status             text        not null default 'open',
  completion_result  text,
  source             text        not null default 'manual',
  idempotency_key    text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  completed_at       timestamptz,
  created_by         uuid,
  updated_by         uuid,

  constraint vtk_pkey primary key (id),
  constraint vtk_vendor_fk foreign key (vendor_id)
    references public.vendors (id) on update restrict on delete restrict,
  constraint vtk_owner_fk foreign key (owner_profile_id)
    references public.profiles (id) on update restrict on delete set null,
  constraint vtk_created_by_fk foreign key (created_by)
    references public.profiles (id) on update restrict on delete set null,
  constraint vtk_updated_by_fk foreign key (updated_by)
    references public.profiles (id) on update restrict on delete set null,
  constraint vtk_title_nonempty check (char_length(btrim(title)) > 0),
  constraint vtk_type_check check (task_type in
    ('onboarding','documents','verification','package_renewal','low_credit',
     'inactivity','complaint','campaign_response_followup','general')),
  constraint vtk_priority_check check (priority in ('low','medium','high','urgent')),
  constraint vtk_status_check check (status in ('open','in_progress','blocked','done','cancelled')),
  constraint vtk_source_check check (source in ('manual','suggested','system')),
  constraint vtk_completed_consistency check ((status = 'done') = (completed_at is not null))
);

-- idempotency for later automation-suggested tasks (nullable-safe: only enforced
-- where a key is supplied). Jarvis cannot insert directly — suggestions arrive
-- through Core/admin server code (source='suggested').
create unique index if not exists uq_vendor_tasks_idempotency
  on public.vendor_tasks (idempotency_key) where idempotency_key is not null;
create index if not exists idx_vendor_tasks_vendor on public.vendor_tasks (vendor_id, status);
create index if not exists idx_vendor_tasks_due on public.vendor_tasks (due_at) where status in ('open','in_progress');

comment on table public.vendor_tasks is
  'QF-MVP-30.1B Vendor CRM tasks. Archive via status (cancelled) — no hard delete. Automation may later create source=suggested tasks through Core/admin code (idempotency_key), never a direct Jarvis write.';


-- ---------------------------------------------------------------------------
-- 7. RLS + least-privilege grants (server-only; service_role bypasses RLS).
-- ---------------------------------------------------------------------------
alter table public.vendor_crm_profiles      enable row level security;
alter table public.vendor_contacts          enable row level security;
alter table public.vendor_tags              enable row level security;
alter table public.vendor_tag_assignments   enable row level security;
alter table public.vendor_tasks             enable row level security;
-- vendor_internal_notes RLS is already enabled (20260621000006); re-assert.
alter table public.vendor_internal_notes    enable row level security;

-- untrusted roles: ZERO privilege on every foundation table (deterministic reset).
revoke all privileges on table public.vendor_crm_profiles    from public, anon, authenticated, service_role;
revoke all privileges on table public.vendor_contacts        from public, anon, authenticated, service_role;
revoke all privileges on table public.vendor_tags            from public, anon, authenticated, service_role;
revoke all privileges on table public.vendor_tag_assignments from public, anon, authenticated, service_role;
revoke all privileges on table public.vendor_tasks           from public, anon, authenticated, service_role;
revoke all privileges on table public.vendor_internal_notes  from public, anon, authenticated, service_role;

-- notes are append-only: service_role SELECT + INSERT only (no UPDATE/DELETE).
grant select, insert on table public.vendor_internal_notes to service_role;

-- lifecycle tables: service_role SELECT + INSERT + UPDATE (archive via state; no DELETE/TRUNCATE).
grant select, insert, update on table public.vendor_crm_profiles    to service_role;
grant select, insert, update on table public.vendor_contacts        to service_role;
grant select, insert, update on table public.vendor_tags            to service_role;
grant select, insert, update on table public.vendor_tag_assignments to service_role;
grant select, insert, update on table public.vendor_tasks           to service_role;


-- ---------------------------------------------------------------------------
-- 8. Immutability — notes are append-only for EVERY role (incl. service_role).
-- ---------------------------------------------------------------------------
create or replace function public.qf_prevent_vendor_note_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'QF_VENDOR_NOTE_IMMUTABLE',
    detail  = 'vendor_internal_notes is append-only: UPDATE and DELETE are never permitted. A correction is a NEW note via supersedes_note_id.';
  return null;
end;
$$;

create or replace function public.qf_prevent_vendor_note_truncate()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'QF_VENDOR_NOTE_TRUNCATE_FORBIDDEN',
    detail  = 'vendor_internal_notes is append-only: TRUNCATE is never permitted.';
  return null;
end;
$$;

drop trigger if exists trg_vin_immutable on public.vendor_internal_notes;
create trigger trg_vin_immutable
  before update or delete on public.vendor_internal_notes
  for each row execute function public.qf_prevent_vendor_note_mutation();

drop trigger if exists trg_vin_no_truncate on public.vendor_internal_notes;
create trigger trg_vin_no_truncate
  before truncate on public.vendor_internal_notes
  for each statement execute function public.qf_prevent_vendor_note_truncate();

revoke all on function public.qf_prevent_vendor_note_mutation() from public, anon, authenticated;
revoke all on function public.qf_prevent_vendor_note_truncate() from public, anon, authenticated;
revoke all on function public.qf_crm_touch_updated_at() from public, anon, authenticated;

-- updated_at maintenance on the lifecycle tables.
drop trigger if exists trg_vcp_touch on public.vendor_crm_profiles;
create trigger trg_vcp_touch before update on public.vendor_crm_profiles
  for each row execute function public.qf_crm_touch_updated_at();
drop trigger if exists trg_vco_touch on public.vendor_contacts;
create trigger trg_vco_touch before update on public.vendor_contacts
  for each row execute function public.qf_crm_touch_updated_at();
drop trigger if exists trg_vtg_touch on public.vendor_tags;
create trigger trg_vtg_touch before update on public.vendor_tags
  for each row execute function public.qf_crm_touch_updated_at();
drop trigger if exists trg_vtk_touch on public.vendor_tasks;
create trigger trg_vtk_touch before update on public.vendor_tasks
  for each row execute function public.qf_crm_touch_updated_at();


-- ---------------------------------------------------------------------------
-- 9. Self-verification — fail closed on any deviation. CATALOG FACTS ONLY
--    (no pg_get_functiondef()/prosrc lexical assertion; names compared as text).
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_missing text;
  v_count   integer;
  v_bad     text;
begin
  -- 9.1 all six foundation tables exist with RLS enabled.
  for v_missing in
    select t from unnest(array[
      'public.vendor_crm_profiles','public.vendor_contacts','public.vendor_tags',
      'public.vendor_tag_assignments','public.vendor_tasks','public.vendor_internal_notes']) s(t)
    where to_regclass(s.t) is null
       or not exists (select 1 from pg_class c where c.oid = to_regclass(s.t) and c.relrowsecurity)
  loop
    raise exception 'QF-MVP-30.1B aborted: foundation table % missing or RLS disabled.', v_missing;
  end loop;

  -- 9.2 canonical notes authority is the SOLE notes table: no rival vendor_notes.
  if to_regclass('public.vendor_notes') is not null then
    raise exception 'QF-MVP-30.1B aborted: a rival public.vendor_notes table exists (two writable notes authorities).';
  end if;

  -- 9.3 notes append-only triggers present (UPDATE|DELETE row + TRUNCATE stmt).
  select count(*) into v_count from pg_trigger t
   where t.tgrelid = to_regclass('public.vendor_internal_notes') and not t.tgisinternal
     and t.tgname::text in ('trg_vin_immutable','trg_vin_no_truncate');
  if v_count <> 2 then
    raise exception 'QF-MVP-30.1B aborted: vendor_internal_notes append-only triggers missing (found %).', v_count;
  end if;

  -- 9.4 untrusted roles hold ZERO privilege on every foundation table.
  if exists (
    select 1 from unnest(array[
      'public.vendor_crm_profiles','public.vendor_contacts','public.vendor_tags',
      'public.vendor_tag_assignments','public.vendor_tasks','public.vendor_internal_notes']) s(t)
      cross join unnest(array['public','anon','authenticated']) r(role_name)
      cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
     where has_table_privilege(r.role_name, to_regclass(s.t), p.priv)
  ) then
    raise exception 'QF-MVP-30.1B aborted: an untrusted role holds a privilege on a foundation table.';
  end if;

  -- 9.5 service_role: notes = SELECT+INSERT only; lifecycle = SELECT+INSERT+UPDATE;
  --     and NEVER DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN on any of them.
  if not (has_table_privilege('service_role', to_regclass('public.vendor_internal_notes'),'SELECT')
          and has_table_privilege('service_role', to_regclass('public.vendor_internal_notes'),'INSERT')) then
    raise exception 'QF-MVP-30.1B aborted: service_role lost SELECT/INSERT on the notes authority.';
  end if;
  if has_table_privilege('service_role', to_regclass('public.vendor_internal_notes'),'UPDATE')
     or has_table_privilege('service_role', to_regclass('public.vendor_internal_notes'),'DELETE') then
    raise exception 'QF-MVP-30.1B aborted: service_role can mutate the append-only notes authority.';
  end if;
  for v_missing in
    select t from unnest(array[
      'public.vendor_crm_profiles','public.vendor_contacts','public.vendor_tags',
      'public.vendor_tag_assignments','public.vendor_tasks']) s(t)
    where not (has_table_privilege('service_role', to_regclass(s.t),'SELECT')
               and has_table_privilege('service_role', to_regclass(s.t),'INSERT')
               and has_table_privilege('service_role', to_regclass(s.t),'UPDATE'))
  loop
    raise exception 'QF-MVP-30.1B aborted: service_role lacks SELECT/INSERT/UPDATE on %.', v_missing;
  end loop;
  if exists (
    select 1 from unnest(array[
      'public.vendor_crm_profiles','public.vendor_contacts','public.vendor_tags',
      'public.vendor_tag_assignments','public.vendor_tasks','public.vendor_internal_notes']) s(t)
      cross join unnest(array['DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
     where has_table_privilege('service_role', to_regclass(s.t), p.priv)
  ) then
    raise exception 'QF-MVP-30.1B aborted: service_role holds DELETE/TRUNCATE/REFERENCES/TRIGGER on a CRM table.';
  end if;

  -- 9.6 evidence-preserving vendor FKs: every CRM->vendors FK is RESTRICT/NO ACTION.
  if exists (
    select 1 from pg_constraint con
     where con.contype = 'f' and con.confrelid = to_regclass('public.vendors')
       and con.conrelid in (
         to_regclass('public.vendor_crm_profiles'), to_regclass('public.vendor_contacts'),
         to_regclass('public.vendor_tag_assignments'), to_regclass('public.vendor_tasks'),
         to_regclass('public.vendor_internal_notes'))
       and con.confdeltype not in ('r','a')      -- r=RESTRICT, a=NO ACTION
  ) then
    raise exception 'QF-MVP-30.1B aborted: a CRM->vendors FK is not RESTRICT/NO ACTION (history-loss risk).';
  end if;

  -- 9.6b canonical notes FINAL contract — proven from live catalog facts, so it
  --      holds whether the table was bootstrapped (absent path) or evolved
  --      (legacy-minimal path). Does NOT assume the table pre-existed.
  --      exact column set:
  if (select array_agg(a.attname::text order by a.attname::text) from pg_attribute a
        where a.attrelid = to_regclass('public.vendor_internal_notes') and a.attnum > 0 and not a.attisdropped)
     is distinct from
     (select array_agg(x order by x) from unnest(array[
        'category','created_at','created_by','id','note','supersedes_note_id','vendor_id']::text[]) x)
  then
    raise exception 'QF-MVP-30.1B aborted: vendor_internal_notes final column set is not the exact contract.';
  end if;
  --      primary key present:
  if not exists (select 1 from pg_constraint con
                  where con.conrelid = to_regclass('public.vendor_internal_notes') and con.contype = 'p') then
    raise exception 'QF-MVP-30.1B aborted: vendor_internal_notes has no primary key.';
  end if;
  --      created_by actor FK is SET NULL (n); self-supersede FK is RESTRICT/NO ACTION.
  if not exists (select 1 from pg_constraint con
                  where con.conrelid = to_regclass('public.vendor_internal_notes') and con.contype = 'f'
                    and con.confrelid = to_regclass('public.profiles') and con.confdeltype = 'n') then
    raise exception 'QF-MVP-30.1B aborted: vendor_internal_notes created_by FK is not ON DELETE SET NULL.';
  end if;
  if exists (select 1 from pg_constraint con
              where con.conrelid = to_regclass('public.vendor_internal_notes') and con.contype = 'f'
                and con.confrelid = to_regclass('public.vendor_internal_notes') and con.confdeltype not in ('r','a')) then
    raise exception 'QF-MVP-30.1B aborted: the notes self-supersede FK cascades.';
  end if;
  --      required/format contracts present; legacy authenticated policy gone.
  for v_missing in
    select n from unnest(array['vin_note_nonempty','vin_vendor_required','vin_category_check']) s(n)
    where not exists (select 1 from pg_constraint con
                       where con.conrelid = to_regclass('public.vendor_internal_notes') and con.conname::text = s.n)
  loop
    raise exception 'QF-MVP-30.1B aborted: notes contract constraint % missing.', v_missing;
  end loop;
  if exists (select 1 from pg_policy pol
              where pol.polrelid = to_regclass('public.vendor_internal_notes')
                and pol.polname::text = 'vendor notes admin all') then
    raise exception 'QF-MVP-30.1B aborted: the legacy authenticated notes policy is still present.';
  end if;

  -- 9.7 uniqueness/idempotency contracts present.
  for v_missing in
    select n from unnest(array[
      'vcp_pkey','vtg_normalized_unique','uq_vendor_tag_active','uq_vendor_tasks_idempotency',
      'uq_vendor_contacts_active_primary']) s(n)
    where to_regclass('public.'||s.n) is null
      and not exists (select 1 from pg_constraint where conname::text = s.n)
  loop
    raise exception 'QF-MVP-30.1B aborted: required unique/idempotency object % missing.', v_missing;
  end loop;

  -- 9.8 NO Core-truth duplicate columns on any CRM table.
  select string_agg(distinct format('%s.%s', c.relname, a.attname), ', ')
    into v_bad
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace nsp on nsp.oid = c.relnamespace
   where nsp.nspname = 'public'
     and c.relname in ('vendor_crm_profiles','vendor_contacts','vendor_tags',
                       'vendor_tag_assignments','vendor_tasks','vendor_internal_notes')
     and a.attnum > 0 and not a.attisdropped
     and a.attname::text = any (array[
       'is_verified','verification_status','verified','is_enabled','is_active_vendor',
       'city','service_area','service_areas','areas_covered','service_categories','categories',
       'package','package_name','package_status','package_expires_at','plan',
       'credits','total_credits','remaining_credits','credit_balance',
       'eligibility','is_eligible','assignment_eligibility',
       'consent','consent_status','is_suppressed','suppression','suppressed',
       'communication_authorization']::text[]);
  if v_bad is not null then
    raise exception 'QF-MVP-30.1B aborted: CRM table duplicates authoritative Core truth (%).', v_bad;
  end if;

  -- 9.9 NO segment/campaign objects were created here.
  if to_regclass('public.vendor_segments') is not null
     or to_regclass('public.vendor_campaigns') is not null
     or to_regclass('public.vendor_campaign_audiences') is not null
     or to_regclass('public.vendor_campaign_events') is not null
     or to_regclass('public.vendor_engagement_events') is not null then
    raise exception 'QF-MVP-30.1B aborted: a segment/campaign table exists (out of foundation scope).';
  end if;

  -- 9.10 SCOPE FENCE — Core/Marketplace authority untouched.
  if to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)') is null then
    raise exception 'QF-MVP-30.1B aborted: canonical assignment authority missing.';
  end if;
  if to_regclass('public.credit_ledger_reconciliation_exceptions') is null then
    raise exception 'QF-MVP-30.1B aborted: the 20.4C register is missing.';
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='public' and c.relname='vendor_public_v' and c.relkind='v') then
    raise exception 'QF-MVP-30.1B aborted: vendor_public_v is missing.';
  end if;
  if exists (select 1 from pg_attribute where attrelid='public.profiles'::regclass and not attisdropped and attname::text='admin_role') then
    raise exception 'QF-MVP-30.1B aborted: profiles.admin_role reappeared.';
  end if;
  if exists (select 1 from pg_attribute where attrelid='public.leads'::regclass and not attisdropped
              and attname::text = any(array['client_account_id','user_id','created_by']::text[])) then
    raise exception 'QF-MVP-30.1B aborted: an owner-binding column exists on public.leads.';
  end if;

  raise notice 'QF-MVP-30.1B verified: six Vendor CRM foundation tables (RLS on, server-only, untrusted zero-privilege, service_role minimal), vendor_internal_notes the SOLE append-only notes authority, evidence-preserving RESTRICT vendor FKs + SET NULL actor FKs, uniqueness/idempotency in place, NO Core-truth duplicate columns, NO segment/campaign tables; Marketplace A-E/20.4C/20.5A + vendor_public_v + owner-binding deferral intact.';
end;
$verify$;
