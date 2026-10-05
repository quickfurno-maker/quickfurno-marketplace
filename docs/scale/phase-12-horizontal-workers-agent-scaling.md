# Phase 12 — Horizontal Workers & Agent Scaling

## Status

Implementation branch: `feat/scale-phase12-horizontal-workers`.

Phase 12 makes QuickFurno worker execution horizontally scalable without moving any
business authority out of Core. It preserves the Phase 11 QuickFurno ↔ Jarvis
isolation contract and adds durable per-conversation ordering for communication
work.

## Scaling units

QuickFurno now exposes independent worker lanes:

- `client` — client journey automation.
- `vendor` — vendor journey automation.
- `campaigns` — campaign execution.
- `system` — lead assignment dispatch, consent acknowledgements and delayed fill.
- `background` — recovery, reconciliation and maintenance.
- `provider-outbound` — governed WhatsApp/provider reply delivery.
- `jarvis-ingress` — QuickFurno → Jarvis turn transport.

`QF_NATIVE_AUTOMATION_LANES` selects native automation lanes.
`QF_CONVERSATION_TRANSPORT_LANES` selects transport lanes.

Both selectors default to the pre-Phase-12 combined behavior, so deployment can
remain unchanged until an operator deliberately splits replicas.

## Durable communication claims

Two database claim functions are authoritative for horizontal transport workers:

- `qf_claim_conversation_outbox_v1()`
- `qf_claim_jarvis_turn_outbox_v1(p_allow_conversation, p_allow_qualification)`

Each claim is one SQL transaction using `FOR UPDATE ... SKIP LOCKED`. A later row
for a conversation is not claimable while an earlier row is pending/retryable or
while any row for that conversation is already claimed.

Partial unique indexes provide a second database-level fence: at most one claimed
row per conversation may exist in each durable transport lane.

The Jarvis purpose filter runs before the claim, but it cannot overtake an earlier
turn for the same conversation. This is important when dedicated qualification and
conversation workers run concurrently.

## Noisy-neighbor isolation

Conversation transport was removed from `nativeAutomationWorker.ts`. This keeps
provider/Jarvis latency or provider backpressure from consuming the automation
worker loop.

Native automation can be deployed as separate client, vendor, campaign, system and
background replicas. Transactional/system work therefore does not have to share a
worker budget with campaigns or maintenance.

Worker heartbeats remain per-replica and use role-specific identities for split
lanes.

## Business authority

Phase 12 does not change:

- canonical lead assignment or fair matching;
- credit mutation authority;
- consent or DNC authority;
- provider send authority;
- human takeover behavior;
- QuickFurno ownership of conversation state;
- the Phase 11 bounded QuickFurno ↔ Jarvis transport contract.

The new functions own queue claim lifecycle only.

## Certification

The Phase 12 gate is:

1. `npm run test:scale:phase12:contract`
2. existing Phase 08 canonical assignment contention certification;
3. existing Phase 07 exactly-once durable scheduler certification;
4. `npm run test:scale:phase12:messages`;
5. existing conversation fast-path validation;
6. TypeScript, lint and production build gates.

The message certificate creates an isolated Phase 12 schema inside a loopback/test
PostgreSQL database and runs 32 concurrent claimers over 20 conversations. It
requires exactly one first turn per conversation, then exactly one second turn per
conversation after the first wave is finalized. It also proves that a dedicated
conversation lane cannot overtake an earlier qualification turn.

CI runs the Phase 12 message certificate only after the existing durable-job and
matching-contention jobs succeed.

## Deployment and rollback

No production topology change is required to merge Phase 12.

Initial deployment may keep the default combined lane configuration. Operators can
split one lane at a time and observe per-replica heartbeats, queue depth/age and
provider/Jarvis latency.

Rollback is configuration-first:

- remove `QF_NATIVE_AUTOMATION_LANES` to restore all native lanes in one worker;
- remove `QF_CONVERSATION_TRANSPORT_LANES` to restore both transport lanes in one
  conversation worker;
- reduce replica counts to one.

The database ordering fences and atomic claims remain safe when running only one
replica and should not be removed during a topology rollback.
