# Vendor WhatsApp OTP / private verification evidence contract — 4 November 2026

**Status: SOURCE-ONLY DESIGN; NO LIVE OTP OR DOCUMENT STORAGE IN THIS BATCH.**

## A. Reuse existing authentication and message transport

QuickFurno ALREADY has a signed Supabase Send SMS HTTP Auth Hook, raw-body Standard Webhooks authentication, bounded payload reading, a five-second deadline, a WhatsApp client-login OTP delivery orchestrator, authentication ledger and kill switches. There is also separate authenticated-vendor phone verification. **Do not build a second OTP generator, custom JWT minting or duplicate WhatsApp gateway.**

The existing hook is currently bound to client_login_otp. It cannot automatically serve the vendor login purpose; that risks confusing a vendor phone login with a homeowner client account. Keep new vendor OTP delivery OFF until a safe separate server-authoritative purpose route exists.

### Vendor OTP implementation contract

1. Normalize vendor mobile to Indian E.164 +91; apply shared pre-Auth per-number/IP/device throttle, resend cooldown and bot safeguards.
2. Create a server-only, short-lived vendor OTP purpose reservation keyed by a hashed phone and unguessable nonce. Make it atomic and reject conflicting client/vendor simultaneous purposes. Never treat browser user_metadata, purpose, verified or user_id as trusted authorization.
3. Initiate Supabase Auth phone signInWithOtp on the server (WITHOUT the Twilio-only channel=whatsapp flag). Supabase generates the OTP and owns the later session. New principal remains neutral.
4. The existing signed Send SMS hook must verify the raw webhook signature, check that the internal vendor reservation is valid, and route through an independently disabled-by-default vendor_login_otp Authentication template/WhatsApp provider gate. The existing client branch must retain its own policy and template. No queue, no campaign or blind fallback.
5. Verify via Supabase Auth verifyOtp with type=sms. Check signed Auth user ID, matching confirmed phone, a fresh protected vendor_login_otp delivery attestation, matching verified webhook ID and same authenticated subject. Use the pure guard in lib/identity/vendorWhatsappOtpAdmission.ts, but require a server-side DB read; never allow the browser to supply attestation.
6. Reject any claim on an existing client, admin, staff or conflicting role. Verify the vendor's canonical account-ownership mapping before making or reusing a vendor row. Invalidate the local session on any failed post-verification check.
7. Successful verified signup creates exactly one Pending, inactive, not-public vendor row with consent receipt and optional GST, and no lead/credit/payment/provider-message side effects. Returning login uses the same verified principal.
8. Certify replay, expired/wrong OTP, wrong number, double tabs, simultaneous client/vendor login, Meta uncertain outcome, hook timeouts, SIM swap and lost-number recovery in managed Staging.

**Already implemented by this source batch:** Pure admission policy and seven positive/negative tests. **Not implemented:** vendor-purpose reservation DB/RPC, vendor OTP send/verify service, login UI, approved Meta vendor Authentication template, live provider configuration or session canary. Never mark WhatsApp OTP operational just from these tests.

### Provider dependencies

Supabase phone sign-in enabled; phone auto-confirm disabled; signed Send SMS Auth Hook configured to protected endpoint; valid hook secrets and five-second timeout; approved Meta Authentication template and India delivery entitlement; operational kill switches, rate limits, monitoring, recovery and policy sign-off.

## D. Private identity and office evidence — target data design

DO NOT reuse public vendor portfolio bucket. Proposed separate private migration (not applied):
- Vendor verification cases: vendor foreign key, versioned case state, identity, office, contact, category and zone reviews, reviewer principal, timestamps and expiry.
- Vendor verification evidence: case reference, type, private storage key, content digest, malware scan state, uploader identity, retention/deletion time; never a public URL or raw Aadhaar stored in public vendors.
- Append-only verification decisions: signed Owner reviewer, before/after states, reasons and evidence refs.
- Separate consent receipts: Aadhaar versus alternative identity option, purpose, notice version, acceptance or withdrawal and verifier. Business registration consent is not Aadhaar consent.

**Approval gate:** Verified WhatsApp mobile alone does not prove identity or office. Require documented consent-based Aadhaar offline verification OR an accepted lawful alternative. Require current business or home/on-site office proof. Revalidate independent Google Place Details, city/zone, approved active category and coverage. The Owner-only VOX UI calls existing canonical Core APIs. A verified evidence predicate must be enforced in Core and final DB assignment authority, not just a visual checkbox. Missing/expired/rejected evidence blocks Approved, Active, accepting_leads and paid matching.

**Storage:** private encrypted documents, time-limited download rights, allowlisted MIME/magic-byte/size, malware scan, no EXIF or address leaks, RLS, viewer audit and enforceable retention/deletion. PAN not separately collected; GSTIN optional without standalone PAN extraction.

## B/C currently implemented source fixes

- Public vendor registration input no longer carries user_id. Canonical server account registration supplies trustedContext.verifiedAuthUserId. The old anonymous legacy action is disabled rather than leaving unlinked applications. The old email/password action fails closed by default, with only a separate explicit internal rollback/canary env flag; no rollout is authorized.
- Legacy password path validates required phone, email, business, active city and location before Auth creation; independent pre-Auth phone/email rate budgets supplement the existing Core registerVendor limit. The owner decided WhatsApp-only final signup; THIS LEGACY EMAIL PATH MUST NOT BE MISREPRESENTED AS COMPLETE OTP AUTH.
- Sensitive development vendor payload logging and raw Auth error disclosure removed.
- New consent migration explicitly SHA-pinned in strict no-deployment-authorization ledger. It must be independently reviewed and applied in managed Staging BEFORE dependent source rollout.

## Release gates and non-goals

G0: WABA Authentication template and signed vendor-purpose-routing design proved.
G1: CI and exact migration hash/order passes; managed Staging application with RLS/rollback.
G2: Actual Meta WhatsApp OTP -> Supabase signed session -> one Pending vendor and returning login canary; all negatives pass.
G3: Private compliant identity/office evidence and Owner-only VOX review gates, no missing-evidence approval.
G4: Controlled capture-only Pune pilot with auto-assignment OFF and no live paid leads.
G5: Finance, credits and three-vendor assignment independently certified; explicit Owner production activation.

No source batch in this document enables paid assignments, official EOD, campaigns, automated messaging or unrestricted Production vendor enrollment.

References:
- https://supabase.com/docs/guides/auth/phone-login
- https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook
- https://uidai.gov.in/pa/ovse
- https://github.com/quickfurno-maker/quickfurno-marketplace/pull/484
