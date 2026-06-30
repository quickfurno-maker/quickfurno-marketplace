# Phase 12 — Admin-Controlled AOS / n8n Activation Switch

Goal: let a **Superadmin** enable/disable AOS → n8n event forwarding from the
admin dashboard, **without editing `.env.local` every time**.

This phase adds **Lock 2** (an admin runtime switch) on top of the existing
**Lock 1** (server environment flags). Both locks must be ON before any event
is forwarded to the **n8n Master Preview Router**.

```
Production n8n webhook (preview only):
https://quickfurnonew1.app.n8n.cloud/webhook/quickfurno/aos/events
```

---

## Safety contract (unchanged side effects)

Everything below stays **disabled** in this phase, regardless of the switch:

- ❌ No WhatsApp sending
- ❌ No vendor notification
- ❌ No credit deduction
- ❌ No auto-assignment of vendors
- ❌ No real WhatsApp credentials
- ❌ No Supabase write nodes in n8n
- ❌ No secrets exposed in the UI (no webhook URL, no `QF_N8N_SECRET`)
- ✅ Public website UI unchanged
- ✅ Lead form submission + Supabase lead creation unchanged
- ✅ Default runtime switch is **OFF**

When the switch is ON in `preview` mode and both env locks are ON, QuickFurno
sends a **safe, masked, side-effect-free preview event** to the n8n Master
Preview Router. Nothing else changes.

---

## Two-lock model

| Lock | Where | Requirement |
| --- | --- | --- |
| **Lock 1** (env) | VPS / server env | `N8N_ENABLED=true` **and** `N8N_OUTBOUND_WEBHOOK_ENABLED=true` |
| **Lock 2** (runtime) | Supabase `aos_runtime_settings` | row `aos_n8n_master_router` `enabled=true` **and** `mode='preview'` |

`shouldCallN8n = Lock1.bothEnabled && runtime.enabled && runtime.mode === 'preview'`

If **either** lock is OFF → AOS processing continues in **mock/preview mode**
and `n8nWebhookCalled = false`. If the runtime row is **missing**, the reader
returns a safe **OFF** default and lead submission is never blocked.

Mode values: `off`, `preview`, `production_locked`.
For now only `off` and `preview` are usable; `production_locked` is shown as
disabled / coming soon and is rejected by the API.

---

## Files changed / added

- **DB migration:** `supabase/migrations/20260630000016_aos_runtime_settings.sql`
- **Runtime reader/writer (server-only):** `lib/aos/runtime/aosRuntimeSettings.ts`
- **Dispatch gate:** `lib/aos/events/safeAgentEventPipeline.ts` (two-lock check + new response fields)
- **Side-effect report:** `lib/aos/events/n8nEventTypes.ts` (added `vendorNotified`)
- **Admin API:** `app/api/admin/aos-runtime-settings/route.ts` (GET + POST, Superadmin only)
- **Admin UI:** `components/admin/AosAutomationControl.tsx` rendered inside
  `components/admin/AdminSectionPage.tsx` → `AutomationsPage`
  (route: **/admin/automations**, "AOS / n8n Automation Control").

---

## 1. Supabase SQL setup

Run this on the **live DB** (Supabase SQL editor). It is idempotent and
**non-destructive** — `IF NOT EXISTS` for the table and a safe
`ON CONFLICT DO NOTHING` upsert for the default row (an existing admin-chosen
value is never overwritten).

```sql
create extension if not exists "pgcrypto";

create table if not exists public.aos_runtime_settings (
  id uuid primary key default gen_random_uuid(),
  setting_key text unique not null,
  enabled boolean not null default false,
  mode text not null default 'off' check (mode in ('off', 'preview', 'production_locked')),
  description text,
  updated_by text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.aos_runtime_settings is
  'Admin-only AOS runtime switches (Lock 2). RLS enabled. No secrets stored here.';

create index if not exists idx_aos_runtime_settings_setting_key on public.aos_runtime_settings(setting_key);
create index if not exists idx_aos_runtime_settings_updated_at on public.aos_runtime_settings(updated_at desc);

alter table public.aos_runtime_settings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'aos_runtime_settings'
      and policyname = 'aos_runtime_settings admin all'
  ) then
    execute 'create policy "aos_runtime_settings admin all" on public.aos_runtime_settings for all to authenticated using (public.is_admin()) with check (public.is_admin())';
  end if;
end $$;

-- Default row: OFF. Safe upsert preserves any existing admin value.
insert into public.aos_runtime_settings (setting_key, enabled, mode, description)
values (
  'aos_n8n_master_router',
  false,
  'off',
  'Controls QuickFurno AOS event forwarding to n8n Master Preview Router.'
)
on conflict (setting_key) do nothing;
```

Verify:

```sql
select setting_key, enabled, mode, updated_at
from public.aos_runtime_settings
where setting_key = 'aos_n8n_master_router';
-- expect: enabled=false, mode='off'
```

---

## 2. Local test plan

Start the app locally:

```bash
npm run dev
```

### Case 1 — env ON + admin switch OFF → mock

`.env.local`:

```
N8N_ENABLED=true
N8N_OUTBOUND_WEBHOOK_ENABLED=true
```

Admin switch: **OFF** (default). In the dashboard go to
**Admin → Automations → AOS / n8n Automation Control** and confirm Lock 2 is OFF.

```powershell
# PowerShell
$body = '{"event":"lead.created","lead_id":"qf_test_local_1","source":"phase12-local"}'
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/aos/events" -ContentType "application/json" -Body $body | ConvertTo-Json -Depth 6
```

```bash
# bash
curl -s -X POST http://localhost:3000/api/aos/events \
  -H "content-type: application/json" \
  -d '{"event":"lead.created","lead_id":"qf_test_local_1","source":"phase12-local"}' | jq
```

**Expected:**

```
n8nWebhookCalled = false
mockMode = true
runtimeAutomationEnabled = false
runtimeAutomationMode = "off"
sideEffects.whatsappSent = false
sideEffects.vendorNotified = false
sideEffects.creditsDeducted = false
sideEffects.leadAutoAssigned = false
sideEffects.databaseWritten = false
```

### Case 2 — env ON + admin switch ON (preview) → n8n called

Keep `N8N_ENABLED=true` and `N8N_OUTBOUND_WEBHOOK_ENABLED=true`.
In the dashboard, toggle **Enable AOS → n8n Preview Routing = ON**, set mode
to **Preview**, and click **Save**. (Requires `N8N_WEBHOOK_URL` set in env and a
listening n8n preview workflow.)

Re-run the same POST.

**Expected:**

```
n8nWebhookCalled = true
mockMode = false
runtimeAutomationEnabled = true
runtimeAutomationMode = "preview"
sideEffects.whatsappSent = false   (and all other side effects false)
```

> If `N8N_WEBHOOK_URL` is missing or the preview workflow is not listening, the
> webhook fails **safely**: `n8nWebhookCalled=false`, `mockMode=true`. The lead
> pipeline never breaks.

### Case 3 — admin switch OFF again + real local lead form

In the dashboard set the switch back to **OFF** and Save. Then submit the **real
local lead form** on the website.

**Expected:**

- Lead form works.
- Supabase insert works (row created in `leads`).
- n8n is **not** called (`n8nWebhookCalled=false` in server logs / event echo).

---

## 3. VPS test plan

Keep the n8n preview router safe (preview-only; no WhatsApp/Supabase write nodes).

1. On the VPS, temporarily set env and reload:

   ```bash
   # add to the server env (NOT committed; e.g. PM2 ecosystem env or shell export)
   N8N_ENABLED=true
   N8N_OUTBOUND_WEBHOOK_ENABLED=true
   # N8N_WEBHOOK_URL + QF_N8N_WEBHOOK_SECRET already configured server-side
   pm2 restart quickfurno --update-env
   ```

2. **Admin switch OFF first.** Submit a test event:

   ```bash
   curl -s -X POST https://<your-domain>/api/aos/events \
     -H "content-type: application/json" \
     -H "x-qf-n8n-secret: <QF_N8N_WEBHOOK_SECRET>" \
     -d '{"event":"lead.created","lead_id":"qf_test_vps_1","source":"phase12-vps"}' | jq
   ```

   **Expected:** `n8nWebhookCalled=false`, `mockMode=true`.

3. **Turn admin switch ON (preview)** in the dashboard → Save. Submit again.

   **Expected:** `n8nWebhookCalled=true`, and the event appears in the n8n
   Master Preview Router execution log — with **no** WhatsApp/vendor/credit/DB
   side effects.

4. **Turn admin switch OFF after the test** and Save. Confirm `n8nWebhookCalled`
   returns to `false`.

---

## 4. Rollback steps

Any one of these returns the system to safe mock mode:

1. **Fastest (no deploy):** Admin → Automations → set the switch **OFF** → Save.
   Lock 2 is now OFF; n8n is no longer called.
2. **Env (Lock 1):** unset `N8N_ENABLED` / `N8N_OUTBOUND_WEBHOOK_ENABLED`
   (or set to `false`) on the VPS and `pm2 restart quickfurno --update-env`.
3. **DB level:**

   ```sql
   update public.aos_runtime_settings
   set enabled = false, mode = 'off', updated_at = now()
   where setting_key = 'aos_n8n_master_router';
   ```

4. **Code:** revert the Phase 12 commit. The table can stay; with the switch
   OFF it has no effect. (Dropping the table is optional and not required — the
   reader falls back to a safe OFF default if the table is absent.)

---

## 5. Safety confirmation

- ✅ Default runtime switch is **OFF** (`enabled=false`, `mode='off'`).
- ✅ Two-lock gate: both env (Lock 1) and runtime (Lock 2) must be ON to forward.
- ✅ Either lock OFF → mock/preview mode, `n8nWebhookCalled=false`.
- ✅ No WhatsApp sending. No vendor notification. No credit deduction.
- ✅ No auto-assignment. No Supabase writes from n8n.
- ✅ No secrets in the UI/API responses (webhook URL and `QF_N8N_SECRET` never returned).
- ✅ Lead form + Supabase lead creation untouched; public website UI unchanged.
- ✅ `production_locked` mode is rejected by the API and shown as coming soon.
```
