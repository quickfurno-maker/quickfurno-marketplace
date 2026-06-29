# QuickFurno AOS + n8n — Phase 2: New Lead Intake (safe preview)

**Endpoint:** `POST /api/aos/process-lead`
**Workflow:** `QF-n8n-New-Lead-Intake`
**Event:** `lead.created`
**Status:** Preview only — no side effects.

QuickFurno AOS is the brain, the CRM stores and tracks, n8n executes workflows,
WhatsApp communicates later, and Supabase is memory/database. Phase 2 is the
first AOS *intake* step: when a lead is created, n8n calls this endpoint and AOS
scores + previews the lead. Nothing is sent, charged, assigned, or written.

---

## What Phase 2 does

When called, the endpoint:

1. Validates the inbound n8n secret (`x-qf-n8n-secret` header).
2. Safely parses and validates the JSON payload.
3. Runs a deterministic, rule-based preview through five AOS agents:
   - **TrustShield** — spam-risk preview (`low` / `medium` / `high`).
   - **LeadLens** — quality score (0–100) and label (`hot` / `warm` / `cold`).
   - **MatchForge** — vendor suggestions *preview only* (always empty here).
   - **LeadFlow** — assignment *preview only* (`assignmentReady` is always `false`).
   - **OpsBrief** — logs a masked, read-only preview summary.
4. Returns safe JSON describing the preview and an explicit `sideEffects` block
   confirming nothing was executed.

The logic lives in
[`lib/aos/workflows/processLeadWorkflow.ts`](../lib/aos/workflows/processLeadWorkflow.ts)
and the route in
[`app/api/aos/process-lead/route.ts`](../app/api/aos/process-lead/route.ts).
The output is deterministic so n8n preview branches and local tests are stable.

---

## What remains disabled (unchanged from Phase 1)

The response always reports these as `false`, and the code enforces it:

| Side effect            | Phase 2 |
| ---------------------- | ------- |
| WhatsApp send          | ❌ off  |
| Vendor notification    | ❌ off  |
| Vendor credit deduction| ❌ off  |
| Lead auto-assignment   | ❌ off  |
| External API call      | ❌ off  |
| Supabase / DB write    | ❌ off  |

Also unchanged: public website UI, client form, vendor form, Supabase
integration, and all `.env` / `.env.local` files. No secrets are exposed and the
client phone number is masked in logs and any diagnostic output.

---

## Request

```json
{
  "event": "lead.created",
  "lead_id": "TEST-LEAD-001",
  "source": "n8n-new-lead-intake",
  "lead": {
    "name": "Test Client",
    "phone": "9999999999",
    "city": "Pune",
    "category": "Full Home Interior",
    "budget": "5-10 lakh"
  }
}
```

A `lead` object **or** a `lead_id` is required; otherwise the endpoint returns `400`.

## Response (200)

```json
{
  "ok": true,
  "status": "processed_preview",
  "eventType": "lead.created",
  "workflowName": "QF-n8n-New-Lead-Intake",
  "leadId": "TEST-LEAD-001",
  "leadQuality": "warm",
  "spamRisk": "low",
  "assignmentReady": false,
  "matchedVendorsPreview": [],
  "agents": {
    "trustShield": { "status": "accepted", "spamRisk": "low" },
    "leadLens": { "status": "scored", "quality": "warm", "score": 70 },
    "matchForge": { "status": "preview", "suggestions": [] },
    "leadFlow": { "status": "preview_only", "assignmentReady": false },
    "opsBrief": { "status": "logged_preview" }
  },
  "sideEffects": {
    "whatsappSent": false,
    "vendorNotified": false,
    "creditsDeducted": false,
    "leadAutoAssigned": false,
    "databaseWritten": false,
    "externalApiCalled": false
  },
  "message": "Lead processed safely in AOS preview mode. No side effects executed."
}
```

> Note: `leadQuality`, `spamRisk`, and `score` are computed deterministically
> from the lead fields, so different inputs produce different (but stable) values.

## Status codes

| Code | Meaning                                            |
| ---- | -------------------------------------------------- |
| 200  | Safe processed preview                             |
| 400  | Bad / unparseable payload                          |
| 401  | Invalid or missing n8n secret (production)         |
| 500  | Unexpected server error only                       |

---

## Security

- Header: `x-qf-n8n-secret`.
- Server env: **`QF_N8N_SECRET`** (falls back to the Phase 1
  `QF_N8N_WEBHOOK_SECRET` if that is the only one set).
- If the secret env is **missing**:
  - **Production** (`NODE_ENV=production`) → request rejected with `401`.
  - **Development** → allowed as a safe mock/preview only (the response
    `security.mode` is `development_mock`; it is explicitly not a trusted call).
- The secret is never logged. Phone numbers are masked everywhere.

> Set `QF_N8N_SECRET` in the production hosting secrets (Hostinger/PM2 env),
> **not** in `.env` or `.env.local`. This phase does not touch those files.

---

## How n8n calls this endpoint (later)

In the `QF-n8n-New-Lead-Intake` workflow, add an **HTTP Request** node:

- **Method:** `POST`
- **URL (production):** `https://quickfurno.in/api/aos/process-lead`
- **Headers:**
  - `Content-Type: application/json`
  - `x-qf-n8n-secret: <value of QF_N8N_SECRET>`
- **Body (JSON):** the `lead.created` payload shown above.

n8n should branch on the response: e.g. route `spamRisk === "high"` to a review
branch and `leadQuality` to different preview paths. Because every `sideEffects`
flag is `false`, no real action is taken until later phases enable them.

---

## Local test (PowerShell)

From the project root, with the dev server running (`npm run dev`):

```powershell
$headers = @{ "x-qf-n8n-secret" = $env:QF_N8N_SECRET; "Content-Type" = "application/json" }
$body = Get-Content -Raw -Path .\test-aos-process-lead.json
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/aos/process-lead" -Headers $headers -Body $body | ConvertTo-Json -Depth 6
```

In development with no `QF_N8N_SECRET` set, the header may be omitted and the
endpoint responds in `development_mock` mode.

**Production URL placeholder:** `https://quickfurno.in/api/aos/process-lead`

---

## Reversibility

Phase 2 is fully modular and reversible. Removing
`app/api/aos/process-lead/route.ts` and
`lib/aos/workflows/processLeadWorkflow.ts` restores the Phase 1 state with no
other changes required.
