# Vendor SQL — seven-source immutable fingerprint handoff (Batch 12, 5 Nov 2026)

**Scope:** Source-only, no DB connection, no managed Staging or Production mutations. **RELEASE HOLD.**

## Why this exists
Vendor Draft [#484](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/484) contains seven additional November 4 SQL migrations on branch head `b177f5289a10a0736e5ddd5e206304eb49e44ba1`. A prior uncommitted integration rehearsal with VOX exposed 11 RC22–RC40 governance errors, including the old 162-vs-169 source inventory, historical digest snapshots, and a VOX migration quarantine. That rehearsal was aborted and is not release evidence.

This branch adds **no SQL** and does **not** repair any old ledger by changing historical snapshot/source truth. It pins the raw SHA-256 of each exact #484 SQL file and requires an independent later managed Staging capture. The command `node scripts/mvp/vendor/vendor-seven-migration-fingerprint.mjs` prints a JSON report: `SOURCE_EXACT` is source integrity **only** and still reports `releaseDecision=HOLD`, `canApplyStaging=false`, `updatesLedger=false`.

## Exact migration source fingerprints

| Source version | SHA-256 of exact SQL source bytes |
| --- | --- |
| 20261104090000 | d633187e5084591056c4a87687297fd9ca385a9e1a8d03ff8ae4df6d9e2c9e19 |
| 20261104140000 | cb5a4e1f74c6cbc6a6f4a89464c4d7235956b2ae9b71c3bd79bf39ed70581f48 |
| 20261104153000 | 2f62663edc5f64122f771f8c141019933b7f4eba1680a8a62a8af9c150972596 |
| 20261104160000 | 177c8f11ffeee951040e04bdb1a75e0391308ba022e00cdbd979a675a352e89e |
| 20261104163000 | dd4914f154e75e361ad862a17a702b9e72f3252e22e3c0a041616507ef3fd7d2 |
| 20261104170000 | 47dd11398806729bb93609857cf037cb3123cc0faaf703383a4885f287fe7012 |
| 20261104173000 | da53a260e9a15b39c24701e480f3d52759965406c8fbbebc2ac383767f481a68 |

## Must obtain independently before any schema install

1. **Authorized read-only managed Staging catalog and migration ledger:** compare exact applied versions, statements/source digests, schema grants, private RPC signatures and pre-existing vendor identity/matching policy; distinguish prior captured snapshots from current reality.
2. **Collision and legacy compatibility:** run the already-written read-only baseline `ops/vendor/vendor-before-migration-readonly-preflight-20261105.sql` under separate Owner approval; investigate duplicates, active Pending, shared user identities, historical assignment population, unknown migrations. Do not automatically adopt or erase legacy vendors.
3. **Governance and recovery:** reconcile RC22–RC40 historical source vs managed ledger, quarantine and 162/169 inventory while preserving immutable history. Record independent database/identity/Storage backup and isolated restore, signed rollback/forward-fix, qualified review and Owner Staging GO.
4. **Controlled Staging positive tests after approval:** apply reviewed append-only SQL to Staging only, confirm private RLS/scan receipts/Owner MFA gates, test one synthetic Pending signup and Office/Category evidence, and read back all new RPCs; keep decision writes OFF during read-only Owner UAT.
5. **Production and live registration:** separate approval after safe Staging proof. No automatic migration replay or repaired ledger claims.

The digest list is not a signature or a proof of the SQL's correctness; a reviewer must independently verify the source bytes and migration order against actual managed state.
