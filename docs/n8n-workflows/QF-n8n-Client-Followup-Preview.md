# QF-n8n-Client-Followup-Preview

## 1. Workflow purpose

Handles `client.followup_preview` and `nurture.due` events. It prepares a
**message preview only** for a client follow-up or nurture touch. It does
**not** send WhatsApp or any message.

## 2. Trigger event type

- `client.followup_preview`
- `nurture.due`

(both routed from `QF-n8n-Event-Router`.)

## 3. Expected input payload

```json
{
  "eventType": "client.followup_preview",
  "leadId": "lead_mock_004",
  "clientId": "client_mock_004",
  "source": "quickfurno-aos",
  "data": {
    "stage": "post_assignment_2h",
    "templateKey": "client_followup_preview",
    "context": {
      "service": "Modular kitchen",
      "city": "Pune"
    }
  }
}
```

## 4. Safe preview output

```json
{
  "ok": true,
  "workflow": "QF-n8n-Client-Followup-Preview",
  "status": "preview",
  "eventType": "client.followup_preview",
  "messagePreview": {
    "channel": "whatsapp_future",
    "templateKey": "client_followup_preview",
    "previewText": "Hi! Checking in on your Modular kitchen request in Pune. Reply to continue.",
    "recipientMasked": "client_mock_004"
  },
  "message": "Follow-up message prepared as preview only. Nothing was sent.",
  "sideEffects": {
    "whatsappSent": false,
    "providerCalled": false,
    "creditsDeducted": false,
    "databaseWritten": false
  }
}
```

The `previewText` is a template render preview. No phone number is included.

## 5. Disabled side effects

- Does not send WhatsApp.
- Does not call the WhatsApp API or any provider.
- Does not write production data.

## 6. Future activation checklist

- [ ] Register approved WhatsApp template keys for follow-up / nurture.
- [ ] Add opt-in, template, and rate-limit checks before any send.
- [ ] Keep sending behind `WHATSAPP_SENDING_ENABLED` (default false).
- [ ] Route delivery callbacks to `POST /api/aos/whatsapp-status`.
- [ ] Log masked message state only after migration + RLS review.

## 7. n8n node structure

1. **Execute Workflow Trigger** — from `QF-n8n-Event-Router`.
2. **Set: Resolve Template + Context** — pick template key and masked context.
3. **Function: Render Preview Text** — build preview string (no phone).
4. **NoOp: Sending Disabled** — documents that no provider call is made.
5. **Respond / Return** — return the message preview above.
