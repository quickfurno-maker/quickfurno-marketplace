# QF-n8n-Event-Router

## 1. Workflow purpose

Main webhook receiver for QuickFurno automation. It receives events forwarded
from QuickFurno's `/api/aos/events` endpoint, reads the `eventType`, and routes
the event to the correct preview workflow. It returns a clean JSON response and
performs **no business side effects**.

## 2. Trigger event type

- Trigger: inbound webhook (n8n Webhook node).
- Accepts **all** QuickFurno preview event types and dispatches by `eventType`:
  - `lead.created`
  - `lead.qualified` / `lead.quality_preview`
  - `lead.assignment_preview` / `vendor.match_preview`
  - `client.followup_preview` / `nurture.due`
  - `report.daily` / `ops.daily`
  - `aos.failure`

## 3. Expected input payload

```json
{
  "eventType": "lead.created",
  "source": "quickfurno-aos",
  "leadId": "lead_mock_001",
  "occurredAt": "2026-06-28T10:00:00.000Z",
  "data": { "preview": true },
  "metadata": { "mode": "safe_agent_preview", "sideEffectsDisabled": true }
}
```

`eventType` is required. The router also tolerates the aliases `event`,
`event_type`, and `type` (QuickFurno normalizes to `eventType` before sending).

## 4. Safe preview output

```json
{
  "ok": true,
  "router": "QF-n8n-Event-Router",
  "status": "routed_preview",
  "eventType": "lead.created",
  "routedTo": "QF-n8n-New-Lead-Intake",
  "mockMode": true,
  "sideEffects": {
    "n8nWebhookCalled": true,
    "whatsappSent": false,
    "creditsDeducted": false,
    "leadAutoAssigned": false,
    "databaseWritten": false
  },
  "message": "Event routed to preview workflow. No side effects executed."
}
```

If `eventType` is unknown, the router returns `status: "unrouted_preview"` and
`routedTo: "QF-n8n-Failure-Handler"` without erroring.

## 5. Disabled side effects

- Does not send WhatsApp.
- Does not call the WhatsApp API.
- Does not deduct vendor credits.
- Does not auto-assign leads.
- Does not write production data.
- Does not apply database migrations.

## 6. Future activation checklist

- [ ] Configure the inbound webhook URL outside the repo (never commit it).
- [ ] Require the `x-qf-n8n-secret` header and validate it.
- [ ] Keep `N8N_ENABLED` / `N8N_OUTBOUND_WEBHOOK_ENABLED` gated by env flags.
- [ ] Add per-event Switch branches only after each child workflow is reviewed.
- [ ] Add audit logging (masked) for routed events.
- [ ] Enable one downstream workflow at a time.

## 7. n8n node structure

1. **Webhook (Trigger)** — `POST` inbound, responds with router JSON.
2. **Set: Normalize Event** — resolve `eventType` from `event`/`type` aliases.
3. **Switch: eventType** — one branch per supported event type.
4. **NoOp / Execute Workflow (preview)** — points at the matching child
   workflow; in this phase it is documentation only and disabled.
5. **Respond to Webhook** — return the clean preview JSON above.
