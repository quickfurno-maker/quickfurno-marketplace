# Phase 9 — Real Lead Form → AOS Event Bridge

This phase connects the **real client lead/enquiry form** to the existing safe AOS
event pipeline. After a lead is successfully saved to Supabase, the backend emits a
non-blocking, side-effect-free `lead.created` AOS event.

## Which lead submission route was connected

- **Server action:** `app/actions.ts → submitLead(input)` (public, no auth — the
  website enquiry funnel).
- **Service:** `services/leadService.ts → createLead(input)` — this is where the
  Supabase `leads` insert happens.
- The bridge is invoked in `createLead`, **immediately after** the successful
  insert and the existing `[lead submit] inserted` log, and **before** the
  function returns `ok({ id, is_duplicate })`.

The form UI, form fields, and the Supabase insert were **not** changed.

## What event is emitted

A safe AOS event built by `lib/aos/events/emitLeadCreatedEvent.ts`:

```jsonc
{
  "eventType": "lead.created",
  "lead_id": "<actual saved Supabase lead id>",   // fallback: qf_lead_<ts>_<rand>
  "source": "quickfurno-real-lead-form",
  "lead": {
    "name":     "<name>",
    "phone":    "<phone>",       // masked before any outbound dispatch
    "city":     "<city>",
    "area":     "<area/locality, if available>",
    "category": "<service_required>",
    "budget":   "<budget, if available>",
    "message":  "<requirement/message, if available>"
  },
  "metadata": {
    "mode": "real_lead_form_bridge",
    "isDuplicate": false,
    "formSource": "Website",
    "sideEffectsDisabled": true
  }
}
```

The helper passes this to the existing `runSafeAgentEventPipeline()` — the same
pipeline used by `POST /api/aos/events` and the n8n Master Preview Router. That
pipeline:

- runs the deterministic, **preview-only** agent summary (TrustShield / LeadLens /
  MatchForge / LeadFlow / OpsBrief),
- masks phone numbers and secrets before any outbound call,
- routes to n8n **only when the flags are enabled** (see below),
- performs **no** Supabase writes.

## How to test locally

1. Ensure flags are at their safe defaults (current repo state):
   - `lib/aos/config/featureFlags.ts`: `N8N_ENABLED = false`,
     `N8N_OUTBOUND_WEBHOOK_ENABLED = false`.
   - No `N8N_ENABLED` / `N8N_OUTBOUND_WEBHOOK_ENABLED` env overrides set to a
     truthy value (`1/true/yes/on`).
2. `npm run dev`.
3. Submit the public lead/enquiry form on the website with a normal enquiry.
4. Observe server logs:
   - `[lead submit] inserted { lead_id, is_duplicate, source }` — Supabase save
     succeeded **first**.
   - `[aos][lead.created] safe event emitted { leadId, status: "mocked",
     n8nWebhookCalled: false, mockMode: true }` — safe preview ran, nothing left
     the server.
5. Optional — verify isolation: in `lib/aos/events/emitLeadCreatedEvent.ts`,
   `runSafeAgentEventPipeline` could throw and the lead would still be saved and
   returned (the call is `void` fire-and-forget, internally timeout-bounded to
   `AOS_EMIT_TIMEOUT_MS = 3000ms`, and never throws).

### Optional: enable the real preview webhook (staging only)

Set, **in hosting secrets only (never in `.env` / `.env.local`)**:

- `N8N_ENABLED=true`, `N8N_OUTBOUND_WEBHOOK_ENABLED=true`,
- `N8N_WEBHOOK_URL=<your n8n Master Preview Router test URL>`.

Submitting a lead then logs `status: "accepted"`, `n8nWebhookCalled: true`, and
n8n receives the masked preview payload. Even here, no WhatsApp / credits /
assignment / DB writes occur.

## Expected safe result

- Lead is saved to Supabase exactly as before.
- A safe `lead.created` preview event is emitted (mock mode by default).
- The form response is never delayed or blocked by AOS/n8n.

## Safety flags / guarantees

| Concern | Status |
| --- | --- |
| Supabase insert behavior | Unchanged — runs first; bridge is downstream |
| UI layout / form fields | Unchanged |
| AOS/n8n failure blocks form | No — `void` fire-and-forget, 3s timeout, never throws |
| Direct n8n call from frontend | No — server-only helper |
| Secrets exposed to frontend | No — secrets read server-side only, masked in logs |
| `N8N_ENABLED` / `N8N_OUTBOUND_WEBHOOK_ENABLED` respected | Yes — via `sendEventToN8n` |
| WhatsApp sending | No |
| Vendor notification | No |
| Credit deduction | No |
| Lead auto-assignment | No |
| Extra Supabase writes from n8n | No |
| `.env` / `.env.local` modified | No |

## Changed files

- `lib/aos/events/emitLeadCreatedEvent.ts` — **new** safe helper.
- `services/leadService.ts` — import + fire-and-forget emit after the insert.
- `docs/n8n-workflows/phase-9-real-lead-form-aos-bridge.md` — this note.
