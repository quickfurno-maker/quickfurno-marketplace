# `scripts/mvp/reconciliation/` — Read-only DB reconciliation runbook (QF-MVP-10.7)

Resolves the **actual** staging and production database truth against the committed
schema, using **read-only** access only. Answers: which migrations are recorded,
which assignment/credit RPC bodies are live, whether credit-log idempotency exists,
whether every debit writes a ledger row, which consent/Meta objects + provider-account
constraints exist, and what QF-MVP-20/40 must change.

## Prerequisites (supplied out-of-band — never committed)

1. **`psql`** on `PATH` (postgres client). The tool **stops** if `psql` is absent rather
   than adding a DB dependency or using an unsafe path.
2. A **READ-ONLY** database role. Export the connection URI (never printed, never written):
   - `QF_STAGING_READONLY_DATABASE_URL`
   - `QF_PRODUCTION_READONLY_DATABASE_URL`
   Prefer a Supabase **read replica** / a role with `SELECT`-only grants. Do **not** use a
   service-role or an owner credential.

## Commands

| Command | Effect |
|---|---|
| `npm run reconcile:mvp:selftest` | Validates the tool with **no DB** (SQL guard, determinism, leak-fence). |
| `npm run reconcile:mvp:staging` | Collects staging metadata → `docs/generated/qf-mvp-staging-db-reconciliation.json`. |
| `npm run reconcile:mvp:production` | Collects production metadata → `docs/generated/qf-mvp-production-db-reconciliation.json`. |
| `npm run reconcile:mvp:compare` | Diffs the two env JSONs vs the repo ledger → `docs/generated/qf-mvp-db-drift-comparison.json`. |

Run staging first, then production, in a maintenance-safe window; then `compare`.
Run each collection **twice** and confirm the normalized JSON is byte-identical when DB
state has not changed.

## Safety contract (by construction)

- **Read-only:** one `BEGIN READ ONLY` session; `SHOW transaction_read_only` must report
  `on` or collection aborts. Only `SELECT`/`SHOW` metadata queries run.
- **Write/DDL guard:** every outgoing statement is scanned; any `insert/update/delete/`
  `upsert/merge/drop/alter/create/truncate/grant/revoke/comment/reindex/vacuum/cluster/`
  `call/do/copy/refresh/lock` whole-word → refused. (Catalog names like `role_table_grants`
  are safe — `\bgrant\b` ≠ `grants`.)
- **Credential hygiene:** the URI is parsed into `PG*` env vars for the psql child only —
  the password never appears in `argv`, is never logged, and is never written. Output is
  passed through a leak-fence that refuses any connection URL / JWT / API-key pattern.
- **No PII / no business rows:** queries read `pg_catalog` / `information_schema` and return
  metadata (schemas, columns, constraints, indexes, function signatures/bodies, triggers,
  RLS/policies, grants) plus a small set of **approved COUNT(\*)** safety checks — never
  row contents, phones, emails, messages, or destinations.
- **No fabrication:** with credentials or `psql` unavailable, the tool stops with a distinct
  exit code (`3` = credentials, `4` = psql, `5` = read-only not established) and **writes
  nothing**.

## What it collects (per environment)

Database identity · migration-history tables + recorded versions (never the SQL body) ·
tables+columns · constraints (PK/FK/UNIQUE/CHECK + validated state + exact def) · indexes ·
all function signatures + body fingerprint · **load-bearing RPC exact bodies + behaviour
flags** (writes `vendor_credit_logs`? debits credits? enforces max-3? SECURITY DEFINER?
exec grants) · triggers · RLS/policies · table grants · approved safe counts (NULL
provider-account counts, duplicate credit-log references, duplicate assignment pairs).

## Interpreting results (drift classification)

`compare` and the human reviewer classify each discrepancy as `MATCHED` · `REPOSITORY_ONLY`
· `DATABASE_ONLY` · `DEFINITION_DRIFT` · `HISTORY_DRIFT` · `EXPECTED_ENVIRONMENT_DIFFERENCE`
· `UNKNOWN_REQUIRES_REVIEW`. **No automatic remediation is proposed.** Each corrective action
becomes a narrowly-scoped, founder-reviewed migration applied via the normal path — never an
automatic `db push`/`reset`/`repair`. Record findings in
[`docs/QF-MVP-10-RECONCILIATION-RESULTS.md`](../../../docs/QF-MVP-10-RECONCILIATION-RESULTS.md).

## Current execution status

At authoring time (HEAD `cd3bbf4`), **no read-only credentials and no `psql` are present in
the working environment**, so live collection has **not** run. The tool + runbook are built
and self-tested; execution is the outstanding gate that keeps **QF-MVP-10 `IN_PROGRESS`**.
