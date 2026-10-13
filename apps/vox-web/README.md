# VOX-01 independently deployable staff web — source-only

Own Next.js 16 app, own lockfile, standalone Docker image, runtime non-root, loopback-only stage port and resource limits. Not imported into the Core root web app or Jarvis runtime.

**Production access fail-closed**: the source shell does not implement a login route, nor any privileged data API. Production home renders only an access-hold page; the graphical workspace is LOCAL PREVIEW ONLY (development mode + VOX_DEMO_PREVIEW=local-only). The server binds 127.0.0.1 for local development. The stage Compose service has a named disabled profile; no deployment performed.

The public health endpoint returns the generic marker source-shell-only and no health secrets. There are no vendor rows, API tokens, credits, inbox messages or live integration data in this app. Source lock is intentional until external staff authentication and Core-verified staff identity, MFA and object scope are certified.

Before any public VOX route, implement a hardened same-origin login and CSRF/origin validation, fresh Core server-validated staff grants, per-city/per-vendor/per-prospect ABAC, audit trail, strict CSP, origin protection and negative test suite. DO NOT use browser-supplied roles, user_metadata or a shared Superadmin token. Do not route vox.quickfurno.in away from DNS placeholder 192.0.2.0.

Prepare only: npm ci, npm test, npm run typecheck, npm run build. Compose stage resource controls are provisional, not a certification of production headroom.
