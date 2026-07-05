# N8N VENDOR CREDIT SYNC — FUTURE CONTRACT (Phase 5, not implemented)

> **Status: DOCUMENTATION ONLY.** Phase 4 does **not** emit these events, does not
> create/modify any n8n workflow, and does not change existing webhook URLs or
> payloads. This file specifies what n8n should eventually consume so the next
> phase can wire it without breaking compatibility.

## Purpose
Once the credit-wallet model is production-tested, n8n will observe vendor credit
lifecycle changes (WhatsApp nudges, recharge reminders, admin alerts). Every event
below is derivable from the canonical wallet: `vendors.remaining_credits` (balance)
and `vendor_credit_logs` (ledger). No new balance column exists.

## Common envelope (every event)
| Field | Type | Notes |
|---|---|---|
| `event` | string | one of the names below |
| `vendor_id` | uuid | canonical vendor id |
| `credit_balance` | int | `vendors.remaining_credits` AFTER the change |
| `delta` | int \| null | signed change; null for non-credit events |
| `reference_type` | string \| null | e.g. `lead_assignment`, `package_purchase`, `admin_grant`, `invalid_lead_refund` |
| `reference_id` | string \| null | assignment id / purchase id / grant id — the **idempotency key** |
| `reason` | string \| null | ledger reason text |
| `timestamp` | ISO 8601 | event time |
| `idempotency_key` | string | `${event}:${reference_type}:${reference_id}` — n8n must de-dupe on this |

## Events
| Event | delta | reference_type | Fires when |
|---|---|---|---|
| `vendor.approved` | null | `vendor_status` | `vendors.status` → approved |
| `vendor.accepting_leads_changed` | null | `vendor_availability` | `vendors.accepting_leads` toggled |
| `credits.granted` | `+n` | `admin_grant` | admin credit grant applied |
| `credits.debited` | `-1` | `lead_assignment` | a successful auto/preferred assignment debited one credit (`reference_id` = assignment id) |
| `credits.refunded` | `+1` | `invalid_lead_refund` | an invalid lead refunded a credit (original debit is retained) |
| `credits.exhausted` | `-1` | `lead_assignment` | a debit brought `credit_balance` to `0` (recharge nudge) |
| `package.purchase_confirmed` | `+n` | `package_purchase` | a package purchase confirmed and credits added once |

## Guarantees n8n can rely on
- **Idempotency:** `reference_type + reference_id` is unique in `vendor_credit_logs`
  (partial unique index, Phase 4 migration 20260706000141). Re-delivered webhooks/
  events with the same reference must be treated as duplicates.
- **One debit per assignment:** exactly one `credits.debited` per successful
  `lead_assignments` row; delivery side effects (dashboard / WhatsApp preview /
  client preview) emit **no** credit events.
- **Append-only ledger:** refunds are new rows; the original debit is never deleted.

## Explicitly out of scope for Phase 4
No emit code, no workflow JSON, no webhook URL changes, no payload changes to any
existing event. Wiring an emitter (from the canonical credit RPC + assignment RPC)
is a Phase 5 task, gated on review.
