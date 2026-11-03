"""Pure source tests for the protected offline Staging atomic erasure generator."""
import importlib.util
from pathlib import Path
import unittest

PATH = Path(__file__).with_name("step3b21_staging_atomic_offline.py")
SPEC = importlib.util.spec_from_file_location("qf_atomic", PATH)
assert SPEC and SPEC.loader
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)


def fixtures():
    root = """-- LOCAL DISPOSABLE REHEARSAL ONLY
BEGIN;
SELECT 'b3437e2ec13bcc794f77783eab598749',
       'de829b5d5c1f5e2109407805454bcbf7',
       'STAGING_SCOPE_MISMATCH','STAGING_CANARY_MISSING',
       'trg_lead_assignment_events_immutable','trg_vcam_immutable',
       'trg_vin_immutable';
COMMIT;
"""
    autom = """-- OFFLINE PG17 scratch only
BEGIN;
CREATE TEMP TABLE qf_target_action AS
WITH pattern AS (
 SELECT p.pattern FROM public.dblink('dbname='||replace(current_database(),'qf_purge_','qf_source_')||' user=postgres',
 $source$
 SELECT string_agg(s,'|' ORDER BY s) FROM (SELECT 'abc' AS s) x
 $source$) AS p(pattern text)
)
SELECT id FROM public.automation_action_requests WHERE false;
SELECT 'STAGING_AUTOMATION_TARGET_SCOPE_DRIFT',
       'trg_automation_action_requests_no_delete';
COMMIT;
"""
    opaque = """-- OFFLINE ONLY: residual ID-bearing rows
BEGIN;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA public;
CREATE TEMP TABLE qf_purge_regex AS
SELECT x.pattern FROM public.dblink(
 'dbname='||replace(current_database(),'qf_purge_','qf_source_')||' user=postgres',
 $source$ SELECT 'test' $source$
) AS x(pattern text);
COMMIT;
"""
    residual = """-- OFFLINE ONLY. Detect residual references
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA public;
DO $scan$
DECLARE pattern text;
BEGIN
 SELECT x.pattern INTO pattern
 FROM public.dblink('dbname='||'qf_source_staging' || ' user=postgres','SELECT 1') AS x(pattern text);
END $scan$;
"""
    return [root, autom, opaque, residual]


class AtomicStagingOfflineTests(unittest.TestCase):
    def test_one_transaction_and_hard_scratch_guard(self):
        sql = MOD.make_sql(fixtures())
        self.assertEqual(sql.count("\nBEGIN;"), 1)
        self.assertEqual(sql.count("\nCOMMIT;"), 1)
        self.assertIn("current_database()<>'qf_purge_staging'", sql)
        self.assertIn("LOCK TABLE public.vendors", sql)
        self.assertIn("ACCESS EXCLUSIVE MODE", sql)
        self.assertIn("QF_ATOMIC_DISABLED_TRIGGER", sql)
        self.assertIn("QF_ATOMIC_UUID_REFERENCE_OR_SCAN_ERROR", sql)

    def test_all_original_ids_are_transaction_local_and_no_dblink(self):
        sql = MOD.make_sql(fixtures())
        self.assertIn("qf_original_scope_pattern", sql)
        self.assertIn("CREATE TEMP TABLE qf_original_scope_pattern", sql)
        self.assertNotIn("public.dblink", sql)
        self.assertNotIn("CREATE EXTENSION IF NOT EXISTS dblink", sql)

    def test_wrong_inputs_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "FOUR_PRIVATE_SOURCE_FILES_REQUIRED"):
            MOD.make_sql(fixtures()[:3])
        p = fixtures()
        p[0] = p[0].replace("LOCAL DISPOSABLE", "OTHER")
        with self.assertRaisesRegex(ValueError, "INVALID_OFFLINE_SOURCE"):
            MOD.make_sql(p)

    def test_missing_exact_uuid_guard_is_rejected(self):
        p = fixtures()
        p[0] = p[0].replace("b3437e2ec13bcc794f77783eab598749", "wrong")
        with self.assertRaisesRegex(ValueError, "PROTECTED_GUARD_MISSING"):
            MOD.make_sql(p)

    def test_no_auth_delete_or_broad_truncate(self):
        for token in ["DELETE FROM auth.users", "TRUNCATE TABLE public.vendors",
                      "SET session_replication_role=replica", "DROP TRIGGER x"]:
            p = fixtures()
            p[0] = p[0].replace("COMMIT;", token + ";\nCOMMIT;")
            with self.assertRaisesRegex(ValueError, "UNSCOPED_OR_AUTH_OPERATION"):
                MOD.make_sql(p)

    def test_all_sql_sections_must_share_one_transaction(self):
        p = fixtures()
        p[2] = p[2].replace("COMMIT;", "")
        with self.assertRaisesRegex(ValueError, "BAD_TRANSACTION_BOUNDARIES"):
            MOD.make_sql(p)

    def test_broken_cross_database_replacement_fails_closed(self):
        p = fixtures()
        p[1] = p[1].replace("AS p(pattern text)", "AS other(pattern text)")
        with self.assertRaisesRegex(ValueError, "UNABLE_TO_REMOVE_CROSS_DATABASE_LINK"):
            MOD.make_sql(p)

    def test_private_source_sha256_must_match_exact_archived_probes(self):
        self.assertEqual(len(MOD.SOURCE_SHA256), 4)
        with self.assertRaisesRegex(ValueError, "PRIVATE_SOURCE_SHA256_MISMATCH"):
            MOD.verify_private_sources([b"tampered"] * 4)
        with self.assertRaisesRegex(ValueError, "FOUR_PRIVATE_SOURCE_FILES_REQUIRED"):
            MOD.verify_private_sources([b"tampered"])


if __name__ == "__main__":
    unittest.main()
