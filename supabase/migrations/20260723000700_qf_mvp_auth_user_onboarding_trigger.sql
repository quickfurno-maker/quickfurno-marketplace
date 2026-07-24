-- ============================================================================
-- QF-MVP-20.3D — AUTH-USER ONBOARDING TRIGGER (RESTORE + PRIVILEGE HARDENING)
--
-- Forward-only. Additive. Non-destructive to DATA. STAGING FIRST.
-- NOT AUTHORIZED FOR PRODUCTION by this phase. Generated and reviewed only;
-- application is a separate, separately authorized phase (D preflight, then
-- D application).
--
-- ---------------------------------------------------------------------------
-- WHY THIS MIGRATION EXISTS
-- ---------------------------------------------------------------------------
-- The original repository contract (20260620000003_functions.sql) created BOTH
-- public.handle_new_user() AND the trigger on_auth_user_created on auth.users.
--
-- The QF-MVP-20.2 staging baseline captured the FUNCTION (it lives in the
-- `public` schema) but NOT the TRIGGER: the baseline is generated from a
-- schema dump, and a trigger attached to auth.users belongs to the `auth`
-- schema, which the dump excludes. The function therefore exists on staging
-- while the trigger does not — which is exactly what Migration C's verifier
-- row C20 reports ("Migration D not started", auth.users trigger count = 0).
--
-- D restores the missing trigger, and in the same forward-only step CLOSES a
-- privilege-escalation defect in the original function (see below).
--
-- ---------------------------------------------------------------------------
-- THE DEFECT THIS MIGRATION CLOSES
-- ---------------------------------------------------------------------------
-- The original function derived the profile role from UNTRUSTED signup metadata:
--
--     coalesce(new.raw_user_meta_data->>'role', 'vendor')
--
-- `raw_user_meta_data` is populated verbatim from the client-supplied
-- `options.data` of a public `supabase.auth.signUp()` call, so it is entirely
-- attacker-controlled. public.profiles.role is CHECK-constrained to
-- ('admin','vendor'), and public.is_admin() is:
--
--     select exists (select 1 from public.profiles
--                     where id = auth.uid() and role = 'admin')
--
-- Attaching the trigger unchanged would therefore let ANY anonymous visitor
-- self-register as an administrator by passing {"role":"admin"} at signup,
-- unlocking every `is_admin()` RLS policy in the schema (profiles, vendors,
-- leads, lead_assignments, …).
--
-- ROLE IS NEVER READ FROM METADATA HERE. Administrator access is granted only
-- by the deliberate, service-role operator path (scripts/grant-superadmin.mjs),
-- which sets auth app_metadata.admin_role (not client-writable) and upserts
-- profiles.role = 'admin'. Signup initialises the non-privileged role only.
--
-- ---------------------------------------------------------------------------
-- FROZEN ONBOARDING CONTRACT (proved from the repository, not invented)
-- ---------------------------------------------------------------------------
--   target table   : public.profiles
--   key            : profiles.id = new.id  (FK -> auth.users(id) ON DELETE CASCADE)
--   columns written: id, full_name, phone, role   (explicit list, as originally)
--     id           <- new.id                                    TRUSTED (auth)
--     full_name    <- new.raw_user_meta_data->>'full_name'      untrusted, NON-privileged display text, single allowlisted key
--     phone        <- new.raw_user_meta_data->>'phone'          untrusted, NON-privileged display text, single allowlisted key
--     role         <- CONSTANT 'vendor'                         TRUSTED CONSTANT — never metadata
--   not written    : created_at, is_active  (left to their table defaults)
--   conflict       : ON CONFLICT (id) DO NOTHING — idempotent, never overwrites
--   fires on       : INSERT only (never UPDATE, so password reset / email change
--                    / ordinary auth-user updates do not re-run initialisation)
--
-- WHAT THIS TRIGGER DOES NOT CREATE:
--   no vendor row, no client account, no credits, no package/subscription, no
--   verification/approval state, no assignment state, no consent record, no
--   campaign state, and no admin/superadmin privilege of any kind.
--
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER — REQUIRED, AND PROVED
-- ---------------------------------------------------------------------------
-- The INSERT into auth.users is performed by the Supabase auth service role,
-- which holds no privilege on public.profiles, and public.profiles has RLS
-- ENABLED with only self/admin policies (none of which an auth-service insert
-- satisfies). Without SECURITY DEFINER the initialisation would fail and, being
-- in the same transaction, would abort every signup. SECURITY DEFINER is
-- therefore necessary, not convenient.
--
-- It is not an escalation surface: EXECUTE is revoked from PUBLIC, anon and
-- authenticated (only service_role retains it, matching the applied baseline),
-- the function takes no arguments and returns only NEW, it contains no dynamic
-- SQL, and search_path is pinned with pg_temp LAST so no temporary object can
-- shadow a referenced relation. Every reference is schema-qualified.
--
-- ---------------------------------------------------------------------------
-- ATOMICITY, EXISTING USERS, DELETION
-- ---------------------------------------------------------------------------
--   * AFTER INSERT ... FOR EACH ROW runs inside the signup transaction, so a
--     failed initialisation ROLLS BACK the auth user rather than leaving a
--     privileged or half-initialised account. Signup and initialisation are
--     atomic, and no partial state can survive.
--   * NO HISTORICAL BACKFILL. D deliberately does not create profiles for
--     pre-existing auth users; that is historical reconciliation and belongs to
--     a separate, separately approved migration. The application already
--     tolerates a missing row (it reads `profile?.role`, never assuming one).
--   * Deletion is unchanged: profiles.id -> auth.users(id) ON DELETE CASCADE,
--     so removing an auth user removes its profile. D adds no delete logic.
--
-- ---------------------------------------------------------------------------
-- SCOPE FENCE
-- ---------------------------------------------------------------------------
-- NOT in D: Migration E (legacy assignment-RPC EXECUTE revocation — every
-- legacy RPC and its grants are untouched); QF-MVP-20.4 (historical
-- credit-ledger reconciliation — no ledger row is written); client-selected
-- owner binding; any change to the Migration C public projection, its ACLs or
-- policies; any change to assignment, credit, package, consent or campaign
-- authority. A/A2/B1/G/B2/C objects and signatures are preserved untouched.
--
-- No explicit transaction control (the CLI wraps file + history in one
-- transaction). No data backfill. No migration-history write. No secret or
-- project ref. Self-verification uses CATALOG FACTS only — no lexical
-- assertion over pg_get_functiondef()/prosrc, and every catalog `name` value is
-- compared as text (the QF-MVP-20.3B1A / B2R1 defect classes).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Hardened onboarding function (forward-only replacement)
--
--    Same target, same key, same explicit column list and same idempotent
--    conflict behaviour as the original contract. The ONLY semantic change is
--    that `role` is a trusted constant instead of untrusted signup metadata.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  -- Only two non-privileged display fields are read from signup metadata, each
  -- by an explicit single key. The metadata JSON is NEVER copied wholesale, and
  -- NO privileged value (role, admin, verification, package, credit, status) is
  -- ever taken from it.
  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'phone',
    -- TRUSTED CONSTANT. Administrator access is granted only by the deliberate
    -- service-role operator path, never by self-service signup.
    'vendor'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'QF-MVP-20.3D auth-user onboarding. Creates the public.profiles row for a NEW auth user with a NON-PRIVILEGED constant role. Never reads role/admin/verification/package/credit/status from raw_user_meta_data. Idempotent via ON CONFLICT (id) DO NOTHING and never overwrites an existing profile. Creates no vendor, client, credit, package, verification or assignment state.';


-- ---------------------------------------------------------------------------
-- 2. Least-privilege posture (matches the applied baseline exactly)
--
--    A trigger function is invoked by the executor, not by a caller, so no role
--    needs EXECUTE for the trigger to fire. Revoking from PUBLIC/anon/
--    authenticated removes it as a directly callable surface.
-- ---------------------------------------------------------------------------

revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to service_role;


-- ---------------------------------------------------------------------------
-- 3. The auth.users onboarding trigger
--
--    AFTER INSERT FOR EACH ROW, exactly as the original repository contract.
--    AFTER (not BEFORE) is required: profiles.id carries a foreign key to
--    auth.users(id), so the auth row must exist before the profile row is
--    inserted. INSERT-only, so password resets and other auth-user updates
--    never re-run initialisation.
--
--    The DROP guard names the exact reviewed trigger only, so re-application is
--    idempotent and no other auth object is touched.
-- ---------------------------------------------------------------------------

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------------
-- 4. Self-verification — fail closed on any deviation from the D contract.
--
--    CATALOG FACTS ONLY. No pg_get_functiondef()/prosrc text assertion (the
--    QF-MVP-20.3B1A defect class); every catalog `name` is compared as text and
--    any set comparison normalises both sides (the B2R1 / CVR1 defect classes).
--    The source-level guarantee that `role` is a constant is enforced by the
--    OFFLINE VALIDATOR, which grades the migration text — the correct place for
--    a semantic assertion, since proving it in-database would require inserting
--    a test auth user, which is prohibited.
-- ---------------------------------------------------------------------------

do $verify$
declare
  v_fn      oid;
  v_tgtype  smallint;
  v_enabled text;
  v_relname text;
  v_nspname text;
  v_count   integer;
begin
  -- 4.1 the onboarding function exists with the exact zero-argument signature.
  v_fn := to_regprocedure('public.handle_new_user()');
  if v_fn is null then
    raise exception 'QF-MVP-20.3D aborted: public.handle_new_user() is missing.';
  end if;

  -- 4.2 it is SECURITY DEFINER with a search_path that pins pg_catalog.
  --     Matched structurally (a proconfig entry), never by exact string
  --     equality, because PostgreSQL normalises GUC list spelling.
  if not exists (
    select 1 from pg_proc p
     where p.oid = v_fn
       and p.prosecdef
       and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
                    where cfg like 'search_path=%' and cfg like '%pg_catalog%')
  ) then
    raise exception
      'QF-MVP-20.3D aborted: handle_new_user() must be SECURITY DEFINER with a search_path pinning pg_catalog.';
  end if;

  -- 4.3 it is NOT a callable escalation surface for untrusted roles.
  if has_function_privilege('public', v_fn, 'EXECUTE')
     or has_function_privilege('anon', v_fn, 'EXECUTE')
     or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception
      'QF-MVP-20.3D aborted: handle_new_user() is executable by PUBLIC, anon or authenticated.';
  end if;
  if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception
      'QF-MVP-20.3D aborted: service_role lost EXECUTE on handle_new_user().';
  end if;

  -- 4.4 exactly ONE live onboarding trigger, on auth.users, AFTER INSERT,
  --     FOR EACH ROW, enabled. tgtype bits: 1 ROW, 2 BEFORE, 4 INSERT
  --     => AFTER INSERT ROW = 1 + 4 = 5 (BEFORE bit deliberately unset).
  select count(*) into v_count
    from pg_trigger t
   where t.tgname = 'on_auth_user_created' and not t.tgisinternal;
  if v_count <> 1 then
    raise exception
      'QF-MVP-20.3D aborted: trigger on_auth_user_created exists % times, expected exactly 1.', v_count;
  end if;

  select t.tgtype, t.tgenabled::text, c.relname::text, n.nspname::text
    into v_tgtype, v_enabled, v_relname, v_nspname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where t.tgname = 'on_auth_user_created' and not t.tgisinternal;

  if v_nspname <> 'auth' or v_relname <> 'users' then
    raise exception
      'QF-MVP-20.3D aborted: on_auth_user_created is attached to %.%, expected auth.users.', v_nspname, v_relname;
  end if;
  if v_tgtype <> 5 then
    raise exception
      'QF-MVP-20.3D aborted: on_auth_user_created must be AFTER INSERT FOR EACH ROW (tgtype 5), found %.', v_tgtype;
  end if;
  if v_enabled <> 'O' then
    raise exception
      'QF-MVP-20.3D aborted: on_auth_user_created is not enabled in origin mode (tgenabled=%).', v_enabled;
  end if;

  -- 4.5 it is bound to OUR function, and auth.users carries no OTHER trigger.
  if not exists (
    select 1 from pg_trigger t
     where t.tgname = 'on_auth_user_created' and not t.tgisinternal and t.tgfoid = v_fn
  ) then
    raise exception
      'QF-MVP-20.3D aborted: on_auth_user_created does not execute public.handle_new_user().';
  end if;

  select count(*) into v_count
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal and n.nspname = 'auth' and c.relname = 'users'
     and t.tgname <> 'on_auth_user_created';
  if v_count <> 0 then
    raise exception
      'QF-MVP-20.3D aborted: % unexpected trigger(s) on auth.users.', v_count;
  end if;

  -- 4.6 the onboarding target is intact: profiles keyed to auth.users, with the
  --     role vocabulary unchanged (no new privileged value was introduced).
  if not exists (
    select 1 from pg_constraint con
     where con.conname = 'profiles_id_fkey' and con.contype = 'f'
  ) then
    raise exception
      'QF-MVP-20.3D aborted: profiles.id -> auth.users(id) foreign key is missing.';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'profiles_role_check' and contype = 'c'
  ) then
    raise exception
      'QF-MVP-20.3D aborted: the profiles_role_check constraint is missing.';
  end if;

  -- 4.7 SCOPE FENCE — A/A2/B1/G/B2/C are untouched.
  if to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)') is null then
    raise exception 'QF-MVP-20.3D aborted: the canonical B1 authority is missing.';
  end if;
  select count(*) into v_count
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal and n.nspname = 'public'
     and t.tgname in ('trg_lead_assignments_active_cap','trg_lead_assignment_events_lifetime_cap',
                      'trg_lead_assignment_events_immutable','trg_lead_assignment_events_no_truncate');
  if v_count <> 4 then
    raise exception 'QF-MVP-20.3D aborted: the four B2 enforcement triggers are not all present.';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'vendor_public_v' and c.relkind = 'v'
  ) then
    raise exception 'QF-MVP-20.3D aborted: the Migration C public projection is missing.';
  end if;
  if has_table_privilege('anon', 'public.vendors', 'SELECT')
     or has_table_privilege('anon', 'public.leads', 'SELECT') then
    raise exception 'QF-MVP-20.3D aborted: the Migration C anon revocation was weakened.';
  end if;

  -- 4.8 SCOPE FENCE — Migration E has NOT been performed by D.
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('assign_lead_to_vendors','admin_smart_assign_lead_to_vendors',
                       'assign_lead_to_paid_vendors_phase26a','assign_lead_to_preferred_vendor',
                       'assign_client_selected_vendor_to_group','assign_vendor_to_requirement_group');
  if v_count = 0 then
    raise exception
      'QF-MVP-20.3D aborted: the legacy assignment RPCs are gone — removing them is Migration E, not D.';
  end if;

  raise notice 'QF-MVP-20.3D auth-user onboarding verified: handle_new_user() hardened (constant role), on_auth_user_created AFTER INSERT on auth.users (tgtype 5, enabled, sole auth trigger), untrusted EXECUTE revoked, A/A2/B1/G/B2/C intact, E not started, no backfill.';
end;
$verify$;
