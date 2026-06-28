# QF-n8n-Vendor-Match-Preview

## 1. Workflow purpose

Handles `lead.assignment_preview` and `vendor.match_preview` events. It shows a
preview vendor match list capped at `matchedVendorLimit: 3`. It does **not**
assign real vendors, deduct credits, or notify vendors.

## 2. Trigger event type

- `lead.assignment_preview`
- `vendor.match_preview`

(both routed from `QF-n8n-Event-Router`.)

## 3. Expected input payload

```json
{
  "eventType": "vendor.match_preview",
  "leadId": "lead_mock_003",
  "source": "quickfurno-aos",
  "data": {
    "agents": {
      "matchForge": {
        "status": "preview",
        "matchedVendorLimit": 3,
        "suggestedVendorCount": 0,
        "notes": ["Vendor matching preview only. No assignment executed."]
      },
      "leadFlow": {
        "status": "preview",
        "assignmentStatus": "not_assigned"
      }
    }
  }
}
```

## 4. Safe preview output

```json
{
  "ok": true,
  "workflow": "QF-n8n-Vendor-Match-Preview",
  "status": "preview",
  "eventType": "vendor.match_preview",
  "matchPreview": {
    "matchedVendorLimit": 3,
    "suggestedVendorCount": 0,
    "candidates": [],
    "assignmentStatus": "not_assigned"
  },
  "message": "Vendor match preview only. No vendor assigned, notified, or charged.",
  "sideEffects": {
    "whatsappSent": false,
    "creditsDeducted": false,
    "leadAutoAssigned": false,
    "vendorNotified": false,
    "databaseWritten": false
  }
}
```

Candidate entries, when present, are masked previews (no contact numbers).

## 5. Disabled side effects

- Does not assign real vendors.
- Does not deduct credits.
- Does not notify vendors.
- Does not write production data.

## 6. Future activation checklist

- [ ] Confirm vendor eligibility rules (city, category, area, active status).
- [ ] Enforce max 3 vendor cap in real assignment logic.
- [ ] Keep assignment behind `AUTO_ASSIGNMENT_ENABLED` (default false).
- [ ] Keep credit deduction behind `CREDIT_DEDUCTION_ENABLED` (default false).
- [ ] Route real assignment through the human approval queue.

## 7. n8n node structure

1. **Execute Workflow Trigger** — from `QF-n8n-Event-Router`.
2. **Set: Read MatchForge/LeadFlow** — extract preview match data.
3. **Function: Cap Candidates (max 3)** — build masked candidate preview.
4. **NoOp: No Assign / No Notify / No Credit** — documents disabled effects.
5. **Respond / Return** — return the match preview above.
