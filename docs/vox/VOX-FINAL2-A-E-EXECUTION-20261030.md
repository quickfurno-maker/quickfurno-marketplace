# QuickFurno VOX FINAL-2 — Tracks B, C, D, E execution checkpoint

**30 October 2026 — source-only implementation on protected PR #450.** Managed Staging/Production, Core consent policy, live Staff sessions, external provider delivery, signed EOD publication and marketplace data were not modified. This is an engineering checkpoint, **not release GO**.

## B — Genuine PostgreSQL consent destination lock tested (partial integration)
- New `scripts/mvp/vox/validate-vox-final2-consent-lock-pg17.mjs`: creates a disposable, network-isolated local PostgreSQL 17 Docker instance; starts two independent PostgreSQL sessions; holds `pg_advisory_xact_lock(hashtextextended('dst|<destination_hash>|whatsapp',0))` in one session, proves the second session's non-blocking acquisition is denied, and proves it becomes available after the first transaction rolls back. **PASS**.
- This lock is the source-level D2-D STOP/START destination lock. The existing `rc6TransactionalConsentProof.ts` calls the canonical D2-C authority with a matching lock in a read-only transaction; **the real READ WRITE Staff mutation path remains uninstalled**. All Core consent writer paths, Staff city/team/role authorization and actual database mutation still need reviewed same-transaction integration and negative/concurrency tests. SQL AB7B `CORE_CONVERSATION` CHECK and the production gate remain unchanged and closed.

## C — Real PostgreSQL approval persistence atomicity tested (partial integration)
- New `scripts/mvp/vox/validate-vox-final2-atomic-approval-pg17.ps1`: local, disposable, network-isolated PG17; synthetic Owner/TL and subject nonce inserts and one intent insert in one transaction; verifies no partial rows after rollback, unique nonce replay denial, and correct committed counts. **PASS: 3 claims / 1 intent**.
- No real human keys, no real Core auth AAL2, no signer enrolment or Ed25519 proof inside SQL. Earlier real in-process Ed25519 tests and test-only transaction protocol remain source-only; the **actual verified two-human approval DB writer** is NOT installed. `VERIFIED_APPROVAL_WRITER_INSTALLED=false` and no new publication is permitted.

## D — Narrow recovery ACL discrepancy isolated, not signed off
- Added opt-in `-ProbeOwnerAclReconciliation` to `scripts/mvp/vox/validate-voxAB7K-recovery-harness-pg17.ps1`.
- Baseline disposable PG17 7 quarantined + 23 candidate SQLs all install; strict full-fidelity source/restored snapshot parity remains **FALSE**, exit **3**. Only the two previously observed differences appear at `vox_ab7j_staff_suspend_intents_candidate_v1.acl` and `.acl_is_default`.
- A **separate, opt-in, guarded local-only** probe refuses any unexpected difference and explicitly reapplies the table owner's ACL in the restored disposable DB. The resulting snapshot matches the source **TRUE**; the original strict result is retained and not relabeled as a pass. Other/managed DBs are never contacted. Local proof: `AB7K_DISPOSABLE_OWNER_ACL_RECONCILIATION_PROBE_PARITY=True`; `AB7K_ORIGINAL_FULL_FIDELITY_RESTORE_PARITY_REMAINS_FALSE`.
- Qualified DBA must determine whether that explicit-owner/default-owner difference is semantically benign, and how to faithfully back up/restore managed Supabase owner/ACL/default privileges/Auth/Vault/Storage and PITR. No DDL or restore on managed Staging.

## E — Feature-by-feature source inventory and negative acceptance
- `validate-vox-final2-feature-gates.mjs` and 5 tests inventory 11 critical features, check source route existence, verified-auth references, no-store response headers and required activation flags.
- Critical source modules exist for Owner overview, Staff management, Vendor 360, Service Desk, Aarohi acquisition, Automation Studio, Staff transitions/chat/permissions and disabled official EOD. **VOX Finance route `app/api/vox/v1/finance/route.ts` is absent**; it is recorded `SOURCE_ROUTE_MISSING`, not activated.
- The matrix intentionally records `managedStagingAccepted=false` and `productionReady=false` for every item. This is source evidence only; real integrated UI/API 401/403/200/business acceptance on managed Staging remains pending.
- Feature-gate source tests **5/5 PASS**.

## Continuous QA and release decision
- Consolidated RC4 source-only orchestrator on this exact worktree: **107 suites / 730/730 PASS**, `SOURCE_PASS`, `releaseDecision=HOLD`; local untracked report `test-results/vox-final2-a-e-source-qa.json` SHA256 `fca27c9d45b503d064b9e7acfd0bf1fc327e3556c419949e04c1ee2abaa61264`.
- Existing final internal VOX regression: **161/161 PASS**.
- `npm run typecheck` **PASS** and `npm run build` **PASS**.
- Previous PR head `7af6c845` completed **155 success, 1 skipped, 0 failure**; new FINAL-2 commit must pass its own exact-head CI before any source merge review.

## Hard blockers before Staging/Production
Real reviewed same-transaction Core consent/Staff writer, database-side verifiable two-independent-human approval writer and actual key enrollment, strict managed recovery/ACL/Auth/Vault/Storage/PITR certification, independent human DBA/AppSec decision, Owner and first TL genuine AAL2, full managed Staging schema installation and signed API/UI E2E, and later separate authorized Production GO. PR #450 remains DRAFT and launch HOLD. Do not move 7 quarantined SQLs to managed migration discovery, change release gates, or silently declare human signoff.
