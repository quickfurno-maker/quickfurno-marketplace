-- P0-5 source-only forward/rollback proof for public.is_admin().
-- Disposable PostgreSQL 17 only. Never run on managed Staging/Production.
BEGIN;

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

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  role text NOT NULL DEFAULT 'user',
  is_active boolean
);

INSERT INTO public.profiles (id, role, is_active) VALUES
 ('11111111-1111-1111-1111-111111111111','admin',true),
 ('22222222-2222-2222-2222-222222222222','admin',false),
 ('33333333-3333-3333-3333-333333333333','user',true);

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.profiles TO authenticated;

\ir ../sql-candidates/vox_p0_5_is_admin_rollback_candidate.sql

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
DO $$
DECLARE v boolean;
BEGIN
  SELECT public.is_admin() INTO v;
  ASSERT v IS TRUE, 'FAIL: baseline disabled admin should still be admin before forward change';
  RAISE NOTICE 'PASS: baseline reproduces current Staging disabled-admin behavior';
END
$$;
RESET ROLE;

\ir ../sql-candidates/vox_p0_2_is_admin_active_candidate.sql

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
DO $$
DECLARE v boolean;
BEGIN
  SELECT public.is_admin() INTO v;
  ASSERT v IS TRUE, 'FAIL: active admin must remain admin after forward change';
  RAISE NOTICE 'PASS: forward keeps active admin allowed';
END
$$;

SELECT set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
DO $$
DECLARE v boolean;
BEGIN
  SELECT public.is_admin() INTO v;
  ASSERT v IS NOT TRUE, 'FAIL: disabled admin must be denied after forward change';
  RAISE NOTICE 'PASS: forward revokes disabled admin';
END
$$;

SELECT set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
DO $$
DECLARE v boolean;
BEGIN
  SELECT public.is_admin() INTO v;
  ASSERT v IS NOT TRUE, 'FAIL: non-admin must remain denied after forward change';
  RAISE NOTICE 'PASS: forward keeps non-admin denied';
END
$$;
RESET ROLE;

\ir ../sql-candidates/vox_p0_5_is_admin_rollback_candidate.sql

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
DO $$
DECLARE v boolean;
BEGIN
  SELECT public.is_admin() INTO v;
  ASSERT v IS TRUE, 'FAIL: rollback must restore baseline disabled-admin behavior';
  RAISE NOTICE 'PASS: rollback restores exact baseline disabled-admin behavior';
END
$$;

SELECT set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
DO $$
DECLARE v boolean;
BEGIN
  SELECT public.is_admin() INTO v;
  ASSERT v IS TRUE, 'FAIL: rollback must preserve active admin';
  RAISE NOTICE 'PASS: rollback preserves active admin';
END
$$;

SELECT set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
DO $$
DECLARE v boolean;
BEGIN
  SELECT public.is_admin() INTO v;
  ASSERT v IS NOT TRUE, 'FAIL: rollback must keep non-admin denied';
  RAISE NOTICE 'PASS: rollback keeps non-admin denied';
END
$$;
RESET ROLE;

ROLLBACK;
