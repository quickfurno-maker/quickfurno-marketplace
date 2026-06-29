# QF-n8n-Event-Router-Full-Preview — Setup & Testing Guide

**Workflow file:** `QF-n8n-Event-Router-Full-Preview.workflow.json`
**Purpose:** A single, safe **preview-only** n8n router that receives QuickFurno
AOS events on one webhook and routes each `eventType` to its own preview node.
**Phase:** Testing only. **Not** for production publish yet.

> ## Safety contract (what this workflow does NOT do)
> - **No** real WhatsApp sending. **No** WhatsApp API call. **No** WhatsApp token.
> - **No** real email sending.
> - **No** Supabase / Postgres write, update, or delete.
> - **No** credit deduction.
> - **No** vendor auto-assignment. **No** vendor notification.
> - **No** real vendor/client API calls. **No** outbound HTTP.
> - **No** credentials required. **No** secrets, service-role key, or prod URL inside the file.
>
> Every branch only emits a JSON **preview** with all side-effect flags set to
> `false`. AOS stays the brain; CRM stores/tracks; Supabase is memory; WhatsApp
> communicates *later*. This file just proves routing works.

---

## 1. What is inside

| Component | Node | Notes |
| --- | --- | --- |
| Trigger | `QF AOS Events Webhook` (Webhook) | `POST` → path `quickfurno/aos/events` |
| Router | `Route by Event Type` (Switch) | 13 outputs, matched on resolved event type |
| 13 previews | Set / "Edit Fields" nodes | One per event, preview JSON only |

**Switch resolution expression** (handles every payload shape AOS might send):

```text
{{ $json.body.eventType || $json.body.event || $json.body.event_type || $json.body.type || $json.body.data?.eventType || $json.eventType || $json.event }}
```

**Webhook response mode:** `When Last Node Finishes` (returns the matched preview
node's JSON to the caller). This was chosen over plain *Respond Immediately* on
purpose: it is still credential-free and warning-free, **and** it lets every
PowerShell test show the safe preview payload (with `whatsappSent:false`,
`databaseWritten:false`, etc.) directly in the HTTP response so you can verify
safety without opening n8n. If you prefer literal *Respond Immediately*, open the
webhook node and set **Respond → Immediately** — one dropdown, no other change.

### Event → preview branch map

| # | Event type | Preview node | Mapped workflow name | Agents (preview) |
| --- | --- | --- | --- | --- |
| 1 | `lead.created` | New Lead Intake Preview | QF-n8n-New-Lead-Intake | TrustShield, LeadLens, MatchForge, LeadFlow, OpsBrief |
| 2 | `lead.qualified` | Client Confirmation Preview | QF-n8n-Client-Confirmation | ClientCare, LeadFlow |
| 3 | `lead.assignment_approved` | Vendor Lead Alert Preview | QF-n8n-Vendor-Lead-Alert | MatchForge, LeadFlow, VendorPulse, WhatsAppPilot |
| 4 | `lead.assigned` | Assignment Tracking Preview | QF-n8n-Assignment-Tracking | LeadFlow, VendorPulse, ClientCare |
| 5 | `vendor.replied` | Vendor Response Preview | QF-n8n-Vendor-Response | VendorPulse, LeadFlow |
| 6 | `client.followup_due` | Client 2-Hour Followup Preview | QF-n8n-Client-2-Hour-Followup | ClientCare, LeadFlow |
| 7 | `client.rating_due` | Client 24-Hour Rating Preview | QF-n8n-Client-24-Hour-Rating | ClientCare, ReviewShield, VendorPulse |
| 8 | `nurture.due` | Nurture Followup Preview | QF-n8n-Nurture-Followup | LeadNurture, ClientCare, CalendarSync |
| 9 | `report.daily` | Daily Founder Report Preview | QF-n8n-Daily-Founder-Report | OpsBrief, GrowthRadar, RevenueVault, SourceTracker |
| 10 | `vendor.low_credit` | Vendor Low Credit Preview | QF-n8n-Vendor-Low-Credit | RevenueVault, VendorPulse, WhatsAppPilot |
| 11 | `complaint.created` | Complaint Escalation Preview | QF-n8n-Complaint-Escalation | ReviewShield, VendorPulse, ClientCare, VaultGuard |
| 12 | `lead.source_tracking` | Lead Source Tracking Preview | QF-n8n-Lead-Source-Tracking | SourceTracker, GrowthRadar |
| 13 | `aos.failure` | Failure Handler Preview | QF-n8n-AOS-Failure-Handler | VaultGuard, NexusKernel, OpsBrief |

---

## 2. Import into n8n (Cloud)

1. Open n8n → **Workflows** (top-left menu).
2. Click **Add workflow** to start a blank workflow (this guarantees a new one).
3. In the new canvas, open the **⋯ menu (top-right)** → **Import from File…**.
4. Select **`QF-n8n-Event-Router-Full-Preview.workflow.json`**.
5. The canvas fills with: **Webhook → Switch → 13 preview nodes**.
6. **Save** (Ctrl/Cmd+S). Leave the workflow **Inactive** for now.

> ### ⚠️ Import as a NEW workflow — do not overwrite
> Always import into a **fresh/blank** workflow. Do **not** open an existing
> QuickFurno workflow and import over it. The file deliberately has **no**
> top-level `id`/`versionId`, so n8n treats it as new — but if you import while an
> existing workflow is open, you can still overwrite that canvas. Start blank.

No credentials prompt should appear. If n8n ever asks for credentials on import,
stop — this file does not need any, and that would indicate the wrong file.

---

## 3. How testing works

While the workflow is **Inactive**, use the **Test webhook**:

1. Open the **`QF AOS Events Webhook`** node.
2. Copy the **Test URL**. It looks like:
   `https://YOUR-N8N-HOST/webhook-test/quickfurno/aos/events`
3. Click **Listen for Test Event** (or **Execute workflow**). n8n now waits for
   **one** request.
4. Send one PowerShell command (below). n8n captures it, routes it, and the
   matching preview node turns **green**.
5. Repeat **Listen for Test Event** before each new test (the test listener
   handles one request at a time).

The **production URL** (`/webhook/...`, no `-test`) only works **after** you
Activate the workflow — do that only when every branch has been verified.

---

## 4. PowerShell tests — one per event type

First set your test URL once in the PowerShell session:

```powershell
# Paste your n8n test webhook URL here (note: /webhook-test/ while testing)
$QF = "https://YOUR-N8N-HOST/webhook-test/quickfurno/aos/events"

function Send-QFEvent($body) {
  $json = $body | ConvertTo-Json -Depth 8
  Invoke-RestMethod -Uri $QF -Method POST -ContentType "application/json" -Body $json |
    ConvertTo-Json -Depth 8
}
```

> Click **Listen for Test Event** on the webhook node **before each** command below.

**1. lead.created**
```powershell
Send-QFEvent @{ eventType = "lead.created"; leadId = "lead_mock_001"; source = "local-test"; data = @{ clientName = "Test Client"; service = "Modular kitchen"; city = "Pune" } }
```

**2. lead.qualified**
```powershell
Send-QFEvent @{ eventType = "lead.qualified"; leadId = "lead_mock_002"; clientId = "client_mock_002"; source = "local-test" }
```

**3. lead.assignment_approved**
```powershell
Send-QFEvent @{ eventType = "lead.assignment_approved"; leadId = "lead_mock_003"; vendorId = "vendor_mock_003"; source = "local-test" }
```

**4. lead.assigned**
```powershell
Send-QFEvent @{ eventType = "lead.assigned"; leadId = "lead_mock_004"; vendorId = "vendor_mock_004"; source = "local-test" }
```

**5. vendor.replied**
```powershell
Send-QFEvent @{ eventType = "vendor.replied"; leadId = "lead_mock_005"; vendorId = "vendor_mock_005"; data = @{ reply = "Interested" } }
```

**6. client.followup_due**
```powershell
Send-QFEvent @{ eventType = "client.followup_due"; leadId = "lead_mock_006"; clientId = "client_mock_006"; data = @{ stage = "post_assignment_2h" } }
```

**7. client.rating_due**
```powershell
Send-QFEvent @{ eventType = "client.rating_due"; leadId = "lead_mock_007"; clientId = "client_mock_007"; data = @{ stage = "post_service_24h" } }
```

**8. nurture.due**
```powershell
Send-QFEvent @{ eventType = "nurture.due"; leadId = "lead_mock_008"; clientId = "client_mock_008"; data = @{ stage = "nurture_drip" } }
```

**9. report.daily**
```powershell
Send-QFEvent @{ eventType = "report.daily"; source = "local-test"; data = @{ range = "last_24h" } }
```

**10. vendor.low_credit**
```powershell
Send-QFEvent @{ eventType = "vendor.low_credit"; vendorId = "vendor_mock_010"; data = @{ creditsRemaining = 2 } }
```

**11. complaint.created**
```powershell
Send-QFEvent @{ eventType = "complaint.created"; leadId = "lead_mock_011"; vendorId = "vendor_mock_011"; data = @{ reason = "delay" } }
```

**12. lead.source_tracking**
```powershell
Send-QFEvent @{ eventType = "lead.source_tracking"; leadId = "lead_mock_012"; data = @{ source = "google_ads"; campaign = "kitchens_pune" } }
```

**13. aos.failure**
```powershell
Send-QFEvent @{ eventType = "aos.failure"; failureId = "failure_mock_013"; workflowName = "QF-n8n-AOS-Failure-Handler"; data = @{ errorMessage = "Mock failure. No side effects." } }
```

### Optional: stand-alone command (no helper)

If you want a fully self-contained example (event #1):

```powershell
$body = @{ eventType = "lead.created"; leadId = "lead_mock_001"; source = "local-test" } | ConvertTo-Json -Depth 8
Invoke-RestMethod -Uri "https://YOUR-N8N-HOST/webhook-test/quickfurno/aos/events" `
  -Method POST -ContentType "application/json" -Body $body | ConvertTo-Json -Depth 8
```

---

## 5. Expected result

For each test:

- **`QF AOS Events Webhook`** node turns **green** (request received).
- **`Route by Event Type`** node turns **green** (event matched a branch).
- **Only the matching preview node** turns green (e.g. `lead.created` →
  **New Lead Intake Preview**). The other 12 stay idle.
- The HTTP response (and the preview node output) looks like:

```json
{
  "workflow": "QF-n8n-New-Lead-Intake",
  "eventType": "lead.created",
  "ok": true,
  "received": true,
  "safePreviewOnly": true,
  "whatsappSent": false,
  "emailSent": false,
  "creditsDeducted": false,
  "leadAutoAssigned": false,
  "vendorNotified": false,
  "databaseWritten": false,
  "externalApiCalled": false,
  "message": "QuickFurno lead.created event received safely by n8n. ...",
  "agents": "TrustShield, LeadLens, MatchForge, LeadFlow, OpsBrief",
  "input": { "eventType": "lead.created", "leadId": "lead_mock_001", "source": "local-test" }
}
```

`input` echoes your original payload so you can confirm what was received.

**If an unknown event type is sent**, no branch matches and no preview node runs
(the Switch simply discards it) — that is expected and safe.

---

## 6. What remains DISABLED (by design)

- WhatsApp sending and any WhatsApp API call / token.
- Email sending.
- Supabase / database writes, updates, deletes, and migrations.
- Vendor credit deduction.
- Automatic lead assignment and vendor notification.
- Any real outbound HTTP to vendor/client/provider APIs.
- Any credential requirement.

These will be added **later**, one workflow at a time, behind human approval and
feature flags — not in this preview file.

---

## 7. Before you publish (pre-activation checklist)

- [ ] Imported as a **new** workflow (did not overwrite an existing one).
- [ ] All **13** event types tested via the **test** URL.
- [ ] For every test: Webhook + Switch + the correct preview node went green.
- [ ] Every response showed all side-effect flags = `false`.
- [ ] No credentials were ever requested.

> **Do not Activate / publish until every one of the 13 branches has been tested
> and verified.** Activation exposes the production `/webhook/quickfurno/aos/events`
> URL — keep it off until the checklist above is complete.

### Production hardening (later — not in this preview)

Per `QuickFurno_n8n_AOS_Workflow_Structure.docx`, the live Event Router must
"Validate secret" before routing. This preview deliberately skips it so testing
needs no header. Before activation, add — as separate, reviewed steps:

- An **IF / Filter** node right after the webhook that checks the
  `x-qf-n8n-secret` header against an **n8n environment variable**
  (`QF_N8N_SECRET`), never a hardcoded value. Reject when it does not match.
- Replace each preview Set node with an **HTTP Request** node calling the real
  QuickFurno endpoint (`/api/aos/process-lead`, `/api/aos/vendor-response`, etc.)
  only after that path is reviewed and its feature flag is enabled.
- Add WhatsApp send, wait/timer, retry, and CRM/Supabase logging one workflow at
  a time, behind the human-approval queue.

---

## 8. QuickFurno `.env.local` reminder

Keep all n8n / send / side-effect flags **OFF** unless you are actively testing.
Per `lib/aos/config/featureFlags.ts` the safe defaults are:

```text
N8N_ENABLED=false
N8N_OUTBOUND_WEBHOOK_ENABLED=false
WHATSAPP_SENDING_ENABLED=false
CREDIT_DEDUCTION_ENABLED=false
AUTO_ASSIGNMENT_ENABLED=false
```

- Never put `QF_N8N_WEBHOOK_SECRET`, a WhatsApp token, or the Supabase
  service-role key in `.env.local` or the repo. Production secrets belong only in
  hosting secret storage, added during the reviewed production phase.
- This preview workflow does not read any of these — they stay off until the real
  send/assign/credit paths are reviewed and enabled individually.
