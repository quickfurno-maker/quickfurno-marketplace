# VOX RC10 — Parallel Tracks A–F Integration (30 October 2026)

**Protected source:** PR #450 Draft. **RELEASE HOLD.** No managed Staging or Production changes, no real identity enrollment, signing keys, payment mutations, provider sends, client/vendor activation or permission bypass.

## A — Genuine Core writer authorization integrity
Fixed an authorization weakness in the review-only PostgreSQL vendor conversation writer. Previously an arbitrary row in `vox_staff_department_capabilities_v1` could be sufficient, regardless of the original request/reviewer/activation. `services/vox/rc8PgVendorConversationOperator.ts` now proves and row-locks in the SAME SERIALIZABLE READ WRITE transaction:
- Active neutral Staff principal (`auth.users` + `profiles`), current team/city and `operations_manager` membership.
- `client_success` capability with `revision=2`, unrevoked and unexpired.
- Exact independently reviewed department request in state APPROVED, revision 1, independently distinct reviewer, matching subject/department/team/city, valid decision and activation, matching requested/granted/activated actors.
- Current neutral Team Leader reviewer: `auth.users.qf_principal='vox_staff'`, `vox_role='team_leader'`, no admin role, active profile/membership/team, city-bound, unrevoked and unexpired.
- Exact active `conversation` object grant, locked separately.
- All original canonical vendor zone/city resolution, D2-D destination lock and actual D2-C consent on one DB connection, then Core state update, event and nonce receipt in same SQL transaction.

The local real PG17 test now builds reviewed request/decision/capability/activation/Team Leader fixtures and rejects a revoked or REJECTED decision, revoked reviewer Auth role and object scope, in addition to earlier replay/STOP/zone/city/Staff negatives. **PASS**. This is still a vendor-only, non-canonical (AB7B original source-row blocked) review-only adapter; trusted live AAL2 injection, client geography and minimal database role remain unsolved.

## B — Signed Owner + Team Leader approvals
Reran genuine disposable PostgreSQL17 single-transaction synthetic Ed25519 verification; valid pair yields exactly 3 immutable nonce/subject claims and 1 AWAITING_EXTERNAL_REVIEW intent. Replay, tampering, signer-key revocation, Owner/TL Auth metadata revocation and TL membership revocation tested. **PASS**. No source changes to the production signing route, no human key enrollment and no official EOD released. Production approval writer and human-approved key fingerprints remain hard-off. Authentic signers, separate human AAL2, independent AppSec/DBA review and official release integration remain P0.

## C — Database and recovery
Executed 30/30 existing pinned SQL candidates on isolated PG17; the unmodified strict full-fidelity catalog comparison is still **FAIL/nonzero**, reflecting two owner-ACL representation differences. Opt-in, exact-input owner-ACL reconciliation in a separate disposable restored catalog returns **parity TRUE**; lossy restore differs. No managed environment accessed. Full roles/ACL/Auth/Vault/Storage/PITR and independent DBA certification still required. The reviewed-but-uninstalled original AB7B CORE_CONVERSATION source CHECK remains hard-off, as do other quarantined candidates.

## D — Operational Finance integration
Implemented a genuinely connected, bounded **Owner-only Finance order-detail source workflow**:
- New Core `/api/vox/v1/finance/order/[orderId]`: exact UUID, three existing literal Staging guards plus `VOX_FINANCE_DETAIL_READ_ENABLED=staging`, Auth-server verified Owner AAL2 before and after reads, no-store, reads **only** selected columns from canonical `vendor_package_orders` and stable `payments.id=order.id`. Inconsistent vendor/package, amount or status DENY. No provider/UTR/bank fields fetched; POST/PUT/PATCH/DELETE 405. No provider calls, financial writes or reconciliation.
- `contracts/vox/rc10FinanceOrderDetail.mjs` + TypeScript declaration: strict cross-table record validation and minimal stable-ID projection. A missing correlated payment row is not represented as successful/failed settlement; paid/refunded order without a matching payment row is rejected.
- VOX Web `/finance/[orderId]` linked from Finance list, through verified MFA BFF, pinned HTTPS Core origin, no-store, strict response validation and a separately gated `VOX_FINANCE_DETAIL_READ_UI_ENABLED=staging`. Payment attempt history explicitly **incomplete**; refunds, capture, reconciliation and credit actions disabled.
- New real bundled route-handler HTTP tests with mocked DB/Auth boundary **9/9 PASS**, including 503 disabled, 400 invalid ID, 403 denial/revocation, 200 safe projection, mismatched Core row 503, no mutation verbs. No managed payment history or Staging accepted status.

Remaining Finance V2 PAY2 full payment-attempt/UTR history, real reconciliation/refund workflows and scoped Staff access are **NOT implemented or activated** by this addition. All other feature acceptance remains pending.

## E — Continuous validation
- **Source-only QA: 116 suites / 767 of 767 PASS**. `test-results/vox-rc10-source-qa.json` SHA256 `fd6415bf7f0e502117e5dbcf65679b7f5b3ef4052f40fe6077248bda3113dad5`. Verdict `SOURCE_PASS / releaseDecision=HOLD`; the orchestrator's PG17 and real-Auth steps are separately marked BLOCKED, not faked.
- **Both real PostgreSQL 17 disposable writer harnesses separately PASS**; not a genuine managed Staging test.
- **Real local GoTrue+PostgREST+PG Owner AAL2 route 8/8 PASS** (synthetic identity and genuine GoTrue TOTP, malformed/wrong-signature/AAL1/expired/deleted denied).
- **Core Next 16.4.1 TypeScript and production build PASS**, **VOX Web Next 16.3.8 production build and its `npm test` suite PASS**.
- **Finance/model/API/visual source/manifest/production hard-off targeted 15/15 PASS**.

## F — Release evidence and hard boundaries
- `scripts/mvp/vox/rc10-release-evidence.mjs` extends the RC9 provenance manifest to **15 exact file SHA256s**; deterministic bundle SHA256 `d0a45f4333599b923ea236a07249c9bb7941ce328e173f24da62978e49c7131e`; source JSON SHA256 `f0bf675d0e572ca79357913c364adaf485065479c7ee1e637d58f43bdaecbe1a`. This is a **hash inventory, not a signed attestation**.
- All human signer, managed restore, managed Staging and Production release gates remain FALSE. Review-only SQL stays outside managed migrations. Update Notion with exact Git SHA and CI after commit.

## Final launch blockers (do not bypass)
1. **A:** Canonical AB7B CORE_CONVERSATION original source writer + client/vender city scope + trusted real Staff AAL2 + qualified DB role review.
2. **B:** Real Owner and independently authenticated Team Leader MFA and signing-key enrollment, signer verification trust boundary and reviewed official EOD writer.
3. **C:** Full managed Staging backup+restore including roles/ACL/Auth/Vault/Storage/PITR, independent qualified DBA/AppSec, approved source migration package.
4. **D:** Finance payment-attempt history and remaining operational Core/Web features; full genuine authenticated acceptance.
5. **E/F:** Exact-head CI, reviewed and signed release artifacts, approved managed Staging E2E, final Owner Production GO.

**Do not claim VOX is fully functional in managed Staging or Production. PR #450 remains DRAFT / RELEASE HOLD.**
