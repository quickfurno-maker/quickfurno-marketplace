# QF-MVP — Execution Board

**Branch:** `mvp/qf-mvp-00-core-cleanup-v1` · **Base:** `a4d289a` · **Document type:** live execution board (update as phases progress)

Statuses used: `LOCKED` · `NOT_STARTED` · `IN_PROGRESS` · `BLOCKED` · `COMPLETE` · `DEFERRED`.

---

## 1. Program status
- **QF-MVP-00:** **COMPLETE**
- **QF-MVP-10:** **COMPLETE** (production SELECT-only reconciliation completed 22 July 2026)
- **QF-MVP-20:** **IN_PROGRESS**
- **Completed:** QF-MVP-20.0 — Authority Repair Design · QF-MVP-20.1 — Consumer and Call-Path Audit
- **Current task:** QF-MVP-20.2A — Staging Schema Baseline Audit
- **Implementation:** **NOT_STARTED**
- **Migration:** **NOT_CREATED**
- **Database remediation:** **NOT_STARTED**
- **Staging project:** **PROVISIONED** (ref `uckafzuochmbvtiodmcl`)
- **Staging state:** **EMPTY**
- **Staging baseline:** **NOT_CREATED**
- **Staging database mutation:** **NONE**
- **Production database access:** **NONE**
- **Production database mutation:** **NONE**
- **Next:** QF-MVP-20.2B — Generate Reviewed Staging Baseline
- **Roadmap:** LOCKED
- **Launch market:** Pune
- **Meta voice:** excluded
- **AI scoring / ranking:** excluded
- **Vendor CRM:** inside QuickFurno (extension module)
- **Jarvis:** separate repository
- **Core authority:** locked
- **Legacy governance:** non-blocking

## 2. Current active phase
**QF-MVP-20 — Marketplace Transaction Engine** — **`IN_PROGRESS`**. **Current task: QF-MVP-20.2A — Staging Schema Baseline Audit** (read-only schema audit of an external production public-schema dump + documentation; `Implementation: NOT_STARTED`, `Migration: NOT_CREATED`, `Database remediation: NOT_STARTED`, staging + production DB mutation: `NONE`). Staging is now **PROVISIONED and EMPTY**; the reviewed baseline is `NOT_CREATED` (generation is 20.2B).

**QF-MVP-20 subphase status:**
- **20.0 Authority Repair Design** — `COMPLETE`. Canonical engine, credit authority, replacement, eligibility, public projection, communication boundary, migration plan, acceptance-test matrix in [`QF-MVP-20-AUTHORITY-REPAIR-DESIGN.md`](QF-MVP-20-AUTHORITY-REPAIR-DESIGN.md), [`QF-MVP-20-MIGRATION-PLAN.md`](QF-MVP-20-MIGRATION-PLAN.md), [`QF-MVP-20-ACCEPTANCE-TEST-PLAN.md`](QF-MVP-20-ACCEPTANCE-TEST-PLAN.md).
- **20.1 Consumer & call-path audit** — `COMPLETE`. Repository consumer map in [`QF-MVP-20-CONSUMER-CALL-PATH-AUDIT.md`](QF-MVP-20-CONSUMER-CALL-PATH-AUDIT.md): 4 Supabase clients, all `.rpc()` consumers, table-mutation matrix, 8 eligibility evaluators, ledger-bypass paths, no replacement authority, comms-in-transaction only in `assign_lead_to_vendors`, all AOS `DORMANT_KEEP_DISABLED`; 6 ACTIVE_BLOCKERs.
- **20.2A Staging schema baseline audit** — `COMPLETE`. Read-only audit of the external production public-schema dump (SHA256 `269c9265…`) in [`QF-MVP-20-STAGING-BASELINE-AUDIT.md`](QF-MVP-20-STAGING-BASELINE-AUDIT.md) + [`QF-MVP-20-STAGING-BASELINE-PLAN.md`](QF-MVP-20-STAGING-BASELINE-PLAN.md). Inventory (62 tables / 39 functions / 33 SECURITY DEFINER / 67 policies / 62 RLS / 180 indexes / **0 triggers** / **0 destructive** / **0 secrets**); classification matrix; the 4 blocker RPCs confirmed `GRANT ALL TO anon+authenticated` (EXCLUDE_UNSAFE); `GRANT ALL ON vendors TO anon` monetization exposure; live-body evidence resolves the 20.1 "which body is live" unknown (3 un-ledgered blockers vs 3 ledgered RPCs). Truthful migration-history strategy (one baseline row, no fake 68), sanitization rules, application order, parity plan. Raw dump **not** committed.

No runtime code, migration, or DB/provider access in this task. Next: **QF-MVP-20.2B — Generate Reviewed Staging Baseline**.

### Previous active phase — QF-MVP-10 (COMPLETE)
**QF-MVP-10 — Core Architecture and Data Truth** — **`COMPLETE`**. Evidence-based repository + migration map produced (six QF-MVP-10 docs + generated JSON), and the **read-only production reconciliation is executed** (22 July 2026). Access mode: the connection was **not** technically read-only (role `postgres`, `transaction_read_only = off`); read-only behaviour was **process-enforced through an explicit SELECT-only allowlist** under founder approval (`APPROVE SELECT-ONLY PRODUCTION RECONCILIATION. STAGING_NOT_PROVISIONED. NO DATABASE CHANGES.`). No database change, migration application or provider access occurred. Production materially drifts from the repository ledger (**`HISTORY_DRIFT`**: 4 recorded migration-history rows vs 68 repository migrations); an unrecorded version does **not** prove absent objects. Results: [`QF-MVP-10-RECONCILIATION-RESULTS.md`](QF-MVP-10-RECONCILIATION-RESULTS.md).

**QF-MVP-10 subphase status:**
- **10.1 Read-only inventory tooling** — `COMPLETE`. `scripts/mvp/inventory/**` + `npm run inventory:mvp` → byte-stable `docs/generated/qf-mvp-runtime-inventory.json` + `qf-mvp-migration-ledger.json` (no DB/network/secrets; repo-relative; identical across runs).
- **10.2 Runtime inventory** — `COMPLETE`. 31 API routes · 23 pages · 64 services · 19 provider adapters · 283 lib modules · workers/cron · 51 scripts, each with activation status (EXISTS/WIRED/CONFIGURED/DEPLOYED/ACTIVE).
- **10.3 Migration ledger** — `COMPLETE`. 68 migrations; 100 tables / 50 functions / 2 triggers / 0 enums / 77 policies / 89 RLS tables; **12 `DO-NOT-AUTO-APPLY` migrations** flagged; every `staging`/`production` = `UNKNOWN_UNVERIFIED`; verification SQL recorded.
- **10.4 Core domain map** — `COMPLETE`. 14 domains + AOS; dependency direction; 8 evidence-backed boundary violations (no active bypass).
- **10.5 Authority audit** — `COMPLETE`. 16 authorities. **No BLOCKER**; 4 HIGH (eligibility duplication · no 6-lifetime cap · live credit-RPC body unverified · un-ledgered `admin_smart_assign` debit).
- **10.6 Cleanup plan** — `COMPLETE`. A–E buckets; deletion is not an MVP blocker; nothing deleted; DB-proof prerequisites recorded.
- **10.7 Database reconciliation** — **`COMPLETE` (executed 22 July 2026).** Production inspected through the connected Supabase integration under a founder-approved, **process-enforced SELECT-only** mode (connection **not** technically read-only — role `postgres`, `transaction_read_only = off`; behaviour constrained by an explicit SELECT-only allowlist). No DB change / migration / provider access. Findings: **`HISTORY_DRIFT`** (4 history rows vs 68 repo migrations, exact records in the ledger); 62 base tables / 39 functions / 33 SECURITY DEFINER; **4 assignment RPCs PUBLIC/anon-executable = BLOCKER**; canonical service_role RPCs lack the lifetime-six rule; 27/46 credit-deducted assignments lack ledger evidence; anon `SELECT` on vendor monetization columns = **HIGH**; Meta correctly inactive but ack `provider_account_id` nullable = **`QF-MVP-40_BLOCKER`**. Results in [`QF-MVP-10-RECONCILIATION-RESULTS.md`](QF-MVP-10-RECONCILIATION-RESULTS.md).
- **10.8 Execution order** — `COMPLETE`. Order 20→40→(30)→50→70→(60)→80; QF-MVP-20 opens with authority repair (20.A–20.E). QF-MVP-10 is now **COMPLETE**.

**Locked founder decisions (QF-MVP-10.7):** active cap **3**; **lifetime unique-vendor cap = 6** (the existing **9 is rejected**, corrected in QF-MVP-20); credit restoration requires founder/authorized-admin approval; **every credit mutation requires an audit ledger row**; public vendor profiles must not expose package/plan/credit/monetization; **AOS dormant scaffolding = KEEP_DISABLED**; **Jarvis (QF-MVP-60) = MVP_REQUIRED** (recommendation-only), not optional.

**Key facts established:** AOS holds no authority + **no AI active** + **no Jarvis in-repo**; **Meta non-voice only + gated OFF by DB seed**; consent has a single decision/writer/enforcer. **Production reconciliation added the critical correction:** four SECURITY DEFINER assignment RPCs are **PUBLIC/anon-executable with no in-body authorization** — an active bypass that repository-only evidence could not see — now the QF-MVP-20 20.A repair. **Reconciliation is executed; QF-MVP-10 is COMPLETE.**

---

### Previous phase (COMPLETE)
**QF-MVP-00 — Program Lock and Clean Baseline** — **`COMPLETE`**. All exit gates green; full details in [`QF-MVP-00-BASELINE.md`](QF-MVP-00-BASELINE.md).

**Subphase status:**
- **QF-MVP-00.1 Baseline verification + test-command inventory** — `COMPLETE`. Branch/HEAD/parent/ancestry/tracking verified; all `test:*` commands classified from **behavioral** inspection (not names). Finding: the 38 `scripts/phase*` harnesses vendor/inline logic or static-source-match, embed a Git working-tree/commit attestation, and several perform **real write-then-revert source mutation** (`phase5d`, `phase5f:d2c`) or shell out to **`psql`** (`phase1b:runtime`) — all `LEGACY_NON_BLOCKING`, kept on disk. `test:phase*` totals: **35** (34 `LEGACY_NON_BLOCKING` + 1 `DATABASE_INTEGRATION`).
- **QF-MVP-00.2 Focused MVP runner** — `COMPLETE`. New `scripts/mvp/**` runs offline against **real** production modules (no Git/mutation/DB/network/secrets); `marketplace` (16) + `communication` (24) = **40 checks passing**.
- **QF-MVP-00.3 Package commands** — `COMPLETE`. Added `test:mvp`, `test:mvp:marketplace`, `test:mvp:communication`, `verify:mvp`; all historical commands preserved; `test:supabase:lead` and all mutation/governance harnesses excluded from the MVP gate.
- **QF-MVP-00.4 Execution board update** — `COMPLETE`.
- **QF-MVP-00.5 Configure & close the lint gate** — `COMPLETE`. Installed `eslint@8.57.0` + `eslint-config-next@14.2.15` (exact, dev); added `.eslintrc.json` (`next/core-web-vitals`); `next lint` runs non-interactively and passes (exit 0). Two pre-existing `react/no-unescaped-entities` **errors** were surfaced and fixed with authorization (single-character apostrophe escapes in `VendorNoProfileFallback.tsx`, `LeadFunnel.tsx`); 5 non-blocking warnings remain. No Next/React/TS upgrade; `core-web-vitals` not weakened; no suppressions/ignores.

**Completed deliverables:** clean-baseline verification record; full test-command inventory + classification; `scripts/mvp/` runner + two suites + minimal `.ts` resolver + README; four MVP package scripts; ESLint toolchain + `.eslintrc.json`; `docs/QF-MVP-00-BASELINE.md`. Governance is de-blocked: **no MVP gate invokes any legacy governance harness**, and no production code was changed to satisfy a stale pin.

**Final gate results:** `test:mvp` ✅ (40/40) · `typecheck` ✅ · `lint` ✅ (non-interactive) · `build` ✅ · `verify:mvp` ✅ end-to-end · `git diff --check` ✅ · legacy governance non-blocking ✅.

**Deferred coverage (not a QF-MVP-00 blocker):** launch-critical behaviour with no safe pure seam is logged `FOCUSED_TEST_REQUIRED` in the baseline doc (assignment/credit-deduction idempotency, 6-vendor lifetime cap, replacement concurrency, stateful consent decision/writer, outbound enforcement, async ack persistence) → owned by QF-MVP-20 / QF-MVP-40.

## 3. Phase table

| Phase | Status | Depends on | Est. effort | Primary deliverable | Exit gate |
|---|---|---|---|---|---|
| QF-MVP-00 Program Lock & Clean Baseline | **COMPLETE** | — | 1–2 d | Clean branch, governance de-blocked, `verify:mvp`, green build | ✅ Focused MVP tests (40/40) + typecheck + **lint** + build + `verify:mvp` end-to-end; governance non-blocking |
| QF-MVP-10 Core Architecture & Data Truth | **COMPLETE** | 00 | 2–3 d | Runtime + DB inventory, Migration Ledger, ownership map, cleanup classification | ✅ Every route/service/migration classified + ownership map + authority audit + **production SELECT-only reconciliation executed (22 Jul 2026)** |
| QF-MVP-20 Marketplace Transaction Engine | **IN_PROGRESS** (20.0 design) | 10 | 3–5 d | Lead→qualify→eligible→assign→replace→close, deterministic + audited | Limits unbypassable; credit deduction idempotent; replacement concurrency-safe; no AI scoring |
| QF-MVP-30 Vendor CRM & Campaign Readiness | NOT_STARTED | 10, 20 | 4–6 d | CRM directory/profile/tasks/segments + consent-safe campaigns | Segments deterministic; campaigns cannot bypass consent; snapshots auditable |
| QF-MVP-40 Meta WhatsApp Production Readiness | NOT_STARTED | 10 (20 for content) | 4–6 d | Non-voice Meta inbound/outbound/delivery/consent activated on staging | Staging webhook verified; foreign callback zero-effect; STOP/START/HELP correct; no voice path |
| QF-MVP-50 n8n Workflow Automation | NOT_STARTED | 20, 40 | 3–5 d | Core→n8n→Meta execution, idempotent, Jarvis-independent | Duplicate events don't double-act; uncertain outcomes not resent; pausable; auditable |
| QF-MVP-60 Jarvis Agent Integration | NOT_STARTED | 50, 70 | 4–6 d | Sanitized context + action-request API + Riya/Anisha + kill switches | No direct DB authority; unauthorized requests rejected; Core runs Jarvis-offline |
| QF-MVP-70 Operations & Launch Control | NOT_STARTED | 20, 40, 50 | 2–3 d | Admin queues, controls, kill switches, KPIs | No failure hidden; sensitive corrections require approval; KPIs visible |
| QF-MVP-80 Staging, Canary & Pune Launch | NOT_STARTED | 20, 30, 40, 50, 70 | 2–3 d + approvals | Migration rehearsal, journeys, canaries, gated launch | All journeys + canaries pass; rollback verified; Jarvis disableable; Pune approved |

## 4. Critical path
`QF-MVP-00 → 10 → 20 → 40 → 50 → 70 → 80`.
This is the minimum spine to launch. QF-MVP-30 (CRM) and QF-MVP-60 (Jarvis) hang off the spine but are not strictly on the launch-blocking critical path for a **transactional** Pune launch — however **QF-MVP-30 is MVP_REQUIRED** per the locked scope, so it must complete before "MVP done" even though a bare transactional launch could precede full CRM campaigns. QF-MVP-60 is optional for launch (Core must run with Jarvis offline).

## 5. Parallelizable work
- **After 10 completes:** QF-MVP-20 (marketplace) and QF-MVP-40 (Meta verification/activation) can proceed largely in parallel — 20 owns business logic, 40 owns transport; they meet at template content.
- **QF-MVP-30 (CRM)** data model + directory can start once 10's vendor ownership map is done, in parallel with 20's later subphases.
- **QF-MVP-70 (ops)** queues/controls can be scaffolded in parallel with 50, then wired as 20/40/50 land.
- **QF-MVP-60 (Jarvis)** context API can be specced in parallel but must not integrate until 50/70 exist.
- Non-parallel: 50 needs 20+40; 80 needs everything upstream.

## 6. Launch blockers (must be GREEN before Pune launch)
1. QF-MVP-20 marketplace flow (limits, idempotent credits, safe replacement, auditable closure).
2. QF-MVP-40 Meta non-voice: signed inbound accepted, foreign callback zero-effect, template send + delivery lifecycle, STOP/START/HELP, no voice path.
3. QF-MVP-50 n8n: idempotent execution, uncertain-outcome-not-resent, pausable, auditable.
4. QF-MVP-70 controls: Meta sending pause + campaign pause + kill switches + approval gates for credit restoration/campaign.
5. QF-MVP-80 migration rehearsal + rollback verified; both staging journeys pass; Meta + n8n canaries pass; Jarvis disableable.
6. Consent/suppression inviolable across every path (cross-cutting).
7. QF-MVP-30 CRM (MVP_REQUIRED) for campaign readiness — blocks "MVP complete", and blocks any CRM-campaign launch specifically.

## 7. External dependencies (outside engineering control — plan lead time)
- Meta/WhatsApp: WABA + phone-number approval, **template approvals**, app-secret/webhook config.
- Hosting/deploy target for Core + webhook URL (public HTTPS).
- n8n runtime environment.
- Jarvis repository availability (optional for launch).
- Founder/admin sign-off gates: campaign approval, credit-restoration approval, Pune vendor activation, launch go/no-go.

## 8. Deferred backlog (POST_MVP — do not build now)
AI lead scoring · AI vendor ranking · predictive conversion scoring · Jarvis-controlled assignment · AI package priority · Meta voice calling · WhatsApp voice agents · voice campaigns / recording / transcription · autonomous package changes · autonomous credit changes · autonomous vendor suspension · advanced analytics warehouse · mobile apps · microservice conversion · event sourcing · RCS campaigns. (KEEP_AS_BUILT, not deferred: SMS fallback, multi-provider, advanced retry/fallback, multi-city.)

## 9. Decision log (locked)
| # | Decision | Rationale |
|---|---|---|
| D1 | QuickFurno Core is the single authoritative business system; one business DB; modular monolith | Prevents split-brain authority and duplicate data |
| D2 | Vendor CRM is an internal module using extension tables; never duplicates Core facts | Keeps one source of truth for verification/package/credits/consent/eligibility |
| D3 | Jarvis stays a separate repo; recommends only; no service-role key, no direct Core writes/sends/approvals; Core runs Jarvis-offline | Safety + availability |
| D4 | n8n executes only Core-authorized actions; never an authority | Prevents automation becoming a business-rule owner |
| D5 | Meta non-voice only; voice explicitly excluded | Scope discipline |
| D6 | MVP marketplace is deterministic; no AI scoring/ranking/assignment | Explainability + correctness |
| D7 | SMS fallback, multi-provider, advanced retry, multi-city = KEEP_AS_BUILT; Pune first | Retain value without new MVP work |
| D8 | Legacy phase-governance is LEGACY_NON_BLOCKING; production safety still mandatory; no code changed to satisfy stale pins | Unblock delivery without lowering safety |
| D9 | Uncertain communication outcomes are terminal and never auto-resent | Prevents duplicate/erroneous sends |
| D10 | Assignment caps: 3 active / 6 lifetime; credit deduction idempotent; restoration needs approval | Hard business invariants |

## 10. Phase completion checklist (apply to every phase before marking COMPLETE)
- [ ] All subphase deliverables produced and reviewed.
- [ ] Phase exit criteria objectively met (tests/evidence attached).
- [ ] `verify:mvp` (typecheck + lint + build + focused MVP tests) green.
- [ ] No production code changed merely to satisfy a legacy governance pin.
- [ ] Migration-safety review done **iff** SQL changed; no unsafe managed-DB commands.
- [ ] No unintended DB/provider access during ordinary validation.
- [ ] Ownership boundaries respected (Core authority; Jarvis recommends; n8n executes; Meta delivers; results return to Core).
- [ ] Audit records exist for every important action introduced.
- [ ] Kill switches / pause controls exist for any new automated path.
- [ ] Execution board updated (status, blockers, decisions).

---

**Reminder:** QF-MVP-00 is **COMPLETE**. QF-MVP-10 is **COMPLETE** — the evidence-based Core map, runtime inventory, migration ledger, authority audit, cleanup plan, DB-reconciliation procedure, **and the executed production SELECT-only reconciliation (22 July 2026)** are all done. The reconciliation ran through the connected Supabase integration under a founder-approved, process-enforced SELECT-only allowlist (the connection was not technically read-only); no database change, migration application or provider access occurred. Six QF-MVP-10 docs + `docs/generated/*.json` are the authoritative map; the four locked docs (`QF-MVP-LOCKED-ROADMAP.md`, `QF-MVP-SCOPE-MATRIX.md`, `QF-MVP-ARCHITECTURE-BOUNDARIES.md`, this board) remain the governing inputs. **QF-MVP-20 is `NOT_STARTED` and opens with authority repair (20.A–20.E); applying that repair is gated on staging provisioning (`OPEN_LAUNCH_PREREQUISITE`).**
