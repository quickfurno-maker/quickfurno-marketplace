# Step 3B-6A — DBA reconciliation / recovery decision dossier
Source-only. Based on 22-Oct read-only first-party migration inventories; not a new managed DB query.
- Input: `ops/vox/certification/STEP3B1-LIVE-MIGRATION-LEDGER-20261022.json`. 86 versions in each managed ledger, 34 in common, 52 Staging-only, 52 Production-only.
- Produce deterministic 104-row asymmetric difference register with version, migration name, environment, source-presence, resolution=UNREVIEWED; do not infer equivalence from equal totals, title similarity, or timestamps.
- Independently compare SQL semantics and dependents, trigger functions, grants, default privileges, service role grants, RLS effective OR/AND, owners, schema extensions, provider/Auth mapping and data/DDL divergence.
- Current 4-schema `pg_dump` restore does NOT cover global roles/ownership/ACL, physical object storage, PITR, external services or customer session behavior. Independent DBA must certify those separately.
- Confirm Phase22 exact SHA256 `6F53E1781E4D2BD277645ED17B2EB635BE70F1D2C4DF7525CD176DFB0C2F28BA`, protected VOX candidate count 23 and quarantined seven.
- No automated migration repair, `db push`, ledger INSERT, revision squashing or unquarantine permitted. Abort on mismatched versions, drift, missing restore provenance, stale backup, ACL gaps, concurrent changes or non-independent approval.
- DBA review decision: PENDING. Managed Staging application: NOT AUTHORIZED. Managed Production: HOLD.
