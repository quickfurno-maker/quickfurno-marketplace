"""Assemble exact November Staging cleanup into ONE offline scratch transaction.
The result must never be deployed to managed Supabase. No network or DB code here.
"""
from pathlib import Path
import argparse
import hashlib
import re

HEADERS = (
    "LOCAL DISPOSABLE REHEARSAL ONLY",
    "OFFLINE PG17 scratch only",
    "OFFLINE ONLY: residual ID-bearing rows",
    "OFFLINE ONLY. Detect residual references",
)
NAMES = ("roots", "automation", "opaque", "residual")
SOURCE_SHA256 = (
    "e34c077cb8e04d819ff8fcec7969caf0a73e9cca94abeb4a314441ad159cfc6b",
    "9cd0c28416bd799ecb142804a6657858b66f6bc2aa66348ae7fd39233cd8026a",
    "a82ebb9457970f758bd3925bdac68084f984656124f480aa9ad0720eec18c637",
    "dae343b0623f0eb51d9f0471af8b00396caec101dcaceb1fc85f5950335c32aa",
)


def verify_private_sources(raw_sources: list[bytes]) -> None:
    if len(raw_sources) != 4:
        raise ValueError("FOUR_PRIVATE_SOURCE_FILES_REQUIRED")
    for name, raw, expected in zip(NAMES, raw_sources, SOURCE_SHA256):
        if hashlib.sha256(raw).hexdigest() != expected:
            raise ValueError("PRIVATE_SOURCE_SHA256_MISMATCH:" + name)

REQUIRED = (
    "b3437e2ec13bcc794f77783eab598749",
    "de829b5d5c1f5e2109407805454bcbf7",
    "STAGING_SCOPE_MISMATCH",
    "STAGING_AUTOMATION_TARGET_SCOPE_DRIFT",
    "STAGING_CANARY_MISSING",
    "trg_lead_assignment_events_immutable",
    "trg_vcam_immutable",
    "trg_vin_immutable",
    "trg_automation_action_requests_no_delete",
)
PROHIBITED = (
    r"\bsession_replication_role\b",
    r"\bTRUNCATE\s+TABLE\b",
    r"\bDROP\s+(?:TABLE|TRIGGER)\b",
    r"\bDELETE\s+FROM\s+auth\.users\b",
)


def _unwrap(value: str, idx: int) -> str:
    label = NAMES[idx]
    if HEADERS[idx] not in value:
        raise ValueError("INVALID_OFFLINE_SOURCE:" + label)
    lines = re.sub(r"^[ \t]*--[^\n]*\n", "\n", value, flags=re.M)
    beginnings = re.findall(r"^[ \t]*BEGIN\s*;", lines, flags=re.M)
    endings = re.findall(r"^[ \t]*COMMIT\s*;", lines, flags=re.M)
    expected = 0 if idx == 3 else 1
    if len(beginnings) != expected or len(endings) != expected:
        raise ValueError("BAD_TRANSACTION_BOUNDARIES:" + label)
    if any(re.search(p, lines, flags=re.I) for p in PROHIBITED):
        raise ValueError("UNSCOPED_OR_AUTH_OPERATION:" + label)
    text = re.sub(r"^[ \t]*BEGIN\s*;", "", lines, count=1, flags=re.M)
    text = re.sub(r"^[ \t]*COMMIT\s*;", "", text, count=1, flags=re.M).strip()
    if not text:
        raise ValueError("EMPTY_SCRIPT:" + label)
    if idx == 1:
        text, n = re.subn(
            r"WITH pattern AS\s*\(\s*SELECT p\.pattern FROM public\.dblink\([\s\S]*?\) AS p\(pattern text\)\s*\)",
            "WITH pattern AS (SELECT pattern FROM qf_original_scope_pattern)", text, count=1)
    elif idx == 2:
        text, n = re.subn(
            r"CREATE TEMP TABLE qf_purge_regex AS\s*SELECT x\.pattern FROM public\.dblink\([\s\S]*?\) AS x\(pattern text\);",
            "CREATE TEMP TABLE qf_purge_regex AS SELECT pattern FROM qf_original_scope_pattern;",
            text, count=1)
    elif idx == 3:
        text, n = re.subn(
            r"SELECT x\.pattern INTO pattern\s*FROM public\.dblink\([\s\S]*?\) AS x\(pattern text\);",
            "SELECT p.pattern INTO pattern FROM qf_original_scope_pattern p;", text, count=1)
    else:
        n = 1
    if n != 1:
        raise ValueError("UNABLE_TO_REMOVE_CROSS_DATABASE_LINK:" + label)
    text = re.sub(r"CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA public;",
                  "", text, flags=re.I)
    if "public.dblink" in text.lower():
        raise ValueError("CROSS_DATABASE_DEPENDENCY_REMAINS:" + label)
    return "-- BEGIN OFFLINE " + label + "\n" + text + "\n-- END OFFLINE " + label + "\n"


PREFIX = r"""
-- PRIVATE OFFLINE STAGING PG17 CLONE ONLY; NEVER DEPLOY TO MANAGED SUPABASE.
-- Produces no change to Auth, payment providers, managed projects or networks.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='180s';
DO $isolation$
BEGIN
 IF current_database()<>'qf_purge_staging' THEN
  RAISE EXCEPTION 'QF_OFFLINE_ONLY_WRONG_DATABASE';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='qf_source_staging') THEN
  RAISE EXCEPTION 'QF_SOURCE_SIDECAR_REQUIRED';
 END IF;
 IF (SELECT count(*) FROM auth.users)<>2 THEN
  RAISE EXCEPTION 'QF_AUTH_PREIMAGE_DRIFT';
 END IF;
 IF (SELECT count(*) FROM public.vendors)<>27 OR
    (SELECT count(*) FROM public.leads)<>7 OR
    (SELECT count(*) FROM public.payments)<>0 THEN
  RAISE EXCEPTION 'QF_OFFLINE_PREIMAGE_DRIFT';
 END IF;
END $isolation$;
-- Freeze the original test UUID set in this transaction BEFORE deleting roots.
-- No cross-database connection or privileged foreign credential is required.
CREATE TEMP TABLE qf_original_scope_pattern AS
SELECT string_agg(s,'|' ORDER BY s) AS pattern FROM (
 SELECT DISTINCT id::text AS s FROM public.vendors
  WHERE lower(trim(coalesce(city,''))) IN ('pune','mumbai')
 UNION SELECT DISTINCT id::text FROM public.leads
  WHERE lower(trim(coalesce(city,''))) IN ('pune','mumbai')
 UNION SELECT DISTINCT id::text FROM public.lead_assignments
  WHERE vendor_id IN (SELECT id FROM public.vendors
   WHERE lower(trim(coalesce(city,''))) IN ('pune','mumbai'))
    OR lead_id IN (SELECT id FROM public.leads
   WHERE lower(trim(coalesce(city,''))) IN ('pune','mumbai'))
 UNION SELECT DISTINCT user_id::text FROM public.vendors
  WHERE user_id IS NOT NULL AND lower(trim(coalesce(city,''))) IN ('pune','mumbai')
) q;
DO $pattern$
BEGIN
 IF (SELECT count(*) FROM qf_original_scope_pattern)<>1 OR
    (SELECT length(pattern) FROM qf_original_scope_pattern)<100 THEN
  RAISE EXCEPTION 'QF_ORIGINAL_UUID_SET_NOT_VERIFIED';
 END IF;
END $pattern$;
LOCK TABLE public.vendors,public.leads,public.lead_assignments,
 public.lead_assignment_events,public.assignment_operations,
 public.vendor_campaign_audience_members,public.vendor_internal_notes,
 public.automation_action_requests,public.automation_jobs,
 public.automation_execution_attempts,public.automation_transport_requests,
 public.communication_intents,public.communication_messages
 IN ACCESS EXCLUSIVE MODE;
"""

POSTFIX = r"""
DO $postflight$
DECLARE n bigint;
BEGIN
 IF (SELECT count(*) FROM public.vendors)<>1 OR
    (SELECT count(*) FROM public.leads)<>0 OR
    (SELECT count(*) FROM public.lead_assignments)<>0 OR
    (SELECT count(*) FROM public.lead_assignment_events)<>0 OR
    (SELECT count(*) FROM public.vendor_credit_logs)<>0 THEN
  RAISE EXCEPTION 'QF_ATOMIC_POST_ROOTS_UNEXPECTED';
 END IF;
 IF (SELECT count(*) FROM auth.users)<>2 THEN
  RAISE EXCEPTION 'QF_ATOMIC_PROTECTED_AUTH_CHANGED';
 END IF;
 IF (SELECT count(*) FROM public.automation_action_requests)<>36 OR
    (SELECT count(*) FROM public.automation_jobs)<>36 OR
    (SELECT count(*) FROM public.automation_execution_attempts)<>42 OR
    (SELECT count(*) FROM public.automation_transport_requests)<>115 THEN
  RAISE EXCEPTION 'QF_ATOMIC_UNRELATED_AUTOMATION_LOST';
 END IF;
 SELECT count(*) INTO n FROM pg_constraint WHERE contype='f' AND NOT convalidated;
 IF n<>0 THEN RAISE EXCEPTION 'QF_ATOMIC_FK_INVALID'; END IF;
 SELECT count(*) INTO n FROM pg_trigger WHERE NOT tgisinternal AND tgenabled<>'O';
 IF n<>0 THEN RAISE EXCEPTION 'QF_ATOMIC_DISABLED_TRIGGER'; END IF;
 SELECT count(*) INTO n FROM pg_trigger WHERE tgisinternal AND tgconstraint<>0 AND tgenabled<>'O';
 IF n<>0 THEN RAISE EXCEPTION 'QF_ATOMIC_INTERNAL_CONSTRAINT_TRIGGER_DISABLED'; END IF;
 IF EXISTS (SELECT 1 FROM qf_residual_refs) THEN
  RAISE EXCEPTION 'QF_ATOMIC_UUID_REFERENCE_OR_SCAN_ERROR';
 END IF;
END $postflight$;
COMMIT;
\echo QF_STAGING_ATOMIC_OFFLINE_ERASURE_PASS
"""


def make_sql(sources: list[str]) -> str:
    if len(sources) != 4:
        raise ValueError("FOUR_PRIVATE_SOURCE_FILES_REQUIRED")
    chunks = [_unwrap(s, i) for i, s in enumerate(sources)]
    body = "\n".join(chunks)
    for expected in REQUIRED:
        if expected not in body:
            raise ValueError("PROTECTED_GUARD_MISSING:" + expected)
    return PREFIX + "\n" + body + "\n" + POSTFIX


def main() -> None:
    parser = argparse.ArgumentParser(description="PRIVATE OFFLINE CLONE ONLY")
    parser.add_argument("--offline-only", action="store_true", required=True)
    parser.add_argument("sources", nargs=4, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    a = parser.parse_args()
    if "artifacts" not in str(a.output).lower() or a.output.suffix.lower() != ".sql":
        raise ValueError("OUTPUT_MUST_BE_PRIVATE_ARTIFACT")
    verified_bytes = [p.read_bytes() for p in a.sources]
    verify_private_sources(verified_bytes)
    script = make_sql([raw.decode("utf-8") for raw in verified_bytes])
    with a.output.open("x", encoding="utf-8") as f:
        f.write(script)
    print("ISOLATED_STAGING_ATOMIC_SQL_GENERATED_NON_DEPLOYABLE")


if __name__ == "__main__":
    main()
