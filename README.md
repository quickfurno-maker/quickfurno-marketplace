# QuickFurno — Verified Interior & Carpentry Lead Portal

A prepaid lead-credit marketplace. Homeowners submit a project; the system matches
them to **at most three** verified local studios. Studios buy prepaid lead packs and
spend **one credit per assigned lead**. Run out of credits and you're auto-paused
from public listings.

Stack: **Next.js 14 (App Router) · Supabase (Postgres + Auth + Edge Functions) · Tailwind**.
Brand preserved: Deep Navy `#0A2471` / Gold `#FFB909`, Raleway split-weight wordmark, Fraunces display.

---

## What's in here

```
app/
  layout.tsx · globals.css        brand shell (fonts, tokens)
  page.tsx                        landing — the 1 -> 4 matching thesis
  enquiry/                        homeowner funnel: form -> pick studios -> matched
  pricing/                        lead packs (from DB)
  vendors/register/               partner application (creates account + pending studio)
  login/                          studio & admin sign-in (role-routed)
  vendor/                         studio dashboard (guarded)
  admin/                          ops dashboard (guarded)
  actions.ts                      "use server" — all guarded entry points
components/                       Brand, LeadFunnel, dashboards, forms
lib/                              supabase clients · errors · types
services/                        lead · vendor · package · admin (call the RPCs)
middleware.ts                    refreshes the Supabase auth session
db/                              source SQL (001 tables · 002 RLS · 003 seed · 004 functions)
supabase/
  migrations/                    same SQL, timestamped for `supabase db push`
  functions/whatsapp-dispatch/   Edge Function: sends queued WhatsApp messages
  _local_test/                   local Postgres test scripts (not for prod)
```

---

## Setup

**1. Database** — paste `db/*.sql` into the Supabase SQL Editor in order
**001 -> 002 -> 004 -> 003**, or `supabase db push` (migrations are pre-ordered).
> These replace any earlier v1 schema — apply these only.

**2. Create the first admin** — sign up a user, then in SQL:
```sql
update public.profiles set role = 'admin' where id = '<that-auth-user-id>';
```

**3. Environment** — copy `.env.example` -> `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # server only — never exposed to the browser
```

**4. Run**
```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck  # strict, clean
npm run build
```

**5. WhatsApp (optional, for live notifications)**
```bash
supabase secrets set WHATSAPP_TOKEN=... WHATSAPP_PHONE_ID=...
supabase functions deploy whatsapp-dispatch
```
Schedule it to drain queued messages. Until configured, messages queue in
`whatsapp_logs` — nothing is lost.

**6. Expiry cron**
```sql
select cron.schedule('quickfurno-expire','0 2 * * *',
  $$ select public.expire_vendor_packages(); $$);
```

---

## The flows

**Homeowner** — `/enquiry`: submit -> de-duped & saved -> see eligible studios
(safe fields only) -> pick up to 3 -> `assign_lead_to_vendors` RPC fills to a hard
cap of 3, deducts one credit each atomically, queues WhatsApp to client + studios.

**Studio** — `/vendors/register` -> pending -> admin approves -> admin credits a pack
-> goes live. `/vendor`: see assigned leads with contact, move pipeline status, report
a bad lead within 24h (admin approval refunds the credit).

**Admin** — `/admin`: live stats, approve/reject/suspend studios, confirm a manual
payment and credit a pack in one click, resolve bad-lead reports.

---

## Security

- Service-role key used **only** in server code; credit/assignment RPCs are revoked
  from anon/authenticated and granted to `service_role`.
- RLS everywhere: public sees only approved + visible + credited studios; studios see
  only their own assigned leads; client phone numbers are never publicly readable.
- Server actions re-verify role (`requireAdmin` / `requireVendorOwner`).

## Verified

SQL applied to live PostgreSQL 16; full credit flow tested (hybrid fill to 3,
per-vendor deduction, auto-delist at zero, no double-assign, all error guards,
bad-lead refund). TypeScript passes `tsc --strict`. `next build` compiles all routes.
