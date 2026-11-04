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

## 4 Nov 2026 — Real Staging VPS source-of-truth for the freeze gate

This is **read-only operational evidence** from the already-authorized JARVIS `qf-staging` SSH alias (host `srv1873796`). The check inspected only Docker container state and the presence/absence of known public Supabase project reference strings in container environment configuration; **no environment values, credentials, tokens or secrets were returned**. Private sanitized evidence retained on JARVIS: `QF-20261104-VPS-SCOPE-READONLY.jsonl`, SHA-256 `71AA2DA6A984CC45A1EB74A93FC14FDB109A93AD70576C30FD413DFAFB33A410`.

- `qf-core-staging`: **running**, includes the **Staging** Supabase project reference.
- `qf-vox-20261102-mfa-ui-test`: **running**, includes the **Staging** Supabase project reference.
- `qf-jarvis-whatsapp-worker`, `qf-jarvis-gateway`, Jarvis OS and AGNI control-plane instances: **running**, but the tested environment strings did not directly expose a known Supabase project reference. **Absence of that string is not proof of independence** (configuration may be indirect). Do not broadly stop Jarvis/AGNI without a separate verified dependency map and operating approval.
- The VPS system `cron.service` is active; `/etc/cron.d` has only standard system/pruning entries visible in the limited inventory. Other cron users/providers or external trigger surfaces have **not** been certified quiet.
- The managed Staging database reported zero current accepting/in-flight workers, zero recent heartbeats and zero enabled outbound/webhook policies in the prior authorized SELECT. That did not detect the two **running** Staging-bound containers.

**Engineering correction:** Extended the existing `step3b22b-freeze-gate.mjs` to reject a supposedly all-green freeze unless the read-only Docker inventory is fresh, complete, separately evidence-hashed, proves the two currently known Staging-bound containers exited, and shows no additional Staging-reference container still running. Extra four regression tests exercise live-active, unknown-active, stale and missing-container cases. This remains a pure, non-executable adjudicator, not a stop command.

**Operational consequence:** There is presently **no certified Staging freeze**. The release operator must schedule and verify controlled shutdown/isolation of `qf-core-staging` and the Staging-bound VOX MFA UI test, while resolving the Jarvis/AGNI and cron dependency boundary. Neither these containers nor any protected database triggers were stopped/disabled in this inspection. Independent DBA/AppSec exception and managed recoverability remain additional release blockers.

## 4 Nov 2026 — Exact Compose isolation boundary (read-only, operator handoff)

A further **read-only** `docker inspect` on the authorized Staging VPS confirmed the orchestration boundary and restart policies without printing env values, credentials, bind mounts, or secrets.

| Container | Current status | Service/project | Restart | Network | Cutover handling |
| --- | --- | --- | --- | --- | --- |
| `qf-core-staging` | running | Compose `qf-core-staging` / `core` | `unless-stopped` | `qf-core-staging_default` | **Staging-specific:** only operator-controlled, short maintenance stop after recovery/exception approval |
| `qf-vox-20261102-mfa-ui-test` | running | Standalone Staging-dependent test | `no` | `bridge` | **Staging-specific:** only operator-controlled maintenance stop; ensure Owner test/UI access is not needed during window |
| `qf-vox-20261028-access-guard-test` | running | Standalone guard | `no` | `bridge` | **Preserve by default**, do not interrupt Cloudflare Access guard |
| `qf-jarvis-whatsapp-worker` | running | Compose `qf-jarvis-whatsapp-worker` / `quickfurno-worker` | `unless-stopped` | Jarvis networks | **Preserve unless qualified dependency review shows Staging writes** |
| `qf-jarvis-gateway` | running | Compose `qf-jarvis-gateway` / `quickfurno-gateway` | `unless-stopped` | Jarvis networks | **Preserve**, shared WhatsApp infrastructure |
| `qf-jarvis-os` | running | Compose `qf-jarvis-os` | `unless-stopped` | Jarvis network | **Preserve**, separate Jarvis control surface |
| `qf-agni-blue-control-plane-1` | running | Compose `qf-agni-blue` / `control-plane` | `unless-stopped` | AGNI networks | **Preserve**, separate operations/security control |
| `traefik-traefik-1` | running | Compose `traefik` | `unless-stopped` | `host` | **Preserve**, shared routing, Cloudflare/VOX access |

**Controlled operator procedure — prospective only, NOT executed:**

1. Confirm signed DBA/AppSec protected-history exception, independently demonstrated **managed** Supabase recovery/rollback, frozen inbound callback routes/cron and that Jarvis/AGNI cannot reingest Staging TEST data. Capture full original container state/identity and operational owner acknowledgement.
2. Stop **only** the two confirmed Staging-bound containers, using exact names and the authenticated VPS maintenance operator. Avoid broad `docker compose down`, `docker stop $(docker ps ...)`, host-level `systemctl stop docker` or all-workers shutdown. If a container is required for MFA validation, coordinate a separate preserved path rather than claiming it was safe to stop.
3. Prove both stopped using Docker state (not just database worker heartbeats), recheck all TEST-vendor/lead fingerprint and canary counts **inside a verified maintenance window**, and ensure no other Staging writers or callbacks remain.
4. Execute **only a newly reviewed, exact-ID managed Staging procedure**, not the database-name-guarded offline rehearsal SQL. Postflight: zero TEST references, zero invalid FKs, zero disabled protected triggers, exactly one canary and two unrelated Auth users preserved, no payment changes.
5. Restore **only originally running** Staging-specific services in original state and check owner login/VOX/Core health and outbound safeguards. Restore immediately on any failed preflight/rollback condition. Leave shared Traefik/Jarvis/AGNI untouched.

**IMPORTANT:** Stopping even the two confirmed containers **is not yet authorized** because managed recovery and the immutable-history exception are missing. These are precise intended release steps, not proof of execution. No live service/container or database mutation was performed.
