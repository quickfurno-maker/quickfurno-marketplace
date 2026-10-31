# VOX D-DB offline release preflight

`scripts/mvp/vox/d-db-release-preflight.mjs` turns a LOCAL inventory JSON into a machine-readable **HOLD/GO** report. It never calls a managed database, never executes SQL, and never emits SQL text or commands (only `path` + `sha256`). It refuses to run if `DATABASE_URL`, `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN` or `PGPASSWORD` is set.

```
node scripts/mvp/vox/d-db-release-preflight.mjs --inventory inv.json [--root dir] [--migrations-dir supabase/migrations] [--out report.json]
node scripts/mvp/vox/d-db-release-preflight.test.mjs     # synthetic-input tests
```
Exit `0` GO, `2` HOLD, `64` usage/forbidden flag (`--apply`, `--push`, `--go`, `--db-url`, ...), `70` error. `--out` must be a new `.json` outside `supabase/`, `ops/`, `contracts/`.

## Inventory (`qf.vox.d-db.release-inventory.v1`)
`sources[]` ordered `{path, sha256, dependsOn?[]}`; `orderedSourcePinSha256` (sha256 of `i|path|sha256` lines joined by `\n`, see `computeOrderedPin`); `ledger.versions[]` (local capture of the managed ledger); `localVersions[]` (or `--migrations-dir` to derive them); `externalObjects[]` (vox objects declared to exist outside the plan); `consent.canonical {present, bindingPath, bindingSha256}`; `approvals {dba,appsec,owner}` each `{id, orderedSourcePinSha256}`.

## What fails closed
- per-file and ordered SHA256 pin drift or absence; non-ascending/duplicate versions; unsafe paths
- missing/misordered dependencies (explicit `dependsOn` and scanned `public.vox_*` references)
- ledger diff: plan version already applied or behind ledger head; **any** managed staging-only or source-only version (no waiver exists)
- canonical consent missing, unbound to the plan, or sha-mismatched
- approvals missing or not bound to the current ordered pin (the ordered plan is withheld unless GO)
- **P0-6, the 7 quarantined, the 23 candidates and review-only overlay SQL always BLOCK** (`PENDING_SQL_NOT_ENABLEABLE`), however pinned or approved

Approvals are asserted identifiers, not signatures; real signoff stays with the RC4 signed-approval pipeline. A GO from this tool is a preflight consistency result, not authority to apply. Blanket `db push` / `migration repair` stay forbidden. Managed Staging/prod, payment, EOD and UI holds are unchanged.
