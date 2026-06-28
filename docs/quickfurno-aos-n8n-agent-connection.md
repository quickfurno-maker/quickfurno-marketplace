# QuickFurno AOS to n8n Agent Connection

## What agents are connected

The `/api/aos/events` route now runs a safe preview pipeline for:

- TrustShield
- LeadLens
- MatchForge
- LeadFlow
- OpsBrief placeholder

Only these agents are represented in this phase. Future agents remain inactive.

## What n8n receives

When both `N8N_ENABLED` and `N8N_OUTBOUND_WEBHOOK_ENABLED` are true, the route queues a sanitized event for the n8n event router with:

- `eventType`
- `workflowName`
- `leadId`
- `source`
- `timestamp`
- `agentPreviewSummary`
- `agents`

The n8n webhook URL and secrets are never returned in the API response.

If either n8n flag is false, QuickFurno returns a safe mock response and does not call n8n.

## What remains disabled

These side effects remain false in this phase:

- `whatsappSent`
- `providerCalled`
- `creditsDeducted`
- `leadAutoAssigned`
- `databaseWritten`

`n8nWebhookCalled` is true only when both n8n flags are enabled and the webhook responds successfully.

## How to test locally

Use the test payload in `test-aos-n8n-agent-event.json`.

Example:

```bash
curl -X POST http://localhost:3000/api/aos/events \
  -H "content-type: application/json" \
  --data @test-aos-n8n-agent-event.json
```

Expected response:

- `ok: true`
- `eventType: "lead.created"`
- `agents.trustShield` exists
- `agents.leadLens` exists
- `agents.matchForge` exists
- `agents.leadFlow` exists
- `sideEffects.whatsappSent: false`
- `sideEffects.creditsDeducted: false`
- `sideEffects.leadAutoAssigned: false`
- `sideEffects.databaseWritten: false`

## Future production activation checklist

1. Review n8n workflow routing and error handling.
2. Configure n8n secrets only in hosting secret storage.
3. Enable `N8N_ENABLED` in a controlled environment.
4. Enable `N8N_OUTBOUND_WEBHOOK_ENABLED` only after webhook testing.
5. Add audit logging before any live automation.
6. Keep WhatsApp, credit deduction, and auto-assignment disabled until separate approval.
7. Add monitoring for n8n failures and retry behavior.
8. Run a staged test with non-production lead data.
