# VOX RC17 — parallel functional implementation and protected release

**30 October 2026 · PC offline · protected Draft PR #450 · managed Staging/Production HOLD**

## A — Finance V2 (implementation in source, NOT installed)

- New forward-only, **review-only** SQL candidate `ops/vox/rc17-review-candidates/20261031001000_rc17_razorpay_v2_authority_REVIEW_ONLY.sql` defines the exact five `*_v2` RPCs called by `services/vendorPackagePaymentService.ts`, including `provider_mode` TEST/LIVE persistence, token-based claim/bind/release, service-role-only execution, exact-once activation path and failed-payment recording.
- The candidate retains historical V1 migrations unchanged. It rejects old TEST orders in LIVE, reclaims only the exact token/mode after definitive failure, and holds uncertain order creation instead of automatic repeat POST. **A server-side verified captured provider payment remains mandatory before calling activation**; the SQL itself cannot attest a real Razorpay capture.
- `scripts/mvp/vox/validate-vox-rc17-razorpay-v2-real-pg17.mjs` creates a disposable PostgreSQL17 schema and executes the actual candidate, exercising five RPCs, wrong/cross-mode claims, replay, exact-once credits, strict release and browser privileges. **This is an isolated contract fixture, not an entire historical V1→V2 migration replay or an external provider test.**
- Existing V1 migration `20260912010000_qf_vendor_package_razorpay_testmode.sql` contains suspicious `AS $` delimiters and request-token logic. Do not rewrite historical migrations; compare actual managed ledger and independently adjudicate syntax/upgrade sequencing. A successfully compiling V2 fixture **does not resolve** this prerequisite.

## B — Core conversation consent

- Added `FOR SHARE` to existing suppression and preference reads on the same `SERIALIZABLE` connection as the conversation mutation. This narrows the concurrent-update window when consent rows exist.
- An absent row cannot be gap-locked by these reads. All consent insertion/deactivation paths still need verified shared destination serialization, trusted real Staff AAL2/current role and true client-project owner evidence. `RC8_CORE_WRITER_INSTALLED=false` remains unchanged.

## C — Official EOD / signed approvals

- New uninstalled SQL overlay `20261031002000_rc17_eod_publication_authority_REVIEW_ONLY.sql` revokes `service_role` direct execution of the legacy digest-only AB7G publication RPC and direct approval/publication writes. Prevent re-enablement without a narrowly verified writer.
- This does **not** create genuine Owner/TL human signers, enroll their Ed25519 keys, verify their current real AAL2 sessions or authorize publication. The official route and native signer gates remain hard OFF.

## D — Database release discipline

- Both RC17 SQL candidates remain in `ops/vox/rc17-review-candidates`, **not** `supabase/migrations`, with explicit no-deploy warnings.
- `scripts/mvp/vox/rc17-migration-ui-launch-guards.test.mjs` checks that financial/signing DDL does not become an automatic migration or silently enable protected routes.
- Still required: exact current managed Staging schema inventory, chronological source migration replay, full isolated Supabase-compatible Auth/Vault/Storage/PITR/ACL/ownership recovery, independently reviewed grants and signed DBA/AppSec decision.

## E — Finance Owner UI

- Added allow-listed `all/paid/pending/failed/refunded` filter controls to existing **read-only bounded** recent Core order preview. This is not a comprehensive ledger and does not add refund, payment, reconciliation or credit-authority buttons.
- UI retains Owner MFA/Core Staging gates and clear restrictions on settlement inference.

## F — continuous QA

- New `.github/workflows/vox-rc17-six-tracks-hold.yml` triggers on RC17 changes, runs Node source-contract and release-guard tests, Core `npm run typecheck`, and genuine disposable PostgreSQL17 five-RPC integration test.
- Source tests: `rc17-finance-v2-source-contract.test.mjs`, `rc17-core-consent-eod-security.test.mjs`, `rc17-migration-ui-launch-guards.test.mjs`.
- **Exact-head CI result pending.** Do not claim the workflow passed until completed results are available; previous verified test counts belong to previous commits. No tests were skipped, marked allow-failure, or altered to approve a launch.

## Final mandatory P0 blockers — no gate bypass

1. Finance: real full migration/restore replay, authoritative managed schema inventory, captured-payment live/provider ingestion, robust reconciliation, refunds and consumed-credit policy; see [#451](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/451).
2. Core: trustworthy Auth AAL2→Staff→DB bound transactional consent/ownership with complete mutation serialization, independent Core migration review; see [#444](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/444).
3. Signed EOD: two genuinely enrolled independent Owner/TL signatures, verified identity and approved atomic publication writer; see [#447](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/447).
4. Database/release: independent qualified DBA/AppSec, successful current managed recovery/rollback, authorized Staging acceptance and explicit separate Owner Production GO; see [#420](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/420).

**Release decision: HOLD. PR #450 stays DRAFT. No managed migrations, schema changes, payment activation, provider sends, signed official EOD, human identity enrolment or deployment happened in this work.**
