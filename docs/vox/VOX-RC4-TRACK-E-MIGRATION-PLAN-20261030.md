# VOX RC4 Track E — Immutable Staging migration engineering (30 Oct 2026)

**Status: PLAN ONLY / HOLD.** This tooling is not an installer or a staging deployer, and a plan is not a GO. The protected P0-6 and AB7K release reviews remain pending.

## Exact release chain

Source baseline RC3 `f5dd7e4824f66e6b28039606e055ae3e2ca7cfb6`, managed Staging project `uckafzuochmbvtiodmcl`, observed 86 ledger entries with latest `20261013144901`. The reviewed Staff 7 quarantined foundations and 23 dependent SQL candidates must preserve order and source digest `3ae02af58c07e256507532b866594486d2785e768fd4092a1b1aa8db572f8f60`; the separate fail-closed identity/attestation overlay must follow AB7J. P0-6 from protected draft PR #435 must be independently pinned and approved **before** it is installed. The source branch intentionally has missing P0-6 path/hash and overlay byte hashes, so it cannot be release-ready.

## Tooling

- `contracts/vox/rc4ReleasePins.mjs`: immutable source/project/ledger pins, null for unverified approvals and missing hashes.
- `contracts/vox/rc4ReleasePlan.mjs`: deterministic dependency ordering, source bytes and fingerprint validation, strictly reverse rollback inventory, disallow altered SQL.
- `contracts/vox/rc4ReleaseGates.mjs`: checks signed qualified independent DBA and AppSec, Owner and distinct Team Leader AAL2, fresh managed recovery/restore, signed image, hash pin, flags hard-OFF.
- `scripts/mvp/vox/rc4-release-plan.mjs`: local source-only CLI, `plan`/`evaluate` only. Refuses `apply`, `push`, `repair`, `merge`, `--force` and all other dangerous switches.
- `scripts/mvp/vox/rc4-release-plan.test.mjs`: negative and positive source planning fixtures with fail-closed behavior.

## Safe commands (dry-run only)

`node --test scripts/mvp/vox/rc4-release-plan.test.mjs`

`node scripts/mvp/vox/rc4-release-plan.mjs plan --head-sha f5dd7e4824f66e6b28039606e055ae3e2ca7cfb6`

`node scripts/mvp/vox/rc4-release-plan.mjs evaluate --head-sha f5dd7e4824f66e6b28039606e055ae3e2ca7cfb6 --evidence privately-captured-signed-evidence.json`

No CLI execution connects to Supabase or emits runnable SQL. A fully consistent plan only authorizes separate *human* evaluation and cannot execute migrations.

## Blockers

Current Staging roles/ACL/backup and PITR restore, genuine human Owner/first Team Leader MFA, transaction-safe Core consent Staff writer, production-authorized Ed25519 signer and EOD writer, independent qualified human DBA/AppSec signoff and signed release approval remain outstanding. No managed Staging DDL, Production changes or feature activation occurred.
