# QF-MVP — Architecture Boundaries

**Branch:** `mvp/qf-mvp-00-core-cleanup-v1` · **Base:** `a4d289a` · **Status:** LOCKED

One sentence to hold in mind everywhere below:
**Core is authority. Jarvis recommends. n8n executes. Meta delivers. Results return to Core.**

QuickFurno is a **modular monolith** with **one authoritative business database**. There is no second QuickFurno business database. Every boundary below is a rule an implementer must not cross without an explicit, reviewed decision.

---

## 1. QuickFurno Core ownership
Core is the **only** authoritative business system for: leads, clients, vendors, vendor verification, vendor eligibility, lead assignments, replacements, packages, credits and the credit ledger, consent, suppression, communication eligibility, campaign recipient approval, business audit records, admin approvals. Core owns every business decision, every authoritative write, and every business audit record. Anchors: `services/*` (business services), `supabase/migrations/*` (schema), `lib/communication/*` (comms policy).

## 2. Vendor CRM ownership
Vendor CRM is a **separate internal module inside** the QuickFurno app/repo. It owns **extension** data only: CRM profile, contacts, tags, notes, tasks, onboarding stages, relationship state, segments, campaign definitions, audience snapshots, engagement history, campaign results. It **must not** duplicate authoritative Core facts — verification, package, credits, consent, and lead eligibility are **read from Core by foreign key**, never copied as a source of truth. CRM proposes campaigns; Core decides eligibility.

## 3. Jarvis boundaries
Jarvis (coordinator + Riya + Anisha + AI reasoning/memory/recommendations/action-requests) is a **separate repository** and stays one. Jarvis **must not**: access the Supabase service-role key; write directly to Core business tables; assign vendors directly; change packages; restore credits; bypass consent; suspend vendors; send directly through Meta; approve sensitive actions. Jarvis only **receives sanitized context** and **submits recommendations/action-requests** that Core validates. **QuickFurno must continue functioning when Jarvis is offline.** (Boundary predates this doc: `docs/QF-Jarvis-Integration-Boundary.md`.)

## 4. n8n boundaries
n8n is an **execution layer**. It **may** execute actions already authorized by Core. It **must not** become an authority for: consent; package eligibility; credits; lead assignments; campaign recipients; vendor activation; business rules. n8n receives an already-authorized, idempotent job and returns a per-attempt result.

## 5. Meta boundaries
Meta WhatsApp is the **primary delivery channel** for MVP, **non-voice only**. Meta delivers approved-template messages to consented recipients and reports delivery lifecycle. Meta is not an authority for consent or recipients — those are decided in Core before a send. **Excluded:** voice calling, voice agents, recording, transcription, voice campaigns.

## 6. Database authority
**One authoritative business database**, owned by Core. Migrations under `supabase/migrations/` are the schema truth. CRM extension tables live in the same database but reference Core tables by FK and never shadow authoritative columns. No component (n8n, Jarvis) holds the service-role key or writes Core tables directly.

## 7. Consent authority
Consent and suppression decisions are **Core-only** (`communicationConsentDecisionService`, `communicationConsentWriterService`, `consentPolicy.ts`, `outboundConsentScope.ts`, consent migrations). STOP/START/HELP are processed by Core; acknowledgements are async (`consentAckWorkerService`, ack-intent tables) and never block the webhook. **No campaign, workflow, or agent may bypass consent or suppression.**

## 8. Package and credit authority
Packages, credits, the ledger, deduction points, and restorations are **Core-only** (`packageService`, `vendorCreditWalletService`, `vendorPackageOrderService`). Deduction is idempotent and occurs at the approved business point. **Credit restoration requires founder/admin approval** and is audited. No automation or agent changes packages or credits autonomously.

## 9. Campaign approval flow
CRM defines a campaign; Core recalculates eligibility and applies consent/suppression/frequency; the audience is **frozen as an auditable snapshot**; **admin approval is mandatory**; only then is an execution request emitted to n8n → Meta; results return to Core and update CRM engagement. A campaign can never widen its audience after approval.

## 10. Lead-assignment authority
Assignment is **deterministic and Core-owned**. Hard limits: **max 3 active assignments per qualified lead**, **max 6 unique vendors across the lead lifetime**. Replacement is one-at-a-time, concurrency-safe, never reassigns an exhausted vendor, and records reason + actor. **No Jarvis-controlled assignment; no AI ranking.**

## 11. Audit authority
Core owns business audit (`adminAuditService`) and security-event audit (`authSecurityEventService`), plus communication audit (delivery events, ack intents). Every important action — assignment, credit change, approval, campaign send, admin override — produces an audit record that explains actor, entity, reason, and outcome.

## 12. Kill-switch ownership
Core/admin owns all kill switches: global automation pause; Meta sending pause; campaign pause; n8n workflow pause; Jarvis/Riya/Anisha pause; per-action-type pause. Any kill switch must degrade safely to non-automated, non-Jarvis operation without data loss.

## 13. Failure and retry authority
Core classifies outcomes: success; retryable failure; **definitive failure**; **uncertain outcome (terminal — never auto-resent)**; dead-letter. Retries are idempotent and Core-authorized. n8n executes retries only on Core instruction; agents never trigger sends. Advanced retry/fallback (`authenticationTransportDecision`, transport policy services) is `KEEP_AS_BUILT` and honors the no-auto-resend rule.

---

## Authority flows

### Direct (non-Jarvis) flow
```
Core event → Core validation → n8n execution → Meta → callback/result → Core audit
```

### Jarvis-assisted flow
```
Core event → sanitized context → Jarvis recommendation → Core validation → n8n execution → Meta → result → Core audit
```
Jarvis adds a recommendation step *before* Core validation. It never replaces validation, never executes, never touches Meta or the database directly.

### Vendor campaign flow
```
CRM campaign → segment evaluation → Core eligibility → consent/suppression → audience snapshot → admin approval → n8n → Meta → campaign results → CRM engagement
```

### Lead-assignment flow
```
qualified lead → deterministic eligibility → max 3 assignments → accept/reject/expiry → controlled replacement → max 6 lifetime vendors → closure
```

---

## Boundary invariants (must always hold)

- **Core is authority** — all business decisions and authoritative writes.
- **Jarvis recommends** — no direct DB authority, no service-role key, no direct Meta send, no sensitive approval; QuickFurno runs with Jarvis offline.
- **n8n executes** — only Core-authorized, idempotent jobs; never an authority.
- **Meta delivers** — non-voice approved templates to consented recipients; not an authority.
- **Results return to Core** — every execution outcome is persisted and audited in Core; CRM engagement is updated from Core results, not from the executor directly.
- **Consent, packages, credits, and assignment limits are inviolable** — no path may bypass them.
