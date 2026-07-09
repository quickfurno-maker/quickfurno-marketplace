# QuickFurno — SMS Authentication Fallback Readiness (Phase 5F-A)

This documents what must be true **before** SMS can ever become an authentication
transport fallback. Phase 5F-A connects **no** SMS provider, sends **no** SMS,
activates **no** fallback, and claims **no** DLT approval. The `authentication_
transport_policies` seed leaves every fallback `automatic_fallback_enabled = false`,
`is_operationally_enabled = false`, and `fallback_policy_status = 'disabled'`, and
`vendor_whatsapp_verify` has **no** fallback channel at all.

## Status

- **SMS provider selection is still pending.** No provider is chosen or connected.
- **India regulatory / DLT readiness is required before any production SMS.** The
  items below must all be complete and verified first.

## India DLT / regulatory prerequisites

1. **Entity onboarding** — register QuickFurno's legal entity on a DLT platform
   (via the chosen operator/aggregator).
2. **Sender / header registration** — register the transactional/service header
   (sender id) QuickFurno will send under.
3. **OTP / service template registration** — register each OTP/service content
   template with the DLT registry; only registered content may be sent.
4. **Approved content-template mapping** — map each internal template to its
   DLT-approved content template + template id, recorded in
   `communication_provider_template_mappings` (channel `sms`) — never fabricated.
5. **Delivery-receipt webhook** — a signed DLR/webhook endpoint that normalizes
   provider statuses to `accepted|sent|delivered|failed` and de-duplicates.
6. **Cost monitoring** — per-message cost + volume monitoring and alerting.
7. **Abuse / rate-limit controls** — per-identity issuance limits already exist for
   auth challenges (Phase 5E, DB-owned); SMS adds provider-side + cost-based limits.
8. **Provider outage runbook** — documented failover/pause procedure; automatic
   fallback is NEVER enabled merely because a provider is slow or silent.
9. **Test-number validation** — validate against provider test numbers before any
   real destination; the mock adapter (`MockSmsProvider`) covers deterministic
   tests with no network.

## The authentication fallback rule (encoded, not yet wired)

- Automatic WhatsApp → SMS fallback is eligible **only** after a
  `definitive_failure` outcome (a proven non-delivery) — never on a timeout, a
  delayed/absent webhook, an unknown outcome, or merely `!result.ok`. See
  `lib/identity/authTransport.ts#evaluateAutomaticFallback`.
- `vendor_whatsapp_verify` **never** falls back to SMS: that flow proves possession
  of the WhatsApp destination, and SMS possession is a different claim. This is
  enforced both in the contract and by a DB CHECK
  (`chk_auth_transport_whatsapp_verify_no_fallback`).
- Fallback additionally requires the policy to be operationally enabled and
  automatic fallback enabled — all currently `false`.

## Explicitly NOT done in Phase 5F-A

No SMS provider connected, no DLT registration claimed, no SMS sent, no fallback
policy enabled, no automatic fallback path wired. Do not claim DLT approval exists.
Do not activate SMS.
