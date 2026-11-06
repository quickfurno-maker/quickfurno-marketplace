# F2 — Real vendor signup frontend, isolated from the inherited integration stack

Date: 6 November 2026. Branch `integration/qf-f2-vendor-ui-20261106`, based exactly on [Draft Core PR #504](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/504) SHA `089900829040a56644f47fdd22616eca0db6bc4a`, with [VOX Owner PR #503](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/503) below it. **NO DEPLOY.**

## Source and actual changes

Reused **four** scoped frontend paths originally from source SHA `f7ffbc1dbf1f9165c7818d2cfb767be33e238c73`: three are source-exact and the canonical registration wizard has one separately SHA-pinned, reviewable success-screen overlay. No inherited Staff/Finance app, scripts or migrations were imported:

- `app/vendor/page.tsx` — update public vendor portal steps, FAQ and SEO to WhatsApp verification; existing vendor login remains available.
- `components/VendorRegisterForm.tsx` — retain the existing premium five-step business/category/Google Places/strength/review wizard; remove new-vendor password creation and require OTP request then atomic pending registration. Optional email/GST, affirmative privacy consent; exact Google Place/city selection, no GPS/typed-address eligibility bypass. **Reviewed overlay:** after successful Pending registration, do not send a WhatsApp-only new vendor to the legacy email/password login that cannot authenticate them. The success view now states that WhatsApp dashboard sign-in needs separate certification and links safely to QuickFurno's homepage.
- `lib/vendors/vendorSignupUi.ts` — strict OTP acknowledgement: 202 only means initiation, not confirmed delivery. Entry length 6–8 ASCII digits; file selection and strictly Pending private intake ACK.
- `components/vendor/VendorPrivateEvidenceForm.tsx` — only office/category evidence sent as private multipart with consent; reject raw Aadhaar/PAN card uploads, public URLs, forged approval response or automatic matching activation. Any unscanned file stays Pending until independent scan/review and is not Owner-approved.

`/vendors/register` still redirects to `/vendor?mode=signup`; existing vendor login remains intact. `VendorApplicationForm` is unmounted in production pages and was *not* copied. The reviewed Core endpoints from PR #504 own validation, Auth session and SQL transaction authority. There is no public finance/lead activation in this PR.

## Real tests performed on JARVIS

- Source verifier `scripts/mvp/launch/verify-vendor-frontend.py` pins exact donor SHA-256 of all four UI files, matches the Core base SHA and refuses deployment/provider/scanner/Staff authorization.
- Original donor UI contract **6/6 PASS** and restored in isolated branch, no provider delivery assumption.
- Hostile F2 source tests **10/10 PASS**: file drift, untrusted WhatsApp delivery claim, Google Place bypass, password-action reintroduction, incorrect new-vendor login link, scanner/GO forgery, bookmark break and unrelated Core/Staff code changes.
- Complete Marketplace `npm run typecheck` **PASS** and optimized `npm run build` **PASS**; source code only.
- Production-build loopback smoke using stub `http://127.0.0.1:9` Supabase public endpoint and deliberately nonfunctional public key: **8/8 HTTP checks PASS**. The real compiled `/vendor?mode=signup` and existing login respond 200; old bookmarks redirect 307; OTP initiation, signup, private evidence and both Owner review endpoints refuse unapproved operations with 503. No managed service credentials, provider sends or DB writes.
- Dedicated read-only GitHub PR workflow repeats all tests on exact SHA. No image publication, migration, external provider send or Staging/Production deploy permitted.

## Release dependencies / honest scope

1. **Google Places:** location component is reused and demands an exact suggestion; actual Google account billing/restrictions/project activation still needs Owner provider-side work. A local test does not certify live Google autocomplete.
2. **Meta WhatsApp:** signed Supabase Send SMS Hook, approved Meta Authentication template, real delivery receipt and replay/hot/cold failures must be certified in managed Staging before switching OTP gates. The user-facing form correctly reports it unavailable in the meantime.
3. **Core and VOX:** verify all seven installed SQL checksums against actual Staging; signed/pinned Core+VOX image pair; real protected Owner AAL2 and vendor session E2E; private bucket/scan receipt/rollback. **Newly identified critical dependency:** phone-verified Pending accounts do not possess credentials for the legacy email/password vendor dashboard. Build and certify returning-vendor WhatsApp OTP login and protected dashboard membership before any production vendor recruitment.
4. **ClamAV on hold:** scans/approval remain disabled until explicit final F5 certification; never treat uploaded evidence as verified or award credits/leads.
5. **Staff Train B:** preserved and independently QAed, activation remains separate. No Finance/Studio import into this release.

**Decision: SOURCE VERIFIED locally / REVIEW HOLD.** Even successful CI cannot authorize managed deployment, unverified OTP delivery or document approval. Production launch still requires actual first client-vendor contact QA and Owner GO.
