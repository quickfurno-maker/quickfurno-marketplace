-- Step3B5 offline clone-only admin revocation fixture; changes are rolled back.
BEGIN;
DO $$
DECLARE
 v_admin uuid;
 v_expected_deny boolean := current_setting('qf.step3b5.expect_admin_deny',true)='on';
BEGIN
 SELECT id INTO v_admin FROM public.profiles WHERE role='admin' LIMIT 1;
 IF v_admin IS NULL THEN RAISE EXCEPTION 'NO_ADMIN_TEST_PRINCIPAL'; END IF;
 PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
 UPDATE public.profiles SET is_active=TRUE WHERE id=v_admin;
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'ACTIVE_ADMIN_MUST_PASS'; END IF;
 UPDATE public.profiles SET is_active=FALSE WHERE id=v_admin;
 IF public.is_admin()=v_expected_deny THEN
  RAISE EXCEPTION 'INACTIVE_ADMIN_DENIAL_EXPECTATION_FAILED expected_deny=%',v_expected_deny;
 END IF;
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 IF public.is_admin() THEN RAISE EXCEPTION 'UNMAPPED_ADMIN_ID_MUST_DENY'; END IF;
 RAISE NOTICE 'STEP3B5_ADMIN_REVOCATION_FIXTURE_PASS guard_applied=%',v_expected_deny;
END $$;
ROLLBACK;
