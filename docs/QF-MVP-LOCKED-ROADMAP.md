# QF-MVP — Locked Launch Roadmap

**Status:** LOCKED · **Branch:** `mvp/qf-mvp-00-core-cleanup-v1` · **Base commit:** `a4d289a681f6b7aaf8deb2083386af821c072ba0`
**Launch market:** Pune (first) · **Primary WhatsApp provider:** Meta · **Document type:** authoritative execution plan (documentation only)

This is the single authoritative plan for reaching a shippable QuickFurno MVP quickly while keeping a strong, modular, organized QuickFurno Core. It supersedes the phase-governance program as the *day-to-day* driver of work (see QF-MVP-00.2). Estimates are planning targets, **not guarantees**, and exclude external approval latency (Meta template/WABA review, hosting).

> Conventions used in every phase: **Purpose** (why), **Deliverables** (concrete artifacts), **Exit criteria** (objective, testable), **Non-goals** (explicit exclusions), **Effort** (focused engineering days). "Focused engineering day" = one uninterrupted day by an engineer already loaded with context.

---

## Program series overview

| Phase | Title | Primary outcome |
|---|---|---|
| QF-MVP-00 | Program Lock & Clean Baseline | Clean branch, governance de-blocked, focused MVP validation, known-green build |
| QF-MVP-10 | Core Architecture & Data Truth | Runtime + DB inventory, migration ledger, ownership map, cleanup classification |
| QF-MVP-20 | Marketplace Transaction Engine | Reliable lead → qualification → eligibility → assignment → replacement → closure |
| QF-MVP-30 | Vendor CRM & Campaign Readiness | Vendor CRM module + deterministic segments + consent-safe campaigns |
| QF-MVP-40 | Meta WhatsApp Production Readiness | Non-voice Meta inbound/outbound/delivery/consent, activated on staging |
| QF-MVP-50 | n8n Workflow Automation | Core→n8n→Meta execution with idempotency, without Jarvis |
| QF-MVP-60 | Jarvis Agent Integration | Riya/Anisha as optional recommenders behind Core validation + kill switches |
| QF-MVP-70 | Operations & Launch Control | Founder/admin queues, controls, kill switches, KPIs |
| QF-MVP-75 | QF VISION — Deterministic Operations Orchestration | Durable jobs, leases, retries, reconciliation and recovery without duplicating Core authority |
| QF-MVP-80 | Staging, Canary & Pune Launch | Migration rehearsal, journeys, canaries, gated production launch |

Dependency spine (full launch critical path): **00 → 10 → 20 → 40 → 50 → 70 → 75 → 80**. QF-MVP-30 remains the Vendor CRM / campaign-readiness lane: it depends on 10/20 and pairs with the communication and automation work in 40/50. QF-MVP-60 (Jarvis Agent Integration) depends on 50/70, remains a **separate/optional lane**, and is **not** required for the Pune MVP launch — Core must run correctly with Jarvis offline.

**Current remaining critical path** (after the completed work): **40 → 70 → 75 → 80**.

---

# QF-MVP-00 — Program Lock and Clean Baseline

**Purpose:** establish the clean MVP branch, stop legacy governance from blocking development, establish a focused MVP validation command, and pin a known-buildable baseline. No production behaviour changes.

### QF-MVP-00.1 — Branch and baseline verification
- **Deliverables:** branch `mvp/qf-mvp-00-core-cleanup-v1` created from exactly `a4d289a`; recorded starting commit; recorded current migration set (68 migrations, latest `20260721000100_communication_consent_ack_intent_provider_account_required.sql`) and runtime status; confirmation the working tree is clean and no later governance commits (`5f139b5`, `ab8e603`) are reachable.
- **Exit:** branch tip == `a4d289a`; clean tree; inventory recorded in QF-MVP-EXECUTION-BOARD.md.

### QF-MVP-00.2 — Governance de-blocking
- **Deliverables:** the legacy phase-governance scripts (historical commit-range validation, harness blob-SHA freezes, successor-authority transfers, harness-policing-harness checks, per-PR mutation/database proof suites) are removed from the **mandatory** development gate and reclassified `LEGACY_NON_BLOCKING`. Scripts are **kept on disk** (no deletion in the MVP program without dependency proof).
- **Rule recorded:** production safety remains mandatory; legacy governance is no longer an ordinary development blocker; **no production code is changed merely to satisfy a stale historical pin or blob freeze.**
- **Exit:** a documented development gate exists that does not invoke any legacy governance harness; the legacy scripts remain present and runnable diagnostically.

### QF-MVP-00.3 — Focused MVP validation
- **Deliverables (planned npm scripts — to be added in implementation, not this doc task):**
  - `test:mvp` — aggregate of the focused MVP suites below.
  - `test:mvp:marketplace` — lead/qualification/eligibility/assignment/replacement/credits/closure unit + integration tests.
  - `test:mvp:communication` — Meta inbound/outbound/consent/ack unit tests (offline; no DSN, no network).
  - `verify:mvp` — `typecheck` + `lint` + `build` + focused MVP tests, single command.
- **Normal development gate (per PR):** focused feature tests → direct dependency tests → `typecheck` → `lint` → production `build` → migration-safety review **only when** SQL changes.
- **Exit:** the four commands exist and run offline; `verify:mvp` is the one command an engineer runs before opening a PR.

### QF-MVP-00.4 — Baseline green
- **Exit criteria:** focused MVP tests pass; `typecheck` passes; `lint` passes; production `build` passes; ordinary validation performs **no** database or provider access; legacy governance failures no longer block work.

**Non-goals:** no feature implementation, no Vendor CRM build, no Meta activation, no n8n build, no Jarvis integration, no migration deletion.
**Effort:** 1–2 focused engineering days.

---

# QF-MVP-10 — Core Architecture and Data Truth

**Purpose:** produce a strong, organized, understandable QuickFurno Core map before expanding the product, so every later phase edits a known system. Core domains: leads, clients, vendors, vendor eligibility, assignments, replacements, packages, credits, consent, communication, vendor CRM, automation contracts, audit, admin operations.

### QF-MVP-10.1 — Runtime inventory
- **Deliverable:** table of every API route (`app/**/route.ts`, `pages/api/**`), service (`services/*.ts` — 60+ exist, e.g. `leadService`, `leadMatchingEngine`, `packageService`, `vendorCreditWalletService`, `communicationService`, `metaWhatsAppWebhookService`, `consentAckWorkerService`), library (`lib/**`), worker/cron endpoint, provider adapter (`lib/communication/providers/*`), admin function, public route, and package script — each with owning Core domain and one-line responsibility.

### QF-MVP-10.2 — Database inventory
- **Deliverable:** enumeration of migrations (68), and the tables/columns/constraints/indexes/RPCs/functions/triggers/RLS policies/grants/scheduled jobs they define, derived from `supabase/migrations/*.sql` (repository truth). Live-DB comparison is **planned, not executed** in this program (documentation task performs no DB access).

### QF-MVP-10.3 — Migration Ledger
- **Deliverable:** for every migration: filename · purpose · dependencies · repository state · staging state · production state (marked `requires audit` until measured) · expected DB objects · MVP classification · rollback plan · verification query. Seed the ledger from `docs/quickfurno-migration-review.md` where it exists and reconcile.

### QF-MVP-10.4 — Ownership boundaries
- **Deliverable:** map of which Core domain owns each business rule, each write, each decision, each audit record. Explicitly resolve any duplicated authority (e.g., consent decisions vs. writers; credit deduction points; assignment counting).

### QF-MVP-10.5 — Cleanup plan
- **Deliverable:** every production route/service/migration classified as one of `MVP_REQUIRED` · `KEEP_AS_BUILT` · `KEEP_DISABLED` · `POST_MVP` · `LEGACY_NON_BLOCKING` · `REMOVE_AFTER_PROOF` · `UNKNOWN_REQUIRES_AUDIT`. **No deletion without dependency proof.** Cleanup PRs are narrowly scoped (one concern each).

**Exit criteria:** every production route and service classified; every migration recorded in the ledger; a method exists to compare actual DB state with repository state; Core ownership is unambiguous; duplicate authorities identified; cleanup PRs planned narrowly.
**Effort:** 2–3 focused engineering days.

---

# QF-MVP-20 — Marketplace Transaction Engine

**Purpose:** complete one reliable, auditable lead-to-vendor marketplace transaction. Deterministic and explainable throughout — **no AI scoring or ranking.**

- **20.1 Lead intake** — submission; phone verification; category; city; area; requirement details; source attribution; duplicate protection. (Anchors: `leadService`, `clientRequirementGroupService`, `leadQualityService`.)
- **20.2 Lead qualification** — deterministic classification only: `verified` · `incomplete` · `duplicate` · `eligible` · `blocked` · `requires_admin_review`. No scoring. (Anchors: `leadQualityService`, `leadClarificationService`, `leadProcessingDiagnosticsService`.)
- **20.3 Vendor eligibility** — a vendor is eligible **only when** verified **and** enabled **and** correct category **and** correct service capability **and** correct city/service-area **and** valid package/entitlement **and** sufficient credits (when required) **and** not already exhausted for the lead **and** not operationally suppressed. (Anchors: `publicVendorService`, `vendorAccessService`, `packageService`, `vendorCreditWalletService`, `leadMatchingEngine`.)
- **20.4 Assignment** — **max 3 active assignments per qualified lead**; **max 6 unique vendors across the lead lifetime**; deterministic selection; full audit trail; **no Jarvis-controlled assignment.** (Anchors: `leadDeliveryService`, `manualLeadAssignmentService`, `preferredVendorLeadService`, `aosService`.)
- **20.5 Accept / reject / expiry** — vendor accepts; rejects; no-response; offer expiry; result persisted; client status updated.
- **20.6 Replacement** — one replacement action at a time; respect the 6-vendor lifetime cap; never reassign an exhausted vendor; prevent concurrent duplicate replacements; record reason + actor. (Anchor: `delayedLeadFillService` and assignment ledger.)
- **20.7 Packages & credits** — validate package; validate credit balance; deduct at the approved business point; **idempotent** (no duplicate deduction); maintain ledger; **restoration requires founder/admin approval**; every correction audited. (Anchors: `packageService`, `vendorCreditWalletService`, `vendorPackageOrderService`, `adminAuditService`.)
- **20.8 Closure** — `converted` · `not_converted` · `client_cancelled` · `vendor_unavailable` · `duplicate` · `bad_lead` · `expired` · `admin_closed`.

**Exit criteria:** full client flow passes; full vendor flow passes; assignment limits cannot be bypassed; credit deduction is idempotent; replacement is concurrency-safe; closure is auditable; **no AI scoring or ranking exists.**
**Effort:** 3–5 focused engineering days.

---

# QF-MVP-30 — Vendor CRM and Campaign Readiness

**Purpose:** build an advanced Vendor CRM **inside** QuickFurno Core as a separate internal module. It **must not duplicate authoritative Core facts** (verification, package, credits, consent, lead eligibility remain in Core). Foundation exists in `docs/quickfurno-crm-foundation.md` / `docs/quickfurno-crm-flow.md`; implementation status is `UNKNOWN_REQUIRES_AUDIT`.

- **30.1 Vendor data model** — *Authoritative (Core, read-only to CRM):* identity, verification, active status, categories, services, city, service areas, package, credits, consent, assignment eligibility. *CRM extension tables:* business profile; owner/decision-maker contacts; WhatsApp; email; GST/PAN; company type; team size; years in business; workshop/factory capability; project capacity; budget range; design capability; manufacturing capability; preferred/excluded localities; travel radius; relationship stage; account manager; tags; notes; tasks; next follow-up; inactive reason; onboarding state; engagement history. **No duplication of authoritative facts** — CRM references Core by FK.
- **30.2 Vendor directory** — filters: category; specialisation; city; area; pincode; verification; active status; package; credits; onboarding stage; tags; last interaction; package expiry; campaign eligibility; account manager.
- **30.3 Vendor profile** — displays authoritative Core data + CRM extension + documents + service capability + package/credits + lead history + response history + communication history + notes + tasks + campaigns + performance summary.
- **30.4 CRM tasks** — document request; onboarding follow-up; package renewal; low-credit reminder; inactive-vendor follow-up; complaint handling; campaign follow-up.
- **30.5 Rule-based segments** — deterministic only (e.g., "verified carpenters in Pune", "modular factories with packages expiring soon", "vendors with low credits", "inactive vendors", "vendors missing documents", "promotion-eligible painters in Kharadi"). **No AI-generated scoring.**
- **30.6 Vendor campaigns** — flow: campaign created → rule-based segment evaluated → **Core recalculates eligibility** → consent & suppression checked → frequency controls checked → **audience snapshot frozen** → admin approval → execution request created → n8n sends through Meta → results return to Core → CRM engagement updated. Requirements: draft; approval; scheduling; audience preview; exclusions + reasons; idempotency; delivered/read/replied/failed; pause; audit.

**Exit criteria:** directory works; advanced profile works; tasks/notes/tags work; segments are deterministic; campaigns cannot bypass consent; audience snapshots are auditable; campaign results return to CRM.
**Effort:** 4–6 focused engineering days.

---

# QF-MVP-40 — Meta WhatsApp Production Readiness

**Purpose:** complete and activate QuickFurno's **non-voice** Meta WhatsApp capability. Substantial foundation already exists (`lib/communication/providers/metaCloudWhatsAppProvider.ts`, `metaCallbackIdentity.ts`, `metaWebhookRawBody.ts`, `metaWebhookAccountIdentity.ts`, `metaWhatsAppInbound.ts`, `metaWhatsAppWebhook.ts`, `providerAccountOwnership.ts`; services `metaWhatsAppWebhookService.ts`, `metaWhatsAppOutboundService.ts`, `consentAckWorkerService.ts`, `outboundConsentEnforcementService.ts`; runbooks `docs/QF-WhatsApp-Cloud-API-Activation-Runbook.md`, `docs/QF-WhatsApp-Cloud-API-Production-Readiness.md`). This phase **verifies, completes, and activates** — it does not rebuild.

- **40.1 Existing foundation verification** — verify: Meta provider adapter; webhook verification; raw-body signature verification; callback identity gate; WABA identity; phone-number identity; provider-account ownership; inbound message persistence; outbound approved-template send; delivery lifecycle; replay protection; consent enforcement; STOP/START/HELP; asynchronous acknowledgements; provider health + runtime gates.
- **40.2 Migration readiness** — verify required communication migrations; confirm actual DB objects; rehearse migration order; define rollback; **do not use unsafe migration commands when history is drifted** (no `db push`/`migration up`/`reset`/`repair` against a drifted managed DB).
- **40.3 Meta configuration** — provider mode; access token; WABA ID; phone-number ID; Graph API version; app secret; webhook verify token; webhook URL; timeouts; runtime enablement; canary control. (Config held in environment/runtime gates, never in repo.)
- **40.4 Template readiness** — approved templates for: *Clients* — lead confirmation; requirement questions; missing-information reminders; matching updates; lead-status updates; transactional follow-ups. *Vendors* — lead offer; accept/reject; response reminder; onboarding reminder; document reminder; package-expiry warning; low-credit warning; approved CRM promotion. *Consent acknowledgements* — STOP ack; START ack; HELP response.
- **40.5 Inbound handling** — persist inbound; retain provider identity; classify supported inputs; process STOP/START/HELP; maintain idempotency; return correct webhook result; **never perform a slow provider call inside the webhook** (acknowledgements are async, per existing ack-intent design).
- **40.6 Outbound handling** — approved templates only; validate consent; validate suppression; validate provider account; persist provider message ID; record outcomes; prevent duplicate sends.
- **40.7 Delivery callbacks** — accepted; sent; delivered; read; failed; duplicate callback; unknown callback; **foreign-account callback → zero effects.**
- **40.8 Campaign communication** — CRM campaign messages use frozen approved audiences; approved templates; honor marketing consent; honor suppression; honor frequency limits; return results to CRM.
- **40.9 Explicit exclusion** — **exclude completely:** Meta voice calling; WhatsApp voice agents; call recording; transcription; voice campaigns.

**Exit criteria:** staging webhook verified; signed inbound callback accepted; foreign callback causes zero effects; template send succeeds; delivery lifecycle updates Core; STOP blocks future promotional messages; START restores only permitted communication; HELP responds safely; campaign canary succeeds; **no voice path exists.**
**Effort:** 4–6 focused engineering days, excluding external Meta approvals.

---

# QF-MVP-50 — n8n Workflow Automation

**Purpose:** make QuickFurno operational through **Core + n8n + Meta without requiring Jarvis.** Architecture: Core → authorized automation job → n8n → Meta WhatsApp → result callback → Core. (Foundations: `docs/n8n`, `docs/n8n-workflows`, `docs/N8N_VENDOR_CREDIT_SYNC_CONTRACT.md`, AOS docs.)

- **50.1 Action contracts** — action request; automation job; execution attempt; action result; idempotency key; correlation ID; retry classification; audit actor.
- **50.2 Client workflows** — lead confirmation; requirement collection; missing-information reminder; matching update; lead-status update; transactional follow-up.
- **50.3 Vendor workflows** — lead offer; accept/reject; response reminder; onboarding reminder; document reminder; package expiry; low credits.
- **50.4 CRM campaign workflow** — approved campaign; audience snapshot; bounded execution; per-recipient result; campaign totals; pause/resume; failure escalation.
- **50.5 Failure handling** — idempotent execution; retryable vs. definitive failure; **uncertain outcome is terminal and never blindly resent**; dead-letter state; manual safe retry.
- **50.6 Security** — n8n **cannot**: choose arbitrary recipients; decide consent; change packages; change credits; assign vendors; bypass Core validation; directly edit authoritative tables.

**Exit criteria:** all launch workflows operate without Jarvis; duplicate requests do not duplicate actions; failures appear in Core; uncertain outcomes are not blindly resent; workflows can be paused; results are auditable.
**Effort:** 3–5 focused engineering days.

---

# QF-MVP-60 — Jarvis Agent Integration

**Purpose:** connect Jarvis (coordinator), Riya (client agent), Anisha (vendor agent) as **optional** intelligence without weakening Core. Jarvis is a **separate repository** and stays one. Boundary already documented in `docs/QF-Jarvis-Integration-Boundary.md` — this phase implements it. **QuickFurno must run fully with Jarvis offline.**

- **60.1 Sanitized context API** — Jarvis receives only approved context. **Never expose:** service-role credentials; provider secrets; raw consent rows; unrestricted client/vendor data; internal encryption keys.
- **60.2 Action-request API** — Jarvis submits recommendations; Core validates action type, actor, recipient, entity, consent, package/credit authority, assignment limits, idempotency, approval requirements. Jarvis **never** writes Core tables directly.
- **60.3 Jarvis coordinator** — task routing; operational summaries; priority recommendations; agent coordination.
- **60.4 Riya** — client requirement conversations; follow-up recommendations; draft responses; basic response classification; client-recovery suggestions.
- **60.5 Anisha** — vendor onboarding assistance; document reminders; CRM task recommendations; campaign-draft assistance; vendor-engagement summaries.
- **60.6 Kill switches** — global Jarvis pause; Riya pause; Anisha pause; per-action-type pause; safe fallback to non-Jarvis operation.
- **60.7 Shadow mode** — before any autonomous low-risk execution: Jarvis recommends; humans/Core observe; **no provider action from Jarvis alone**; recommendations compared against actual outcomes.

**Exit criteria:** Jarvis has no direct database authority; unauthorized action requests are rejected; QuickFurno works while Jarvis is offline; Riya and Anisha can draft and recommend; kill switches work; sensitive actions require Core/admin approval.
**Effort:** 4–6 focused engineering days.

---

# QF-MVP-70 — Operations and Launch Control

**Purpose:** give the founder/admin complete operational control. (Anchors: `adminService`, `adminAuditService`, `communicationAdminService`, `vendorAdminService`, `categoryAdminService`.)

- **70.1 Lead operations** — queues: new; incomplete; qualified; pending assignments; vendor response pending; replacement required; closure required.
- **70.2 Vendor operations** — onboarding pending; documents missing; package expiry; low credits; inactive vendors; complaints; follow-up tasks.
- **70.3 Communication operations** — queued messages; failed messages; uncertain outcomes; webhook failures; acknowledgement-intent failures; campaign failures; manual retry eligibility.
- **70.4 Automation operations** — pending n8n jobs; failed n8n jobs; dead-letter jobs; Jarvis action requests; pending approvals; rejected actions.
- **70.5 Controls** — global automation pause; Meta sending pause; campaign pause; n8n workflow pause; Jarvis/Riya/Anisha kill switches; manual safe retry; vendor enable/disable; campaign approval; credit-restoration approval.
- **70.6 MVP metrics** — leads received; qualified leads; assignments; acceptance rate; vendor response time; replacements; conversions; credits deducted; credits restored; Meta sent/delivered/read/failed; campaign replies; failed automation jobs.

**Exit criteria:** no important failure is hidden; admin can pause communication; sensitive corrections require approval; audit records explain every important action; launch KPIs are visible.
**Effort:** 2–3 focused engineering days.

---

# QF-MVP-75 — QF VISION — Deterministic Operations Orchestration

**Status:** PENDING · locked by explicit owner decision.

**Purpose:** QF VISION is the durable operations/orchestration control plane for QuickFurno.

> **Locked principle:** *"Vision coordinates work; Core decides business outcomes."*

Vision must schedule, claim, retry, reconcile, expose and recover operational work. It **MUST NOT** become a second business-rule engine and **MUST NOT** duplicate existing Core authority for leads, qualification, vendor eligibility/ranking/assignment, packages/credits, consent/suppression, communication-provider eligibility, or audit truth.

### QF-MVP-75.1 / Vision M9 — Lead Orchestration and Assignment Control
- Durable job creation for required lead-processing/assignment work.
- Lease/claim semantics so work is owned once at a time.
- Invoke existing Core lead-quality, eligibility, matching/assignment and replacement authorities; never reimplement them.
- Idempotency and concurrency safety.
- Bounded retry/backoff only for retryable operational failure.
- Deterministic failure/dead-letter state and reconciliation.
- No AI scoring/ranking.

### QF-MVP-75.2 / Vision M10 — Vendor Automation
- Durable onboarding/document/package/credit/renewal/inactive-vendor operational tasks.
- Schedule and coordinate existing Core/CRM actions.
- Vendor Engagement & Renewal automation may orchestrate existing authorities but owns no authoritative vendor/package/credit fact.
- Safe retries, dedupe, operator visibility and recovery.

### QF-MVP-75.3 / Vision M11 — Client Lifecycle Automation
- Durable client follow-up, clarification, status, closure and permitted re-engagement work.
- Follow-up automation must always pass through existing consent/suppression and communication gates.
- No provider bypass and no independent send authority.
- Deterministic schedules, idempotency, cancellation and reconciliation.

### QF-MVP-75.4 / Vision M12 — Operations Console Integration
- Expose Vision jobs, leases, retries, exhausted/dead-letter work, reconciliation state and timelines to founder/admin operations.
- Reuse QF-MVP-70/Admin V2 surfaces where practical; do not rebuild another admin product.
- Safe operator actions only: inspect, retry when policy allows, cancel/pause, reconcile/escalate.
- Every operator action audited.

### QF-MVP-75.5 / Vision M13 — Production Hardening
- Crash/restart safety.
- Lease expiry/reclaim.
- Duplicate-delivery/replay safety.
- Retry exhaustion/dead-letter behavior.
- Reconciliation after ambiguous/partial execution.
- Shadow mode, canary mode and kill switches.
- Metrics/alerts for backlog, age, retries, failures and stuck leases.
- Load/concurrency and recovery tests sized for MVP launch.
- Core must continue to function when Vision workers are paused; no loss/corruption of authoritative business state.

**Deterministic operational modules.** The following are **orchestration labels, NOT autonomous AI agents**. Each one schedules and coordinates work only, and delegates every business decision to the existing Core authority that already owns it:

- **Lead Quality Agent/module** — delegates all lead-quality and qualification decisions to Core.
- **Vendor Matching Agent/module** — delegates all eligibility, ranking and assignment decisions to Core.
- **Follow-up Agent/module** — delegates all consent/suppression and send-eligibility decisions to the existing communication gates.
- **Vendor Engagement & Renewal Agent/module** — delegates all vendor, package and credit facts to Core.

**Exit criteria:**
- every launch-critical asynchronous action owned by Vision is durably scheduled/audited;
- a job cannot be concurrently owned by two healthy workers;
- idempotent replay cannot duplicate authoritative business effects;
- retry policy is bounded and classification-driven;
- exhausted/ambiguous work is visible and recoverable;
- kill switches/pause work;
- admin can understand current state and safe next actions;
- no duplicated Core decision authority exists;
- no Jarvis dependency is introduced;
- QF-MVP-80 can run integrated staging/canary launch exercises on top of Vision.

**Non-goals:** no LLM/AI ranking/scoring; no Jarvis/Riya/Anisha implementation; no WhatsApp voice; no duplication of lead/vendor/package/credit/consent/provider business rules; no second admin dashboard rebuild; no Pune production launch itself (QF-MVP-80 owns launch).

**Effort:** 5–8 focused engineering days. This target assumes reuse of the current Core and Admin infrastructure and explicitly **excludes** a duplicate rebuild of any existing Core authority or admin surface.

---

# QF-MVP-80 — Staging, Canary and Pune Launch

**Purpose:** prove the complete system and launch safely.

- **80.1 Migration rehearsal** — clean test database; migration order; expected objects; constraints; indexes; rollback; staging comparison; production plan. (No unsafe managed-DB commands.)
- **80.2 Complete staging client journey** — submission → verification → qualification → assignment → communication → follow-up → closure.
- **80.3 Complete staging vendor journey** — onboarding → lead offer → accept/reject → package/credit → task → campaign → result.
- **80.4 Meta canary** — internal test numbers; approved templates; inbound webhook; outbound send; delivery/read/failure; STOP/START/HELP; campaign canary.
- **80.5 n8n canary** — one bounded workflow; duplicate event; failure event; safe retry; result callback.
- **80.6 Jarvis shadow canary** — recommendations only; no sensitive autonomous actions; kill switch tested; Core works when Jarvis disabled.
- **80.7 Production launch order** — (1) deploy Core; (2) apply approved migrations; (3) verify production runtime; (4) configure Meta; (5) activate n8n; (6) run internal canary; (7) activate limited Pune vendors; (8) accept a small Pune lead batch; (9) monitor failures + conversion; (10) increase traffic gradually.

**Exit criteria:** migration rehearsal passes; client journey passes; vendor journey passes; Meta canary passes; n8n canary passes; Jarvis can be disabled safely; rollback is verified; kill switches work; **Pune launch approved.**
**Effort:** 2–3 focused engineering days plus external approval delays.

---

## Locked cross-cutting rules (apply to every phase)

1. **Core is the only authority** for business decisions; one authoritative business database (modular monolith). No second QuickFurno business DB.
2. **Deterministic marketplace** — no AI lead scoring, no AI vendor ranking, no predictive scoring, no Jarvis-controlled assignment, no AI package priority in MVP.
3. **Consent is sacred** — no path (n8n, Jarvis, campaign) may bypass consent/suppression. Uncertain communication outcomes are terminal and never auto-resent.
4. **Meta non-voice only** — voice calling/agents/recording/transcription/voice-campaigns are excluded.
5. **Keep-as-built** — SMS fallback, multi-provider architecture, advanced retry/fallback, multi-city capability are retained; they create no new MVP work unless a small safety correction is required. Pune is first; other providers/cities do not block launch.
6. **Governance is non-blocking** — production safety stays mandatory; legacy governance harnesses are diagnostic only and never gate MVP work; no production code changes merely to satisfy a stale pin.
