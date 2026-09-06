# QF-MVP-82A-R0 — Staging deployment certification

**Verdict: APPLIED TO QUICKFURNO STAGING, EXACTLY ONCE. NOT APPLIED TO PRODUCTION.**

This document records the staging deployment of the QF-MVP-82A-R0 Realtime
publication migration and the independent read-only verification that followed
it. It is evidence, not authorization: it grants nothing and applies nothing.

---

## 1. Identity

| Fact | Value |
|---|---|
| Phase | QF-MVP-82A-R0 (deployment certified by QF-MVP-82A-R0-S1) |
| Foundation PR | #74 — WhatsApp inbox Realtime publication foundation |
| Merge commit | `40af4124c11c862e68c59203f853b6032f3cbd5e` |
| Migration | `20260904000000_qf_mvp_82a_r0_whatsapp_inbox_realtime_publication.sql` |
| Migration SHA-256 | `9bfcd2ed3b6a58976ad5d237d1ca63bf2f0a86ac6dd75aef1ce9267ef7b68e18` |
| Target | QuickFurno **Staging**, project ref `uckafzuochmbvtiodmcl` |
| Production | `yqpgcsduqbxulrlzwzap` — **FORBIDDEN, NOT ACCESSED, NOT APPLIED** |

No secret, password, CLI access token, service-role key, database URL or
connection string appears in this document or in the manifest record it backs.

---

## 2. Why an isolated workspace

The repository working tree contains a second SOURCE-PENDING migration —
`20260903040000_qf_mvp_80_14a_meta_lead_assignment_production_activation.sql`,
the only authority that can turn real outbound WhatsApp on in production. A
`db push` from the repository would have offered **both** unapplied migrations,
and the operator's protection against applying the wrong one would have been
care rather than structure.

The apply was therefore performed from an isolated temporary workspace
containing only the R0 migration, linked specifically to the staging project.
The 80.14A file was proven **absent** from that workspace before anything ran
(`Test-Path` → `False`), so applying it was not merely undesired but impossible.

---

## 3. Pre-apply state

- The workspace was linked to project ref `uckafzuochmbvtiodmcl`.
- The copied migration's hash was proven to equal
  `9bfcd2ed3b6a58976ad5d237d1ca63bf2f0a86ac6dd75aef1ce9267ef7b68e18` — the exact
  source-controlled file, byte for byte.
- Remote migration history was aligned through `20260817000000`.
- The only local-only migration was
  `20260904000000_qf_mvp_82a_r0_whatsapp_inbox_realtime_publication.sql`.

## 4. Exact-one dry run

```
DRY RUN: migrations will *not* be pushed to the database.
Would push these migrations:
 • 20260904000000_qf_mvp_82a_r0_whatsapp_inbox_realtime_publication.sql
Finished supabase db push.
```

Exactly one migration in the plan. **No `20260903040000` appeared.**

## 5. Exactly one apply

```
Applying migration 20260904000000_qf_mvp_82a_r0_whatsapp_inbox_realtime_publication.sql...
Finished supabase db push.
```

One migration applied. One time. No second apply is authorized by this phase.

## 6. Independent re-list

An independent migration re-list immediately afterwards showed the local and
remote versions in agreement:

```
20260904000000 | 20260904000000
```

and **still no `20260903040000` remote row**.

---

## 7. Independent read-only post-apply verification

Performed separately against staging (`uckafzuochmbvtiodmcl`). Read-only
throughout: `SELECT` only, no write of any kind.

### A. Migration history

- `20260904000000` exists **exactly once**, named
  `qf_mvp_82a_r0_whatsapp_inbox_realtime_publication`.
- `20260903040000` **does not exist** in staging migration history.

### B. Publication

| Fact | Observed |
|---|---|
| `pubname` | `supabase_realtime` |
| `puballtables` | **`false`** |
| Members | `public.communication_inbound_messages`, `public.communication_messages` |

**Exactly two tables.** No other communication table is a member —
`communication_delivery_events` and `communication_webhook_receipts` were
deliberately not published, and are not present.

### C. Row level security

| Table | `rls_enabled` |
|---|---|
| `public.communication_inbound_messages` | **`true`** |
| `public.communication_messages` | **`true`** |

### D. API-role grants

`information_schema.role_table_grants` for `grantee in ('anon','authenticated')`
on both communication tables returned **zero rows**.

**Publication membership did not create browser read authority.** That was the
central claim of the R0 review, and it is now observed rather than argued: the
tables replicate to a server-side subscriber holding service-role credentials,
and remain unreadable by the API roles a browser can use.

---

## 8. What this phase did NOT do

- **No production access.** The production project was not connected to, not
  queried, and not applied to. Its R0 status remains *not applied, not proven*.
- **No further migration apply.** `20260903040000` (QF-MVP-80.14A) remains
  unapplied to staging **and** to production, its hash unchanged, and still
  behind its own separate deployment gate. R0 being applied says nothing about
  it and must never be read as promoting it.
- **No database mutation** beyond the single migration itself: no row inserted,
  updated or deleted, no backfill, no trigger, no grant, no policy change.
- **No Meta call. No WhatsApp message sent.** Publication membership is a
  replication concern; it carries no send capability.
- **No application, inbox, webhook or provider code changed.**

---

## 9. Staging verdict

**CERTIFIED.** QF-MVP-82A-R0 is applied to QuickFurno Staging exactly once,
publishing exactly the two intended WhatsApp communication tables, with
`puballtables` false, RLS intact on both tables, and no access granted to `anon`
or `authenticated`.

Production deployment of R0 remains a separate, gated, unperformed action.
