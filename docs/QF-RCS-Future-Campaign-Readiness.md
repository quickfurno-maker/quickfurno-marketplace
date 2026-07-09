# QuickFurno — RCS Future Campaign Readiness (Phase 5F-A)

**No RCS integration is active.** Phase 5F-A creates no RCS agent, makes no Google
API call, stores no Google service-account JSON, sends no RCS message, and runs no
campaign. This document records the future target and the work required, and the
code ships only pure readiness contracts (`lib/communication/rcs.ts`) plus a
capability-cache table skeleton (`communication_channel_capabilities`).

## Target

QuickFurno's planned **first** RCS use case is **PROMOTIONAL** (future marketing
campaigns) — encoded as `QUICKFURNO_PLANNED_FIRST_RCS_USE_CASE = promotional`. RCS
is deliberately **not** an authentication channel: the authentication transport
vocabulary is WhatsApp/SMS only, a DB CHECK forbids `rcs` in any
`authentication_transport_policies` row, and `verification_challenges.delivery_
channel` remains `('whatsapp','sms')`.

## Required future work (none done here)

- **RCS partner / account onboarding** — onboard with an RCS Business Messaging
  partner/aggregator.
- **QuickFurno brand** — register the brand.
- **Agent creation** — create the RCS agent.
- **Use-case selection** — select `promotional` for the first agent.
- **Brand verification** — complete brand verification.
- **Launch approval** — obtain launch approval.
- **Webhook** — signed inbound/status webhook, normalized + de-duplicated.
- **Capability checks** — per-destination reachability cached in
  `communication_channel_capabilities` by destination HASH (never a plaintext
  MSISDN); Phase 5F-A creates the table only — no Google API call.
- **Test devices** — validate on allow-listed test devices before launch.
- **Carrier launch coverage** — confirm carrier rollout coverage per region.
- **Unique outgoing message IDs** — ensure globally unique message ids.
- **Delivery-receipt handling** — normalize RCS delivery/read/failure receipts.
- **Duplicate prevention** — idempotent receipt de-duplication.
- **Opt-out list** — respect an opt-out/suppression list
  (`communication_suppressions`, scope `marketing`/`global`) — a marketing STOP must
  never affect authentication.
- **Campaign analytics** — campaign-level analytics.
- **Consent governance** — marketing consent tracked in
  `communication_preferences` (scope `marketing`), separate from authentication.

## Explicitly NOT done in Phase 5F-A

No RCS provider adapter, no Google API call, no service-account JSON stored, no RCS
agent, no RCS message sent, no campaign executed, no RCS authentication path. RCS
appears only as generic-channel vocabulary and pure future contracts.
