# QuickFurno — QF Jarvis Integration Boundary (Phase 5F-A future-compat)

This documents the **boundary** between QuickFurno and a future QF Jarvis. Phase
5F-A adds **pure future-compatibility contracts only** — no Jarvis, no LLM call, no
autonomous action, no agent database role, no service-role access, no campaign
execution, and no second event system.

## System of record

**QuickFurno remains the system of record.** All authoritative state (identities,
challenges, leads, communications, policy decisions, events) lives in QuickFurno's
Supabase database and services. Jarvis holds no authoritative copy.

## Deployment topology

**QF Jarvis is a SEPARATE repository and a SEPARATE deployment.** It is not part of
this repository and is not deployed by it. Nothing in Phase 5F-A introduces a Jarvis
runtime, endpoint, credential, or database object.

## Integration surface (narrow, controlled)

Jarvis integrates with QuickFurno ONLY through narrow, explicit interfaces:

1. **Read APIs** — scoped, read-only projections of QuickFurno data. No direct
   database connection; no table access.
2. **Recommendation APIs** — Jarvis submits `AgentRecommendation` /
   `CommunicationRecommendation` proposals. A recommendation is inert data; it
   authorizes nothing.
3. **Approval requests** — risky proposals raise an approval request; a human/policy
   approves or rejects. Approval is tracked, never assumed.
4. **Signed events** — the future integration boundary will carry
   `CanonicalEventEnvelope` events. In Phase 5F-A this is a PURE CONTRACT ONLY: no
   event table, no event bus, no outbox, and no consumer is created, and nothing is
   emitted or consumed. A committed workflow-kernel migration
   (`supabase/migrations/20260706000146_create_qf_workflow_kernel_foundation.sql`)
   defines `domain_events`/`outbox_events`, but it is UNAPPLIED on the live database
   and the envelope is NOT wired to it; the canonical persistence target is deferred.
   Envelopes carry only a sanitized `safePayload` — no secret field — and authorize
   nothing.
5. **Controlled action APIs** — any state change requested by an agent goes through
   a narrow, authorized QuickFurno action API — never a direct write, never a
   provider call.

## Authority boundaries (unchanged)

- **Phase 4 Policy Engine** remains the business communication authorization
  authority. An `approved` recommendation does NOT bypass it. Attribution
  (`decision_source_type = agent`, a logical agent label) authorizes nothing.
- **Supabase Auth** remains the client OTP/session authority;
  `verification_challenges` remains the vendor challenge authority.
- **CommunicationService** remains the canonical ledger + dispatch boundary. The
  required path for any agent-originated message is:
  `agent recommendation → QuickFurno authorization → consent/suppression → channel/
  provider decision → CommunicationService → provider`.
- **n8n remains the execution fabric, not the second brain.** It executes
  authorized steps; it is never an OTP, identity, or authorization authority, and
  it is not where agent reasoning lives.

## Agent access model

- **Agents never receive unrestricted database access.** The logical agent labels
  (`qf_jarvis`, `riya`, `jitin`, `kabir`, `arjun`, `meera`, `veer`) are **not**
  Supabase users, **not** PostgreSQL roles, **not** service-role identities, and
  **not** provider credentials. Phase 5F-A creates no database role for any agent
  and grants no service-role access to any agent.
- Agents act only through the integration surface above, under QuickFurno
  authorization.

## Risky actions

Risky actions require, at minimum:

- **Policy checks** — Phase 4 authorization.
- **Approval rules** — an approval that satisfies the recommendation's
  `ApprovalRequirement` (`single_admin` / `dual_admin` / `superadmin` / …).
- **Audit** — attribution + a `CanonicalEventEnvelope` trail (`correlation_id`,
  `causation_id`, `trace_id`, `risk_level`, `approval_required`).
- **Rollback strategy** — a documented compensating/rollback path before any risky
  action is enabled. Phase 5F-A enables none.

## Event persistence (deferred)

`CanonicalEventEnvelope` is a pure future-compatibility contract. It creates no
table, no event bus, no outbox, no consumer, and no execution path, and it does not
currently map onto a live `domain_events`/`outbox_events` table (those exist only in
a committed-but-unapplied workflow-kernel migration and are not wired to this
envelope). Canonical event persistence is implemented in a later controlled phase,
after the event taxonomy and integration contracts are finalized. Roadmap alignment:

- **Phase 5F-A** — pure event-envelope contract only.
- **Phase 6** — canonical operational event taxonomy and relationship lifecycle events.
- **Phase 7** — signed integration/execution delivery and the n8n execution fabric.
- **Later controlled persistence** — canonical event/outbox implementation where appropriate.

## Explicitly NOT done in Phase 5F-A

No Jarvis code, no LLM/API call, no autonomous action loop, no agent database role,
no service-role grant to an agent, no campaign execution, no RCS send, no event
persistence for the envelope (no event table, bus, outbox, or consumer is created;
the committed-but-unapplied workflow-kernel `domain_events`/`outbox_events` are not
wired to it, and canonical persistence is deferred to a later phase), and no
deployment of any kind.
