#!/usr/bin/env python3
"""Hostile tests for the read-only F18 source-to-managed-ledger attestation."""
from pathlib import Path
from copy import deepcopy
import importlib.util
import json
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[3]
HERE=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location("f18_parity",HERE/"f18_verify_managed_sql_parity.py")
module=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)
BASE=json.loads((ROOT/module.MANIFEST).read_text(encoding="utf-8"))

class F18SqlParityTests(unittest.TestCase):
    def test_01_actual_verified_managed_snapshot(self):
        r=module.verify(ROOT,deepcopy(BASE))
        self.assertTrue(r["valid"],r["errors"])
        self.assertEqual(r["verifiedVersionCount"],10)
        self.assertEqual(r["releaseVerdict"],"HOLD")
        self.assertFalse(r["mayDeployStaging"])
        self.assertFalse(r["maySendOtp"])
        self.assertFalse(r["actualDatabaseRecheckedByCI"])
    def test_02_a_single_sql_byte_change_denies(self):
        e=BASE["versions"][0]
        source=(ROOT/"supabase"/"migrations"/(e["version"]+"_"+e["name"]+".sql")).read_bytes()
        self.assertIn("SOURCE_SHA256_DRIFT",module.verify_one(source+b" -- changed",e))
    def test_03_source_statement_count_drift_denies(self):
        e=BASE["versions"][0]
        self.assertIn("STATEMENT_COUNT_DRIFT",module.verify_one(b"SELECT 1;",e))
    def test_04_forged_managed_fingerprint_denies(self):
        evidence=deepcopy(BASE);e=evidence["versions"][4]
        e["storedStatementMD5"]="0"*32
        self.assertFalse(module.verify(ROOT,evidence)["valid"])
    def test_05_duplicate_migration_versions_denied(self):
        evidence=deepcopy(BASE)
        evidence["versions"][1]=deepcopy(evidence["versions"][0])
        self.assertFalse(module.verify(ROOT,evidence)["valid"])
    def test_06_wrong_staging_project_denied(self):
        e=deepcopy(BASE);e["stagingProjectId"]="another-project"
        self.assertFalse(module.verify(ROOT,e)["valid"])
    def test_07_no_deployment_authorization_in_evidence(self):
        e=deepcopy(BASE);e["mayDeployStaging"]=True
        self.assertFalse(module.verify(ROOT,e)["valid"])
    def test_08_no_otp_authorization_in_evidence(self):
        e=deepcopy(BASE);e["maySendOtp"]=True
        self.assertFalse(module.verify(ROOT,e)["valid"])
    def test_09_no_production_authorization_in_evidence(self):
        e=deepcopy(BASE);e["mayDeployProduction"]=True
        self.assertFalse(module.verify(ROOT,e)["valid"])
    def test_10_missing_or_duplicate_file_names_rejected(self):
        e=deepcopy(BASE);e["versions"][0]["name"]="unknown_sql"
        self.assertFalse(module.verify(ROOT,e)["valid"])
    def test_11_no_unapproved_canonicalization_mode(self):
        e=deepcopy(BASE);e["versions"][0]["comparisonMode"]="remove_literals"
        self.assertFalse(module.verify(ROOT,e)["valid"])
    def test_12_single_quoted_semicolon_preserved(self):
        self.assertEqual(module.split_pg_sql("SELECT ';'; SELECT 1;"),["SELECT ';'","SELECT 1"])
    def test_13_nested_comments_preserved(self):
        self.assertEqual(module.split_pg_sql("/* outer /* inner; */ outer */ SELECT 2;"),["/* outer /* inner; */ outer */ SELECT 2"])
    def test_14_dollar_quote_semicolon_preserved(self):
        self.assertEqual(module.split_pg_sql("DO $x$ BEGIN PERFORM 1; END $x$;"),["DO $x$ BEGIN PERFORM 1; END $x$"])
    def test_15_empty_tag_dollar_quote_preserved(self):
        self.assertEqual(module.split_pg_sql("DO $$ BEGIN RAISE NOTICE 'a;b'; END $$;"),["DO $$ BEGIN RAISE NOTICE 'a;b'; END $$"])
    def test_16_quoted_identifiers_preserved(self):
        self.assertEqual(module.split_pg_sql('SELECT "a;b" FROM x;'),['SELECT "a;b" FROM x'])
    def test_17_missing_dollar_close_denies(self):
        with self.assertRaises(ValueError):
            module.split_pg_sql("DO $x$ BEGIN PERFORM 1;")
    def test_18_unterminated_block_comment_denies(self):
        with self.assertRaises(ValueError):
            module.split_pg_sql("SELECT 1; /* unterminated")
    def test_19_f7_whole_file_raw_method_is_necessary(self):
        for e in BASE["versions"][7:9]:
            src=(ROOT/"supabase"/"migrations"/(e["version"]+"_"+e["name"]+".sql")).read_bytes()
            self.assertEqual(module.verify_one(src,e),[])
            forged={**e,"comparisonMode":"split_trimmed_join"}
            self.assertIn("MANAGED_LEDGER_CONTENT_DIFFERENCE",module.verify_one(src,forged))
    def test_20_all_sha256_source_entries_valid(self):
        for e in BASE["versions"]:
            path=ROOT/"supabase"/"migrations"/(e["version"]+"_"+e["name"]+".sql")
            self.assertEqual(module.verify_one(path.read_bytes(),e),[],e["version"])

if __name__=="__main__":
    unittest.main()
