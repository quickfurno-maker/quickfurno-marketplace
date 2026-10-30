-- Synthetic Postgres 17 regression test for public.is_admin() candidate,
-- extending ops/security/tests/vox_p0_2_admin_rls_pg17.sql (9/9 passed) with
-- session-level state transitions and a representative real-shaped policy.
--
-- Pure SQL, run manually with psql against a disposable/local scratch DB:
--   psql <scratch-db-conn> -f ops/security/tests/vox_p0_4_admin_rls_session_transitions_pg17.sql
-- Self-contained: builds its own auth/profiles shim (does not depend on
-- vox_p0_2_admin_rls_pg17.sql having run first or last in the same session).
-- Local synthetic only; no shell; BEGIN/ROLLBACK leaves no trace.
--
-- What this file adds beyond vox_p0_2_admin_rls_pg17.sql's 9 cases:
--   1) A positive active-admin SELECT + INSERT + UPDATE (P0-2 only tested
--      active-admin SELECT; write success was never exercised for the
--      *positive* case, only write *denial* for a disabled admin).
--   2) Mid-session (same transaction, same connection, no reconnect) toggles
--      of profiles.is_active and profiles.role, proving is_admin() is
--      re-evaluated per statement rather than cached for the session:
--        active -> disabled revokes; disabled -> active restores;
--        admin -> nonadmin revokes; active -> NULL fails closed.
--   3) A single FOR ALL policy shape (USING/WITH CHECK both is_admin()),
--      which per docs/vox/VOX-P0-4-ADMIN-POLICY-MATRIX-20261029.md section 1
--      is the majority real shape (70 of 110 source-only policies), instead
--      of P0-2's separate SELECT + UPDATE policies on the same demo table.

BEGIN;

-- Minimal auth shim: auth.uid() reads request.jwt.claim.sub (as Supabase does).
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
END
$$;

-- Synthetic public.profiles matching the candidate's expected shape.
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  role text NOT NULL DEFAULT 'user',
  is_active boolean
);

-- Candidate defines public.is_admin() with no arguments.
\ir ../sql-candidates/vox_p0_2_is_admin_active_candidate.sql

-- Representative demo table using the majority real-world policy shape: one
-- FOR ALL policy, USING and WITH CHECK both public.is_admin() — mirrors e.g.
-- "profiles admin all" / "vendor_pkgs admin all" / "<table> admin all" in
-- supabase/migrations/20260620000002_rls_policies.sql and the loop-generated
-- AOS/CRM admin policies documented in the P0-4 matrix.
CREATE TABLE admin_all_demo (
  id int PRIMARY KEY,
  secret text NOT NULL
);

ALTER TABLE admin_all_demo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_demo admin all" ON admin_all_demo
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

INSERT INTO admin_all_demo (id, secret) VALUES (1, 'top-secret');

GRANT SELECT, INSERT, UPDATE, DELETE ON admin_all_demo TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;

-- Single transitioning admin profile, starts active.
INSERT INTO public.profiles (id, role, is_active) VALUES
  ('99999999-9999-9999-9999-999999999999', 'admin', true);

-- ============================================================================
-- Case 1: positive active admin -> SELECT visible, INSERT succeeds,
-- UPDATE succeeds (P0-2 only exercised active-admin SELECT; this is the
-- first positive write check under the active state).
-- ============================================================================
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);

DO $$
DECLARE visible_count int;
BEGIN
  SELECT count(*) INTO visible_count FROM admin_all_demo;
  ASSERT visible_count = 1, 'FAIL: active admin should SELECT the existing row';
  RAISE NOTICE 'PASS: active admin SELECT visible (admin_all_demo)';
END
$$;

DO $$
DECLARE affected int;
BEGIN
  INSERT INTO admin_all_demo (id, secret) VALUES (2, 'second-secret');
  GET DIAGNOSTICS affected = ROW_COUNT;
  ASSERT affected = 1, 'FAIL: active admin should be able to INSERT';
  RAISE NOTICE 'PASS: active admin INSERT succeeded (admin_all_demo)';
END
$$;

DO $$
DECLARE affected int;
BEGIN
  UPDATE admin_all_demo SET secret = 'rotated' WHERE id = 1;
  GET DIAGNOSTICS affected = ROW_COUNT;
  ASSERT affected = 1, 'FAIL: active admin should be able to UPDATE';
  RAISE NOTICE 'PASS: active admin UPDATE succeeded (admin_all_demo)';
END
$$;

RESET ROLE;

-- ============================================================================
-- Case 2: active -> disabled in the SAME session (no reconnect, no new
-- transaction) revokes access on the very next statement.
-- ============================================================================
UPDATE public.profiles SET is_active = false
  WHERE id = '99999999-9999-9999-9999-999999999999';

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);

DO $$
DECLARE result boolean;
BEGIN
  SELECT public.is_admin() INTO result;
  ASSERT result IS NOT true, 'FAIL: is_admin() should flip false immediately after is_active=false, same session';
  RAISE NOTICE 'PASS: active->disabled revokes is_admin() in same session';
END
$$;

DO $$
DECLARE visible_count int;
BEGIN
  SELECT count(*) INTO visible_count FROM admin_all_demo;
  ASSERT visible_count = 0, 'FAIL: disabled admin should not SELECT admin_all_demo';
  RAISE NOTICE 'PASS: active->disabled denies SELECT in same session';
END
$$;

DO $$
DECLARE affected int;
BEGIN
  UPDATE admin_all_demo SET secret = 'tampered' WHERE id = 1;
  GET DIAGNOSTICS affected = ROW_COUNT;
  ASSERT affected = 0, 'FAIL: disabled admin should not be able to UPDATE admin_all_demo (FOR ALL shape)';
  RAISE NOTICE 'PASS: active->disabled denies UPDATE in same session (representative FOR ALL policy)';
END
$$;

RESET ROLE;

-- ============================================================================
-- Case 3: disabled -> active restores access in the SAME session.
-- ============================================================================
UPDATE public.profiles SET is_active = true
  WHERE id = '99999999-9999-9999-9999-999999999999';

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);

DO $$
DECLARE result boolean;
BEGIN
  SELECT public.is_admin() INTO result;
  ASSERT result = true, 'FAIL: is_admin() should restore to true immediately after is_active=true, same session';
  RAISE NOTICE 'PASS: disabled->active restores is_admin() in same session';
END
$$;

DO $$
DECLARE visible_count int;
BEGIN
  SELECT count(*) INTO visible_count FROM admin_all_demo;
  ASSERT visible_count >= 1, 'FAIL: re-enabled admin should SELECT admin_all_demo again';
  RAISE NOTICE 'PASS: disabled->active restores SELECT in same session';
END
$$;

RESET ROLE;

-- ============================================================================
-- Case 4: admin -> nonadmin (role flips, is_active stays true) revokes
-- access in the SAME session.
-- ============================================================================
UPDATE public.profiles SET role = 'user'
  WHERE id = '99999999-9999-9999-9999-999999999999';

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);

DO $$
DECLARE result boolean;
BEGIN
  SELECT public.is_admin() INTO result;
  ASSERT result IS NOT true, 'FAIL: is_admin() should be false once role is no longer admin, same session';
  RAISE NOTICE 'PASS: admin->nonadmin revokes is_admin() in same session';
END
$$;

DO $$
DECLARE affected int;
BEGIN
  UPDATE admin_all_demo SET secret = 'tampered-2' WHERE id = 1;
  GET DIAGNOSTICS affected = ROW_COUNT;
  ASSERT affected = 0, 'FAIL: former-admin (now role=user) should not be able to UPDATE admin_all_demo';
  RAISE NOTICE 'PASS: admin->nonadmin denies UPDATE in same session';
END
$$;

RESET ROLE;

-- Restore admin role before the next case (keeps each case's precondition
-- explicit rather than relying on leftover state from the prior case).
UPDATE public.profiles SET role = 'admin'
  WHERE id = '99999999-9999-9999-9999-999999999999';

-- ============================================================================
-- Case 5: active -> NULL is_active (not just false) fails closed, exercised
-- as a mid-session transition rather than only as an initial seed value
-- (vox_p0_2_admin_rls_pg17.sql case 3 only seeded NULL at INSERT time).
-- ============================================================================
UPDATE public.profiles SET is_active = null
  WHERE id = '99999999-9999-9999-9999-999999999999';

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);

DO $$
DECLARE result boolean;
BEGIN
  SELECT public.is_admin() INTO result;
  ASSERT result IS NOT true, 'FAIL: is_admin() should be false when is_active transitions to NULL mid-session';
  RAISE NOTICE 'PASS: active->NULL fails closed in same session';
END
$$;

DO $$
DECLARE visible_count int;
BEGIN
  SELECT count(*) INTO visible_count FROM admin_all_demo;
  ASSERT visible_count = 0, 'FAIL: NULL-active admin should not SELECT admin_all_demo';
  RAISE NOTICE 'PASS: active->NULL denies SELECT in same session';
END
$$;

RESET ROLE;

ROLLBACK;
