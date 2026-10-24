# Phase 3B-15 — QuickFurno private Pune beta preparation (A–E)
**Date:** 24 October 2026. **Source worktree:** `D:\QuickFurno-Workspace\Worktrees\qf-vox-step3b15-20261024`; stacked on Phase 3B-14 draft PR #409.

**Scope:** internal source code and isolated checks only. **Never** touch managed Staging/Production, delete rows, invite Auth users, submit real enquiries, debit credits, access private customer/vendor PII, call external providers, activate campaigns or turn on VOX/Finance features. External DBA/AppSec hiring is postponed, not signed or waived. The public QuickFurno website is already online; real marketplace fulfilment is not certified.

## 15A — Exact-scoped cleanup recovery
The Owner has approved eventual removal of **all 29 Production test vendors** (27 Pune + 2 Mumbai), **all 74 test leads**, and associated test assignments/credits/outbox, subject to safe backup/restore and linked Auth review. The correct session-pooler preflight passed earlier; **fresh Production backup is not yet available**. All 29 and 74 are assumed still present until a new read-only postflight confirms otherwise.

Added `ops/vox/sql-review/STEP3B15A-ALL-TEST-DATA-FK-INVENTORY-READ_ONLY.sql`, a SELECT-only, review-only FK/trigger/non-FK-reference inventory of vendor, lead, assignment and related fields plus the latest root counts. It cannot make deletions or certify retention. Added strict 6/6 source checks. Previous network-none PG17 synthetic 29/74 root/child rehearsal passes in CI but intentionally models only a SUBSET of actual constraints and triggers. **NOT a deployable SQL cleanup migration.** Auth identities and finance/audit retention require separate consideration. Before any Production delete: fresh recoverable backup (including appropriate roles/ACL/PITR/Storage binaries) + independent restore verification; frozen exact IDs and count guards; reviewed true full FK/trigger/JSON scope; approved transactional delete; postflight zero roots/orphans; user-config and Staff/Auth preserved.

## 15B — Core matching + mocked accounting
Added `scripts/scale/step3b15b-offline-marketplace-canary.test.mjs`, 7/7 pure source-backed synthetic scenarios using real Core locked constants (active vendor cap **3**, one credit per successful assignment, canonical RPC name). It demonstrates no simulated debit on missing consent, duplicate or mode off, only 3 matching vendors, duplicate event suppression and zero-credit guard. **No Supabase RPC was invoked, no live ledger, webhook or WhatsApp touched.** These are NOT real Core RPC integration/provider delivery proof.

Existing main marketplace/assignment/communications suites remain a separate prerequisite; last fully verified in 3B-14 at 137/137. Production persisted assignment mode has been observed as `auto_suggest`, which **does** create live assignments and debit credits once real vendors become eligible. Never regard `preview` or `auto_suggest` as nonmutating.

## 15C — Beta release governance / operational HOLD
Added `lib/launch/marketplaceBetaEvidence.ts`, a pure **advisory-only** Pune beta readiness evaluator and `scripts/scale/step3b15-beta-gate.test.mjs` (13/13). Requires exact SHA Owner-approved source, evidence of tested backup/restore and zero old test data/orphans, *observed* assignment mode, signed + completed real canary with consent, balanced credit ledger and deduplicated deliveries, customer support on-call and tested rollback. Requires **three independent, actually verified eligible vendors PER advertised Pune service category**, never counting Mumbai/duplicate/unverified or insufficient-credit vendor profiles. Even full synthetic passing input returns `READY_FOR_OWNER_FINAL_DECISION`, never an executable GO.

Website previously read-only tested GET /, /enquiry, /privacy, /terms, /vendors, /pricing redirect and /readyz 7/7. Instance `readyz` is NOT proof of downstream provider health. Live form/OTP/mobile devices/provider delivery not tested; no new paid campaigns.

## 15D — Real vendor onboarding preparation
The Beta gate requires verified identity, office and service zones for each candidate, positive credit and the correct category. The earlier separate advisory vendor evidence and existing governed Vendor Admin approvals still apply. Aadhaar is **not** wired to an authorized verification provider in the inspected production services; no Aadhaar number, documents, OTP or provider tokens are stored in this new phase. True Aadhaar/KYC/consent and Google Places office API results require future documented integration, lawful design, actual provider confirmation and Owner-governed approval. This phase does NOT create or activate vendors.

## 15E — Continuous QA and release plan
New offline source/model regression **26/26 PASS** (6 cleanup read-only source, 7 fake matching, 13 Beta gate). All tests are read-only and synthetic; none authenticates against protected Staging. GitHub Finance source workflow extended to rerun new tests on the exact new source SHA, while retaining existing VOX/Finance/source and network-none PostgreSQL17 tests. Core/Web types, inherited suites and exact-head GitHub CI must pass before reporting a *source* release candidate. **Still not a Production launch authorization.**

## Frozen decisions, pending operational gates
- **No managed writes/deployments now.** The previously consented eventual Production wipe must wait for verified backup, recovery and postflight; user postponed running local password-assisted backup.
- Obtain genuine Pune vendors and independently verified category/zone/identity evidence. Only after cleanup plus signoffs proceed to a controlled approved real lead and credit/debit/outbound canary.
- Do not start broad paid customer acquisition without demonstrated fulfilment.
- Distinct protected VOX/Finance rollout HOLD: seven conflicting managed migration IDs/hashes, 104 ledger discrepancies, 69 RLS policy contexts and helpers, real Owner AAL2 + TL bootstrap, signed exact staging build and Razorpay TEST.
- This source candidate is a **draft** until qualified approvals and separate later Owner launch decision.
