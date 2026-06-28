# QF-n8n-New-Lead-Intake

## 1. Workflow purpose

Handles the `lead.created` event in preview mode. It receives the safe agent
preview summaries from TrustShield, LeadLens, MatchForge, and LeadFlow and
returns a safe preview response. It does **not** send WhatsApp, assign vendors,
or deduct credits.

## 2. Trigger event type

- `lead.created` (routed from `QF-n8n-Event-Router`).

## 3. Expected input payload

```json
{
  "eventType": "lead.created",
  "leadId": "lead_mock_001",
  "source": "quickfurno-aos",
  "data": {
    "agentPreviewSummary": {
      "trustShield": "accepted",
      "leadLens": "warm:70",
      "matchForge": "suggestions:0",
      "leadFlow": "not_assigned"
    },
    "agents": {
      "trustShield": { "status": "preview", "spamRisk": "low" },
      "leadLens": { "status": "preview", "leadQuality": "warm", "score": 70 },
      "matchForge": { "status": "preview", "matchedVendorLimit": 3 },
      "leadFlow": { "status": "preview", "assignmentStatus": "not_assigned" }
    }
  }
}
```

## 4. Safe preview output

```json
{
  "ok": true,
  "workflow": "QF-n8n-New-Lead-Intake",
  "status": "preview",
  "eventType": "lead.created",
  "intakeSummary": {
    "trustShield": "accepted",
    "leadQuality": "warm",
    "score": 70,
    "matchedVendorLimit": 3,
    "assignmentStatus": "not_assigned"
  },
  "nextStepPreview": "Await human qualification. No vendor notified.",
  "sideEffects": {
    "whatsappSent": false,
    "creditsDeducted": false,
    "leadAutoAssigned": false,
    "databaseWritten": false
  }
}
```

## 5. Disabled side effects

- Does not send WhatsApp.
- Does not assign vendors.
- Does not deduct credits.
- Does not write production data.

## 6. Future activation checklist

- [ ] Confirm lead intake schema and masked fields with CRM.
- [ ] Add Supabase write only after migration + RLS review.
- [ ] Keep vendor assignment behind `AUTO_ASSIGNMENT_ENABLED` (default false).
- [ ] Keep messaging behind `WHATSAPP_SENDING_ENABLED` (default false).
- [ ] Add idempotency on `leadId` to avoid duplicate intake.

## 7. n8n node structure

1. **Execute Workflow Trigger** — invoked by `QF-n8n-Event-Router`.
2. **Set: Extract Preview Summary** — pull `agentPreviewSummary` safely.
3. **Function: Build Intake Summary** — assemble preview-only object.
4. **NoOp: Side Effects Disabled** — documents that no send/assign/credit runs.
5. **Respond / Return** — return the safe preview output above.
