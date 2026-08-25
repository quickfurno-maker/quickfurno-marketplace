# QF-MVP-40 — R7H Recovery Canary Authority

## Status

**CONSUMED — R7H RECOVERY CANARY COMPLETED**

This document does not itself authorize a Meta provider invocation.

It exists because the original QF-MVP-40 live canary runbook limits the
phase to two real outbound utility messages, while staging evidence now
proves three historical Meta-accepted attempts already occurred.

The historical attempts are preserved and are not deleted, rewritten,
ignored, or reclassified.

## 1. Historical evidence

Staging contains exactly three known Meta WhatsApp Cloud attempts with
failure code `131042`:

1. 2026-08-14T05:53:45.682166+00:00
2. 2026-08-15T09:43:38.054151+00:00
3. 2026-08-15T13:10:52.247742+00:00

For all three:

- provider = `meta_whatsapp_cloud`
- Meta returned a provider message ID
- `accepted_at` is present
- `sent_at` is absent
- `delivered_at` is absent
- terminal status = `failed`
- failure code = `131042`
- attempt_count = 1
- QuickFurno did not internally retry the send

These are three distinct provider invocations.

## 2. Why recovery is being reconsidered

The historical failures occurred while Meta returned business
eligibility/payment failure `131042`.

Current read-only evidence now differs materially from the historical state.

Dedicated staging WABA:

- WABA ID: `27861262223494153`
- status: `ACTIVE`
- account_review_status: `APPROVED`
- business_verification_status: `verified`
- currency: `INR`
- timezone_id: `71`
- WABA can_send_message: `AVAILABLE`
- BUSINESS can_send_message: `AVAILABLE`
- APP can_send_message: `AVAILABLE`
- no account violation information returned

Dedicated staging sender:

- Phone Number ID: `1333595106493545`
- display number: `+91 77091 72106`
- verified name: `quickfurno.in`
- quality_rating: `GREEN`
- code_verification_status: `VERIFIED`

Billing UI currently shows:

- payment method attached
- payment method Default
- current balance INR 0.00
- prior card verification charge/refund present
- business address populated
- no active billing-warning banner after non-applicable GST prompt was dismissed

QuickFurno staging callback path is currently proven reachable:

Internet -> locked ngrok hostname -> localhost:3311 -> QuickFurno webhook

A deliberately wrong verify token returns HTTP 403 as required.

## 3. Recovery-canary exception boundary

A future R7H recovery canary, if separately owner-authorized, is an
explicit exception to the original two-message phase cap.

It is not an invisible continuation or retry of any historical attempt.

The exception shall permit:

- exactly ONE additional Meta provider invocation
- dedicated staging assets only
- owner-controlled canary recipient only
- one approved UTILITY template only
- canonical CommunicationService path only

It shall prohibit:

- production Meta assets
- real customer/vendor recipients
- dashboard/manual Meta sends
- automatic retry
- operator resend
- second recovery attempt
- changing WABA, sender, billing card, business information, or webhook
  merely to obtain a successful result
- deleting or modifying any historical failure evidence

## 4. Hard execution rule

Before any recovery send:

1. exact branch/head/tree must be re-proven
2. dedicated staging asset identity must be re-proven
3. Core must be running with staging-only environment
4. public signed callback path must be ready
5. provider must begin fail-closed
6. readiness preflight must PASS
7. canary preflight must PASS
8. exactly one approved mapping may be armed

After the one provider invocation:

- DO NOT invoke the provider again under R7H
- if accepted but callback is uncertain: disable immediately
- if delivery fails: disable immediately
- if delivery succeeds: disable immediately
- preserve the exact provider message ID and lifecycle evidence
- independently prove fail-closed state after disable

## 5. Certification meaning

A successful R7H recovery message proves that the previously observed
Meta `131042` delivery condition is no longer blocking the tested path.

It does NOT erase the three historical failures.

It does NOT by itself complete QF-MVP-40.

All remaining locked exit criteria still require their own evidence.

## 6. Owner authorization

Current state:

**CONSUMED — NO FURTHER R7H PROVIDER INVOCATION AUTHORIZED**

Owner authorization recorded:

- authorization phrase: `AUTHORIZE R7H RECOVERY CANARY`
- authorization time: `2026-08-23T10:46:00+05:30`
- scope: exactly one additional Meta provider invocation
- environment: QuickFurno staging only
- recipient: owner-controlled canary only
- template class: approved UTILITY only
- execution path: canonical CommunicationService only

This authorization does not itself arm the provider.

The authorization is **single-use**. It is consumed by the first R7H
Meta provider invocation regardless of whether the outcome is success,
failure, timeout, transport uncertainty, or callback uncertainty.

After that first provider invocation:

- no second R7H provider invocation is authorized
- no operator resend is authorized
- no automatic retry is authorized
- provider must be disabled immediately after evidence capture
- historical failures must remain preserved
- the R7H authority must be updated to `CONSUMED` during closeout

## 7. R7H closeout

Final state:

**CONSUMED - SUCCESSFUL DELIVERY CERTIFIED - FAIL-CLOSED RESTORED**

The single authorized R7H Meta provider invocation was consumed on
2026-08-23.

Certified outbound evidence:

- communication message ID: `6dfbbed2-7e22-45b0-95e0-3b2a0170ba02`
- provider: `meta_whatsapp_cloud`
- provider message ID: `wamid.HBgMOTE3NzIwMDAwNTUzFQIAERgSNDJDODkzMTNCOUZGQTIyQzMyAA==`
- template key: `vendor_onboarding_reminder`
- approved provider template: `qf_vendor_onboarding_reminder_v1`
- provider template mapping ID: `5a9deda4-2005-45c9-8d67-79ddb718018c`
- destination hash: `f39df03d854700db04c7c87b7a9052d4b2b0267f6f7d81be0cbf6930335d2372`
- provider account ID: `9e589e8b-d96d-4de7-b97b-e4cf49211067`
- attempt_count: `1`
- internal retry: `false`
- failure_code: `null`
- final lifecycle status: `delivered`
- accepted_at: `2026-08-23T15:55:23.240Z`
- delivered_at: `2026-08-23T15:55:24.000Z`

Certified signed-callback evidence:

- webhook receipt ID: `e8a64384-763e-4e21-8f9b-3076b764a3ff`
- signature_valid: `true`
- processing_status: `processed`
- normalized_event_type: `delivered`
- provider event ID: `meta-wh-02d89d520505fc2a4d981856ee9bc123`
- duplicate_count: `0`
- owning provider account matched the outbound provider account

Callback recovery note:

Meta delivered the signed lifecycle callbacks to the locked staging
ngrok endpoint, but the running staging Core initially rejected them
with HTTP 401 `invalid_signature`.

The cause was an incorrect `WHATSAPP_APP_SECRET` loaded into the
staging Core. The correct App Secret for Meta App
`2097008694503517` was obtained without exposing its value and was
cryptographically proven against an already-captured Meta callback.

The staging Core was restarted with that verified secret. Because Meta
had not yet retried after restart, the already-captured, genuinely
Meta-signed callback for the same provider message ID was replayed
locally into the canonical QuickFurno webhook endpoint. No outbound
WhatsApp resend or second Meta provider invocation occurred.

The signed callback passed all signature, identity, runtime and
provider-account ownership gates and produced the certified
`delivered` lifecycle state above.

Runtime configuration correction identified during R7H:

- `WHATSAPP_AUTH_HTTP_TIMEOUT_MS=3000`
- `WHATSAPP_HTTP_TIMEOUT_MS=10000`
- `WHATSAPP_APP_SECRET` must correspond to Meta App `2097008694503517`

Final independent fail-closed readback after `--disable`:

- activation_status: `disabled`
- outbound_enabled: `false`
- webhook_processing_enabled: `false`
- health_check_enabled: `false`
- active provider-template mappings: `0`
- active canary destinations: `0`

The three historical `131042` failures remain preserved.

R7H authority is permanently consumed.

**NO SECOND R7H PROVIDER INVOCATION, RESEND OR RETRY IS AUTHORIZED.**
