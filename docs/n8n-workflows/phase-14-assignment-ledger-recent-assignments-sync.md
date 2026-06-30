# Phase 14 — Assignment Ledger + Recent Assignments Sync

Goal: make Phase 13 preview approval records **visible and trackable** in the
admin **Lead Distribution** page. After a Superadmin approves an assignment
preview, it now shows up under **Recent Assignments**, **Distribution Logs**, and
(if it ever records a safe failure) **Failed Assignments** — all read from the
existing `lead_assignment_approvals` ledger.

Everything stays **preview/draft/safe**. No real `lead_assignments` row is
written, no WhatsApp, no vendor notification, no credit deduction, no
auto-assignment.

---

## Safety contract

- ❌ No WhatsApp sending
- ❌ No vendor notification
- ❌ No credit deduction
- ❌ No auto-assignment of vendors
- ❌ No real paid assignment behavior
- ❌ No public website UI change
- ❌ No secrets exposed (the stored `event_response` is a safe masked summary)
- ✅ Phase 12 switch, Phase 13 approval, and Phase 13B vendor controls unchanged
- ✅ The ledger is `lead_assignment_approvals` only — `lead_assignments` is untouched

The Recent / Failed / Logs panels always render the four side-effect badges as
**Disabled** so the preview-only contract is obvious at a glance.

---

## What changed

| File | Purpose |
| --- | --- |
| `supabase/migrations/20260630000019_assignment_ledger_snapshots.sql` | Adds `lead_snapshot / vendor_snapshot / event_response / failure_reason / approval_source` to `lead_assignment_approvals`. Idempotent. |
| `lib/aos/runtime/leadAssignmentApprovalService.ts` | On approval, saves readable snapshots (lead name/city/category/budget; selected vendor names/city/package/credits) + the safe AOS `event_response`. Graceful fallback if migration 019 is not applied. |
| `lib/aos/runtime/assignmentLedgerService.ts` | Read-only ledger queries: recent / failed / logs / by-id, with readable mapping. |
| `app/api/admin/lead-assignments/recent/route.ts` | `GET` recent preview approvals. |
| `app/api/admin/lead-assignments/failed/route.ts` | `GET` safe-failure records (usually empty). |
| `app/api/admin/lead-assignments/logs/route.ts` | `GET` approval log lines + preview credit logs. |
| `app/api/admin/lead-assignments/[id]/route.ts` | `GET` full record detail (incl. `event_response`). |
| `components/admin/AssignmentLedgerPanels.tsx` | Recent / Failed / Distribution Logs panels + detail drawer. |
| `components/admin/AdminSectionPage.tsx` | Lead Distribution tabs wired to the new panels; Eligibility Checker now shows full reasoning via the shared helper. |

### Recent Assignments badges

| Condition | Badge |
| --- | --- |
| `status = preview_approved` | **Preview saved** |
| `status = preview_sent_to_aos` | **Sent to AOS Preview** |
| `n8n_webhook_called = true` | **n8n preview called** |
| `n8n_webhook_called = false` | **safe mock mode** |

Always-shown side-effect badges: WhatsApp **Disabled**, Vendor notification
**Disabled**, Credits **Not deducted**, Auto assignment **Disabled**.

---

## 1. SQL setup

Apply on the live DB (idempotent — `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF
NOT EXISTS`; no drop/delete/truncate):

```
supabase/migrations/20260630000019_assignment_ledger_snapshots.sql
```

> If migration 019 is **not** applied, Phase 13 approval still works: the service
> detects the missing columns and saves the base record without snapshots. Recent
> Assignments then shows vendor IDs/counts instead of names. Apply 019 for the
> readable view.

---

## 2. Test Recent Assignments after a Phase 13 approval

1. Admin → **Lead Distribution → Assignment Approval Preview**.
2. Select a lead, pick 1–3 eligible vendors, **Approve Assignment Preview**.
3. Switch to the **Recent Assignments** tab (or click **Refresh**).
4. The new record appears with the lead name/city/category, selected vendor
   names, status badge, n8n badge, approved-by, and created time. **View details**
   opens the full record (lead, approval, vendors, side effects, event summary).

API check:

```bash
curl -s --cookie "$ADMIN_SESSION_COOKIE" \
  http://localhost:3000/api/admin/lead-assignments/recent | jq '.assignments[0]'
```

---

## 3. Verify no side effects

- The detail drawer and the panel legend show WhatsApp / Vendor notification /
  Credits / Auto assignment all **Disabled / Not deducted**.
- `side_effects` in the record stays `{ whatsappSent:false, vendorNotified:false,
  creditsDeducted:false, leadAutoAssigned:false }`.
- `databaseWritten` = `preview_approval_record_only`. No `lead_assignments` row is
  created.

---

## 4. Verify n8n called or not called

- **Phase 12 switch OFF** (or env Lock 1 OFF): the record shows **safe mock mode**
  and `n8nWebhookCalled=false`; status stays **Preview saved**.
- **Phase 12 switch ON (preview)** with env Lock 1 ON: the record shows **n8n
  preview called** and `n8nWebhookCalled=true`; status becomes **Sent to AOS
  Preview**. The n8n `lead.assignment_approved` branch runs (preview only).

The stored `event_response` (visible via the detail endpoint) records
`runtimeAutomationEnabled`, `runtimeAutomationMode`, `mockMode`, and the gate
`reason` — no secrets.

---

## 5. Rollback steps

1. **Hide the panels:** revert the Lead Distribution tab wiring in
   `components/admin/AdminSectionPage.tsx` (point Recent/Failed/Logs back to a
   placeholder) and redeploy.
2. **Stop saving snapshots:** revert the snapshot additions in
   `leadAssignmentApprovalService.ts`; approval still works (base record only).
3. **Remove the code:** delete the Phase 14 files listed above.
4. **Database:** the new columns are additive and safe to leave. The migration
   performs **no** destructive SQL. Remove manually in a maintenance window only
   if required.

---

## 6. Safety confirmation

Recent Assignments now reads from `lead_assignment_approvals`. Failed Assignments
shows a clean empty state unless a record records a safe failure. Distribution
Logs are read-only. The Vendor Eligibility Checker uses the shared
`vendorEligibility` helper. **No WhatsApp, no vendor notification, no credit
deduction, no auto-assignment** — everything remains preview-only.

---

## Test plan (end-to-end)

1. Keep Phase 12 switch **OFF**.
2. Approve an assignment preview.
3. Recent Assignments shows the new record.
4. Record shows `n8nWebhookCalled=false` and **safe mock mode**.
5. Turn Phase 12 switch **ON (preview)** locally (env Lock 1 ON too).
6. Approve another assignment preview.
7. Recent Assignments shows `n8nWebhookCalled=true` (**n8n preview called**).
8. The n8n `lead.assignment_approved` branch runs (preview only).
9. Turn Phase 12 switch **OFF** again.
10. Confirm no WhatsApp, no vendor notification, no credit deduction, no
    auto-assignment in any record.
