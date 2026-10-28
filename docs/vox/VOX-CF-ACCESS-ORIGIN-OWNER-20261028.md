# VOX — Cloudflare Access signed-JWT origin validation (source candidate)

Owner-only release **HOLD** for public activation. This code is not deployed or enabled by default. It hardens VOX's Next.js 16 Node.js Proxy boundary, and it does **not** replace real Supabase Auth, Owner AAL2 or the Core authoritative role checks.

## Exact design

- When `VOX_STAFF_PORTAL_ENABLED=disabled`, the locked private preview remains unchanged.
- When `VOX_STAFF_PORTAL_ENABLED=staging`, any non-health business/login route returns **503** unless `VOX_CF_ACCESS_REQUIRED=staging` and all three exact Cloudflare settings are supplied.
- Once activated, the Proxy permits only a request whose `Host` is exactly `vox.quickfurno.in` **and** whose `Cf-Access-Jwt-Assertion` is a genuine RS256 JWT signed by Cloudflare Access, whose issuer equals the pinned Team domain, whose audience equals the configured VOX application AUD, whose expiry and issued-at timestamps are valid, and whose `email` matches the Owner address.
- JWKS is obtained only from the pinned `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` location, cached and refreshed for key rotation. It never trusts `X-Forwarded-Host`, the cookie alone, user-defined JWKS URLs or plaintext email headers. Exceptions never leak token content.
- Only `/api/health`, framework static files and favicon bypass the boundary; sensitive API endpoints independently require a real Supabase session, immutable app metadata, AAL2 and Core authorization.
- The production ingress and origin must additionally be locked with strict TLS, origin-only networking/Authenticated Origin Pull or origin Access JWT checks; Cloudflare's browser login alone is insufficient to secure an exposed VPS.

## Pre-activation gates

1. Cloudflare dashboard: Copy **QuickFurno VOX** Application Audience (AUD) Tag. Verify `VOX - Authorized Staff` Include only exact approved Owner email, no Bypass, short Access lifetime. Use the actual Cloudflare One team domain from Access login.
2. Configure staging runtime `VOX_CF_ACCESS_REQUIRED=staging`, `VOX_CF_ACCESS_AUD`, `VOX_CF_ACCESS_TEAM_DOMAIN` and `VOX_CF_ACCESS_OWNER_EMAIL` only server-side. Never commit real password, JWT, cookie, OTP or recovery link.
3. Full unit tests including synthesized trusted and untrusted RS256 keys, signature, issuer/audience, expiry, matching Owner email, malformed and missing headers. Run actual signed JWT E2E in the protected staging origin **without copying token into logs**. Test direct origin bypass with no or forged Access token fails 403.
4. Approve exact release branch/commit, signed artifact, rollback, DNS/Cf Access/Traefik route, origin TLS and old/new containers. No public exposure before acceptance.
5. Only after a verified HTTPS callback and trusted Auth recovery redirect, enable password recovery under separate flags, verify real Owner Gmail mailbox, signed Supabase session and approved one-Owner identity transfer. Owner performs genuine TOTP AAL2. Other VOX SQL and Core feature activation have separate approval gates.

Source-only rollback is dropping this branch. Deployment rollback must restore the previous private routing and fail-closed Owner feature flags. Never disable the guard while Staff Portal is enabled merely to make browser sign-in work.
