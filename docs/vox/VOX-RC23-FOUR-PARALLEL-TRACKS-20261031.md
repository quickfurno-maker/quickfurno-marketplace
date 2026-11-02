# VOX RC23: Four independently tested worktrees — 31 October 2026

**Target:** existing Draft PR #450 `feat/vox-rc6-operational-20261030`. No merge to `main`, no managed Staging or Production migration/deployment, no real provider actions, no official signing. Release decision **HOLD**.

## Execution provenance
Four isolated JARVIS worktrees were created from exact common source head `55b41a1a1bf5fa94409d1e295e41b089a94c4f9e`, separately edited, tested and committed, then cherry-picked into the Draft PR branch:
- Core `qf-vox-rc23-core`: `35241d9723826e3675d9e3b5789e085bb2cabfe3`
- Finance `qf-vox-rc23-finance`: `a86c4c4962d29de63911c70e7d99117957ece3be`
- EOD `qf-vox-rc23-eod`: `95c94305040d24737cd06bc9c001ed2d118009e5`
- Database release engineering `qf-vox-rc23-db`: `01eead0d454238460cf1e191728d4d9daf373fab`

## Engineering changes (all intentionally review-only)

**Core:** `services/vox/rc8PgVendorConversationOperator.ts` now carries the originally locked `req.decided_by` reviewer UUID through the final serializable PostgreSQL grant recheck, along with the exact reviewed capability and scope UUIDs, operations-manager role and same city/team constraints. A different Team Leader cannot silently satisfy a previously reviewed request after the original reviewer's privilege expires. New `rc23-core-authorization-contract.test.mjs`. Genuine disposable native PostgreSQL 17 AB7B / client binding / consent / rollback suite **PASS**, zero provider sends; live Core writer remains hard-OFF.

**Finance:** new `lib/payments/vendorPackageRefundReconciliationReview.mjs` composes the *existing* refund review and exact order/vendor credit-ledger evidence. Rejects mismatched order, vendor, credits, consumed leads, pending/already-refunded payments and duplicate charges. It is a pure evidence reviewer: even a successful review explicitly returns `refundAllowed:false`, `creditRevocationAllowed:false`, `requiresHumanReview:true`, `providerSettlementIndependentlyCertified:false`. **11/11 focused refund/credit/reconciliation tests PASS**. No actual provider settlement, refund or credit mutation; consumption policy remains pending.

**Signed EOD:** `rc8-pg-signed-intent-writer.mjs` now rechecks expiration and not-before bounds for **both locked, separately enrolled signing keys** just before committing a pending EOD receipt. Genuine disposable PostgreSQL 17 negative test uses still-valid signed envelopes, Owner/TL sessions and AAL2, but advances time past the registry key's notAfter threshold; verifies **zero persisted nonce claims and zero intent receipts**. Existing expiry and revocation regressions still pass. Human key registry remains empty, official production writer hard-OFF.

**Database release engineering:** new `rc23-migration-adjudication.mjs` validates the exact previously captured **read-only** managed Staging/source lineage, independently pinned by RC22 source hashes. Real evidence: **86 Staging applied versions**, **162 source SQL files**; **55 common**, **31 Staging-only**, **107 source-only**. Critically, **all 107 source-only versions are historically earlier than latest managed Staging migration `20261013144901`**, so **zero** can be treated as straightforward append-only versions. The classifier fails closed on count/name/duplicate drift and emits explicit DBA HOLD, not a migration execution plan. Tests **6/6** across RC22 and RC23 migration validation PASS.

## Integration and continuous QA
The existing release-HOLD GitHub Actions workflow now includes RC23 tests and emits the migration-history HOLD marker. Run exact-head GitHub Actions after pushing the consolidated change; prior-head CI success does NOT establish this head's CI status. **Integrated validation on the combined PR worktree:** RC17–RC23 contracts **78/78 PASS**; final internal source-only regression **161/161 PASS**; real disposable PostgreSQL 17 Core AB7B/client-binding/consent PASS, real disposable PostgreSQL 17 signed-EOD including key-expiry/TTL rollback PASS (synthetic keys), real disposable PostgreSQL 17 Finance V2 five-function PASS with **zero provider calls**; root TypeScript PASS; full VOX Web `npm test` PASS; Next.js 16.3.8 production `npm run build` PASS; updated RC23 GitHub Actions YAML parsed and contains RC23 tests/review-HOLD runner. GitHub exact-head results MUST be checked after push and are not inferred from local successes. No environment flags were enabled, no user credentials exposed and no managed database write performed.

## Unresolved P0 gates — do not re-label as complete
1. **Canonical managed migration history:** 31 managed-only entries, 107 historical source-only entries, old Razorpay V1 parser/NULL-claim defect; qualified DBA/AppSec must adjudicate exact migration version/name/function body and baseline history. Never use blanket `supabase db push --include-all`, auto-repair or direct migration-history writes.
2. **Recovery:** fresh actual managed backup and isolated full-fidelity restore including Auth/Storage/Vault, roles/ACL/ownership, physical Storage objects and PITR where applicable; reviewer/operator rollback evidence.
3. **Core:** actual server-issued branded Staff AAL2-to-native PG writer, owner/TL grants, D2-D consent insert/deactivate locking, reviewed privileged DB role and canonical AB7B source authority; real protected Staging integration and module-by-module authenticated functional QA.
4. **Finance:** provider-authoritative capture/settlement/webhook recovery, real audit trail, money refund authorization and consumed-credit accounting/reversal policy. No real-money tests were run.
5. **EOD:** actual independent human Owner and Team Leader MFA/key enrollment, reviewed signer registry and atomic publication writer with signed authority; real protected Staging verification.
6. **Human launch:** independent qualified DBA/AppSec approvals, approved managed Staging deployment, actual user acceptance, explicit separate Owner Production GO with rollback.

**Outcome:** tested source hardening and deterministic release engineering progressed, but this does NOT mean VOX is fully functional in Staging or production-ready.
