# QF Pune Launch — Homepage Round 2 (branch `pune-launch-ready`)

Plain-language guide to what changed and the 3 things Keshav does by hand.

## What this branch changes

1. **Enquiry form feels like 3 short steps.** The one long form is now grouped
   under numbered headings — 1 Your project, 2 Project details, 3 Your contact —
   and the name/phone fields moved to the END, so visitors describe the project
   before being asked for a phone number. It is still one form (no Back/Next):
   the step-gated wizard is deliberately forbidden by CI
   (`scripts/ui/validate-mobile-form-focus.mjs`, checks 15–17) because the old
   wizard broke mobile typing. This gets the conversion benefit without
   re-opening that bug.
2. **Partial lead capture.** As soon as a visitor completes section 1
   (service + city + area), an anonymous draft is saved to a new `lead_drafts`
   table — no name, no phone, no GPS, ever. It upgrades when section 2
   completes and is marked `converted` on real submission. Rows that never
   reach `converted` are your drop-offs: which services/areas people wanted
   but didn't submit. Requires the migration below; until it is applied the
   feature silently does nothing.
3. **Hero service picker now works.** Picking a service in the hero bar
   pre-fills it in the modal (it used to be ignored).
4. **Real-photo slots.** Drop real project photos into
   `public/assets/quickfurno/images/real/` (exact names in that folder's
   README) and the hero + service cards switch from illustrations to photos on
   the next deploy. No code change.
5. **Small fixes.** Removed the "View All" link that pointed to itself.

(Round 1, already on this branch's history: mobile hero/logo fixes, verify /
FAQ / areas / vendor-CTA sections, featured real-vendor strip, footer cleanup.)

## The 3 manual steps

1. **Apply the migration** (Supabase → SQL editor, or your usual migration
   flow): run `supabase/migrations/20260921100000_qf_lead_drafts.sql`.
   Safe: new table only, RLS on, no policies (service-role access only),
   nothing else touched. The site works fine before it's applied.
2. **Add real photos** to `public/assets/quickfurno/images/real/` — start with
   just `hero.jpg` (a strong One Decore project photo, landscape, under
   250KB). This is the single biggest visual upgrade available.
3. **Add real testimonials** to `TESTIMONIALS` in `lib/homepage-content.ts`
   (name + one-line quote from real clients — WhatsApp thank-you messages are
   perfect). The section renders however many exist; the honesty rule in that
   file means we never invent them.

## Checking drop-offs later

In Supabase SQL editor:

```sql
select stage, service_category, city, area, count(*)
from lead_drafts
group by 1, 2, 3, 4
order by count(*) desc;
```

`stage = 'project'` or `'details'` rows are enquiries that stopped before
sharing a phone number.
