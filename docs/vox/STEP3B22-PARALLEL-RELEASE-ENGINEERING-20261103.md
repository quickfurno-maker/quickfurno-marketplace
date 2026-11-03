# 3B22 — Parallel pre-release engineering: independent signatures, freeze, Auth survivor protection

**Date:** 3 November 2026
**Status:** Source implementation and tests only. Managed QuickFurno Staging and Production remain **DELETE HOLD**.
**Owner instruction:** Permanently delete the scoped Pune/Mumbai TEST data, with genuine data, Owner access, Staging canary and configuration protected. Owner deletion intent is authorized; this does **not** constitute qualified DBA/AppSec security signoff or a managed change-window approval.

## Branches implemented concurrently on JARVIS

Three isolated, clean worktrees were branched from the exact clean 3B21 candidate `9419a7053682035e3b80a13b020ae24aac4befe6`; each has eight source regression tests. Changes are integrated only after individual verification. No production credentials are in source, no managed database write is performed, and neither compiled artifact nor passing test is a deployment grant.

### A — Cryptographic release-envelope verification
- `scripts/scale/step3b22a-signed-release.mjs` provides a **pure, offline** Ed25519 signature checker. All three genuinely independent **DBA, AppSec and SRE** reviewer roles must sign the *same* canonical payload, with distinct reviewers and keys obtained from a **separately authenticated, pretrusted reviewer registry**.
- The payload pins the target Staging or Production project, exact candidate Git SHA, environment-specific **Nov 3 archive SHA256**, exact vendor and lead UUID-*set drift fingerprints*, encrypted **private allowlist SHA256**, separate recovery and freeze evidence SHA256 values, explicit reviewed controls, and an approval window lasting at most 30 minutes. A missing key, invalid signature, stale window, hash drift or unfinished Staging gate means **HOLD**.
- **Security caveat:** `trust` is an input to the verifier, not a certificate authority: **never accept reviewer public keys or the `independent` flag supplied by the release request itself**. The production operator must obtain registry identity/public-key attribution independently (e.g., organization-approved reviewer identity keys) and verify the registry's custody before calling this checker. The test suite uses ephemeral synthetic keys only. No actual independent review exists yet.
- Even hypothetical all-green returns `SIGNED_REVIEW_EVIDENCE_PRESENT_MANUAL_CHANGE_REQUIRED` with `executable:false`; never auto-run SQL.

### B — Maintenance-window and external-worker freeze evidence
- `scripts/scale/step3b22b-freeze-gate.mjs` evaluates a fresh, at-most-120-second **Staging-only** read-only database snapshot and **independent** external stop attestations.
- Requires valid nonnegative counts and zero accepting/in-flight/recent-heartbeat workers, unfinished Jarvis/conversation outbox, enabled outbound and webhook policies. Also requires operator-maintenance window evidence and the authenticated stop of eight external surfaces: marketplace, automation, matching, Jarvis, webhook ingress, cron, message gateway and financial webhook.
- A quiet Staging table is **not** proof a VPS, provider or cron was stopped. Missing, old or incomplete external stop evidence yields HOLD. Green hypothetical results still return `FREEZE_EVIDENCE_PRESENT_INDEPENDENT_RELEASE_REQUIRED` with `executable:false`.
- The observed live Staging table inventory (one heartbeat row, zero accepting/in-flight/fresh heartbeats, zero unfinished outboxes, zero enabled outbound/webhook policies) is **preliminary evidence only**, not a signed freeze.

### C — Nine-account Production Auth protection
- `scripts/scale/step3b22c-auth-guard.mjs` validates the exactly nine dedicated Production TEST vendor principal IDs against a separately protected list of Owner/nonvendor IDs. Rejects invalid/duplicate user/vendor UUIDs, Owner overlap, privileged-role membership, any non-test or cross-application usage, nine identity-count drift, eight session-count drift or 23 refresh-token-count drift.
- Requires current verified Owner login, independently reviewed supported Supabase **Auth Admin API** revocation plan, JWT/session expiry planning and full recovery proof. **No raw `DELETE auth.users`, no service-role credentials, and no Auth Admin API calls are present.**
- A completed review still returns `AUTH_COHORT_REVIEW_COMPLETE_MANUAL_ADMIN_API_REQUIRED` with `executable:false`. Production account lifecycle must be executed separately after staging and managed Production clearance, preserving the one nonvendor account.

## Integration, tests and review gates

- Eight source tests each for A, B and C (**24** additional unit tests); all previous **62 Node + 8 Python** tests remain mandatory. The `.github/workflows/vox-source-gates.yml` non-deploying check runs A+B+C alongside prior cleanup tests.
- The Staging atomic actual-schema clone rehearsal remains **PASS** (26/7 target rows deleted, unrelated canary/2 Auth users preserved, independent unrelated automation records retained), plus full transaction ROLLBACK and wrong-database negative controls PASS. This is not a live execution and uses local-only protected trigger exceptions.
- Current draft [PR #414](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/414) has no approved external DBA/AppSec review. The protected exception to immutable ledger, frozen campaign audience, vendor notes and automation history **must be designed, audited and independently signed** before live Staging activity.
- Completion requires a genuine, tested managed Supabase recovery/PITR/roles/ACL/Auth/Storage procedure, external stop operation, permitted Production verification, and backup/provider-copy retention disposition. No source gate proves those operational controls by itself.

## Acceptance decision

**Engineering feature progress:** three isolated, test-backed, independent release controls, integrated only after validation. These avoid manual checklists masquerading as verified release evidence.

**Actual service state:** managed Staging **26 test vendors / 7 leads remain**; Production **29 test vendors / 74 leads remain** according to last permitted census (a later Production SELECT was blocked and must be reestablished through approved access). No managed DELETE/DDL/trigger disable, Auth identity change, provider messaging or finance activation has occurred. Genuine onboarding stays on HOLD.

**Next human-operated gate:** independently approved exception, trusted DBA/AppSec/SRE registry and signatures, verified full managed rollback and operator maintenance freeze; execute Staging first, postflight certify, then separately authorize pinned Production procedure. Permanent removal from backups/providers needs its own retention closure.
