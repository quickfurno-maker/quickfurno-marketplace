# QF-n8n-Daily-Founder-Report

## 1. Workflow purpose

Handles `report.daily` and `ops.daily` events. It builds a **founder summary
placeholder** from safe aggregate counts only. It does **not** send email or
WhatsApp yet.

## 2. Trigger event type

- `report.daily`
- `ops.daily`

(both routed from `QF-n8n-Event-Router`; in production this is schedule-driven.)

## 3. Expected input payload

```json
{
  "eventType": "report.daily",
  "source": "quickfurno-aos",
  "occurredAt": "2026-06-28T03:30:00.000Z",
  "data": {
    "range": "last_24h",
    "aggregates": {
      "newLeads": 0,
      "qualifiedPreview": 0,
      "matchPreviews": 0,
      "blockedSideEffects": 0
    }
  }
}
```

Aggregates are counts only — never client phone numbers or secrets.

## 4. Safe preview output

```json
{
  "ok": true,
  "workflow": "QF-n8n-Daily-Founder-Report",
  "status": "preview",
  "eventType": "report.daily",
  "founderSummary": {
    "range": "last_24h",
    "newLeads": 0,
    "qualifiedPreview": 0,
    "matchPreviews": 0,
    "blockedSideEffects": 0,
    "headline": "Daily founder summary placeholder. Aggregate counts only."
  },
  "delivery": {
    "channel": "none",
    "emailSent": false,
    "whatsappSent": false
  },
  "sideEffects": {
    "whatsappSent": false,
    "emailSent": false,
    "databaseWritten": false
  }
}
```

## 5. Disabled side effects

- Does not send email.
- Does not send WhatsApp.
- Does not write production data.

## 6. Future activation checklist

- [ ] Confirm the daily aggregate query is read-only and excludes PII/secrets.
- [ ] Choose a reviewed delivery channel (email/WhatsApp) behind a flag.
- [ ] Add a schedule trigger (cron) only after approval.
- [ ] Store report snapshots only after migration + RLS review.

## 7. n8n node structure

1. **Schedule Trigger (future) / Execute Workflow Trigger** — fires the report.
2. **Set: Read Aggregates** — pull counts-only object.
3. **Function: Build Founder Summary** — assemble placeholder summary.
4. **NoOp: Delivery Disabled** — documents that no email/WhatsApp is sent.
5. **Respond / Return** — return the founder summary above.
