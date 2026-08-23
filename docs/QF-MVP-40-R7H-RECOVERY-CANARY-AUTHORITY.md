# QF-MVP-40 — R7H Recovery Canary Authority

## Status

**AUTHORIZED — EXACTLY ONE R7H RECOVERY CANARY**

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

**AUTHORIZED FOR EXACTLY ONE RECOVERY PROVIDER INVOCATION**

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
