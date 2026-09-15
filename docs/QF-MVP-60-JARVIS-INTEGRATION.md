# QF-MVP-60 — Jarvis Integration Implementation

**Status:** repository implementation complete for the optional signed/shadow integration boundary as of 2026-09-15. Production activation is OFF. This document does not certify Jarvis providers, deploy Jarvis JF-6, authorize autonomous business actions, or make Jarvis a Pune-launch dependency.

## Permanent authority boundary

QuickFurno Core remains the system of record and business authority. Jarvis, Riya and Anisha are external intelligence/recommendation actors only. They have no QuickFurno database credential, no provider credential, no n8n execution path and no direct write authority over QuickFurno business tables.

The final September lead-generation scope lock remains authoritative: new `automation_action_requests` originate only from `core`, `admin` or `system`. Historical `jarvis`, `riya` and `anisha` source values are provenance only. QF-MVP-60 does not weaken or replace that rule.

## Implemented surfaces

### 60.1 Sanitized context

`POST /api/internal/jarvis/context` accepts only the signed `qfj.context.read` v1 contract. The request is authenticated with Ed25519 under its own signing domain and fixed path. Scope is explicit: Riya may request lead context, Anisha may request vendor context, and Jarvis may request either. Unknown fields and cross-agent scope are refused.

Lead context contains only bounded operational fields: opaque lead id, city, service, budget band, property type, timeline, lead status, verification status and duplicate flag. It does not expose name, phone, email, raw requirement/message, precise coordinates, formatted address, consent rows or credentials.

Vendor context contains only opaque vendor id, city, service categories, status/activity/visibility/paid-status and a derived package-readiness band. Exact credit balance never leaves Core; it is reduced to `UNKNOWN`, `NOT_ACTIVE`, `NO_PACKAGE`, `LOW_CREDITS` or `READY`.

### 60.2 Recommendation/action-request intake

`POST /api/internal/jarvis/action-request` accepts the signed `qfj.action.request` v1 contract. It does **not** create an automation request, authorization or job. It persists only an inert recommendation into the existing AOS V2 advisory ledger.

The allowed recommendation vocabulary is intentionally narrower than Core automation:

- Riya: requirement collection, missing-information reminder, matching update, lead-status update.
- Anisha: onboarding reminder, document reminder, package-expiry warning, low-credit warning.
- Jarvis coordinator: the union of those bounded Riya/Anisha recommendation types.

Campaign execution, vendor lead offers, vendor response reminders and the bounded client transactional follow-up are not agent-recommendable through this boundary. The last item remains owned by the Core connection-assurance flow.

A separate server-side promotion function can convert an already-proposable recommendation into a `source="system"` Core action request only when all active-mode switches and the exact action allowlist still pass. Promotion still creates only a **requested** Core action. It does not call the authorization function and does not create an n8n job. Core/admin must make the later authoritative decision using the existing automation layer.

### 60.3–60.5 Jarvis/Riya/Anisha integration

The existing private Riya web-turn contract remains the conversational client path. QuickFurno signs exact bytes and calls only the private Jarvis ingress; it has no Groq/Nara/model-provider integration. Core-decision v2 is the return authority seam: only an exact, signed, content-bound Core decision may materialize an authorized reply.

Anisha participates through the signed sanitized-context and inert-recommendation boundaries. Phase 60 deliberately does not invent a second vendor lifecycle database or a direct vendor action path.

### 60.6 Kill switches

All controls default OFF. The runtime policy exposes global mode plus Riya, Anisha, Riya-web, context-read, recommendation-intake, action-proposal and exact per-action allowlist gates. Invalid modes fall back to OFF. An invalid action allowlist fails closed to an empty list. Shadow mode can never make a recommendation proposable.

### 60.7 Shadow mode

Shadow mode may authenticate requests, return sanitized context, run the private Riya conversation path and record advisory recommendations. It may not authorize a Core reply by itself and may not promote recommendations into Core automation. No provider or n8n execution is reachable from either Phase-60 ingress route.

## Cryptographic separation

The three Jarvis→QuickFurno server protocols use distinct signing domains and fixed paths: Core decision, sanitized-context read and recommendation intake. A signature valid for one cannot be replayed on another. QuickFurno stores only public verification keys for Jarvis→Core authentication. QuickFurno→Jarvis/Riya uses its own private signing material server-side; no private key belongs in Git or browser code.

## Activation state

Repository implementation and offline verification do **not** activate production Jarvis. Recommended initial QuickFurno state is all QF-JARVIS flags OFF. A future shadow deployment may turn on only the minimum required gates after Jarvis JF-5 provider evidence and JF-6 deployment/observability/operator controls are independently ready.

Nara/Groq keys never belong in QuickFurno. Provider selection remains inside Jarvis.

## Verification

`npm run test:mvp:60` is the bounded offline integration gate. It proves strict protocol parsing, signature freshness/tamper resistance, cross-protocol replay refusal, context minimization, scope separation, kill switches, shadow containment, per-action gating, advisory-only intake and preservation of the September Core-only automation scope lock.

`npm run test:mvp:50-1a` remains the authority regression gate proving Jarvis/Riya/Anisha have no automation-trigger authority and that only Core/admin/system may submit new automation actions.