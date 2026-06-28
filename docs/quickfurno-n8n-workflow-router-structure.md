# QuickFurno n8n Workflow Router Structure

This document describes the **preview-only** n8n workflow router structure for
QuickFurno automation. It complements the existing
[`quickfurno-n8n-workflows.md`](./quickfurno-n8n-workflows.md) foundation doc and
the per-workflow docs under [`n8n-workflows/`](./n8n-workflows/README.md).

> **Phase safety contract**
>
> No WhatsApp sends. No WhatsApp API calls. No credit deduction. No auto lead
> assignment. No production data writes. No database migrations. n8n stays
> disabled by default unless env flags enable it. Every workflow returns
> preview / summary JSON only.

## 1. Workflow list

| # | Workflow | Handles | Output |
| --- | --- | --- | --- |
| 1 | `QF-n8n-Event-Router` | All preview events | Routes by `eventType`, returns clean JSON |
| 2 | `QF-n8n-New-Lead-Intake` | `lead.created` | Intake preview summary |
| 3 | `QF-n8n-Lead-Quality-Check` | `lead.qualified`, `lead.quality_preview` | Quality summary only |
| 4 | `QF-n8n-Vendor-Match-Preview` | `lead.assignment_preview`, `vendor.match_preview` | Capped (3) match preview |
| 5 | `QF-n8n-Client-Followup-Preview` | `client.followup_preview`, `nurture.due` | Message preview only |
| 6 | `QF-n8n-Daily-Founder-Report` | `report.daily`, `ops.daily` | Founder summary placeholder |
| — | `QF-n8n-Failure-Handler` (placeholder) | `aos.failure` | Safe failure capture |

Per-workflow specs:

- [QF-n8n-Event-Router](./n8n-workflows/QF-n8n-Event-Router.md)
- [QF-n8n-New-Lead-Intake](./n8n-workflows/QF-n8n-New-Lead-Intake.md)
- [QF-n8n-Lead-Quality-Check](./n8n-workflows/QF-n8n-Lead-Quality-Check.md)
- [QF-n8n-Vendor-Match-Preview](./n8n-workflows/QF-n8n-Vendor-Match-Preview.md)
- [QF-n8n-Client-Followup-Preview](./n8n-workflows/QF-n8n-Client-Followup-Preview.md)
- [QF-n8n-Daily-Founder-Report](./n8n-workflows/QF-n8n-Daily-Founder-Report.md)

## 2. Event routing map

| Event type | Preview workflow |
| --- | --- |
| `lead.created` | `QF-n8n-New-Lead-Intake` |
| `lead.qualified` | `QF-n8n-Lead-Quality-Check` |
| `lead.quality_preview` | `QF-n8n-Lead-Quality-Check` |
| `lead.assignment_preview` | `QF-n8n-Vendor-Match-Preview` |
| `vendor.match_preview` | `QF-n8n-Vendor-Match-Preview` |
| `client.followup_preview` | `QF-n8n-Client-Followup-Preview` |
| `nurture.due` | `QF-n8n-Client-Followup-Preview` |
| `report.daily` | `QF-n8n-Daily-Founder-Report` |
| `ops.daily` | `QF-n8n-Daily-Founder-Report` |
| `aos.failure` | `QF-n8n-Failure-Handler` (placeholder) |

This map is implemented as code in
[`lib/aos/events/n8nPreviewWorkflowMap.ts`](../lib/aos/events/n8nPreviewWorkflowMap.ts).

### Note on the two routing maps

There are **two** maps and they serve different purposes:

- `lib/aos/events/n8nWorkflowMap.ts` — the existing production-intent map keyed
  on the strict `QuickFurnoN8nEventType` set. It is used by the live safe event
  pipeline (`safeAgentEventPipeline.ts`) and the working n8n test. **Do not
  modify or narrow it.**
- `lib/aos/events/n8nPreviewWorkflowMap.ts` — the new preview map for this
  documentation phase. It adds preview-only event types
  (`lead.quality_preview`, `vendor.match_preview`, `client.followup_preview`,
  `ops.daily`) that are not part of the live type. It is additive and triggers
  nothing.

A separate file was created (instead of overwriting `n8nWorkflowMap.ts`) so the
existing working n8n test and the strict event type both stay intact.

## 3. Manual n8n setup steps

The templates in [`n8n-workflows/templates/`](./n8n-workflows/templates/) are
**manual setup templates** (the exact one-click import format varies by n8n
version). To wire them up in a future reviewed phase:

1. Create `QF-n8n-Event-Router` with a Webhook trigger node.
2. Add a Set node to normalize `eventType` from `event` / `type` aliases.
3. Add a Switch node with one branch per event type in the routing map.
4. Create each child workflow (`QF-n8n-New-Lead-Intake`, etc.) as a separate
   n8n workflow, disabled, using the matching `*.template.json` as the build
   spec (name, trigger, nodes, expected input, safe preview output).
5. Wire each Switch branch to an `Execute Workflow` node pointing at the child.
6. End each workflow with a Respond/Return node emitting the documented safe
   preview JSON.
7. Keep all triggers disabled and all credentials outside the repo.

## 4. Test steps (local mock only)

Run the app locally and POST a sample payload to the existing safe endpoint.
Sample bodies live in
[`n8n-workflows/sample-payloads/`](./n8n-workflows/sample-payloads/).

```powershell
npm run dev

$body = Get-Content -Raw ".\docs\n8n-workflows\sample-payloads\lead-created.json"
Invoke-RestMethod -Uri "http://localhost:3000/api/aos/events" -Method POST `
  -ContentType "application/json" -Body $body | ConvertTo-Json -Depth 8
```

Repeat with `lead-quality-preview.json`, `vendor-match-preview.json`,
`client-followup-preview.json`, `daily-founder-report.json`, and
`aos-failure.json`. All responses must show side effects as `false` and
`mockMode` behavior — no real send, assign, credit, or write.

## 5. What remains disabled

- WhatsApp sending and any WhatsApp API call.
- Vendor credit deduction.
- Automatic lead assignment.
- Production database writes.
- Database migrations.
- Real outbound n8n calls, unless explicitly enabled by env flags.

Current safe flag defaults (see `lib/aos/config/featureFlags.ts`):

```ts
N8N_ENABLED = false
N8N_OUTBOUND_WEBHOOK_ENABLED = false
WHATSAPP_SENDING_ENABLED = false
CREDIT_DEDUCTION_ENABLED = false
AUTO_ASSIGNMENT_ENABLED = false
```

## 6. Future production activation steps

1. Review and approve each child workflow individually.
2. Configure `QF_N8N_WEBHOOK_SECRET` in production hosting secrets only (never
   in `.env` / `.env.local` / the repo).
3. Require and validate the `x-qf-n8n-secret` header on every callback.
4. Apply any Supabase workflow-log migrations with RLS review.
5. Enable one workflow at a time behind its feature flag.
6. Register approved WhatsApp templates before enabling any send path.
7. Keep auto-assignment and credit deduction behind the human approval queue.
8. Add audit logging (masked), retries, and dead-letter handling.
9. Export and back up n8n workflows after activation.
