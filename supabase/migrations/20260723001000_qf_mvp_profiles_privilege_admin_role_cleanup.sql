-- ============================================================================
-- QF-MVP-20.5A — PROFILES BASE-TABLE PRIVILEGE HARDENING + admin_role DRIFT
--                CLEANUP (SCHEMA/ACL ONLY)
--
-- Forward-only. SCHEMA/ACL ONLY. Inserts, updates and deletes NOTHING. Rewrites
-- no user role. STAGING FIRST. Generated and reviewed only; application is a
-- separate, separately authorized phase (preflight, then application).
--
-- ---------------------------------------------------------------------------
-- WHY THIS MIGRATION EXISTS (two mandatory Marketplace-Engine closeout items)
-- ---------------------------------------------------------------------------
-- 1. LEAST-PRIVILEGE BASE-TABLE GRANTS ON public.profiles.
--    The profiles RLS policies (self read / self update / admin all) were added
--    in 20260620000002, but NO explicit table GRANT/REVOKE was ever written, so
--    the effective privileges depend on environment-specific Supabase defaults
--    (drift: on the staging baseline squash `authenticated` currently holds NO
--    privilege at all). PostgreSQL requires BOTH a table privilege AND a passing
--    RLS policy, so this migration makes the grant explicit and minimal:
--      * authenticated: SELECT only (own row via the "profiles self read" policy);
--      * anon / PUBLIC: nothing;
--      * service_role: SELECT + INSERT + UPDATE only (the admin bootstrap
--        `grant-superadmin.mjs` upserts profiles, and admin dashboard reads run
--        through service_role, which bypasses RLS). No runtime deletes profiles,
--        so DELETE / TRUNCATE / REFERENCES / TRIGGER / MAINTAIN are NOT granted.
--
--    ROLE-ESCALATION NOTE (mandatory): the "profiles self update" policy checks
--    only `id = auth.uid()` (not which columns change), so a table-level UPDATE
--    grant to `authenticated` would let a user run
--    `update public.profiles set role = 'admin' where id = auth.uid()` and
--    escalate. No application code updates profiles through an authenticated
--    session (profile creation is the 20260723000700 auth trigger; admin writes
--    use service_role), so the minimum safe mechanism is to grant SELECT ONLY and
--    revoke UPDATE. Escalation is closed at the grant layer; the policy is left
--    intact but inert. The verifier asserts `authenticated` has no UPDATE.
--
-- 2. profiles.admin_role DRIFT CLEANUP.
--    The historical migration 20260621000006 added an OPTIONAL
--    `profiles.admin_role text` column. It is NON-AUTHORITATIVE: `public.is_admin()`
--    reads `profiles.role = 'admin'`, never admin_role; no policy, trigger, view
--    or function references admin_role; no runtime query selects it (adminService
--    fetches `id, created_at, full_name, phone, role, is_active`); the only code
--    references were a dead type field and a display fallback that was always
--    undefined. The real admin marker is `auth app_metadata.admin_role` (a JWT
--    claim on auth.users), which is UNRELATED to this column and is NOT touched.
--    This migration drops the drifted column forward-only and idempotently. On the
--    staging squash (column absent) DROP COLUMN IF EXISTS is a no-op; on any
--    environment where 20260621000006 was applied (production) it removes the
--    obsolete column.
--
-- ---------------------------------------------------------------------------
-- LOCKED AUTHORITY CONTRACT (unchanged by this migration)
-- ---------------------------------------------------------------------------
--   * profiles.role stays the canonical application role field (admin/vendor);
--     no role value is rewritten here.
--   * The 20260723000700 auth trigger + trusted-marker contract is preserved
--     (no admin branch, no user_metadata authority). This migration does not
--     touch the trigger or handle_new_user().
--   * admin authority still requires explicit service-role/bootstrap action; no
--     admin is derived from email/phone/user_metadata/client input.
--   * Owner binding remains separately deferred (untouched).
--   * No assignment / package / credit / lead / public-vendor-projection change.
--   * No ALTER DEFAULT PRIVILEGES, no schema-wide grant, no transaction control,
--     no migration-history write, no data backfill.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Keep RLS enabled (idempotent re-assert; already enabled in 20260620000002).
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;


-- ---------------------------------------------------------------------------
-- 2. Least-privilege base-table grants.
--    Deterministically reset the untrusted roles, then grant the minimum proven
--    matrix. `authenticated` gets SELECT only; its own-row visibility is still
--    enforced by the unchanged "profiles self read" RLS policy.
-- ---------------------------------------------------------------------------
revoke all privileges on table public.profiles from public;
revoke all privileges on table public.profiles from anon;
revoke all privileges on table public.profiles from authenticated;

grant select on table public.profiles to authenticated;

-- service_role: exactly SELECT + INSERT + UPDATE (admin bootstrap upsert + admin
-- dashboard reads). DELETE is NOT needed by any runtime path, so revoke ALL first
-- (version-safe: no explicit MAINTAIN keyword) and grant back only the three.
-- This removes DELETE / TRUNCATE / REFERENCES / TRIGGER / MAINTAIN from service_role.
revoke all privileges on table public.profiles from service_role;
grant select, insert, update on table public.profiles to service_role;


-- ---------------------------------------------------------------------------
-- 3. Drop the non-authoritative admin_role drift column (idempotent, forward-only).
--    Safe: no policy/trigger/view/function/index/query depends on it. Its CHECK
--    constraint is dropped with the column. The auth app_metadata.admin_role JWT
--    claim is unrelated and untouched.
-- ---------------------------------------------------------------------------
alter table public.profiles drop column if exists admin_role;


-- ---------------------------------------------------------------------------
-- 4. Self-verification — fail closed on any deviation. CATALOG FACTS ONLY
--    (QF-MVP-20.3B1R2: no lexical assertion over pg_get_functiondef()/prosrc;
--    every catalog `name` compared as text; set comparisons normalise both sides).
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_rel   oid;
  v_count integer;
begin
  -- 4.1 profiles exists with RLS enabled.
  v_rel := to_regclass('public.profiles');
  if v_rel is null then
    raise exception 'QF-MVP-20.5A aborted: public.profiles is missing.';
  end if;
  if not exists (select 1 from pg_class c where c.oid = v_rel and c.relrowsecurity) then
    raise exception 'QF-MVP-20.5A aborted: RLS is not enabled on public.profiles.';
  end if;

  -- 4.2 canonical role authority column preserved; drift column gone.
  if not exists (select 1 from pg_attribute where attrelid = v_rel and attname::text = 'role' and not attisdropped) then
    raise exception 'QF-MVP-20.5A aborted: canonical profiles.role column is missing.';
  end if;
  if exists (select 1 from pg_attribute where attrelid = v_rel and attname::text = 'admin_role' and not attisdropped) then
    raise exception 'QF-MVP-20.5A aborted: profiles.admin_role drift column still present after cleanup.';
  end if;

  -- 4.3 authenticated: exactly SELECT (no write/DDL privilege).
  if not has_table_privilege('authenticated', v_rel, 'SELECT') then
    raise exception 'QF-MVP-20.5A aborted: authenticated lost the required SELECT on profiles.';
  end if;
  if has_table_privilege('authenticated', v_rel, 'INSERT')
     or has_table_privilege('authenticated', v_rel, 'UPDATE')
     or has_table_privilege('authenticated', v_rel, 'DELETE')
     or has_table_privilege('authenticated', v_rel, 'TRUNCATE')
     or has_table_privilege('authenticated', v_rel, 'REFERENCES')
     or has_table_privilege('authenticated', v_rel, 'TRIGGER') then
    raise exception 'QF-MVP-20.5A aborted: authenticated holds a write/DDL privilege on profiles (role-escalation surface).';
  end if;

  -- 4.4 anon and PUBLIC hold ZERO privilege.
  if exists (
    select 1 from unnest(array['anon','public']) r(role_name)
      cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
     where has_table_privilege(r.role_name, v_rel, p.priv)
  ) then
    raise exception 'QF-MVP-20.5A aborted: anon or PUBLIC holds a privilege on profiles.';
  end if;

  -- 4.5 service_role: EXACTLY SELECT + INSERT + UPDATE. The bootstrap needs those
  --     three; DELETE / TRUNCATE / REFERENCES / TRIGGER (+ MAINTAIN on PG17) must
  --     be absent. has_table_privilege is effective, so it catches any privilege
  --     that leaked via membership as well as any over-grant.
  if not (has_table_privilege('service_role', v_rel, 'SELECT')
          and has_table_privilege('service_role', v_rel, 'INSERT')
          and has_table_privilege('service_role', v_rel, 'UPDATE')) then
    raise exception 'QF-MVP-20.5A aborted: service_role lost the SELECT/INSERT/UPDATE the admin bootstrap requires.';
  end if;
  if has_table_privilege('service_role', v_rel, 'DELETE')
     or has_table_privilege('service_role', v_rel, 'TRUNCATE')
     or has_table_privilege('service_role', v_rel, 'REFERENCES')
     or has_table_privilege('service_role', v_rel, 'TRIGGER') then
    raise exception 'QF-MVP-20.5A aborted: service_role holds an unneeded write/DDL privilege (DELETE/TRUNCATE/REFERENCES/TRIGGER) on profiles.';
  end if;
  -- MAINTAIN exists only on PostgreSQL 17+, so guard the check by server version
  -- (revoke all already removed it where present; this proves the absence).
  if current_setting('server_version_num')::int >= 170000
     and has_table_privilege('service_role', v_rel, 'MAINTAIN') then
    raise exception 'QF-MVP-20.5A aborted: service_role holds MAINTAIN on profiles.';
  end if;

  -- 4.6 the three own-row / admin policies are preserved (boundaries unchanged).
  for v_count in
    select 1 from unnest(array['profiles self read','profiles self update','profiles admin all']) needed(nm)
     where not exists (
       select 1 from pg_policy pol where pol.polrelid = v_rel and pol.polname::text = needed.nm)
  loop
    raise exception 'QF-MVP-20.5A aborted: a required profiles RLS policy is missing.';
  end loop;
  -- no anon-facing profiles policy (every policy targets authenticated only).
  if exists (
    select 1 from pg_policy pol
     where pol.polrelid = v_rel
       and exists (select 1 from unnest(coalesce(pol.polroles, '{}')) rid
                    where pg_get_userbyid(rid)::text = 'anon')
  ) then
    raise exception 'QF-MVP-20.5A aborted: a profiles policy targets anon.';
  end if;

  -- 4.7 role authority function + auth trigger contract preserved (existence only;
  --     body verification stays the 20260723000700 verifier's job).
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'QF-MVP-20.5A aborted: public.is_admin() authority function is missing.';
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where not t.tgisinternal and t.tgname::text = 'on_auth_user_created'
       and n.nspname::text = 'auth' and c.relname::text = 'users'
  ) then
    raise exception 'QF-MVP-20.5A aborted: the Migration D auth onboarding trigger is missing.';
  end if;

  -- 4.8 SCOPE FENCE — the 20.4C immutable register is intact and owner binding
  --     remains deferred (this migration touched neither).
  if to_regclass('public.credit_ledger_reconciliation_exceptions') is null then
    raise exception 'QF-MVP-20.5A aborted: the 20.4C exception register is missing.';
  end if;
  if exists (
    select 1 from pg_attribute
     where attrelid = 'public.leads'::regclass and not attisdropped
       and attname::text = any(array['client_account_id','user_id','created_by']::text[])
  ) then
    raise exception 'QF-MVP-20.5A aborted: an owner-binding column exists on public.leads (a later phase).';
  end if;

  raise notice 'QF-MVP-20.5A verified: profiles RLS on; authenticated SELECT-only (no write/escalation surface); anon/PUBLIC zero privilege; service_role SELECT+INSERT+UPDATE only (no DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN); admin_role drift column removed; profiles.role authority + is_admin() + D auth trigger intact; 20.4C register and owner-binding deferral untouched.';
end;
$verify$;
