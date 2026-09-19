# QF Vendor Reviews — Deployment Certification

Date: 2026-09-19

## Authority

Canonical migration: `20260919010000_vendor_review_system.sql`

Canonical SHA-256: `30f85cf0cee2b0b1b3cbd825194af586fd44950f0a56e009750f1308161edb65`

The migration creates `public.vendor_reviews` as the server-written review authority. A verified review links to an existing QuickFurno vendor, lead, and lead assignment. New submissions enter `pending`; only `approved` rows may contribute to public rating/count and public review cards. The review table stores no client phone number.

Direct table privileges are revoked from `PUBLIC`, `anon`, and `authenticated`. RLS is enabled. The `service_role` holds SELECT, INSERT, and UPDATE for the server-controlled submission/moderation path.

## Staging deployment

Project: QuickFurno Staging (`uckafzuochmbvtiodmcl`).

An isolated, version-preserving temporary migration workspace was built from the remote-applied history plus only the review migration. The pre-apply dry run listed exactly one migration:

`20260919010000_vendor_review_system.sql`
The exact migration was applied once with Supabase CLI `db push` from that isolated workspace.

Independent post-apply migration history contains 45 rows and ends with `20260919010000 vendor_review_system`.

Post-apply verification:
- RLS enabled: true
- anon SELECT / INSERT: false / false
- authenticated SELECT / INSERT: false / false
- service_role SELECT / INSERT / UPDATE: true / true / true
- transactional rollback smoke: a real existing lead assignment could create a pending review row without leaving test data behind

## Production deployment

Project: QuickFurno (`yqpgcsduqbxulrlzwzap`).

The production isolated-workspace dry run observed 52 existing remote migration versions and listed exactly one pending migration: `20260919010000_vendor_review_system.sql`.

The exact migration was applied once. Independent post-apply history contains 53 rows and ends with `20260919010000 vendor_review_system`.

Production post-apply verification:
- RLS enabled: true
- anon SELECT / INSERT: false / false
- authenticated SELECT / INSERT: false / false
- service_role SELECT / INSERT / UPDATE: true / true / true
- review rows immediately after migration: 0

No fabricated review, rating, testimonial, or production client row was inserted as part of deployment.
## Application behavior certified in source

The application submission service verifies the supplied phone against an existing QuickFurno lead and then verifies an assignment from that lead to the reviewed vendor. The phone is used for verification only and is not stored on the review row.

Admin moderation supports pending, approved, rejected, and hidden states. Pending/rejected/hidden reviews do not affect public aggregates.

The public vendor service derives review count and average only from approved `vendor_reviews` rows. The legacy 4.2 fallback and hard-coded `reviews: 0` path are removed from the real public-vendor flow.

The public vendor profile exposes an approved-review section and a verified review submission form. Listing cards and review sorting consume only approved review aggregates.

## Safety conclusion

This deployment did not replay `20260621000006_superadmin_foundation.sql`, did not resurrect its unrelated legacy tables, and did not apply any other source-pending migration. Both database applies were exact-one dry-run verified before execution.
