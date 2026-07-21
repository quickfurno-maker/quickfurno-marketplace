# QF-MVP — Execution Board

**Branch:** `mvp/qf-mvp-00-core-cleanup-v1` · **Base:** `a4d289a` · **Document type:** live execution board (update as phases progress)

Statuses used: `LOCKED` · `NOT_STARTED` · `IN_PROGRESS` · `BLOCKED` · `COMPLETE` · `DEFERRED`.

---

## 1. Program status
- **Roadmap:** LOCKED
- **Active implementation:** NOT STARTED
- **Active phase after documentation:** QF-MVP-00
- **Launch market:** Pune
- **Meta voice:** excluded
- **AI scoring / ranking:** excluded
- **Vendor CRM:** inside QuickFurno (extension module)
- **Jarvis:** separate repository
- **Core authority:** locked
- **Legacy governance:** non-blocking

## 2. Current active phase
**QF-MVP-00 — Program Lock and Clean Baseline** — `NOT_STARTED`. (This documentation task locks the roadmap and creates the branch; it does **not** perform QF-MVP-00's engineering subphases 00.2–00.4, so QF-MVP-00 is not COMPLETE.)

## 3. Phase table

| Phase | Status | Depends on | Est. effort | Primary deliverable | Exit gate |
|---|---|---|---|---|---|
| QF-MVP-00 Program Lock & Clean Baseline | NOT_STARTED | — | 1–2 d | Clean branch, governance de-blocked, `verify:mvp`, green build | Focused MVP tests + typecheck + lint + build green; governance non-blocking |
| QF-MVP-10 Core Architecture & Data Truth | NOT_STARTED | 00 | 2–3 d | Runtime + DB inventory, Migration Ledger, ownership map, cleanup classification | Every route/service classified; every migration ledgered; ownership unambiguous |
| QF-MVP-20 Marketplace Transaction Engine | NOT_STARTED | 10 | 3–5 d | Lead→qualify→eligible→assign→replace→close, deterministic + audited | Limits unbypassable; credit deduction idempotent; replacement concurrency-safe; no AI scoring |
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

**Reminder:** QF-MVP-00 is **NOT_STARTED / not COMPLETE**. This board and the three companion documents (`QF-MVP-LOCKED-ROADMAP.md`, `QF-MVP-SCOPE-MATRIX.md`, `QF-MVP-ARCHITECTURE-BOUNDARIES.md`) are the authoritative inputs to begin QF-MVP-00.
