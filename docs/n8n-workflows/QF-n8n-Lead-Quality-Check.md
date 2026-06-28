# QF-n8n-Lead-Quality-Check

## 1. Workflow purpose

Handles `lead.qualified` and `lead.quality_preview` events. It reads LeadLens
and TrustShield preview fields and returns a **quality summary only**. No lead
status is changed and no downstream action is triggered.

## 2. Trigger event type

- `lead.qualified`
- `lead.quality_preview`

(both routed from `QF-n8n-Event-Router`.)

## 3. Expected input payload

```json
{
  "eventType": "lead.quality_preview",
  "leadId": "lead_mock_002",
  "source": "quickfurno-aos",
  "data": {
    "agents": {
      "leadLens": {
        "status": "preview",
        "leadQuality": "warm",
        "score": 70,
        "reasons": ["Budget, city, service present", "No AI provider called"]
      },
      "trustShield": {
        "status": "preview",
        "spamRisk": "low",
        "duplicateRisk": "unknown"
      }
    }
  }
}
```

## 4. Safe preview output

```json
{
  "ok": true,
  "workflow": "QF-n8n-Lead-Quality-Check",
  "status": "preview",
  "eventType": "lead.quality_preview",
  "qualitySummary": {
    "leadQuality": "warm",
    "score": 70,
    "spamRisk": "low",
    "duplicateRisk": "unknown",
    "recommendation": "manual_review"
  },
  "message": "Quality summary preview only. No lead status changed.",
  "sideEffects": {
    "whatsappSent": false,
    "creditsDeducted": false,
    "leadAutoAssigned": false,
    "databaseWritten": false
  }
}
```

## 5. Disabled side effects

- Does not change lead status in the database.
- Does not send WhatsApp.
- Does not assign vendors or deduct credits.
- Does not write production data.

## 6. Future activation checklist

- [ ] Confirm scoring thresholds with LeadLens rules.
- [ ] Decide which qualified leads advance to vendor match (human-approved).
- [ ] Persist quality summary only after migration + RLS review.
- [ ] Keep all downstream sends and assignments flag-gated.

## 7. n8n node structure

1. **Execute Workflow Trigger** — from `QF-n8n-Event-Router`.
2. **Set: Read LeadLens/TrustShield** — extract preview fields safely.
3. **Function: Build Quality Summary** — compute summary + recommendation.
4. **NoOp: No Status Write** — documents read-only behavior.
5. **Respond / Return** — return the quality summary preview above.
