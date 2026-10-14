# VOX-24 — GitHub-only staging readiness and independent evidence gate

**15 October 2026. STATE: source-only work; real Staging and Production HOLD.**

This change adds a small *verification-only* Node utility and synthetic CI coverage. It does **not** create a deployment workflow, staging environment, database connection, admin API, secret, approval bypass or release authorization.

## Current exact review sources
- Core consolidated ancestor [#251](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/251): `384d8e0cc066603a5400030afd0b64a1daa220fe` (NOT eligible as standalone staff-launch candidate)
- Core Phase A non-admin staff candidate [#257](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/257): `d8c3e1e1b8698873f652a459164214cb665ba235` — current proposed Core source, DRAFT stacked on #251
- Jarvis [#336](https://github.com/quickfurno-maker/qf-jarvis/pull/336): `1bbc916ccc095bd656b3bbcf373736a728037177`
- AGNI [#83](https://github.com/quickfurno-maker/qf-agni/pull/83): `84c4a0f09d010045c40073824da112855a3ebb18`
- Do not merge AGNI #82 (superseded/closed), or double-merge the constituent draft stacks.
- Read-only first-party snapshot: healthy Postgres 17.6 Staging `uckafzuochmbvtiodmcl`, 86 applied migrations, **zero** of the seven VOX Core migrations. The temporary schema branch had **12/86** migrations, lacked Aarohi dependencies and failed replay. It was deleted.
- Exact seven Core VOX source migration-set SHA256: `8fb8d1c4fce97fbac7282f1ad8647b584429f2e58950c4293a7784f4667d1eaa`. AGNI owner replay is **0008**, separate from the Core seven. Neither should be applied yet.

## Three parallel tracks and hard stops

**A. GitHub internal release closure**
1. Keep the three review heads frozen, DRAFT, and feature flags OFF. Re-check exact heads and current base ancestry immediately before any merge.
2. Run source QA and synthetic PostgreSQL restore tests; these do not prove actual managed Staging recovery.
3. Review CI supply-chain semantics: on PR the build is **not** a published/signed production or staging OCI release; signing only follows approved merged-main paths.
4. Prepare a dedicated **protected staging environment** with stage-only runner and permission isolation in GitHub settings. Require trusted environment reviewers, distinct stage credentials, approved signed immutable digests, and no production credentials. Creating a job with an unprotected `environment: staging` label is **not** a substitute for setting environment protection rules.
5. Keep existing Phase 15 production promotion/rollback unchanged until real gates pass; never dispatch as a staging shortcut.

**B. Database restoration and migration parity — P0** ([#246](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/246))
1. In the real managed Supabase dashboard, verify backup restore *capability*, latest complete backup/retention, and archive provenance. Pro plan status is not verification.
2. Obtain the consistent **actual Staging** archive with restricted operator credentials; checksum the file and independently restore the **same archive** into isolated Postgres 17. Block outward cron, webhooks, `pg_net`, provider calls and queue workers in the restore.
3. Compare all 86 migration version/name records and schema dependencies, RLS/grants/functions, anonymized counts and Auth/Storage integration. Debug the earlier replay divergence at/after `20260723001200_qf_mvp_vendor_segment_foundation.sql` without rewriting applied history.
4. Only after exact parity and separate signed owner/DBA approval, review/apply the seven pinned Core SQL files in version order to **authorized Staging**. Separately stage AGNI migration 0008 against its own actual database after its independent restore gate.
5. Reverify schema/grants, minimum role access and rollback. No SQL is executed by VOX-24.

**C. Security and authenticated integration** ([#254](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/254))
1. Resolve or explicitly risk-review the owner-rights 21-column public vendor listing, preserving its public filter; never blindly grant table-wide anon SELECT or convert it to `security_invoker` and break listing behavior.
2. Review two RLS helper definer functions, 102 no-policy RLS tables, Auth leaked-password protection; record a signed owner decision. A green catalogue query is not risk acceptance.
3. After signed staging deployment, exercise genuine AAL2 staff/Team Leader, city/vendor/subject IDOR, independent owner approval, Aarohi+Anisha consent and HUMAN takeover, Jarvis signed private replay, AGNI owner read-only, Service Desk, Automation Studio, AOS advisory, Google Place ID, retry/idempotency, rate/soak/concurrency, negative auth, rollback and fail-closed provider boundaries.

## What the new offline verifier proves — and does NOT prove

`node scripts/release/vox-stage-evidence-preflight.mjs --self-test` creates *synthetic* Ed25519 owner and DBA keys in memory, signs a fake evidence packet, and rejects tampered proof, wrong project, release-head drift, history truncation, checksum divergence, use of live Staging as restore destination, stale/missing security decisions, missing safety flags, same signer and extra data fields.

`--status` always reports `RELEASE_HOLD`. The optional `--packet path --owner-key path --dba-key path` command validates **two separate externally trusted Ed25519 signatures** and structural claims from an operator-supplied packet. The two public trust roots MUST be distributed independently via approved security process, not bundled with the packet or checked into Git. The signed evidence can be reviewed by an operator; it does not itself demonstrate archive bytes, a live restore, privilege safety, or authorization to run migrations. Keys, DB passwords, restore data, unredacted user records, or other secrets must not be committed, posted in GitHub issues or Notion, or printed in CI.

The source-only CI now also reads the actual Core Phase A branch tip and hashes all seven SQL blobs via read-only Git access. A newer branch commit, changed migration bytes, missing source branch, or mismatched frozen SHA **fails the check** rather than silently approving a stale candidate. The other two remote-repository heads still require separate review.

**No green CI result, positive operator attestation or check mark from VOX-24 is a staging or production go/no-go.** Human go/no-go remains separate. Unmerged release candidates must not be activated on staging until proven recovery and security clearance.
