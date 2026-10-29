-- P0-6 direct proof of the exact Staging migration candidate and rollback.
-- Disposable PostgreSQL 17 only; never managed Staging/Production.
BEGIN;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
END $$;
CREATE TABLE public.profiles (id uuid primary key, role text not null, is_active boolean);
INSERT INTO public.profiles VALUES
('11111111-1111-1111-1111-111111111111','admin',true),
('22222222-2222-2222-2222-222222222222','admin',false),
('33333333-3333-3333-3333-333333333333','admin',null),
('44444444-4444-4444-4444-444444444444','user',true);
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.profiles TO authenticated;

-- Reproduce exact observed Staging baseline and grants before forward replacement.
\ir ../sql-candidates/vox_p0_5_is_admin_rollback_candidate.sql
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;
\ir ../sql-candidates/vox_p0_6_is_admin_staging_preflight_readonly.sql

-- Apply exact P0-6 candidate.
\ir ../sql-candidates/vox_p0_6_is_admin_staging_migration_candidate.sql
\ir ../sql-candidates/vox_p0_6_is_admin_staging_postflight_readonly.sql

DO $$
DECLARE sd boolean; vol "char"; cfg text[];
BEGIN
  SELECT prosecdef, provolatile, proconfig INTO sd, vol, cfg
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='is_admin' AND p.pronargs=0;
  ASSERT sd IS TRUE, 'FAIL: P0-6 must remain SECURITY DEFINER';
  ASSERT vol = 's', 'FAIL: P0-6 must remain STABLE';
  ASSERT cfg @> ARRAY['search_path=public'], 'FAIL: P0-6 must keep search_path=public';
  RAISE NOTICE 'PASS: P0-6 function properties preserved';
END $$;

DO $$
BEGIN
  ASSERT has_function_privilege('authenticated','public.is_admin()','EXECUTE') IS TRUE,
    'FAIL: authenticated EXECUTE must be preserved';
  ASSERT has_function_privilege('anon','public.is_admin()','EXECUTE') IS FALSE,
    'FAIL: anon EXECUTE must remain denied';
  RAISE NOTICE 'PASS: P0-6 EXECUTE grants preserved';
END $$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
DO $$ DECLARE v boolean; BEGIN SELECT public.is_admin() INTO v; ASSERT v IS TRUE; RAISE NOTICE 'PASS: P0-6 active admin allowed'; END $$;
SELECT set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
DO $$ DECLARE v boolean; BEGIN SELECT public.is_admin() INTO v; ASSERT v IS NOT TRUE; RAISE NOTICE 'PASS: P0-6 disabled admin denied'; END $$;
SELECT set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
DO $$ DECLARE v boolean; BEGIN SELECT public.is_admin() INTO v; ASSERT v IS NOT TRUE; RAISE NOTICE 'PASS: P0-6 NULL-active admin denied'; END $$;
SELECT set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
DO $$ DECLARE v boolean; BEGIN SELECT public.is_admin() INTO v; ASSERT v IS NOT TRUE; RAISE NOTICE 'PASS: P0-6 non-admin denied'; END $$;
RESET ROLE;

-- Exact rollback candidate must restore observed Staging baseline and retain grants.
\ir ../sql-candidates/vox_p0_6_is_admin_staging_rollback_migration_candidate.sql
DO $$
BEGIN
  ASSERT has_function_privilege('authenticated','public.is_admin()','EXECUTE') IS TRUE,
    'FAIL: rollback must preserve authenticated EXECUTE';
  ASSERT has_function_privilege('anon','public.is_admin()','EXECUTE') IS FALSE,
    'FAIL: rollback must preserve anon denial';
  RAISE NOTICE 'PASS: rollback preserves EXECUTE grants';
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
DO $$ DECLARE v boolean; BEGIN SELECT public.is_admin() INTO v; ASSERT v IS TRUE; RAISE NOTICE 'PASS: P0-6 rollback restores exact baseline'; END $$;
RESET ROLE;
ROLLBACK;
