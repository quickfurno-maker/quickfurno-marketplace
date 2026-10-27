# VOX AB-3 Staff Web — Domain work integration (review HOLD)

Actual `/team/work-queue` adds a separately gated, read-only department lane using the new default-off Core `GET /api/vox/v1/ab3-domain-work`. One existing verified Staff MFA session and pinned HTTPS Core origin are reused; no second Staff Auth system. Display never asks browser to select a department or sends full Bearer to the browser.

Strict server-only adapter `apps/vox-web/lib/ab3Domain.ts` requires `VOX_AB3_DOMAIN_WEB_ENABLED=staging`, existing portal stage flags and scoped/dual mode. Validates Core schema, exact response keys, items and departments, denied actions, bound 25 rows, incomplete workload and no invented SLA or credit data. Shows explicit 401/403/503 locked messages, never fake events.

QA: `node apps/vox-web/scripts/validate-ab3-domain.mjs` executes the compiled TypeScript projection in isolated stubs and verifies exact success plus 11 forged cases, disabled flags and page wiring. `npm test`, `npm run typecheck` and `npm run build` pass in isolated Web worktree; browser smoke pending combined final QA. Real protected staging Staff AAL2 and Core API tests remain pending; production not activated. Cursor independent review deferred.
