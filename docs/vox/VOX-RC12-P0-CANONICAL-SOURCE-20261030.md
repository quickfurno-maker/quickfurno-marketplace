# VOX RC12 — P0 canonical Core source and client project binding

**30 October 2026 · PR #450 protected DRAFT · RELEASE HOLD**.

No managed Staging or Production deployment, migrations, consent changes, human credentials, key enrollment, payment/credits or provider sends. Every RC12 schema is **review-only** outside managed migration discovery and pinned SQL inventory. This is a genuine disposable PostgreSQL17 source-event integration, not Staging certification.

## P0 — GitHub CI
The prior RC11 head `ae7cb6f95129e84bec286ba98e06df5f3e4d7c55` initially had 153 successful checks, 1 skipped and 2 failed due to **Node SIGSEGV** in VM-module EOD-attention tests on GitHub Linux runners (not test assertions). Reran the **exact two failed jobs with tests unchanged**. Both `core-web-postgres-and-ingress` and `combined-auth-queue-client-eod` passed on rerun. This resolves prior RC11 exact-head CI failures without bypassing a security test. RC12 fresh-head CI must be checked after this commit.

## P0 A — Actual client conversation geographic authority
Canonical `public.client_accounts` has **no project city, zone or FK to leads**; `public.leads` has **no client_account_id/user_id/created_by**. We did not infer ownership from phone or contact records.

Created `ops/vox/rc7-review-candidates/20261030050000_vox_rc12_client_project_binding_review_only.sql` with a strict, append-only, RLS-FORCE candidate binding a specific conversation to a specific client_account, lead, verified service_zone and active city. The binding includes current independent Team Leader reviewer, bounded lifetime and an explicit evidence digest; it is **not** a real human signing ceremony and is not valid production authority unless reviewed and installed by an independent DBA/AppSec process. No anon/authenticated/service_role access.

Extended the real single-session SERIALIZABLE Core conversation writer `services/vox/rc8PgVendorConversationOperator.ts` to require on the **client** lane: an existing, explicitly approved binding, active `client_accounts` owner ID, exact verified lead `service_zone_id`, matching client project city, active zone and city, independently active/neutral Team Leader Auth principal and team, and `RIYA`-assigned conversation. All binding/geography/reviewer rows are locked while Staff/dept/object-grants and canonical D2-D/D2-C consent are evaluated on the SAME transaction. Vendor matching behavior remains unchanged. Existing production entry `executeRc8PgVendorConversationOperatorProduction` remains hard-OFF; no live Staff AAL2/native PG adapter was created.

Real loopback-only PostgreSQL17 test PASS: explicit synthetic reviewed client project can atomically TAKEOVER; unbound client, revoked reviewer and unverified project deny; existing vendor positives/nonce replay/STOP suppression/zone/city/Staff/reviewer grant denials still PASS. Synthetic binding does **not** certify human-reviewed ownership.

## P0 A — ORIGINAL AB7B -> F1 -> nonce SAME-TX provenance
Created `ops/vox/rc7-review-candidates/20261030060000_vox_rc12_core_original_source_review_only.sql` (NOT installed). It drops the original `vox_ab7b_core_conversation_blocked` constraint **only within an explicitly reviewed disposable forward SQL candidate**, replaces the AB7B guard with a clause accepting CORE_CONVERSATION only when a real, correctly typed/attributed consent-bound Core receipt, conversation state/revision, event and current Staff+object grant all match. CRM_AAROHI and SUPPORT_DESK guard cases remain enforced. The forward SQL revokes direct service_role INSERT from AB7B, F1 and source nonce tables to deny PostgREST forged attribution; actual minimal native DB role/policy remains an independent DBA/AppSec task.

The native writer now has an **explicit test-only** `DISPOSABLE_RC12_AB7B_PROOF` branch (never called by a route or worker, default OFF; production function still hard-OFF). After real state/event/consent/nonce mutation, it inserts one AB7B original source row, triggers the exact existing pinned F1 and PhaseB nonce ledger and verifies actor/team/city/subject/revision/nonce attribution inside the SAME PG transaction. Any failure must roll back all records.

Real disposable PG17 validation installed the repository's **actual** F1, PhaseB and AB7B candidate SQL in their original form. Before review-only correction, the original AB7B CHECK rejected CORE_CONVERSATION and the entire operation rolled back with NO conversation event, original-source row, F1 or nonce committed. After the candidate correction, one authorized synthetic client operation atomically wrote its Core conversation, event, receipt, AB7B original-source row, F1 event and nonce. A forged AB7B INSERT without a linked receipt was denied; all service_role direct INSERT grants on the three attribution tables were verified absent. This is a real SQL **LOCAL PASS**, NOT authority to alter managed schema.

## P0 B/C/D status
- Signed Owner + separate TL pending-intent Ed25519/real PG17 and signer-revocation-serialized tests rerun: **PASS** with SYNTHETIC keys, no official EOD writer activated and real human MFA/key ceremony/independent trust review still open.
- Finance V2 append-only attempt audit real PG17 suite rerun: **PASS** (no provider calls, payment state or wallet mutation). Real provider ingestion, complete history, refunds and consumed-credit handling remain P0.
- Local full-fidelity recovery baseline remains non-parity; narrow owner-ACL correction has a separately passing disposable parity probe from RC11. Managed roles/ACL/Auth/Vault/Storage/PITR restore and independent DBA/AppSec approval still required. No managed recovery was performed.

## P0 continuous QA
- Source-only RC4 QA **119 suites / 781/781 PASS**, report `test-results/vox-rc12-p0-final-source-qa.json` SHA256 `65faa439ddb66a2ecf89178a014dcdd003c35bfdbe0ca05bc7cd4c0bb5da90cf`, release decision **HOLD**. One earlier run caught an **outdated exact-string static test** expecting the old single-branch SQL; the test was updated to verify both new client and vendor row locks and the unchanged production hard-OFF, without weakening authorization. Final full QA then passed.
- Genuine local PG17 client/vendor/original AB7B->F1/nonce test **PASS**, plus independent signer+revocation and Finance suite PASS. Core Next 16.4.1 TypeScript+production build PASS, VOX Web pinned Next 16.3.8 tests+production build PASS (latest unmodified Web source), previous local GoTrue TOTP AAL2 8/8 PASS (synthetic identity).
- `scripts/mvp/vox/rc12-core-original-source-boundary.test.mjs` 3/3 PASS, release guard 4/4 PASS; the new review-only SQL files are not in `supabase/migrations` or the pinned 30.

## Actual launch gates — DO NOT mark P0 complete yet
1. Independent review and approved deployable migration order + minimal native writer role covering **all** AB7B/F1/nonce sources and exact privacy/consent mutation races. Actual live scoped Staff AAL2 -> trusted PG transaction adapter, client project signed ownership ceremony; no production toggles until these conditions.
2. Actual enrolled Owner + distinct Team Leader TOTP AAL2/human-signed Ed25519 keys and reviewed **official EOD source release**, not merely a pending-intent record.
3. Real Razorpay/Core Finance attempt ingestion and exact invoice/payment/UTR history with protected TEST/LIVE reconciliation, refund recovery and consumed credits. Existing audit timeline is read-only and incomplete.
4. Independent DBA/AppSec and managed Staging restore with roles/ACL/Auth/Vault/Storage/PITR; genuine authenticated all-feature E2E; signed artifact and explicit Owner Production GO.
5. New exact-head PR CI must pass; PR remains Draft, issues #444/#447/#420 remain OPEN.

**Final decision:** Engineering progress, NO live feature activation, RELEASE HOLD.
