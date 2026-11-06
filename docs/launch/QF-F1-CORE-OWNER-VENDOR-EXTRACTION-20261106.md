# F1 — Minimal Marketplace Core + VOX Owner vendor bridge (NO DEPLOY)

**6 November 2026.** Source implementation / protected integration candidate only. Release **HOLD**. Do not enable public vendor registration, OTP send, document approval, Staff features, Finance, lead routing, managed database changes, signed image publishing or Staging/Production deployment from this PR.

## Source extraction

- Starting branch: `integration/qf-f1-core-owner-vendor-20261106`, based on isolated Owner-only host [Draft PR #503](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/503) at commit `a01ce330b199b8e5f03d336122fc4752b3116566`, rather than the inherited 1,258-commit full integration stack.
- Source reference for reused Core code: [Draft PR #502](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/502) at exact `f7ffbc1dbf1f9165c7818d2cfb767be33e238c73`. The import-closure extraction copies only reachable changed source for the eight listed endpoints, plus **the same seven November vendor migrations already reported installed in Staging**. No SQL execution.
- Eight new Core API endpoints: WhatsApp OTP request, verified pending signup, private office/category evidence, Owner signup status, Owner readiness, 20-item verification queue, Owner case/CAS decision and Owner workspace read model. No new Staff/Finance/provider-send API routes.
- A total of **38 changed Core/migration paths** in the pinned manifest: the extracted source and seven SQL files plus two narrowly reviewed legacy compatibility overlays. Per-file SHA-256, original source commit, base SHA, exact routes and migration order are recorded in `docs/launch/f1-core-owner-vendor-manifest.json`.
- Protected baseline `lib/supabase.ts` and `services/vox/verifiedStaffBearer.ts` deliberately **not imported from the candidate**, because their candidate differences add unrelated EOD/Staff functions. Existing verified Owner AAL2 logic remains intact.

## Security compatibility finding and fix

The new source contract removes browser-supplied `VendorRegistrationInput.user_id`; the old Core public and password signup actions still attempted to pass that field. Restoring the field would reintroduce caller-controlled ownership.

Instead, we explicitly split ownership in the legacy vendor service: `registerVendor(input, trustedAuthUserId)` accepts a validated **server-generated** Auth user ID only as a separate trusted argument. Both legacy server actions and the underlying service require two independent Staging-only switches (`QF_VENDOR_LEGACY_REGISTRATION_MODE=staging` AND `QF_RUNTIME_ENV=staging`) and are disabled by default. Legacy registration never activates a vendor or matching eligibility. The approved WhatsApp-first route uses a separate atomic pending-account RPC and its independent Meta/OTP gates.

This is a compatibility guard on source; **it is not permission to enable the old flow** for the pilot. It is held off during the vendor launch.

## What has actually passed

- Full JARVIS Marketplace Core TypeScript check **PASS** after resolving old `user_id` compatibility.
- Full optimized Core Next.js production build **PASS** (no Staging service changed).
- 10/10 local hostile scope tests **PASS** for SQL drift, missing/rerouted endpoint, provider flag removal, forged release switch, public owner-ID reintroduction, direct legacy bypass and unrelated Staff/Finance route changes.
- Full Staff VOX `npm test` suite **PASS**, independently, and earlier Staff source VO0–VO12 173/173 tests and full VOX production build PASS. No Staff activation.
- GitHub CI must independently validate this **exact** commit after PR publication; passing local tests is not a merge or deployment authorization.

## Outstanding gates

1. Review this Core PR and its interaction with the existing VOX Owner PR #503; verify the seven managed Staging migration hashes directly against live metadata/backup evidence and independently review SQL permissions/RLS.
2. Complete registration frontend integration, Google Places Place ID/restrictions, real Meta WhatsApp Authentication template and OTP delivery/replay tests, Supabase Auth hook, and true Owner MFA/AAL2 protected Staging testing.
3. Signed immutable Core + VOX pair, image provenance, private Storage/Auth complete recovery, real rollback and staged deployment with all business side effects OFF.
4. Only at F5, activate and certify ClamAV and resource capacity before any private-document approval. No safe scan = no vendor activation.
5. Full Vendor to exactly-three eligible vendors to first-client-contact journey, security/load/soak and explicit Production GO.

**Decision:** SOURCE VERIFIED locally / REVIEW HOLD. This branch has made no external provider send, Staging/Production write or live release.
