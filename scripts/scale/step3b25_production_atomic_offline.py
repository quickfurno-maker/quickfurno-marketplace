"""One-transaction Production TEST-erasure rehearsal on network-isolated PG17 only.

This program DOES NOT connect to any DB or deploy. It combines four pinned
private, previously tested SQL sources into a deliberately non-live SQL script.
The generated SQL accepts ONLY qf_purge_production in a disposable PG17 clone.
"""
from __future__ import annotations
import argparse
from pathlib import Path
from step3b21_staging_atomic_offline import (
    _unwrap, verify_private_sources,
)

REQUIRED_PRODUCTION = (
    "767228fc486c378f500df83af36da4b6",
    "fccc2594dd5ce49bc12c590f6f9f2dff",
    "PRODUCTION_SCOPE_MISMATCH",
    "PRODUCTION_AUTOMATION_TARGET_SCOPE_DRIFT",
    "trg_lead_assignment_events_immutable",
    "trg_vcam_immutable",
    "trg_vin_immutable",
    "trg_automation_action_requests_no_delete",
)

PRE = r"""
-- OFFLINE PG17 PRODUCTION SNAPSHOT CLONE ONLY, NEVER A MANAGED RELEASE PROCEDURE.
-- Refuses wrong database; no credentials/network/providers/Auth Admin action.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='180s';
DO $isolated$
BEGIN
 IF current_database()<>'qf_purge_production' THEN
  RAISE EXCEPTION 'QF_PROD_OFFLINE_ONLY_WRONG_DATABASE';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='qf_source_production') THEN
  RAISE EXCEPTION 'QF_PRODUCTION_SIDECAR_MISSING';
 END IF;
 IF (SELECT count(*) FROM public.vendors)<>29 OR
    (SELECT count(*) FROM public.leads)<>74 OR
    (SELECT count(*) FROM public.lead_assignment_events)<>73 OR
    (SELECT count(*) FROM auth.users)<>10 OR
    (SELECT count(*) FROM public.payments)<>0 OR
    (SELECT count(*) FROM public.automation_action_requests)<>83 OR
    (SELECT count(*) FROM public.automation_jobs)<>83 OR
    (SELECT count(*) FROM public.automation_execution_attempts)<>25 OR
    (SELECT count(*) FROM public.automation_transport_requests)<>32165 THEN
  RAISE EXCEPTION 'QF_PROD_OFFLINE_PREIMAGE_DRIFT';
 END IF;
END $isolated$;
-- Preserve the original target UUIDs inside this same transaction.
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
DO $uuid$
BEGIN
 IF (SELECT count(*) FROM qf_original_scope_pattern)<>1 OR
    (SELECT length(pattern) FROM qf_original_scope_pattern)<100 THEN
  RAISE EXCEPTION 'QF_PROD_ORIGINAL_UUID_SET_NOT_VERIFIED';
 END IF;
END $uuid$;
LOCK TABLE public.vendors,public.leads,public.lead_assignments,
 public.lead_assignment_events,public.assignment_operations,
 public.vendor_campaign_audience_members,public.vendor_internal_notes,
 public.automation_action_requests,public.automation_jobs,
 public.automation_execution_attempts,public.automation_transport_requests,
 public.communication_intents,public.communication_messages
 IN ACCESS EXCLUSIVE MODE;
"""

POST = r"""
SET LOCAL statement_timeout='180s';
DO $postflight$
DECLARE n bigint;
BEGIN
 IF (SELECT count(*) FROM public.vendors)<>0 OR
    (SELECT count(*) FROM public.leads)<>0 OR
    (SELECT count(*) FROM public.lead_assignments)<>0 OR
    (SELECT count(*) FROM public.lead_assignment_events)<>0 OR
    (SELECT count(*) FROM public.vendor_credit_logs)<>0 THEN
  RAISE EXCEPTION 'QF_PROD_OFFLINE_ROOT_POSTFLIGHT_FAIL';
 END IF;
 -- Deliberately preserve all auth.users including the unrelated Owner account.
 -- Dedicated TEST principals require a SEPARATELY APPROVED Auth Admin lifecycle.
 IF (SELECT count(*) FROM auth.users)<>10 THEN
  RAISE EXCEPTION 'QF_PROD_OFFLINE_AUTH_WAS_CHANGED';
 END IF;
 IF (SELECT count(*) FROM public.automation_action_requests)<>0 OR
    (SELECT count(*) FROM public.automation_jobs)<>0 OR
    (SELECT count(*) FROM public.automation_execution_attempts)<>0 OR
    (SELECT count(*) FROM public.automation_transport_requests)<>32114 THEN
  RAISE EXCEPTION 'QF_PROD_OFFLINE_AUTOMATION_POSTFLIGHT_FAIL';
 END IF;
 SELECT count(*) INTO n FROM pg_constraint WHERE contype='f' AND NOT convalidated;
 IF n<>0 THEN RAISE EXCEPTION 'QF_PROD_OFFLINE_FK_INVALID'; END IF;
 SELECT count(*) INTO n FROM pg_trigger
 WHERE NOT tgisinternal AND tgenabled<>'O';
 IF n<>0 THEN RAISE EXCEPTION 'QF_PROD_OFFLINE_PROTECTED_TRIGGER_DISABLED'; END IF;
 IF EXISTS (SELECT 1 FROM qf_residual_refs) THEN
  RAISE EXCEPTION 'QF_PROD_OFFLINE_UUID_REFERENCE_OR_SCAN_ERROR';
 END IF;
END $postflight$;
COMMIT;
\echo QF_PRODUCTION_ATOMIC_OFFLINE_ERASURE_PASS_NOT_MANAGED_RELEASE
"""


def make_production_sql(sources: list[str]) -> str:
    if len(sources) != 4:
        raise ValueError("FOUR_PINNED_PRIVATE_SOURCE_FILES_REQUIRED")
    chunks = [_unwrap(s, idx) for idx, s in enumerate(sources)]
    body = "\n".join(chunks)
    for term in REQUIRED_PRODUCTION:
        if term not in body:
            raise ValueError("PRODUCTION_GUARD_MISSING:" + term)
    if "public.dblink" in body.lower():
        raise ValueError("CROSS_DATABASE_CONNECTION_UNSAFE")
    return PRE + "\n" + body + "\n" + POST


def main() -> None:
    parser = argparse.ArgumentParser(description="DISPOSABLE OFFLINE PRODUCTION CLONE ONLY")
    parser.add_argument("--offline-only", action="store_true", required=True)
    parser.add_argument("sources", type=Path, nargs=4)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if "artifacts" not in str(args.output).lower() or args.output.suffix.lower() != ".sql":
        raise ValueError("OUTPUT_MUST_BE_PRIVATE_ARTIFACT_SQL")
    original = [path.read_bytes() for path in args.sources]
    verify_private_sources(original)
    sql = make_production_sql([value.decode("utf-8") for value in original])
    with args.output.open("x", encoding="utf-8") as handle:
        handle.write(sql)
    print("PRODUCTION_ISOLATED_ATOMIC_SQL_CREATED_NON_DEPLOYABLE")


if __name__ == "__main__":
    main()
