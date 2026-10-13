# VOX-02 Staff MFA + server-only Core read proxy

The existing standalone VOX shell now has server-side Supabase Auth email/password login, TOTP challenge for an already enrolled verified authenticator, HttpOnly Strict cookies, a staff verified AAL2 session gate, and the `/api/overview` BFF with HTTPS allowlisted Core origin. Its source only contains read-only, bounded preview views. **Feature gate defaults disabled**; no public origin or staging service deployed.

VOX Core JWT authentication requires the same Supabase project and active Superadmin user, AAL2 and Core's own `profiles` state. Other staff are refused until new scoped team/city/vendor grants are verified. The app never gets the Core service-role key. The provider worker, financial actions and Core canonical vendor state remain inaccessible. 

Current route family: `/login`, `/mfa`, `/operations`, `/api/auth/sign-in`, `/api/auth/mfa`, `/api/auth/sign-out`, `/api/overview`. Sign-in and MFA POST enforce Origin and size caps. Any route handling business data refuses calls when `VOX_STAFF_PORTAL_ENABLED` is not `staging`. Existing root `/` stays locked.

Run `npm ci && npm test && npm run typecheck && npm run build` from `apps/vox-web`. The local production HTTP smoke with the feature gate disabled returned sign-in 503, overview 503, `/operations` hold, and `/` hold. **These are source/security-negative gates, not a genuine signed-in Staging E2E.** Required before access: MFA factor enrollment/availability, staff permissions, host security, genuine Core Auth roundtrip, signed image, and rollout verification.

Do not move `vox.quickfurno.in` from Cloudflare's 192.0.2.0 placeholder yet.

## Staging-only owner authenticator enrollment (source)

The new `/mfa/enroll` page and `POST /api/auth/mfa/enroll` + `/api/auth/mfa/confirm` provide TOTP enrollment for an **already password-authenticated, email-confirmed Core Superadmin**. They use the existing Supabase Auth factor registry, not a custom OTP/memory store. Enrollment checks that no verified TOTP factor already exists; confirmation checks the factor is owned by the same session, still unverified, and requires a six-digit code using Supabase `challengeAndVerify`. The initial secret/QR is one-time user-facing only and not persisted to browser storage or server logs. Exact same-origin enforcement and the disabled-by-default staging feature gate apply to both routes.

Local security tests now total 12 existing shell + 26 staff/MFA guards, TypeScript and Next production build PASS. Disabled gate loopback HTTP: `POST /api/auth/mfa/enroll` **503**, `POST /api/auth/mfa/confirm` **503**. A successful real Supabase TOTP enrollment and full AAL2 Core read roundtrip have **not** yet been tested; do not claim authenticated staging launch readiness or enable on public origin.
