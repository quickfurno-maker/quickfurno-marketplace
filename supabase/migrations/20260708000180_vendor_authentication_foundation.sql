-- ============================================================================
-- QuickFurno — 20260708000180_vendor_authentication_foundation.sql
--
-- PHASE 5C — VENDOR AUTHENTICATION FOUNDATION (additive-only, non-destructive).
--
-- Establishes vendor_dashboard_users as the mapping between a Supabase Auth
-- principal and a QuickFurno vendor business, WITHOUT introducing a custom JWT,
-- a custom session, or any credential storage.
--
-- IDENTITY MODEL (do not merge these responsibilities)
--   • Supabase Auth               = authentication + session authority
--   • vendor_dashboard_users      = auth principal → vendor business access map
--   • vendors                     = the business entity
--   • Phase 4 policy engine       = business authorization authority
--   • Phase 5A auth_security_events = authentication/security audit log
--   • Phase 5B communication core = transport, never an authentication authority
--
-- STATES THAT MUST STAY SEPARATE
--   vendor login authentication
--     != vendor WhatsApp verification   (phone_verified / whatsapp_otp_enabled)
--     != vendor business verification   (vendors.verification_status)
--     != vendor subscription/paid state (vendors.paid_status, package status)
--     != vendor lead eligibility        (credits, accepting_leads)
--   A vendor may authenticate while every one of those is pending, unpaid, or
--   false. None of them is an authentication credential. Nothing below reads any
--   of them.
--
-- WHAT THIS MIGRATION DOES
--   1. Ensures the vendor_dashboard_users table exists (it currently exists in
--      the linked database but was never captured in a local migration file —
--      see the migration-history drift note below). No-op where it exists.
--   2. Adds vendor_dashboard_users.user_id → auth.users(id) ON DELETE SET NULL.
--      Deleting an authentication account must never delete a vendor business.
--   3. Adds a partial unique index on (user_id) WHERE user_id IS NOT NULL, so a
--      single auth principal can never resolve to two vendor businesses.
--   4. Backfills mappings for vendors that already carry vendors.user_id, only
--      where doing so is unambiguous. It never writes to vendors.
--   5. Replaces the effective deny-all (RLS enabled, zero policies) with an
--      explicit least-privilege model: authenticated self-read only.
--
-- NOT DONE HERE, DELIBERATELY
--   • No credential column of any kind is created.
--   • No SECURITY DEFINER helper (e.g. public.current_vendor_id()) is added: no
--     policy in this migration needs one, and services/vendorAccessService.ts is
--     the canonical resolver. Adding an unnecessary definer function would widen
--     the trusted surface for nothing.
--   • Phase 5A and Phase 5B migrations are untouched. No Phase 5B communication
--     automation is enabled.
--
-- MIGRATION-HISTORY DRIFT WARNING
--   The Supabase CLI migration history is drifted from the local files. Do NOT
--   run `supabase db push` / `migration up` / `migration repair` / reset. This
--   file is a review artefact and is applied manually after review.
--
-- Additive, idempotent, safe to re-run, safe for existing vendor records.
-- NOT applied to production by this change.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) VENDOR DASHBOARD USERS — auth principal → vendor business access mapping
-- ----------------------------------------------------------------------------
-- Authoritative definition for fresh environments. A no-op against the linked
-- database, where this table already exists with these columns.
create table if not exists public.vendor_dashboard_users (
  id                    uuid primary key default gen_random_uuid(),
  -- Deleting the vendor business removes its access mappings.
  vendor_id             uuid not null references public.vendors(id) on delete cascade,
  -- The Supabase Auth principal. Nullable: a mapping may be provisioned before
  -- the auth account exists, and survives that account's deletion (see the FK).
  user_id               uuid,
  phone                 text,
  email                 text,
  role                  text not null default 'owner',
  -- Dashboard MEMBERSHIP status. Not vendor business status, not paid status.
  status                text not null default 'active',
  -- WhatsApp/phone verification state. Phase 5E owns these. They are never an
  -- authentication credential and are never inferred from a phone being present.
  phone_verified        boolean not null default false,
  whatsapp_otp_enabled  boolean not null default false,
  last_login_method     text,
  last_login_at         timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint vendor_dashboard_users_vendor_id_phone_key unique (vendor_id, phone)
);

-- Defensive, idempotent column adds for environments that drifted. Every add is
-- nullable or defaulted, so it can never fail against a populated table.
alter table public.vendor_dashboard_users
  add column if not exists user_id              uuid,
  add column if not exists phone                text,
  add column if not exists email                text,
  add column if not exists role                 text not null default 'owner',
  add column if not exists status               text not null default 'active',
  add column if not exists phone_verified       boolean not null default false,
  add column if not exists whatsapp_otp_enabled boolean not null default false,
  add column if not exists last_login_method    text,
  add column if not exists last_login_at        timestamptz,
  add column if not exists created_at           timestamptz not null default now(),
  add column if not exists updated_at           timestamptz not null default now();

-- ----------------------------------------------------------------------------
-- 2) AUTH USER FOREIGN KEY — ON DELETE SET NULL
-- ----------------------------------------------------------------------------
-- Deleting a Supabase Auth account must orphan the mapping, never cascade into
-- the vendor business. The existing vendor_id FK (ON DELETE CASCADE) is untouched.
--
-- Adding the constraint validates existing rows: if an orphaned non-null user_id
-- exists, this migration FAILS rather than silently discarding the link. That is
-- the intended behaviour.
do $$
begin
  if to_regclass('public.vendor_dashboard_users') is null then
    return;
  end if;
  if to_regclass('auth.users') is null then
    return;
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any (c.conkey)
    where c.conrelid = 'public.vendor_dashboard_users'::regclass
      and c.contype  = 'f'
      and c.confrelid = 'auth.users'::regclass
      and a.attname = 'user_id'
  ) then
    alter table public.vendor_dashboard_users
      add constraint vendor_dashboard_users_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete set null;
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 3) ONE AUTH PRINCIPAL → ONE VENDOR ACCESS MAPPING
-- ----------------------------------------------------------------------------
-- Partial so that many rows may hold a NULL user_id (unclaimed invitations),
-- while a claimed principal can never resolve to two unrelated vendor businesses.
create unique index if not exists uq_vendor_dashboard_users_user_id
  on public.vendor_dashboard_users(user_id)
  where user_id is not null;

create index if not exists idx_vendor_dashboard_users_vendor
  on public.vendor_dashboard_users(vendor_id);

-- ----------------------------------------------------------------------------
-- 4) ONE-TIME BACKFILL — preserve existing vendors.user_id ownership links
-- ----------------------------------------------------------------------------
-- Creates a dashboard mapping for vendors that already carry an auth link, ONLY
-- where the result is unambiguous:
--   • the vendor has no dashboard mapping yet;
--   • that auth principal is not already mapped to some vendor;
--   • exactly one vendor claims that auth principal (never pick a winner).
--
-- It never UPDATEs public.vendors, never overwrites an existing mapping row, and
-- never infers WhatsApp verification, paid status, or business verification.
-- Re-running is a no-op: the NOT EXISTS guards exclude every row it created.
-- ON CONFLICT DO NOTHING makes a racing insert fail safely instead of reassigning
-- identity ownership.
insert into public.vendor_dashboard_users (
  vendor_id, user_id, phone, email, role, status,
  phone_verified, whatsapp_otp_enabled, last_login_method, last_login_at
)
select
  v.id,
  v.user_id,
  v.phone,
  v.email,
  'owner',
  'active',
  false,   -- phone_verified: NEVER inferred from a phone number being present
  false,   -- whatsapp_otp_enabled: Phase 5E decides this, not a backfill
  null,    -- last_login_method: no login has happened
  null     -- last_login_at
from public.vendors v
where v.user_id is not null
  and not exists (
    select 1 from public.vendor_dashboard_users d where d.vendor_id = v.id
  )
  and not exists (
    select 1 from public.vendor_dashboard_users d where d.user_id = v.user_id
  )
  and (
    select count(*) from public.vendors v2 where v2.user_id = v.user_id
  ) = 1
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 5) RLS + GRANTS — least privilege
-- ----------------------------------------------------------------------------
-- The table already had RLS enabled with ZERO policies (effective deny-all for
-- the PostgREST roles) while broad grants remained. This replaces that with an
-- explicit model.
alter table public.vendor_dashboard_users enable row level security;

-- anon: no access at all. Vendors authenticate before anything here is readable.
revoke all on public.vendor_dashboard_users from anon;

-- authenticated: SELECT only, and only its own row (policy below).
-- No INSERT / UPDATE / DELETE grant, so a vendor can never modify vendor_id,
-- user_id, role, status, phone_verified, or whatsapp_otp_enabled from the
-- browser. Login metadata is written server-side via service_role.
revoke all on public.vendor_dashboard_users from authenticated;
grant select on public.vendor_dashboard_users to authenticated;

-- service_role: the server layer resolves access, links principals, and stamps
-- login metadata. No DELETE grant — access is revoked by setting status, and the
-- vendor_id FK already cascades when a vendor business is removed.
grant select, insert, update on public.vendor_dashboard_users to service_role;

-- Self-read. auth.uid() is the Supabase-validated principal; a NULL user_id row
-- (unclaimed invitation) matches nobody because NULL = NULL is never true, and
-- the explicit NOT NULL guard keeps that intent readable.
drop policy if exists "vendor_dashboard_users self read" on public.vendor_dashboard_users;
create policy "vendor_dashboard_users self read" on public.vendor_dashboard_users
  for select to authenticated
  using (auth.uid() is not null and auth.uid() = user_id);

-- Admin read, via the repository's existing trusted admin convention. SELECT
-- only: admin writes go through the server layer, not the browser.
drop policy if exists "vendor_dashboard_users admin read" on public.vendor_dashboard_users;
create policy "vendor_dashboard_users admin read" on public.vendor_dashboard_users
  for select to authenticated
  using (public.is_admin());

-- ============================================================================
-- Deliberately NOT created (per Phase 5C review scope):
--   • no credential column, no token column, no session column
--   • no anon policy or grant
--   • no authenticated INSERT / UPDATE / DELETE grant or policy
--   • no policy that exposes another vendor's mapping row
--   • no SECURITY DEFINER helper (no policy here requires one)
--   • no UPDATE of public.vendors (existing vendors.user_id links are preserved
--     exactly as they are, and remain the source the backfill reads from)
--   • no change to any Phase 5A or Phase 5B table, index, grant, or seed row
-- ============================================================================
