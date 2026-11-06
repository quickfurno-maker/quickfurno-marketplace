"""F10 anti-bypass recertification: preserve historical source pins, attack
the EXACT three approved deltas, detect cross-lane provider identity bypass.
No DB, HTTP, API key, Meta token, production service or writes.
"""
import importlib.util
import pathlib
import unittest

REPO=pathlib.Path(__file__).resolve().parents[3]
MOD=REPO/"scripts/mvp/launch/verify-f10-cross-phase-whatsapp-recert.py"
spec=importlib.util.spec_from_file_location("f10_under_test", MOD)
f10=importlib.util.module_from_spec(spec)
spec.loader.exec_module(f10)
CURRENT={x:(REPO/x).read_text(encoding="utf8") for x in f10.EXPECTED_NEW}
ORIGINAL={
 x:f10.git_show(REPO,
    f10.F6_SOURCE if x=="services/supabaseSendSmsHookService.ts" else
    f10.F5_SOURCE if x.startswith("services/returningWhatsapp") else f10.F1_SOURCE,
    x).decode("utf8").replace("\r\n","\n")
 for x in f10.EXPECTED_NEW
}
COMP="app/api/vendor/onboarding/complete/route.ts"
EVID="services/vendorOtpEvidenceReadService.ts"
RETURN="services/returningWhatsappVendorLoginService.ts"
HOOK="services/supabaseSendSmsHookService.ts"

class TestF10ProtectedRecertification(unittest.TestCase):
 def test_01_current_exact_source_approved(self):
  self.assertEqual(f10.audit(REPO),[])
 def test_02_only_exact_three_source_deltas_claimed(self):
  self.assertEqual(set(f10.EXPECTED_NEW),{COMP,EVID,RETURN,HOOK})
 def test_03_new_source_hashes_pinned(self):
  for path,sha in f10.EXPECTED_NEW.items():
   self.assertEqual(f10.digest((REPO/path).read_bytes()),sha)
 def test_04_original_pinned_F1_drift_is_not_hidden(self):
  self.assertEqual(f10.HISTORICAL_F1,{
   "source_hash_mismatch:app/api/vendor/onboarding/complete/route.ts",
   "source_hash_mismatch:services/vendorOtpEvidenceReadService.ts"})
 def test_05_original_F5_drift_is_not_hidden(self):
  self.assertEqual(f10.HISTORICAL_F5,{
   "missing_security_contract:meta_verified_only",
   "source_modified:services/returningWhatsappVendorLoginService.ts"})
 def test_06_F6_sender_security_still_passes(self):
  self.assertEqual(f10.load_module(REPO/"scripts/mvp/launch/verify-whatsapp-lane-isolation-scope.py","f6_test").audit(REPO),[])
 def test_07_original_to_current_complete_route_delta_exact(self):
  self.assertTrue(f10.assess_delta(COMP,ORIGINAL[COMP],CURRENT[COMP]))
 def test_08_signup_route_wrong_client_provider_rejected(self):
  tampered=CURRENT[COMP].replace('return p==="meta_whatsapp_cloud" ? p : null;','return p==="meta_whatsapp" ? p : null;')
  self.assertFalse(f10.assess_delta(COMP,ORIGINAL[COMP],tampered))
 def test_09_signup_route_mock_sender_rejected(self):
  tampered=CURRENT[COMP].replace('return p==="meta_whatsapp_cloud" ? p : null;','return p==="mock" ? p : null;')
  self.assertFalse(f10.assess_delta(COMP,ORIGINAL[COMP],tampered))
 def test_10_signup_route_bypass_enablement_rejected(self):
  tampered=CURRENT[COMP].replace('if(!enabled())return null;','')
  self.assertFalse(f10.assess_delta(COMP,ORIGINAL[COMP],tampered))
 def test_11_old_to_new_returning_delta_exact_two_edits(self):
  self.assertTrue(f10.assess_delta(RETURN,ORIGINAL[RETURN],CURRENT[RETURN]))
 def test_12_client_template_reuse_for_vendor_rejected(self):
  bad=CURRENT[RETURN].replace('"meta_whatsapp_cloud"', '"meta_whatsapp"')
  self.assertFalse(f10.assess_delta(RETURN,ORIGINAL[RETURN],bad))
 def test_13_returning_guard_bypass_denied(self):
  bad=CURRENT[RETURN].replace('process.env.QF_RUNTIME_ENV === "staging"','true')
  self.assertFalse(f10.assess_delta(RETURN,ORIGINAL[RETURN],bad))
 def test_14_evidence_exact_source_shape(self):
  self.assertTrue(f10.assess_delta(EVID,ORIGINAL[EVID],CURRENT[EVID]))
 def test_15_missing_exact_account_id_denied(self):
  bad=CURRENT[EVID].replace('.eq("provider_account_id", vendorAccountId)','')
  self.assertFalse(f10.assess_delta(EVID,ORIGINAL[EVID],bad))
 def test_16_missing_row_account_binding_denied(self):
  bad=CURRENT[EVID].replace('row.provider_account_id !== vendorAccountId','true')
  self.assertFalse(f10.assess_delta(EVID,ORIGINAL[EVID],bad))
 def test_17_vendor_waba_phone_mismatch_denied(self):
  bad=CURRENT[EVID].replace('1088396637681784','1333595106493545')
  self.assertFalse(f10.assess_delta(EVID,ORIGINAL[EVID],bad))
 def test_18_missing_ownership_identity_validation_denied(self):
  bad=CURRENT[EVID].replace('hasValidVendorAccountIdentity(accounts[0])','true')
  self.assertFalse(f10.assess_delta(EVID,ORIGINAL[EVID],bad))
 def test_19_missing_signed_auth_claim_denied(self):
  bad=CURRENT[EVID].replace('readClaimedVendorOtpPurpose','readMissingVendorOtpPurpose')
  self.assertFalse(f10.assess_delta(EVID,ORIGINAL[EVID],bad))
 def test_20_wrong_provider_key_denied(self):
  bad=CURRENT[EVID].replace('providerRequired !== VENDOR_OTP_PROVIDER_KEY','providerRequired !== "meta_whatsapp"')
  self.assertFalse(f10.assess_delta(EVID,ORIGINAL[EVID],bad))
 def test_21_fail_closed_response_never_release_authorizes(self):
  r=f10.report(REPO)
  self.assertTrue(r["valid"])
  self.assertIs(r["release_authorized"],False)
  self.assertIs(r["staging_auth_hook_live_certified"],False)
  self.assertIs(r["otp_delivered"],False)
  self.assertIs(r["production_deployment_authorized"],False)
 def test_22_modified_preexisting_verifier_fails_recognition(self):
  # Old verifier code itself must remain byte-identical, checked by Git ref.
  self.assertFalse(any("protected_historical_file_changed" in x for x in f10.audit(REPO)))
 def test_23_original_f6_to_current_hook_signed_route_delta(self):
  self.assertTrue(f10.assess_delta(HOOK,ORIGINAL[HOOK],CURRENT[HOOK]))
 def test_24_vendor_purpose_routing_removed_fails(self):
  bad=CURRENT[HOOK].replace('if (signedPurpose === "vendor_login")','if (false)')
  self.assertFalse(f10.assess_delta(HOOK,ORIGINAL[HOOK],bad))
 def test_25_server_signed_purpose_claim_removed_fails(self):
  bad=CURRENT[HOOK].replace('await claimSignedAuthOtpPurpose(','await unsignedCallerPurpose(')
  self.assertFalse(f10.assess_delta(HOOK,ORIGINAL[HOOK],bad))
 def test_26_client_guard_removed_fails(self):
  bad=CURRENT[HOOK].replace('if (!canUseSignedClientOtpDispatch(signedPurpose','if (false')
  self.assertFalse(f10.assess_delta(HOOK,ORIGINAL[HOOK],bad))
 def test_27_vendor_signer_id_removed_fails(self):
  bad=CURRENT[HOOK].replace('verifiedWebhookId: headers.webhookId','verifiedWebhookId: "unsigned"')
  self.assertFalse(f10.assess_delta(HOOK,ORIGINAL[HOOK],bad))
 def test_28_vendor_dispatch_not_authorized_by_client_token(self):
  bad=CURRENT[HOOK].replace('await deliverVendorWhatsappOtp({','await deliverClientLoginOtp({')
  self.assertFalse(f10.assess_delta(HOOK,ORIGINAL[HOOK],bad))
 def test_29_explicit_vendor_dispatch_result_required(self):
  bad=CURRENT[HOOK].replace('dispatchAttempted: delivery.dispatchAttempted','dispatchAttempted: true')
  self.assertFalse(f10.assess_delta(HOOK,ORIGINAL[HOOK],bad))

if __name__=="__main__":
 unittest.main()
