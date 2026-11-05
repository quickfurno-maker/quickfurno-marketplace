# Vendor / VOX SQL source delta — pinned exact Git-tree review (5 Nov 2026)

**Classification:** Internal source-only evidence, no merged migration, no managed DB access, RELEASE HOLD.

## Scope and inputs

Compare the exact source tree of Vendor Draft [#488](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/488) at `f33b6dc4c62306cb5848756184a0e80b2291d535` (retains the seven original Vendor Draft #484 SQL files) against VOX/Core code-only Draft [#486](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/486) at `49cf169eb84be743e6db30b23ee9d9cd57089976`. No Git merge/cherry-pick, no SQL execution, no historic manifest changes.

Run on JARVIS with both exact Git objects available: `node scripts/mvp/vendor/vendor-vox-migration-cross-branch-delta.mjs`. This executes only `git ls-tree -r` twice and compares path names and Git blob hashes, not database contents.

## Verified local source result

- VOX candidate: **162** SQL migration files.
- Vendor branch: **169** SQL migration files.
- **7 vendor-only files**, precisely the seven files pinned by the sibling fingerprint tool.
- **0 VOX-only migrations**, **0 modified shared SQL migration blobs**.
- Verdict `EXACT_SEVEN_ADDITIVE_SOURCE_FILES`, **releaseDecision HOLD**, `canMerge=false`, `canApplyStaging=false`.
- New 4-test offline suite tests valid delta, changed historical blobs, unknown/missing SQL, duplicate and invalid tree entries. GitHub source CI executes mocks because the separate VOX exact SHA may not exist in a shallow PR checkout; the exact real two-tree comparison is a **JARVIS-local verification**, not a managed-Staging claim.

## What this does not resolve

The previous full-merge rehearsal surfaced **11 real RC22–RC40 errors** in historical release manifests, migration count governance, quarantine and digest inventories. A source delta without changed historical SQL does not prove the restored/prior managed schema or historic ledger is compatible. Nor does it justify editing historic manifests to force 169 files through an older 162-file fixed-count release certification.

Next independent evidence still required: current authorized read-only managed Staging migration ledger and catalog, source-to-managed statements/signatures, legacy vendor identity and assignment audit, RLS/grants/ownership, separate DBA-reviewed append-only plan, isolated backup/restore/forward-fix and Owner Staging GO. The private bucket, actual ClamAV engine, genuine Owner MFA and exact deployed image attestations remain separate gates.

**Never execute** `supabase db push`, managed migration repair or direct ledger edits as a result of this report. Managed Staging, Production, public vendor registration, provider sends, lead assignment, credits, and Official EOD remain HOLD.
