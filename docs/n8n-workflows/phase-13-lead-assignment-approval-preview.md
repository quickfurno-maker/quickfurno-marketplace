# Phase 13 — Lead Assignment Approval Workflow (Preview Only)

Goal: let a **Superadmin** review a lead, see a **vendor match preview**, select
**up to 3 vendors**, and **approve** the assignment in **preview mode**. The
approval saves a **preview/draft database record** and emits a safe AOS event:

```
eventType = lead.assignment_approved
```

This phase builds directly on **Phase 12's two-lock safety gate**. The approval
record always saves safely. The `lead.assignment_approved` event is only
forwarded to the **n8n Master Preview Router** when **both locks are ON**
(`preview` mode).

---

## Safety contract (everything below stays disabled)

- ❌ No WhatsApp sending
- ❌ No vendor notification
- ❌ No credit deduction
- ❌ No auto-assignment of vendors (the real `assign_lead_to_vendors` RPC and
  `lead_assignments` table are **never** touched by this phase)
- ❌ No paid/package changes
- ❌ No secrets exposed in the frontend (no webhook URL, no `QF_N8N_*` secret,
  no service-role key)
- ✅ Public website UI unchanged
- ✅ Existing lead form + Supabase lead creation unchanged
- ✅ Existing admin dashboard unchanged (a new tab is added; nothing removed)
- ✅ Production n8n workflow unchanged (reuses the existing
  `lead.assignment_approved` branch of the Master Preview Router)
- ✅ The **only** database write is the preview approval record

When both locks are ON in `preview` mode, the approval emits a **safe, masked,
side-effect-free** preview event. The n8n preview branch only *previews* a vendor
alert — it sends nothing.

---

## Two-lock model (from Phase 12, unchanged)

| Lock | Where | Requirement |
| --- | --- | --- |
| Lock 1 | Server env | `N8N_ENABLED=true` **AND** `N8N_OUTBOUND_WEBHOOK_ENABLED=true` |
| Lock 2 | Runtime switch | `aos_runtime_settings` row `aos_n8n_master_router` `enabled=true` **AND** `mode='preview'` |

If **either** lock is OFF → the approval still saves, but
`n8nWebhookCalled=false` and `mockMode=true`.

---

## Files in this phase

| File | Purpose |
| --- | --- |
| `supabase/migrations/20260630000017_lead_assignment_approvals.sql` | Preview approval table (idempotent, admin-only RLS, max-3 CHECK) |
| `lib/aos/events/emitLeadAssignmentApprovedEvent.ts` | Safe emit through the two-lock gate |
| `lib/aos/runtime/leadAssignmentApprovalService.ts` | Preview reader + approval writer (server only) |
| `app/api/admin/lead-assignment-preview/route.ts` | `GET` lead + suggested vendors |
| `app/api/admin/lead-assignment-approval/route.ts` | `POST` save preview approval + emit event |
| `components/admin/LeadAssignmentApprovalControl.tsx` | Superadmin UI (new tab under Lead Distribution) |
| `lib/aos/events/safeAgentEventPipeline.ts` | Recognizes `lead.assignment_approved` as a safe event |

UI location: **Admin → Lead Distribution → "Assignment Approval Preview"** tab.

---

## 1. SQL setup

Apply the migration on the live DB (safe / idempotent — uses `IF NOT EXISTS`,
no drop/delete/truncate):

```bash
# Local (supabase CLI) or paste into the Supabase SQL editor:
supabase/migrations/20260630000017_lead_assignment_approvals.sql
```

Table `public.lead_assignment_approvals`:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK, `gen_random_uuid()` |
| `lead_id` | text | accepts uuid or preview/mock ids; no FK so previews never block |
| `selected_vendor_ids` | jsonb | default `[]` |
| `selected_vendor_count` | int | default 0, **CHECK `<= 3`** |
| `status` | text | `draft` \| `preview_approved` \| `preview_sent_to_aos` \| `cancelled` |
| `mode` | text | `preview` only |
| `approval_note` | text | optional |
| `approved_by` | text | admin role label |
| `aos_event_emitted` | boolean | default false |
| `n8n_webhook_called` | boolean | default false |
| `side_effects` | jsonb | default `{}` |
| `created_at` / `updated_at` | timestamptz | `now()` |

Admin-only RLS policy `lead_assignment_approvals admin all` is created using the
existing `public.is_admin()` helper. No anon/public policy is created.

---

## 2. Local test — admin switch OFF (default safe state)

Pre-conditions: env Lock 1 may be anything; runtime Lock 2 is OFF (default).

1. Go to **Admin → Lead Distribution → Assignment Approval Preview**.
2. Select a lead. The preview loads lead details + suggested vendors.
3. Select 1–3 vendors, add an optional note, click **Approve Assignment Preview**.

Expected:

- ✅ DB approval row saved (`status = preview_approved`, `mode = preview`).
- ✅ `n8nWebhookCalled = false`
- ✅ `mockMode = true`
- ✅ Success panel: "No vendor notification sent. No WhatsApp sent. No credits
  deducted. No auto-assignment executed."

API check:

```bash
curl -s -X POST http://localhost:3000/api/admin/lead-assignment-approval \
  -H 'content-type: application/json' \
  --cookie "$ADMIN_SESSION_COOKIE" \
  -d '{"leadId":"<LEAD_ID>","selectedVendorIds":["<V1>","<V2>"],"approvalNote":"test"}'
# → ok:true, status:"preview_approved", n8nWebhookCalled:false, mockMode:true
```

---

## 3. Local test — admin switch ON (`preview`)

Pre-conditions: env Lock 1 ON (`N8N_ENABLED=true`,
`N8N_OUTBOUND_WEBHOOK_ENABLED=true`, `N8N_WEBHOOK_URL` set) **and** runtime
Lock 2 ON: **Admin → Automations → AOS / n8n Automation Control → Enable +
Preview → Save**.

1. Repeat the approval steps from test 2.

Expected:

- ✅ DB approval row saved (`status = preview_sent_to_aos`).
- ✅ `n8nWebhookCalled = true`
- ✅ `mockMode = false`
- ✅ The event reaches the n8n Master Preview Router on the
  **`lead.assignment_approved`** branch:

```
QF AOS Events Webhook
  → Route by Event Type            (matches "lead.assignment_approved")
    → Vendor Lead Alert Preview    (preview only — no message sent)
      → Prepare Vendor WhatsApp Preview   (builds a preview payload only)
```

The forwarded payload is masked and side-effect-free:

```json
{
  "eventType": "lead.assignment_approved",
  "leadId": "<LEAD_ID>",
  "data": {
    "selected_vendor_ids": ["<V1>", "<V2>"],
    "selected_vendor_count": 2,
    "approval_mode": "preview",
    "approved_by": "Superadmin",
    "agents": [
      { "agent": "LeadFlow", "status": "preview" },
      { "agent": "VendorPulse", "status": "preview" },
      { "agent": "ClientCare", "status": "preview" },
      { "agent": "TrustShield", "status": "preview" }
    ],
    "sideEffects": {
      "whatsappSent": false,
      "vendorNotified": false,
      "creditsDeducted": false,
      "leadAutoAssigned": false,
      "databaseWritten": "preview_approval_record_only"
    }
  }
}
```

---

## 4. Max-3 vendor validation test

The cap is enforced in **three** places:

1. **UI** — selecting a 4th vendor is blocked; checkboxes disable at 3.
2. **API / service** — `createLeadAssignmentApprovalPreview` rejects
   `selectedVendorIds.length > 3` with `code: "MAX_VENDORS_EXCEEDED"`.
3. **Database** — `CHECK (selected_vendor_count <= 3)`.

Test the API guard directly:

```bash
curl -s -X POST http://localhost:3000/api/admin/lead-assignment-approval \
  -H 'content-type: application/json' \
  --cookie "$ADMIN_SESSION_COOKIE" \
  -d '{"leadId":"<LEAD_ID>","selectedVendorIds":["a","b","c","d"]}'
# → HTTP 400, ok:false, code:"MAX_VENDORS_EXCEEDED"
```

Expected: fails **safely** (no DB row written, no event emitted).

---

## 5. Live VPS safe test

On the production VPS with **n8n env OFF** and the **admin switch OFF** (the
default live state):

1. Open Admin → Lead Distribution → Assignment Approval Preview.
2. Approve a preview with 1–3 vendors.

Expected:

- ✅ Approval row saved (`status = preview_approved`).
- ✅ `n8nWebhookCalled = false`, `mockMode = true`.
- ✅ **n8n is NOT called.** No outbound webhook, no WhatsApp, no vendor
  notification, no credit change.
- ✅ Public website + lead form + existing admin dashboard all unchanged.

---

## 6. Rollback steps

This phase is additive and safe. To roll back:

1. **Disable forwarding (instant, no deploy):** Admin → Automations → set the
   AOS / n8n switch **OFF**. Approvals keep saving as preview; n8n is never
   called. (Or set env Lock 1 OFF on the VPS.)
2. **Hide the UI:** remove the `"Assignment Approval Preview"` tab entry and the
   `LeadAssignmentApprovalControl` render from
   `components/admin/AdminSectionPage.tsx` (`LeadDistributionPage`), then
   redeploy.
3. **Remove the code:** delete the Phase 13 files listed above and revert the
   `lead.assignment_approved` additions in `safeAgentEventPipeline.ts`.
4. **Database:** the `lead_assignment_approvals` table is preview-only and
   isolated. It can be left in place safely. If you must remove it, do so
   manually in a maintenance window — the migration itself performs **no**
   destructive SQL and never drops anything.

> Note: no production n8n workflow changes are required to roll back, because
> Phase 13 reuses the existing `lead.assignment_approved` preview branch.
