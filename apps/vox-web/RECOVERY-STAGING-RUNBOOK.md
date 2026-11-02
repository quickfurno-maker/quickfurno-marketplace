# VOX staff account recovery — private staging candidate (15 October 2026)

**RELEASE HOLD. DO NOT ENABLE, EMAIL REAL STAFF, OR CHANGE SUPABASE AUTH URLS YET.**

This adds a separately gated staged recovery option to the standalone VOX web
application. It does NOT modify Core or Supabase managed database schemas,
grant staff privileges, invite anyone, or authorize deployment.

## Security and ownership

- `VOX_PASSWORD_RECOVERY_ENABLED=disabled` by default. Both this flag and
  `VOX_STAFF_PORTAL_ENABLED=staging` must be explicitly configured for the
  endpoint to do anything.
- The recovery request accepts one bounded email field from a browser with
  exact pinned Origin and Host; it uses Supabase Auth's recovery email flow.
  Account existence is not returned. **Before activation, independent WAF
  rate limits, email quotas and enumeration tests are mandatory.**
- Callback `GET /auth/callback?code=...` is valid only on the trusted public
  `vox.quickfurno.in` Host and uses server-side Supabase PKCE
  `exchangeCodeForSession`. Arbitrary `next` URLs are not accepted. The
  PKCE verifier cookie alone is SameSite Lax to support top-level email
  navigation; established Auth session cookies remain HttpOnly SameSite Strict.
- A 10-minute HMAC recovery-intent cookie binds the original email to the
  verified Supabase identity; a separate 10-minute user-bound HMAC cookie
  permits the account password update. Both use an independent 32-byte
  base64url signing key from a secret manager. No key is committed.
- The completion API requires exact browser Origin, a genuine Supabase user
  session and the signed user-bound cookie, consumes the browser cookie
  before attempting `auth.updateUser` and signs out after a successful
  update. **This is a short-lived signed browser authorization, not a
  durable database-enforced exactly-once nonce:** concurrent replay and
  long-lived JWT revocation require separate live testing and risk signoff.
- No page exposes session JWTs or persistence keys to JavaScript; passwords
  are sent only to the same-origin server route and are not logged here.
- All user-facing recovery pages also render a locked message when
  staging recovery is disabled.

## Mandatory activation dependencies

1. Review and merge the independently approved Core/VOX source PR and exact
   signed immutable VOX image; the VPS inert template is not a running service.
2. Deploy into an **isolated, approved STAGING** runtime with TLS to
   `https://vox.quickfurno.in`, configured Traefik and Cloudflare protections,
   stage-only publishable Supabase key (NEVER service-role) and Core URL.
3. Supabase Staging (`uckafzuochmbvtiodmcl`) must allow exactly
   `https://vox.quickfurno.in/auth/callback` under Authentication → URL
   Configuration before any messages. Do NOT replace the shared Staging
   `Site URL` currently set to localhost without separate Auth impact review.
4. Verify recovery email template uses the Supabase-generated confirmation
   link, the server-created PKCE verifier and correct browser/session behavior.
   Email mailboxes opened in a different browser may lose the PKCE verifier;
   the user should request and open the link in the same browser.
5. Provision a 32-byte CSPRNG key privately in the staging secret manager as
   `VOX_RECOVERY_SIGNING_KEY`. Do not publish it in Git, Notion, logs or chat.
   Rotate on incident; rotation invalidates outstanding tickets.
6. Enforce tested WAF / Auth email-recovery request rate limits, no staff
   account enumeration, no open redirects, valid TLS and short referrers.
7. Using **synthetic approved Staging accounts only**, test correct link,
   expired/wrong browser, mismatched email, tamper, replay/racing requests,
   password-reset result, Supabase Auth logout/old-session invalidation,
   subsequent TOTP AAL2, scope/city/grant/revocation and human takeover.
   Require independent owner + security signoff before flipping the flag.
8. Keep production and unrelated providers untouched until staged rollback and
   audit evidence are independently approved.

## Offline reproducible checks

```bash
cd apps/vox-web
npm test
npm run typecheck
npm run build
node scripts/smoke-standalone-origin-12b.mjs
```

The recovery ticket's pure HMAC verification has unit tests covering purpose,
identity mismatch, tampering, expiry, wrong key, malformed tokens and
exactly bounded lifetime. The standalone HTTP test checks that recovery sends,
updates and callbacks are **all unavailable** while disabled. These tests are
NOT confirmation of genuine Supabase email delivery or staging recovery.

**Current status:** SOURCE TESTED, RUNTIME DISABLED, NOT STAGING CERTIFIED.
