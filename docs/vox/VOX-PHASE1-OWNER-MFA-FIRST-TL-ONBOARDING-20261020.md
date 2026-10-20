# VOX Phase 1 Priority B — Genuine Owner MFA + first neutral Team Leader onboarding

## Current protected Staging state (read-only 20 Oct 2026)
- **One real Auth user** with one trusted Core `profiles.role = admin` and Auth `app_metadata.admin_role = Superadmin` (do not duplicate Owner identity).
- **One session; 0 verified MFA factors; 0 unverified factors.** No second Staff Auth user yet.
- No VOX schema installed in managed Staging. First Team Leader membership and governance RPCs exist ONLY as quarantined/native candidate SQL, not operational.

## Owner's genuine user-driven MFA enrollment (prepared source; NOT DEPLOYED)

RC1 child branch adds `app/admin/security/mfa/page.tsx` with `OwnerMfaSetup`. The page is server-disabled unless **both** `VOX_DEPLOYMENT_ENV=staging` and `VOX_OWNER_MFA_STAGING_ENABLED=true`, then checks the existing trusted server `getAdminSession()` (Core Superadmin only). The server additionally pins `NEXT_PUBLIC_SUPABASE_URL` to exact protected QuickFurno Staging project `https://uckafzuochmbvtiodmcl.supabase.co`, preventing accidental use with Production even if switches are copied. These switches must not be enabled until independent AppSec review of this page and authorized protected Staging deployment. No new Auth service, no service-role key in browser.

At the approved time, the **actual Owner** signs in using the existing Supabase-backed Core Admin login, visits `/admin/security/mfa`, clicks Start TOTP enrollment, scans a QR using their own authenticator app and enters the 6-digit code **personally in the browser**. The component calls Supabase `auth.mfa.enroll({ factorType:'totp' })`, `auth.mfa.challengeAndVerify({factorId,code})`, `auth.mfa.getAuthenticatorAssuranceLevel()` and `auth.mfa.listFactors()` on the same existing user. It only displays a success state after Supabase returns `currentLevel='aal2'` **and** confirms a `verified` TOTP factor. If already enrolled but AAL1, the user completes the existing factor challenge instead of enrolling a duplicate. No TOTP QR or secret is copied into Git, assistant messages, logs, Notion or an external reviewer request. This process cannot be completed from a DBA SQL query or from synthetic JWTs.

**Important:** Supabase Auth Dashboard MFA TOTP settings must allow enrollment/challenge/verification (verification disabled blocks both); verify on the protected Staging provider before enabling the page. Supabase Auth may invalidate other sessions when a factor is verified; Owner must be prepared to sign in again. If an enrollment remains unverified after abandonment, owner reviews their Auth factors; do not bulk delete factors or bypass existing MFA.

## First Team Leader: separate neutral Staff identity (approved bootstrap ONLY)

1. Independent AppSec reviewer and DBA approve the exact RC1 SHA, review key custody, first Team Leader bootstrap target and reviewed VOX SQL install/rollback. Cursor's technical report **does not become a human signature**.
2. Owner and independent reviewer approve first **neutral, separate, real Staff Auth account**. Never create a second Superadmin, never use Owner identity for Team Leader, and never grant staff leadership based on an untrusted browser role parameter.
3. After approved schema install and named identity approval, use the existing **Core Supabase Auth** invitation method through authorized Superadmin workflow. The invited user personally accepts and establishes their own login. No plaintext passwords or OTPs are shared with the assistant or Cursor.
4. The actual Team Leader enrolls and verifies **their own** authenticator through approved Staff UI/Auth flow and proves current Auth AAL2. Approver checks current Core active team membership, city/department scope and non-revocation through signed Core method; no SQL manual edits or forged auth.jwt claims.
5. A genuine independent authorized reviewer signs the *exact* first TL appointment digest with a trusted pinned key. The existing two-person review RPC must validate Owner and distinct TL plus consent, role, freshness and exact digest. DO NOT run privileged bootstrap/role grants with one Admin pretending to be two people.
6. Audit immutable proof of the two separate sessions (redact token/secret), enrollments, team/department and permission revocation; exercise AAL1 deny and session sign-out/expired JWT denies before enabling workflows.

**Not done:** No human MFA enrollment, no Staff Auth invite, no first TL identity/approval, no applied VOX database migration or operational Staging E2E has happened. The UI is a staging-gated source candidate, not a live portal.

Official Supabase documentation:
- https://supabase.com/docs/guides/auth/auth-mfa
- https://supabase.com/docs/reference/javascript/auth-mfa-enroll
- https://supabase.com/docs/reference/javascript/auth-mfa-challengeandverify

**Release status: HOLD until real DBA/AppSec approval and first TL genuine AAL2.**
