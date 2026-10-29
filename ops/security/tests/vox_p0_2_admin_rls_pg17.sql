-- Synthetic Postgres 17 test for admin-only RLS via public.is_admin() candidate.
-- Pure SQL, run manually with psql against a scratch DB:
--   psql <scratch-db-conn> -f ops/security/tests/vox_p0_2_admin_rls_pg17.sql
-- Uses a psql relative include (\ir) to load the candidate function definition
-- after the synthetic auth/profiles schema exists and before policies are created.
-- Local synthetic only; no shell; BEGIN/ROLLBACK leaves no trace.

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

-- Synthetic public.profiles matching the candidate's expected shape:
-- id uuid, role text, is_active bool (NOT is_admin boolean).
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  role text NOT NULL DEFAULT 'user',
  is_active boolean
);

-- Candidate defines public.is_admin() with no arguments.
\ir ../sql-candidates/vox_p0_2_is_admin_active_candidate.sql

CREATE TABLE admin_only_demo (
  id int PRIMARY KEY,
  secret text NOT NULL
);

ALTER TABLE admin_only_demo ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_only_select ON admin_only_demo
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

INSERT INTO admin_only_demo (id, secret) VALUES (1, 'top-secret');

INSERT INTO public.profiles (id, role, is_active) VALUES
  ('11111111-1111-1111-1111-111111111111', 'admin', true),   -- active admin
  ('22222222-2222-2222-2222-222222222222', 'admin', false),  -- disabled admin
  ('33333333-3333-3333-3333-333333333333', 'admin', null),   -- null-active admin
  ('44444444-4444-4444-4444-444444444444', 'user', true);    -- active non-admin
  -- 55555555-... intentionally omitted: missing profile case

GRANT SELECT ON admin_only_demo TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;

SET ROLE authenticated;

-- Case 1: active admin -> SELECT visible
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
DO $$
DECLARE result boolean;
BEGIN
  SELECT public.is_admin() INTO result;
  ASSERT result = true, 'FAIL: active admin should be true';
  RAISE NOTICE 'PASS: active admin is true';
END
$$;
DO $$
DECLARE visible_count int;
BEGIN
  SELECT count(*) INTO visible_count FROM admin_only_demo;
  ASSERT visible_count = 1, 'FAIL: active admin should see admin_only_demo row';
  RAISE NOTICE 'PASS: active admin can SELECT admin_only_demo';
END
$$;

-- Case 2: disabled admin -> false, denied
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
DO $$
DECLARE result boolean;
BEGIN
  SELECT public.is_admin() INTO result;
  ASSERT result IS NOT true, 'FAIL: disabled admin should be false';
  RAISE NOTICE 'PASS: disabled admin is false';
END
$$;
DO $$
DECLARE visible_count int;
BEGIN
  SELECT count(*) INTO visible_count FROM admin_only_demo;
  ASSERT visible_count = 0, 'FAIL: disabled admin should not see admin_only_demo row';
  RAISE NOTICE 'PASS: disabled admin denied SELECT on admin_only_demo';
END
$$;

-- Case 3: null-active admin -> false
SELECT set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
DO $$
DECLARE result boolean;
BEGIN
  SELECT public.is_admin() INTO result;
  ASSERT result IS NOT true, 'FAIL: null-active admin should be false';
  RAISE NOTICE 'PASS: null-active admin is false';
END
$$;

-- Case 4: non-admin -> false
SELECT set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
DO $$
DECLARE result boolean;
BEGIN
  SELECT public.is_admin() INTO result;
  ASSERT result IS NOT true, 'FAIL: non-admin should be false';
  RAISE NOTICE 'PASS: non-admin is false';
END
$$;

-- Case 5: missing profile row -> false
SELECT set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
DO $$
DECLARE result boolean;
BEGIN
  SELECT public.is_admin() INTO result;
  ASSERT result IS NOT true, 'FAIL: missing profile should be false';
  RAISE NOTICE 'PASS: missing profile is false';
END
$$;

-- Case 6: absent auth user (no jwt sub set) -> false
SELECT set_config('request.jwt.claim.sub', '', false);
DO $$
DECLARE result boolean;
BEGIN
  SELECT public.is_admin() INTO result;
  ASSERT result IS NOT true, 'FAIL: absent auth user should be false';
  RAISE NOTICE 'PASS: absent auth user is false';
END
$$;

RESET ROLE;

-- UPDATE denial check for disabled admin (requires an UPDATE policy to be
-- meaningful; add one scoped to this test table only, mirroring the SELECT
-- policy, so disabled admins cannot bypass admin-only RLS via UPDATE either).
CREATE POLICY admin_only_update ON admin_only_demo
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT UPDATE ON admin_only_demo TO authenticated;

SET ROLE authenticated;

-- Case 7: disabled admin -> UPDATE denied (0 rows affected)
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
DO $$
DECLARE affected int;
BEGIN
  UPDATE admin_only_demo SET secret = 'tampered' WHERE id = 1;
  GET DIAGNOSTICS affected = ROW_COUNT;
  ASSERT affected = 0, 'FAIL: disabled admin should not be able to UPDATE admin_only_demo';
  RAISE NOTICE 'PASS: disabled admin denied UPDATE on admin_only_demo';
END
$$;

RESET ROLE;

ROLLBACK;
