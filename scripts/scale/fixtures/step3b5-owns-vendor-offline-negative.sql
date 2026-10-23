-- Synthetic, transaction-scoped OFFLINE-CLONE fixture only.
-- Observe current ownership helper vs review-only status-guard candidate.
-- qf.step3b5.expect_status_deny must be 'off' (before) or 'on' (after).
BEGIN;
DO $$
DECLARE
 v_owner uuid;
 v_vendor uuid;
 v_expected_deny boolean := current_setting('qf.step3b5.expect_status_deny',true)='on';
BEGIN
 SELECT id INTO v_owner FROM auth.users LIMIT 1;
 SELECT id INTO v_vendor FROM public.vendors LIMIT 1;
 IF v_owner IS NULL OR v_vendor IS NULL THEN RAISE EXCEPTION 'OFFLINE_FIXTURE_MISSING'; END IF;
 PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
 UPDATE public.vendors SET user_id=v_owner, is_active=TRUE, status='Approved' WHERE id=v_vendor;
 IF NOT public.owns_vendor(v_vendor) THEN RAISE EXCEPTION 'ACTIVE_OWNERSHIP_MUST_PASS'; END IF;
 UPDATE public.vendors SET is_active=FALSE WHERE id=v_vendor;
 IF public.owns_vendor(v_vendor)=v_expected_deny THEN
   RAISE EXCEPTION 'INACTIVE_OWNERSHIP_EXPECTATION_FAILED expected_deny=%', v_expected_deny;
 END IF;
 UPDATE public.vendors SET is_active=TRUE,status='Suspended' WHERE id=v_vendor;
 IF public.owns_vendor(v_vendor)=v_expected_deny THEN
   RAISE EXCEPTION 'SUSPENDED_OWNERSHIP_EXPECTATION_FAILED expected_deny=%', v_expected_deny;
 END IF;
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 IF public.owns_vendor(v_vendor) THEN RAISE EXCEPTION 'FORGED_OWNER_MUST_DENY'; END IF;
 RAISE NOTICE 'STEP3B5_VENDOR_OWNERSHIP_FIXTURE_PASS candidate_active=%',v_expected_deny;
END $$;
ROLLBACK;
