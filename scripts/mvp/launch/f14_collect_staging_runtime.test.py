import unittest
import sys
import importlib.util
from pathlib import Path

p=Path(__file__).with_name("f14_collect_staging_runtime.py")
spec=importlib.util.spec_from_file_location("f14collector",p)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

class F14RuntimeTests(unittest.TestCase):
    def fixture(self,entries=None):
        env={
         "WHATSAPP_ACCESS_TOKEN":"HIGHLY_SECRET_TOKEN_NEVER_PRINT_123",
         "WHATSAPP_WABA_ID":mod.CLIENT_WABA,
         "WHATSAPP_PHONE_NUMBER_ID":mod.CLIENT_PHONE,
         "WHATSAPP_VENDOR_ACCESS_TOKEN":"HIGHLY_SECRET_VENDOR_TOKEN_NEVER_PRINT",
         "WHATSAPP_VENDOR_WABA_ID":mod.VENDOR_WABA,
         "WHATSAPP_VENDOR_PHONE_NUMBER_ID":mod.VENDOR_PHONE,
         "WHATSAPP_APP_SECRET":"HIGHLY_SECRET_APP_SECRET",
         "WHATSAPP_WEBHOOK_VERIFY_TOKEN":"HIGHLY_SECRET_VERIFY",
         "SEND_SMS_HOOK_SECRETS":"HIGHLY_SECRET_AUTH_HOOK",
        }
        if entries: env.update(entries)
        return [{
         "Name":"/qf-core-staging",
         "Image":"sha256:"+"a"*64,
         "Config":{"Image":"qf-core-staging:release-test", "Env":[k+"="+v for k,v in env.items()]},
         "State":{"Running":True,"StartedAt":"2026-11-07T00:00:00Z"},
        }]
    def test_f14_01_exact_sender_pair_different(self):
        x=mod.evaluate(self.fixture(),live=False)
        self.assertEqual(x["senderClassification"],"RIYA_CLIENT")
        self.assertTrue(x["vendorPairExact"])
    def test_f14_02_no_secret_value_anywhere(self):
        import json
        raw=json.dumps(mod.evaluate(self.fixture(),live=True))
        self.assertNotIn("HIGHLY_SECRET",raw)
    def test_f14_03_stale_default_rejected(self):
        x=mod.evaluate(self.fixture({"WHATSAPP_WABA_ID":mod.STALE_WABA,"WHATSAPP_PHONE_NUMBER_ID":mod.VENDOR_PHONE}),live=True)
        self.assertEqual(x["senderClassification"],"STALE_VENDOR_WABA")
    def test_f14_04_vendor_as_default_rejected(self):
        x=mod.evaluate(self.fixture({"WHATSAPP_WABA_ID":mod.VENDOR_WABA,"WHATSAPP_PHONE_NUMBER_ID":mod.VENDOR_PHONE}),live=True)
        self.assertEqual(x["senderClassification"],"VENDOR_MISUSED_AS_DEFAULT")
    def test_f14_05_cross_waba_swap_rejected(self):
        x=mod.evaluate(self.fixture({"WHATSAPP_VENDOR_WABA_ID":mod.CLIENT_WABA}),live=True)
        self.assertFalse(x["vendorPairExact"])
    def test_f14_06_missing_token_not_misrepresented(self):
        x=mod.evaluate(self.fixture({"WHATSAPP_VENDOR_ACCESS_TOKEN":""}),live=True)
        self.assertFalse(x["vendorTokenPresent"])
        self.assertIn("WHATSAPP_VENDOR_ACCESS_TOKEN",x["requiredEnvMissing"])
    def test_f14_07_fixture_is_not_live(self):
        x=mod.evaluate(self.fixture(),live=False)
        self.assertFalse(x["networkExecuted"])
    def test_f14_08_even_green_never_grants_deploy(self):
        x=mod.evaluate(self.fixture(),live=True)
        self.assertEqual(x["releaseVerdict"],"HOLD")
        self.assertFalse(x["mayDeployStaging"])
        self.assertFalse(x["maySendOtp"])
    def test_f14_09_multiple_containers_fail(self):
        with self.assertRaises(ValueError):mod.evaluate(self.fixture()*2,live=True)
    def test_f14_10_wrong_container_fail(self):
        a=self.fixture();a[0]["Name"]="/qf-core-prod"
        with self.assertRaises(ValueError):mod.evaluate(a,live=True)
    def test_f14_11_environment_names_not_secret_values(self):
        x=mod.evaluate(self.fixture(),live=True)
        self.assertEqual(len(x["requiredEnvPresent"]),9)
        self.assertFalse(x["environmentValuesEmitted"])
    def test_f14_12_sha_field_strictly_hex_or_redacted(self):
        x=mod.evaluate(self.fixture({"QF_RELEASE_SHA":"ULTRASECRETVALUE_NOT_HEX_HIDDEN_12345678"}),live=True)
        self.assertEqual(x["imageReleaseSha"],"UNVERIFIED")

if __name__=="__main__": unittest.main()
