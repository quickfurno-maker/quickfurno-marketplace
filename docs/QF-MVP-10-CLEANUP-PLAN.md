# QF-MVP-10.6 — Cleanup Plan & QF-MVP-10.8 — Execution Order

**Branch:** `mvp/qf-mvp-10-core-data-truth-v1` · **HEAD:** `cda20fd` · Evidence = repository code (no DB access).

**Default rule:** *Deletion is NOT an MVP blocker* unless the item causes a **build failure**, a **security exposure**, an **authority bypass**, **migration ambiguity**, or **operational confusion that could cause production misuse**. **No deletion without dependency proof.** No broad rewrites for aesthetics. **This phase deletes/refactors nothing.**

## QF-MVP-10.7 classification corrections & locked founder decisions

Applied to this document and the companion QF-MVP-10 docs:
- **AOS dormant scaffolding = `KEEP_DISABLED`** (not active Core authority; decision 8). This includes AOS **runtime / events / tools** clusters — corrected from any earlier `KEEP_AS_BUILT` framing. AOS **historical harness/governance** evidence is `LEGACY_NON_BLOCKING`.
- **Workflow-kernel infrastructure** (`lib/aos/workflow/**`, migrations 146–150) = **`KEEP_DISABLED`** — it is **not runtime-referenced** (zero live imports). It would be `KEEP_AS_BUILT` **only if/when a runtime path references it**.
- **Jarvis (QF-MVP-60) = `MVP_REQUIRED`**, recommendation-only (decision 9) — **not** "optional". Core must still run with Jarvis offline, so it is not a hard launch-day blocker, but it **is required for MVP-complete** and must never gain direct DB/authority.
- **Lifetime unique-vendor cap = 6** (decision 2); the existing **9 is rejected** (decision 3) and corrected in QF-MVP-20.
- **Every credit mutation requires an audit ledger row** (decision 5); **credit restoration requires founder/authorized-admin approval** (decision 4) — reinforces A6/A7.
- **Public vendor profiles must not expose package/plan/credit-balance/monetization** (decisions 6/7); such data only in authorized vendor/admin/CRM views — QF-MVP-20/30 add an enforcing test + reconciliation checks grants.

---

## A. KEEP UNCHANGED (stable, launch-useful — do not touch)

| Item | Why | MVP-blocking? |
|---|---|---|
| Marketplace RPCs (`assign_lead_to_*`, `qf_apply_vendor_credit_delta`, `check_duplicate_lead`, `get_public_eligible_vendors`, category RPCs) | Authoritative assignment/credit engine; idempotent + atomic | No (verify live body — 10.7) |
| Deterministic quality (`leadQualityService`, `lead_scores`) | Rule-based, "No AI" — the MVP qualification gate | No |
| Consent stack (`communicationConsentDecisionService`/`…WriterService`/`outboundConsentEnforcementService` + RPC `apply_communication_consent_command`) | Single decision/writer/enforcer; fail-closed | No (verify RPC applied — 10.7) |
| Meta non-voice adapter + gates (`metaCloudWhatsAppProvider`, `metaRuntimeGate`, webhook service, provider-account ownership) | Built, fail-closed, no voice; QF-MVP-40 activates (not rebuilds) | No |
| Idempotency/audit infra (`vendor_credit_logs` + `uq_…_reference`, `audit_logs`, `auth_security_events`) | Money + security audit trail | No |
| Public listing (`publicVendorService`, `vendorVisibility`) | Live client-facing surface | No |
| Vendor dashboard + auth (`vendorAccessService`, `vendorAuthChallengeService`) | Live vendor surface | No |
| Core taxonomy (`/api/cities`, `/api/categories`, `categoryAdminService`) | Multi-city source of truth | No |

## B. KEEP DISABLED (useful infra, not operationally required for Pune launch)

| Item | Why disabled | Deletion? |
|---|---|---|
| SMS fallback (Exotel adapter, SMS runtime/selection/canary, transport policy) | KEEP_AS_BUILT; no Exotel rows seeded; WhatsApp primary | Keep |
| Multi-provider + retry/fallback (auth transport decision, failure rules) | Ships default-deny/empty; retained per locked scope | Keep |
| Meta runtime (until QF-MVP-40) | Seed `activation_status='disabled'`, no account/mapping/canary | Keep |
| Client-OTP + vendor-WhatsApp verify automations | Kill-switches default off | Keep |
| AOS runtime toggle + automation-policy config (`aos_runtime_settings`, `automation_policy_configs`) | Two-lock off; policy engine unwired | Keep |
| Workflow kernel (`lib/aos/workflow/**`, migrations 146–150) | Built, **DO-NOT-AUTO-APPLY**, wired to no route | Keep (verify not applied) |
| Package purchase (paid flow) | No payment webhook; intents only | Keep (POST_MVP) |

## C. LEGACY NON-BLOCKING (kept on disk, diagnostic only, never a gate)

| Item | Why | Deletion? |
|---|---|---|
| 34× `test:phase*` harnesses (`scripts/phase*`) | Git-attestation / mutation / blob-freeze / static-source; superseded by `verify:mvp` | Keep (per QF-MVP-00) |
| `/api/aos/whatsapp-status` legacy n8n status path | Not the Meta webhook; secret-gated mock | Keep |
| Historical blob freezes / mutation governance / authority-transfer machinery inside the phase harnesses | Diagnostic history | Keep |

## D. REMOVE AFTER PROOF (evidence needed before any deletion — none required for MVP)

| Candidate | Reason | Dependency evidence | Deletion prerequisite | Rollback risk | MVP-blocking? | Phase |
|---|---|---|---|---|---|---|
| `/vendors/dashboard` page | Appears to be a legacy duplicate of `/vendor/dashboard` | two dashboard routes present | prove no inbound links / redirects; confirm canonical route | Low (redirect) | No | QF-MVP-70 |
| `lib/lead-assignment/autoAssignmentEngine.ts` (+ preview approval path) | Preview-only, **package-based** duplicate of the live credits-based `leadMatchingEngine`; divergent eligibility (A2/V3) | wired to `leadQueueService`, superadmin preview/approval | consolidate onto the live matcher; prove preview flow retired/migrated | Medium (admin preview) | No | QF-MVP-20.4 |
| `lib/aos/kernel/**` (`runNexusKernel` mock) + `lib/aos/memory/**` (mock-only) | Explicit mocks ("No live workflow executed"); no live import | grep: no `services/`/`app/` import | prove zero import + not referenced by an activated AOS phase | Low | No | QF-MVP-60 |
| Superseded RPC redefinitions (legacy `deduct_vendor_credit`, pre-ledger `assign_*` bodies) | Superseded by ledger-backed versions | multiple `CREATE OR REPLACE` | **DB proof** the ledger-backed body is the live definition | High (money path) | No | QF-MVP-10.7 → 20.7 |

> No item in D must be deleted to ship the MVP. Each carries a hard prerequisite; the money-path items require live-DB proof.

## E. UNKNOWN REQUIRES AUDIT (cannot safely conclude)

| Item | Why uncertain | Resolves in |
|---|---|---|
| Migrations 14 (re-declares 12 `aos_*`) & 15 (re-declares 13 `crm_*`) | Apparent re-declaration; idempotency + live state unknown; **migrations never deleted without DB proof** | QF-MVP-10.7 |
| Which `assign_lead_to_paid_vendors_phase26a` / credit-RPC body is LIVE | 3–4 committed versions; some DO-NOT-AUTO-APPLY (A6/V6) | QF-MVP-10.7 |
| Applied state of the 12 DO-NOT-AUTO-APPLY migrations | No DB access | QF-MVP-10.7 |
| Vendor CRM completeness (`lib/crm`, `crm_*` tables) | Foundation only (3 files) | QF-MVP-30 |
| `clientOtpAuthService`, `vendorPasswordResetService` (full behaviour) | Characterized from headers/imports, not full read | QF-MVP-40 |
| `public_visibility` ↔ active-package coupling | May be intended or residual (A5) | QF-MVP-20.7 (founder) |

---

# QF-MVP-10.8 — Recommended Execution Order

**Critical path:** `QF-MVP-00 (done) → 10 (this) → 20 → 40 → 50 → 70 → 80`. **30** depends on 10+20 (MVP_REQUIRED, pairs with 40/50). **60** depends on 50+70 (optional; Core must run Jarvis-offline).

### Pre-QF-MVP-20 GATE (must complete first)
1. **DB reconciliation (QF-MVP-10.7)** on staging→prod (read-only) to resolve **A6/V6**: which `assign_*` / credit-wallet RPC bodies are live, and whether the 12 DO-NOT-AUTO-APPLY migrations are applied. *Everything downstream assumes the ledger-backed wallet; verify it exists.*
2. **Founder decisions:** A4 lifetime cap **6 vs 9**; A7 credit-restoration policy; A5 public-visibility↔package coupling.

### Phase order
| Phase | Depends on | Can parallelize | Launch blocker | Notes |
|---|---|---|---|---|
| **QF-MVP-20** Marketplace engine | 10 + pre-20 gate | 20.x internally | **Yes** | Consolidate A2 (eligibility)/A3 (caps)/A7 (ledger); build A4 replacement; no rebuild of RPC engine, only reconcile + harden |
| **QF-MVP-40** Meta activation | 10 | with 20 (meet at template content) | **Yes** | **Verify + activate** (do not rebuild) — flip DB rows: runtime policy, provider account, approved template mappings; canary-first; external Meta approvals |
| **QF-MVP-30** Vendor CRM | 10, 20 | data-model after 10 | Yes (MVP_REQUIRED) | Build on Core FKs; campaign approval on Core consent (A12) |
| **QF-MVP-50** n8n | 20, 40 | — | **Yes** | Two-lock already OFF; wire idempotent execution; uncertain-outcome-not-resent |
| **QF-MVP-70** Ops & control | 20, 40, 50 | scaffold with 50 | **Yes** | Kill switches, approval gates (A15), KPIs; expose A7/A16 audit completeness |
| **QF-MVP-60** Jarvis | 50, 70 | context API specced early | No¹ | **MVP_REQUIRED** (recommendation-only); no Jarvis in-repo today; rewire AOS engines to Core before activation (V8). ¹Not a launch-*day* blocker (Core runs Jarvis-offline) but required for MVP-complete. |
| **QF-MVP-80** Launch | all upstream | — | **Yes** | Migration rehearsal + rollback; canaries; Pune go/no-go |

### Already complete — DO NOT REBUILD (verify/activate only)
- **QF-MVP-00** focused validation baseline (done).
- Communication/consent/Meta/SMS/auth-transport **foundation** — built and fail-closed; QF-MVP-40 **activates**, not rebuilds.
- Workflow kernel + AOS scaffolding — built (kernel unapplied/dormant); reuse where needed, don't recreate.
- Idempotent credit/assignment RPCs — built; **verify live body**, harden ledger coverage (A7), don't reimplement.

### External dependencies (plan lead time)
Meta WABA + phone-number + **template approvals**; public HTTPS webhook host; n8n runtime; founder sign-offs (campaign, credit-restore, Pune activation, go/no-go). Deployment = Hostinger VPS + PM2 + nginx (out-of-repo config).

### Optimize-for-speed summary
The transport, consent, and money engines already exist and are fail-closed — MVP speed comes from **verifying DB state (10.7)**, making **founder decisions (A4/A5/A7)**, **consolidating duplicated authority (A2/A3)**, and **activating** (not rebuilding) Meta — **without weakening Core authority**.
