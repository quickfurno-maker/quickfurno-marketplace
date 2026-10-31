# VOX TO-04G — QuickFurno Staging vs Production migration reconciliation packet

**Source:** read-only connected Supabase `list_migrations` for the two existing QuickFurno projects, 15 October 2026. No file contents, authentication secrets, customer data, live SQL DDL or role changes were read or modified. JSON evidence file: `ops/vox/certification/TO04G-READONLY-MIGRATION-METADATA.json`.

## Reproducible observed differences

| Measure | Staging | Production |
|---|---:|---:|
| Migration history entries | 86 | 86 |
| Distinct recorded migration names | 84 | 86 |
| Duplicate names inside environment | 2 | 0 |
| Names not occurring in the other environment | 22 | 24 |

Across both environments: **34 identical version IDs**, **62 distinct migration names shared**, including **28 same names filed under different version IDs**. Among shared version IDs, there are **zero mismatched names**. Environment-specific `qf_mvp_staging_*` and `qf_prod_baseline_*` entries suggest intentional naming conventions, but *neither naming similarity nor timestamp mismatch proves equivalent SQL contents*.

**Duplicate names in staging:** `vendor_fair_opportunity_group_reconcile` (two distinct versions), `vendor_fair_opportunity_fk_indexes` (two distinct versions). A DBA must check whether each pair is a legitimate consecutive migration, an accidental retry, or a divergence; DO NOT delete or automatically collapse either entry.

## Mandatory DBA + security review sequence — not performed by this source PR

1. **Freeze evidence, not production:** Independently capture the current exact Staging and production migration ledgers and original Git source for each SQL file, identify the source branch/commit/digest for every entry, and record who authorized each environment-specific migration.
2. **Immutable SQL comparison:** SHA-256 hash original SQL bytes for each of the 62 shared names *in each environment*, including the 28 renumbered cases. Compare normalized DDL effects separately from raw hash. Treat stage-only 22 / prod-only 24 as unresolved until reconciled. Duplicate names must be keyed by VERSION + NAME, not name alone.
3. **Restore outside managed projects:** Take restricted backup of the relevant staging data, roles, schema and migration history; verify checksums, restore to a disposable isolated PostgreSQL environment and replay exact original migrations in historical order. Test table/column/constraint/index/role/RLS/RPC parity and run Supabase Advisor without granting broader permissions.
4. **Validate QuickFurno Core integrity:** Existing vendor/service-zone/Google-verified location and fair matching maximum-three-vendor assignments must remain untouched. Verify `vendor_public_v` SECURITY DEFINER view and `is_admin()` / `owns_vendor(uuid)` permissions as flagged by live Security Advisor; do not blindly drop or revoke before assessing current Core uses.
5. **Only after signed decision:** Independent DBA/security reviewer records signed reconcile/restore/rollback evidence and selects one canonical, source-controlled TO-02C Core Staff SQL+HTTP stack. The first Team Leader still requires a distinct real human verified attestation, not a generated approval or owner self-review.
6. **Staged contract tests:** Deploy the approved VOX schema to *protected staging only* after the above, using genuine synthetic Supabase AAL2/IDOR/nonce/revoke/2-10-50 claims, Riya/Jarvis/Anisha consent, AGNI read-only health and signed CI canary/rollback.
7. **Production authorization separate:** Require explicit Core owner release decision after protected independent staging review. This document is not an authorization.

## Machine gate
`node scripts/mvp/vox/verify-to04g-migration-history.mjs` recomputes version/name statistics from evidence and checks no missing/forged records. `--release-check` must return **exit status 42** because immutable SQL source hashes, an independent DBA decision, and a successful isolated restore are absent. A green Actions run here certifies a correct HOLD, not live database parity.

**NO AUTOMATED MIGRATION REBASE OR MANAGED DATABASE WRITE** until the independent evidence exists.

## RC35 executable inventory reconciliation (read-only)

`scripts/mvp/vox/rc35-migration-inventory-reconcile.mjs` compares two injected inventories by version, name alias and digest. It never connects to a database, runs SQL, or promotes protected SQL (7+23 stays untouched). `releaseGo` is always `false`.

```
# source inventory from the checkout (or inject a prepared file with --source)
node scripts/mvp/vox/rc35-migration-inventory-reconcile.mjs \
  --managed docs/vox/VOX-MANAGED-STAGING-MIGRATION-DRIFT-READONLY-20261031.json \
  --source-dir supabase/migrations --out rc35-reconciliation.json
```

- `--managed`: array, `{migrations}`, TO04G metadata, or the 31/107 drift snapshot. Rows may add `statementsSha256` (64-hex) that the approved DBA computes from the applied statements, canonicalised with `canonicalSqlDigest` (CRLF and trailing whitespace only).
- `--source`: `{files:[{file, sha256, canonicalSha256}]}`; `--source-dir` builds it from disk.
- Alias semantics: same version+name; same name at another version; `_staging[_YYYYMMDD]`/ticket-prefix candidates; repeated ledger names. An alias is `accepted` only when both digests exist and are equal.
- Exit code: `0` fully reconciled; `2` blockers present (sorted `{code,subject,detail}` list plus `reportSha256` in the JSON report); `1` bad input.
- On the captured metadata the report carries `DIGEST_UNAVAILABLE`, `DUPLICATE_MANAGED_NAME`, `MANAGED_ONLY_NO_SOURCE_SQL`, `BASELINE_CONTENT_UNPROVEN` and historical-gap blockers. The DBA clears them only by supplying managed statement digests.

Test: `node --test scripts/mvp/vox/rc35-migration-inventory-reconcile.test.mjs`
