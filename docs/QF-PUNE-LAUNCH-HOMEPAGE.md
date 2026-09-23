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
2. **Hero service picker now works.** Picking a service in the hero bar
   pre-fills it in the modal (it used to be ignored).
3. **Real-photo slots.** Drop real project photos into
   `public/assets/quickfurno/images/real/` (exact names in that folder's
   README) and the hero + service cards switch from illustrations to photos on
   the next deploy. No code change.
4. **Small fixes.** Removed the "View All" link that pointed to itself.

(Round 1, already on this branch's history: mobile hero/logo fixes, verify /
FAQ / areas / vendor-CTA sections, featured real-vendor strip, footer cleanup.)

## Asset rule

Only publish photos with documented QuickFurno ownership or publication rights. Never remove a watermark or publish a provenance-unknown image.
