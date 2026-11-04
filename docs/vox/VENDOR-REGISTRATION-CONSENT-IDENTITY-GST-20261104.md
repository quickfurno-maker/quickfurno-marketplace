# Vendor registration — Consent, GST and identity policy (4 November 2026)

**Scope:** Existing public `/vendor?mode=signup` wizard and canonical Core `registerVendor` only. No new second portal, no staff functionality and no premature matching/payment. Draft code only until Staging migration and approved release.

## Owner decisions and legally safe implementation

- **PAN: removed from the entire active public vendor signup/verification journey.** Source inspection found no PAN inputs in the current wizard, canonical vendor signup API or active vendor verification flow; do not introduce PAN. This does not authorize erasing mandatory statutory finance/tax records outside the vendor onboarding domain.
- **Identity verification: required before marketplace approval.** Owner requested Aadhaar-only mandatory identification. UIDAI guidance for private Offline Verification Seeking Entities says Aadhaar offline verification is **voluntary** and an equivalent non-Aadhaar alternative must exist. Therefore **Aadhaar must not be the sole mandatory credential**. Approved provider consent-based Aadhaar secure QR or offline e-KYC is an optional preferred identity method; an appropriately verified passport, driving licence, voter ID or other lawful equivalent is an alternative. Both require Owner review, and an application remains Pending until verification. A raw 12-digit Aadhaar number, scan, biometrics, OTP or Aadhaar token must **never** be collected in public registration, logs or `public.vendors`. UIDAI information: https://www.uidai.gov.in/images/FAQ_OVSE.pdf, https://uidai.gov.in/pa/ovse.
- **Office verification: required before activation**; Google Place selected in public signup is only a candidate. Owner performs server-side Place Details/zone verification and separately reviews proof of business location such as signed lease, utility bill in business name, Shop Act registration or other appropriate current proof. Store documents in restricted private storage with limited roles, expiry, malware scanning, access logs and deletion/retention policy. Current public form only captures typed address and a Google-selected place; **no file upload is deployed**.
- **GSTIN: optional** on Step 5. Empty allowed; nonempty must match a 15-character uppercase Indian GSTIN format. Format check is **not** GST enrollment verification; verify active/legal name status using official GST mechanisms during Owner review. No GSTIN is invented for nonregistered service providers.

## Source patch

- Reuses existing public 5-step signup wizard and `submitVendorAccountRegistration` (not the unused legacy `VendorApplicationForm`).
- Adds optional GSTIN on review, explicit unchecked privacy notice checkbox, identity verification disclosure with alternatives.
- Server action verifies consent/GST **before** creating any Supabase Auth principal. Service revalidates both.
- Server writes normalized optional GST and accepted notice revision `2026-11-04-v1` plus server timestamp to the **same vendor row**, ensuring consent exists whenever a new vendor record exists. New columns are additive, nullable for legacy data. Migration `20261104090000_vendor_registration_consent_receipt.sql` **must run before source deployment**; never pretend missing columns can be bypassed.
- New applications are `Pending`, `verification_status=Pending`, `is_active=false`, `accepting_leads=false`, `public_visibility=false` and `paid_status=Unpaid`. Approval, activation, verified Google office/zone, category evidence, Auth ownership and purchased credits remain separately governed.
- Existing account action currently sets `email_confirm: true` in Supabase Auth Admin API. **This does not prove mailbox ownership**. Before unrestricted real registration, add a verified email or phone proofing step, or explicitly justify human-assisted verification; do not claim email OTP was tested. Current form password minimum length is only 6 characters; consider 10+ and secure account recovery policy.
- Public `submitVendorRegistration` legacy action also requires consent in canonical Core. The unused `VendorApplicationForm` was updated to provide optional GSTIN and explicit consent as a defensive compatibility fix; **no active route mounts** this legacy component.

## QA and acceptance gates

1. Unit/source policy tests: missing consent, invalid GST, blank GST, normalized GST, no PAN/Aadhaar upload, Pending/inactive status, audit receipt, route reuse, migration RLS.
2. Existing canonical vendor source regression, migration SQL review, TypeScript compilation and deployment checks.
3. Managed Staging: schema migration with RLS and signed rollback, then one isolated consenting vendor signup with unique approved test identity under permitted test policy; verify exactly one Auth principal and one vendor row, receipt, office Place ID candidate, status Pending/inactive and no external messaging/credit/assignment. Verify duplicate phone/email, rate-limit and invalid consent/GST rejects with **zero new principals**.
4. Public release: reviewed Staging → Production, browser mobile and desktop, field-by-field form validation, optional GST, Google suggestions/place selection, network failure/retry, admin inbox Pending, subsequent Owner verification and account activation. No paid lead matching until separately certified.
5. Identity verification implementation remains a **subsequent Owner-only secured gate**, not a public signup upload or current code capability; the required method is Aadhaar with separate consent **or** viable alternative. Provider and legal retention approval needed.

**Status:** Source patch/test in-progress; not yet deployed. Do not mark live vendor registration E2E certified.
