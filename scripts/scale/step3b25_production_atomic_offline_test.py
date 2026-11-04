"""Fail-closed tests for the private, disposable Production clone transaction."""
import importlib.util
from pathlib import Path
import unittest

DIR = Path(__file__).parent
spec = importlib.util.spec_from_file_location("prod_atomic", DIR / "step3b25_production_atomic_offline.py")
assert spec is not None and spec.loader is not None
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

stage_spec = importlib.util.spec_from_file_location("stage_fixtures", DIR / "step3b21_staging_atomic_offline_test.py")
assert stage_spec is not None and stage_spec.loader is not None
stage = importlib.util.module_from_spec(stage_spec)
stage_spec.loader.exec_module(stage)


def fixtures():
    originals = stage.fixtures()
    originals[0] = (originals[0]
        .replace("b3437e2ec13bcc794f77783eab598749",
                 "767228fc486c378f500df83af36da4b6")
        .replace("de829b5d5c1f5e2109407805454bcbf7",
                 "fccc2594dd5ce49bc12c590f6f9f2dff")
        .replace("STAGING_SCOPE_MISMATCH", "PRODUCTION_SCOPE_MISMATCH"))
    originals[1] = originals[1].replace(
        "STAGING_AUTOMATION_TARGET_SCOPE_DRIFT",
        "PRODUCTION_AUTOMATION_TARGET_SCOPE_DRIFT")
    return originals


class ProductionAtomicTests(unittest.TestCase):
    def test_one_atomic_transaction_only(self):
        sql = mod.make_production_sql(fixtures())
        self.assertEqual(sql.count("\nBEGIN;"), 1)
        self.assertEqual(sql.count("\nCOMMIT;"), 1)
        self.assertIn("QF_PROD_OFFLINE_ONLY_WRONG_DATABASE", sql)
        self.assertIn("current_database()<>'qf_purge_production'", sql)
        self.assertIn("qf_source_production", sql)
        self.assertNotIn("public.dblink", sql)
        self.assertIn("ACCESS EXCLUSIVE MODE", sql)

    def test_preserves_all_auth_until_separate_admin_review(self):
        sql = mod.make_production_sql(fixtures())
        self.assertIn("(SELECT count(*) FROM auth.users)<>10", sql)
        self.assertNotIn("DELETE FROM auth.users", sql)
        self.assertIn("QF_PROD_OFFLINE_AUTH_WAS_CHANGED", sql)

    def test_exact_production_snapshot_guards(self):
        sql = mod.make_production_sql(fixtures())
        for item in [
            "PRODUCTION_SCOPE_MISMATCH",
            "PRODUCTION_AUTOMATION_TARGET_SCOPE_DRIFT",
            "767228fc486c378f500df83af36da4b6",
            "fccc2594dd5ce49bc12c590f6f9f2dff",
            "(SELECT count(*) FROM public.lead_assignment_events)<>73",
            "(SELECT count(*) FROM public.automation_transport_requests)<>32165",
            "(SELECT count(*) FROM public.automation_transport_requests)<>32114",
        ]:
            self.assertIn(item, sql)

    def test_missing_or_modified_production_fingerprints_refused(self):
        p = fixtures()
        p[0] = p[0].replace("767228fc486c378f500df83af36da4b6", "bad")
        with self.assertRaisesRegex(ValueError, "PRODUCTION_GUARD_MISSING"):
            mod.make_production_sql(p)

    def test_modified_automation_guard_refused(self):
        p = fixtures()
        p[1] = p[1].replace("PRODUCTION_AUTOMATION_TARGET_SCOPE_DRIFT", "bad")
        with self.assertRaisesRegex(ValueError, "PRODUCTION_GUARD_MISSING"):
            mod.make_production_sql(p)

    def test_source_pin_checks_remain_mandatory(self):
        with self.assertRaisesRegex(ValueError, "PRIVATE_SOURCE_SHA256_MISMATCH"):
            mod.verify_private_sources([b"modified"] * 4)

    def test_no_unscoped_or_raw_auth_delete(self):
        for operation in [
            "DELETE FROM auth.users",
            "TRUNCATE TABLE public.vendors",
            "SET session_replication_role=replica",
            "DROP TRIGGER x",
        ]:
            p = fixtures()
            p[0] = p[0].replace("COMMIT;", operation + ";\nCOMMIT;")
            with self.assertRaisesRegex(ValueError, "UNSCOPED_OR_AUTH_OPERATION"):
                mod.make_production_sql(p)

    def test_no_unexpected_transaction_framing(self):
        p = fixtures()
        p[2] = p[2].replace("COMMIT;", "")
        with self.assertRaisesRegex(ValueError, "BAD_TRANSACTION_BOUNDARIES"):
            mod.make_production_sql(p)

    def test_postflight_covers_trigger_fk_and_opaque_scan(self):
        sql = mod.make_production_sql(fixtures())
        self.assertIn("QF_PROD_OFFLINE_INTERNAL_CONSTRAINT_TRIGGER_DISABLED", sql)
        self.assertIn("tgisinternal AND tgconstraint<>0 AND tgenabled<>'O'", sql)
        for item in [
            "QF_PROD_OFFLINE_FK_INVALID",
            "QF_PROD_OFFLINE_PROTECTED_TRIGGER_DISABLED",
            "QF_PROD_OFFLINE_UUID_REFERENCE_OR_SCAN_ERROR",
            "QF_PROD_OFFLINE_ROOT_POSTFLIGHT_FAIL",
        ]:
            self.assertIn(item, sql)


if __name__ == "__main__":
    unittest.main()
