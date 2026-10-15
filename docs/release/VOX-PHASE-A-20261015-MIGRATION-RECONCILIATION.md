# VOX Phase A — Staging migration reconciliation (15 October 2026)

**Status: RELEASE HOLD.** This report is generated from an authenticated read-only Supabase
migration-ledger snapshot captured separately; it does **not** inspect or modify a live database.

## Verified source truth

- Supabase project: `uckafzuochmbvtiodmcl` (Staging), PostgreSQL 17.6.
- Genuine local staging archive checksum:
  `aa6fac1f6c2bbd642b2de9cd707054ef3616a67561fa0c9678d95e4745a74af8`.
  The archive remains restricted on JARVIS and is **not** checked into Git.
- Exact staging migration ledger: **86** rows, migration-history fingerprint
  `6aae0a57546c5aa3897edadf55af62e2`, with **zero VOX** SQL migrations applied.
- Real backup restored into temporary PostgreSQL 17.6 Supabase-matching container with
  `--network none`; 86 ledger rows and aggregate staging data verified. Temporary
  containers were destroyed. Original owner/cluster configuration is **not** yet
  fully reproduced in that restore; independent owner/DBA signoffs are outstanding.
- Seven VOX migrations `20261014010000` through `20261014070000` all applied cleanly
  in ascending order to an **isolated real restored staging archive**, not managed Staging.
  Ten new VOX tables had RLS and FORCE RLS; four denied SQL probes passed.
  Source-level staff identity/revocation/invite tests and Jarvis/AGNI tests passed
  separately. These do not prove actual live Auth AAL2 / city IDOR / consent boundaries.

## Historical replay discrepancy — hard blocker

Compared all **86** exact applied staging versions to repository migration filenames:

| Category | Staging versions | Interpretation |
|---|---:|---|
| Exact version AND name in repository | 55 | Source candidate exists; contents must still be independently reviewed |
| Same migration name, different version | 25 | **NOT proven equivalent SQL**; never mark applied automatically |
| Applied Staging migration has no exact-name SQL file | 6 | **Applied SQL now recovered into restricted owner-only evidence**; no exact versioned file is present in repository; replay remains uncertified |
| Same version with different name | 0 | No such collision found |

The **six missing by exact name** are:

1. `20260722000100_qf_mvp_staging_baseline_269c9265`
2. `20260926050242_qf_phase2_staging_rls_initplan_parity`
3. `20261012180214_qf_vl01_vendor_assignment_update_authority_closeout_staging`
4. `20261013053930_vl05_scale_phase07_durable_jobs_hardening_staging`
5. `20261013053959_vl05_scale_phase12_horizontal_worker_claims_staging`
6. `20261013144901_vendor_profile_approval_atomic_v3_staging_20261013`

**15 Oct source recovery update:** All six staging-specific applied SQL bodies were recovered from the genuine offline Staging backup and independently MD5-matched to the live read-only ledger. The ledger contains SQL for 85/86 migrations; one audit repair has no recorded statements. Body comparison: 22/25 different-version aliases match text (after line endings), three differ; 12/55 same-version candidates match text, 43 differ. See [authoritative source evidence](VOX-APPLIED-MIGRATION-SQL-RECOVERY-20261015.md). Original SQL lives only in a restricted JARVIS folder; **do not check it into GitHub**. These results do not certify semantic equivalence or empty-database replay.\n\n**Do not synthesize, retimestamp, or 'repair' live migration ledgers.**
Retrieve authoritative applied SQL sources or approved immutable deployment artifacts,
validate hashes and ordering, then run a clean-room replay in a network-isolated
Supabase-compatible PostgreSQL sandbox. Where a historical staging baseline cannot
be replayed, the owner and independent DBA must explicitly accept the defined
recovery scope and residual drift. The 7/7 forward VOX migration test against a
restored stage snapshot does not replace empty-database historic replay.

## Repeatable fail-closed check

```bash
node scripts/release/vox-phase-a-migration-reconcile.mjs --self-test
node scripts/release/vox-phase-a-migration-reconcile.mjs
```

The script checks the pinned read-only ledger snapshot and hashes local SQL files.
It never calls Supabase, rewrites SQL, grants access or deploys. It emits a
`safeToReplayFullHistory: false` and `safeToApplyVox: false` while mismatch exists.
A same-name alias is never mistaken for identical SQL content.

To compare a separate Core checkout, pass `--core-root <path>`. Keep
operator-generated JSON in restricted evidence storage (not a source commit).

## Follow-up archival source search

Historical Git object inspection recovered an **archived copy** of the staging
baseline SQL (not present at this branch HEAD): Git blob
`65e56c0419a986cc14a5abcfb184dd4a82625630`,
former path `supabase/staging-baseline/20260722000100_qf_mvp_staging_baseline_269c9265.sql`
(291,816 bytes; source commit `61f18c1`). This reduces the baseline's
*source-location* uncertainty but does **not** certify reproduction in a
fresh instance. The other five staging-specific applied migration IDs have no
exact-named .sql objects in the local Git object index. Historical
`ops/vendor-approval/pending/20261013133000_vendor_profile_approval_atomic.sql`
and Core VL/scale SQL files are candidate **provenance leads only** and MUST
NOT be treated as identical to those applied under different staging IDs.

## Live Supabase security advisor read-only snapshot (15 October 2026)

| Supabase linter | Severity | Findings | Current interpretation |
|---|---|---:|---|
| `security_definer_view` | ERROR | 1 | `public.vendor_public_v` is an intentional owner-rights projection; reviewed 21-column public allowlist, strict visibility/credit predicates and denial of base vendors table access. Formal security-exception signoff still outstanding. |
| `authenticated_security_definer_function_executable` | WARN | 2 | Authenticated-executable `is_admin` and `owns_vendor` helper functions; verify owner and security boundary with actual role tests. |
| `rls_enabled_no_policy` | INFO | 102 | SQL audit found **0 anon/auth SELECT and 0 anon/auth INSERT table grants** in this set, a plausible intentional server-only posture; continue permissions audit. |
| `auth_leaked_password_protection` | WARN | 1 | **Disabled** in managed Auth. Enable via approved Dashboard/Auth policy change after compatibility review. Not fixed by running a SQL migration. |

Official remediation references:
[definer view](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view),
[authenticated callable definer](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable),
[RLS no policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
[leaked password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
These live advisor findings are NOT CI-certified remediations.

## Still required for an approved staged release

- Genuine independent DBA and owner signoff including Auth/Storage scope and
  incomplete original-object-ownership restore certification.
- Read-only live Supabase `pg_catalog` audit of public owner-rights view and
  SECURITY DEFINER functions, plus tested anon/auth permissions, RLS and
  real staff/vendor city IDOR using synthetic accounts and AAL2.
- Independent trusted GitHub reviewer. The `staging` environment blocks
  self-review and admin bypass; zero secrets were set at last inspection.
- Review of stacked draft Core PRs #251 / #257 / #259 and separate
  #255 / #260, Jarvis #336, AGNI #83. Reverify all live heads and
  contract snapshots, CI, signed images, rollback readiness.
- Stage-only environment credentials, explicit stage-go decision and
  signed evidence packet. **No provider sends, invites, migrations or
  production cutover without authorized controls.**

Only non-mutating offline work and source reviews are currently authorized by
this document. It is **not** a production readiness certificate.
