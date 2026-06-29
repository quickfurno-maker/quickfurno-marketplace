# QF-n8n-AOS-Master-Preview-Router — Setup & Testing Guide

**Workflow file:** `QF-n8n-AOS-Master-Preview-Router.workflow.json`
**Purpose:** One master **preview-only** router. A single webhook receives every
QuickFurno AOS event, a Switch routes by event type, and each branch produces a
safe preview. Three branches are extended (`lead.created`, `lead.qualified`,
`lead.assignment_approved`).
**Phase:** Testing only. Keep **inactive**. **Do not publish.**

> ## Safety contract
> - **No** real WhatsApp send, **no** email send, **no** vendor notification.
> - **No** credit deduction, **no** vendor auto-assignment.
> - **No** Supabase / database write, update, or delete.
> - **No** third-party vendor/client API calls.
> - **No** WhatsApp / Supabase credentials. **No** real secrets in the file.
> - Every preview node sets all side-effect flags to `false` (Boolean type).
>
> **One intentional network call:** the `lead.created` branch has an HTTP node
> that calls **your own** AOS endpoint `https://quickfurno.in/api/aos/process-lead`
> with header `x-qf-n8n-secret: dev-test-secret`. This is your QuickFurno backend
> (not a vendor/client API). Your `process-lead` route must stay in safe/preview
> mode (per `featureFlags.ts`: `N8N_ENABLED=false`, sending disabled). The preview
> node after it marks `externalApiCalled: true` and every other flag `false`.

---

## 1. What is inside (19 nodes)

```
QF AOS Events Webhook (POST quickfurno/aos/events, Respond = When Last Node Finishes)
   └─ Route by Event Type (Switch, 13 outputs)
        ├─ lead.created             → New Lead Intake Preview → Call QuickFurno AOS Process Lead → AOS Process Lead Preview
        ├─ lead.qualified           → Client Confirmation Preview → Prepare Client WhatsApp Preview
        ├─ lead.assignment_approved → Vendor Lead Alert Preview → Prepare Vendor WhatsApp Preview
        ├─ lead.assigned            → Assignment Tracking Preview
        ├─ vendor.replied           → Vendor Response Preview
        ├─ client.followup_due      → Client 2-Hour Followup Preview
        ├─ client.rating_due        → Client 24-Hour Rating Preview
        ├─ nurture.due              → Nurture Followup Preview
        ├─ report.daily             → Daily Founder Report Preview
        ├─ vendor.low_credit        → Vendor Low Credit Preview
        ├─ complaint.created        → Complaint Escalation Preview
        ├─ lead.source_tracking     → Lead Source Tracking Preview
        └─ aos.failure              → Failure Handler Preview
```

**Schema/versions** match your uploaded export: Webhook `typeVersion 2`, Switch
`typeVersion 3` (strict), Set `typeVersion 3.4`, HTTP Request `typeVersion 4.4`,
`settings.executionOrder = v1`.

**Switch resolution expression:**

```text
{{ $json.body.event || $json.body.eventType || $json.body.event_type || $json.body.type || $json.body.data?.eventType || $json.event || $json.eventType }}
```

---

## 2. Import into n8n (Cloud) — as a NEW workflow

1. n8n → **Workflows** → **Add workflow** (start blank).
2. On the blank canvas: **⋯ (top-right) → Import from File…**.
3. Choose **`QF-n8n-AOS-Master-Preview-Router.workflow.json`**.
4. **Save**. Leave it **Inactive**.

> ### ⚠️ Do not overwrite an existing workflow
> Always import into a **fresh/blank** workflow. The file has **no** top-level
> `id`/`versionId`, so n8n treats it as new — but if you import while another
> workflow is open you can still replace that canvas. Start blank.
>
> ### ⚠️ Keep inactive — do not publish
> Do not click **Active**. Testing uses the **Test** webhook URL only. Publishing
> exposes the production URL and is out of scope for this phase.

No credential prompt should appear on import.

---

## 3. Replace the dev secret before production

The HTTP node header uses a **placeholder**: `x-qf-n8n-secret: dev-test-secret`.

- This is a throwaway dev value, **not** a real secret.
- Before any production use, replace it with a strong **server-only** secret,
  stored as an **n8n environment variable** (e.g. `QF_N8N_SECRET`) and referenced
  as `={{ $env.QF_N8N_SECRET }}` — never hardcoded, never in `.env.local`, never
  in the repo. Your `/api/aos/process-lead` route must validate this header.

---

## 4. How testing works

While the workflow is **Inactive**:

1. Open **`QF AOS Events Webhook`** → copy the **Test URL**
   (`https://YOUR-N8N-HOST/webhook-test/quickfurno/aos/events`).
2. Click **Listen for Test Event**.
3. Send one PowerShell command (below).
4. The matched branch turns **green**. With Respond = *When Last Node Finishes*,
   the HTTP response shows the final preview JSON (all safe flags visible).
5. Click **Listen for Test Event** again before each new test.

---

## 5. PowerShell test commands

Set the test URL once:

```powershell
$QF = "https://YOUR-N8N-HOST/webhook-test/quickfurno/aos/events"
function Send-QFEvent($body) {
  $json = $body | ConvertTo-Json -Depth 8
  Invoke-RestMethod -Uri $QF -Method POST -ContentType "application/json" -Body $json |
    ConvertTo-Json -Depth 8
}
```

> Click **Listen for Test Event** before each command.

**lead.created** (exercises HTTP call + AOS Process Lead Preview)
```powershell
Send-QFEvent @{
  eventType = "lead.created"
  lead_id   = "N8N-LEAD-0001"
  source    = "n8n-master-preview-router"
  lead = @{
    name = "Asha Verma"; phone = "9000000001"; city = "Pune"
    area = "Wakad"; category = "Modular kitchen"; budget = "2-3L"
  }
}
```

**lead.qualified** (exercises Prepare Client WhatsApp Preview)
```powershell
Send-QFEvent @{
  eventType = "lead.qualified"
  lead_id   = "N8N-LEAD-0001"
  lead = @{ name = "Asha Verma"; phone = "9000000001"; city = "Pune"; area = "Wakad"; category = "Modular kitchen" }
}
```

**lead.assignment_approved** (exercises Prepare Vendor WhatsApp Preview)
```powershell
Send-QFEvent @{
  eventType = "lead.assignment_approved"
  lead_id   = "N8N-LEAD-0001"
  lead = @{ name = "Asha Verma"; city = "Pune"; area = "Wakad"; category = "Modular kitchen"; budget = "2-3L" }
}
```

**aos.failure**
```powershell
Send-QFEvent @{
  eventType = "aos.failure"
  failureId = "fail_mock_001"
  data = @{ errorMessage = "Mock failure for preview. No side effects." }
}
```

The remaining events test the same way — change `eventType` to any of:
`lead.assigned`, `vendor.replied`, `client.followup_due`, `client.rating_due`,
`nurture.due`, `report.daily`, `vendor.low_credit`, `complaint.created`,
`lead.source_tracking`.

---

## 6. Expected green path per branch

| Event sent | Nodes that should turn green |
| --- | --- |
| `lead.created` | Webhook → Switch → New Lead Intake Preview → Call QuickFurno AOS Process Lead → AOS Process Lead Preview |
| `lead.qualified` | Webhook → Switch → Client Confirmation Preview → Prepare Client WhatsApp Preview |
| `lead.assignment_approved` | Webhook → Switch → Vendor Lead Alert Preview → Prepare Vendor WhatsApp Preview |
| `lead.assigned` | Webhook → Switch → Assignment Tracking Preview |
| `vendor.replied` | Webhook → Switch → Vendor Response Preview |
| `client.followup_due` | Webhook → Switch → Client 2-Hour Followup Preview |
| `client.rating_due` | Webhook → Switch → Client 24-Hour Rating Preview |
| `nurture.due` | Webhook → Switch → Nurture Followup Preview |
| `report.daily` | Webhook → Switch → Daily Founder Report Preview |
| `vendor.low_credit` | Webhook → Switch → Vendor Low Credit Preview |
| `complaint.created` | Webhook → Switch → Complaint Escalation Preview |
| `lead.source_tracking` | Webhook → Switch → Lead Source Tracking Preview |
| `aos.failure` | Webhook → Switch → Failure Handler Preview |

Every preview output includes: `ok:true`, `received:true`, `safePreviewOnly:true`,
and `whatsappSent / emailSent / creditsDeducted / leadAutoAssigned / vendorNotified
/ databaseWritten / externalApiCalled` = `false` (except `AOS Process Lead Preview`,
where `externalApiCalled:true` because the own-domain AOS call was made).

> If `Call QuickFurno AOS Process Lead` shows **red**, the AOS endpoint was
> unreachable or rejected `dev-test-secret`. That is a server-side response only —
> no WhatsApp, credit, assignment, or DB side effect happens in n8n. You can also
> temporarily disable that one node (right-click → Deactivate) to test routing
> without any network call.

---

## 7. What remains DISABLED

- WhatsApp sending and any WhatsApp API call / token.
- Email sending.
- Vendor notification and vendor auto-assignment.
- Credit deduction.
- Supabase / database writes, updates, deletes.
- Third-party vendor/client API calls.
- Production publishing / Activation.

---

## 8. Before you publish (reminders)

- [ ] Imported as a **new** workflow (did not overwrite an existing one).
- [ ] Kept **inactive**; never clicked Activate.
- [ ] Tested all 13 events via the **test** URL; correct branch went green.
- [ ] Every response showed side-effect flags = `false` (only `externalApiCalled`
      true on the AOS call result).
- [ ] Replaced `dev-test-secret` with a strong server-only secret via n8n env var.
- [ ] Confirmed `/api/aos/process-lead` is in safe/preview mode before enabling.

Keep QuickFurno `.env.local` n8n / send flags **OFF** unless actively testing:
`N8N_ENABLED=false`, `N8N_OUTBOUND_WEBHOOK_ENABLED=false`,
`WHATSAPP_SENDING_ENABLED=false`, `CREDIT_DEDUCTION_ENABLED=false`,
`AUTO_ASSIGNMENT_ENABLED=false`.
