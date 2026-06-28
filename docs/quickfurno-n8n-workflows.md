# QuickFurno n8n Foundation

This document defines the safe foundation for future QuickFurno n8n workflows.
This phase does not send WhatsApp messages, call real n8n webhooks, deduct vendor
credits, auto-assign leads, or write workflow state to Supabase.

## 1. Architecture

QuickFurno keeps decision authority inside AOS and CRM. n8n will only execute
approved delayed or scheduled workflows after a future production activation.

- AOS decides what should happen.
- CRM stores lead, vendor, client, approval, and operational state.
- n8n executes delayed timers, reminders, status routing, and scheduled reports.
- WhatsApp API sends approved template messages later.
- Supabase stores logs and workflow state later, after migrations and RLS review.

## 2. AOS vs CRM vs n8n Responsibility

| Layer | Owns | Does not own in this phase |
| --- | --- | --- |
| AOS | Lead scoring, safety decisions, workflow intent, failure classification | WhatsApp sends, real n8n calls, credit deduction, auto assignment |
| CRM | Lead/vendor/client records, admin review state, future workflow status | Delayed workflow execution |
| n8n | Future timers, retries, routing, scheduled reporting | Business decisions, credits, lead assignment authority |
| WhatsApp API | Future message delivery only | Template approval, recipient selection, business rules |

## 3. Event List

- `lead.created`
- `lead.qualified`
- `lead.assignment_approved`
- `lead.assigned`
- `vendor.replied`
- `client.followup_due`
- `client.rating_due`
- `nurture.due`
- `report.daily`
- `vendor.low_credit`
- `complaint.created`
- `aos.failure`
- `whatsapp.status_updated`

## 4. Workflow List

| Event | Future workflow |
| --- | --- |
| `lead.created` | `QF-n8n-New-Lead-Intake` |
| `lead.qualified` | `QF-n8n-Client-Confirmation` |
| `lead.assignment_approved` | `QF-n8n-Vendor-Lead-Alert` |
| `lead.assigned` | `QF-n8n-Client-Followup-Timer` |
| `vendor.replied` | `QF-n8n-Vendor-Response` |
| `client.followup_due` | `QF-n8n-Client-2-Hour-Followup` |
| `client.rating_due` | `QF-n8n-Client-24-Hour-Rating` |
| `nurture.due` | `QF-n8n-Nurture-Followup` |
| `report.daily` | `QF-n8n-Daily-Founder-Report` |
| `vendor.low_credit` | `QF-n8n-Vendor-Renewal` |
| `complaint.created` | `QF-n8n-Complaint-Escalation` |
| `aos.failure` | `QF-n8n-Failure-Handler` |
| `whatsapp.status_updated` | `QF-n8n-WhatsApp-Status-Update` |

Documented workflow shells:

1. `QF-n8n-Event-Router` receives future events and routes by event type.
2. `QF-n8n-New-Lead-Intake` will receive new lead events after AOS validation.
3. `QF-n8n-Client-Confirmation` will queue client confirmation messages later.
4. `QF-n8n-Vendor-Lead-Alert` will notify vendors only after assignment approval.
5. `QF-n8n-Vendor-Response` will process vendor reply callbacks.
6. `QF-n8n-Client-2-Hour-Followup` will run delayed follow-up checks.
7. `QF-n8n-Client-24-Hour-Rating` will ask for rating after completion signals.
8. `QF-n8n-Nurture-Followup` will run dormant lead nurture flows.
9. `QF-n8n-Daily-Founder-Report` will send a daily founder summary later.
10. `QF-n8n-Vendor-Renewal` will handle low-credit renewal reminders later.
11. `QF-n8n-Complaint-Escalation` will escalate complaint events later.
12. `QF-n8n-Failure-Handler` will receive AOS/n8n failure events.

## 5. API Endpoints

All endpoints are placeholders and return safe JSON.

| Endpoint | Purpose | Side effects |
| --- | --- | --- |
| `POST /api/aos/events` | Accept an n8n/AOS event payload | None |
| `POST /api/aos/failure` | Accept a failure payload | None |
| `POST /api/aos/whatsapp-status` | Accept a WhatsApp status payload | None |

Payloads should include `type` or `eventType`, plus optional `leadId`,
`vendorId`, `clientId`, `data`, and `metadata`. Phone and secret-like fields are
masked before being returned in responses or logs.

## 6. Security Rules

- Incoming callbacks must send the `x-qf-n8n-secret` header.
- The expected secret is `QF_N8N_WEBHOOK_SECRET`, configured later in production
  hosting secrets.
- Do not add the secret to `.env` or `.env.local` in this phase.
- If the secret is missing in production, callbacks return safe `401`.
- If the secret is missing outside production, the route enters documented safe
  development mock mode and still performs no side effects.
- Never log secrets, tokens, authorization headers, or full phone numbers.
- Never expose stack traces to clients.
- TODO: before production activation, add secret rotation, source allowlisting,
  retry limits, signed payload checks, and audit review.

## 7. Feature Flags

Current safe defaults:

```ts
N8N_ENABLED = false
N8N_OUTBOUND_WEBHOOK_ENABLED = false
WHATSAPP_SENDING_ENABLED = false
CREDIT_DEDUCTION_ENABLED = false
AUTO_ASSIGNMENT_ENABLED = false
AOS_RULE_BASED_FALLBACK_ENABLED = true
```

These flags are constants in `lib/aos/config/featureFlags.ts`. They should only
change in a reviewed production activation phase.

## 8. Future WhatsApp API Integration Plan

1. Create approved WhatsApp template keys for client, vendor, complaint, and
   renewal flows.
2. Store provider credentials only in production secrets.
3. Add a server-only WhatsApp Cloud API client.
4. Add opt-in, template, and rate-limit checks before every send.
5. Log masked message state to a reviewed Supabase table with RLS.
6. Route delivery callbacks into `POST /api/aos/whatsapp-status`.
7. Add rollback controls that disable sending immediately.

## 9. Future n8n Workflow Import Plan

1. Create `QF-n8n-Event-Router` with event-type branching.
2. Import individual workflow shells with disabled triggers.
3. Configure n8n credentials outside the repository.
4. Point n8n callbacks to the three AOS endpoints.
5. Add `x-qf-n8n-secret` to every callback request.
6. Test in development mock mode with fake payloads only.
7. Add staging webhook URLs after approval.
8. Enable production one workflow at a time behind feature flags.

## 10. Production Checklist

- Confirm `.env` and `.env.local` do not contain n8n or WhatsApp secrets.
- Configure `QF_N8N_WEBHOOK_SECRET` in production hosting secrets.
- Review all endpoint responses for masked phones and no stack traces.
- Add Supabase workflow log tables with RLS and non-public grants.
- Add audited retry and dead-letter behavior.
- Add n8n workflow export backups.
- Add WhatsApp template approval records.
- Keep `N8N_OUTBOUND_WEBHOOK_ENABLED`, `WHATSAPP_SENDING_ENABLED`,
  `CREDIT_DEDUCTION_ENABLED`, and `AUTO_ASSIGNMENT_ENABLED` false until each
  production path is reviewed and tested.
- Run `npm run build`.
- Test with fake events only before enabling any real webhook.
