# QuickFurno n8n Workflow Router Structure

This folder documents the **preview-only** n8n workflow router for QuickFurno
automation. Everything here is documentation and safe template material.

> **Safety contract for this phase**
>
> - No WhatsApp messages are sent.
> - No WhatsApp API is called.
> - No vendor credits are deducted.
> - No leads are auto-assigned.
> - No production data is written.
> - No database migrations are applied.
> - n8n stays disabled by default unless env flags enable it.
> - All workflows return **preview/summary JSON only**.

## What lives here

| Path | Purpose |
| --- | --- |
| `README.md` | This overview. |
| `QF-n8n-Event-Router.md` | Main webhook receiver + router. |
| `QF-n8n-New-Lead-Intake.md` | Handles `lead.created` preview. |
| `QF-n8n-Lead-Quality-Check.md` | Handles `lead.qualified` / `lead.quality_preview`. |
| `QF-n8n-Vendor-Match-Preview.md` | Handles `lead.assignment_preview` / `vendor.match_preview`. |
| `QF-n8n-Client-Followup-Preview.md` | Handles `client.followup_preview` / `nurture.due`. |
| `QF-n8n-Daily-Founder-Report.md` | Handles `report.daily` / `ops.daily`. |
| `templates/*.template.json` | Manual-setup / near-importable workflow specs. |
| `sample-payloads/*.json` | Example event bodies for local mock testing. |

## Event routing map (preview)

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

This preview map is implemented as a constant in
`lib/aos/events/n8nPreviewWorkflowMap.ts`. It is **separate** from the existing
production-intent map in `lib/aos/events/n8nWorkflowMap.ts`, which is still used
by the live safe event pipeline and must not be broken.

## Templates are "manual setup templates"

The exact n8n import format can vary by n8n version. The JSON files in
`templates/` are **manual setup templates**: they describe the workflow name,
trigger event, ordered nodes, expected input, safe preview output, and the
disabled side effects. Use them as a build spec when wiring real workflows in a
future, reviewed activation phase. Do not assume one-click import.

## How to read each workflow doc

Every `QF-n8n-*.md` doc follows the same structure:

1. Workflow purpose
2. Trigger event type
3. Expected input payload
4. Safe preview output
5. Disabled side effects
6. Future activation checklist
7. n8n node structure

See `../quickfurno-n8n-workflow-router-structure.md` for the consolidated
router overview, manual setup steps, and production activation plan.
