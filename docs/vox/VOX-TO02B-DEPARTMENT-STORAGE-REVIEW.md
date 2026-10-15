# TO-02B — additive multi-department staff schema and owner roster

**Source candidate only; no managed staging/production migration.** This branch is stacked on draft PR #263. It is not safe to activate without independent DBA/security review, exact historic staging migration reconciliation, and genuine real Staff AAL2 tests.

The proposal reuses the existing `vox_staff_memberships_v1`, `vox_staff_teams_v1` and Core Superadmin verification. It does not alter the existing single `staff_role`, nor weaken the independent Team Leader reviewer and owner finalizer.

## Source added
- `20261015010000_vox_to02b_staff_department_governance.sql`: five additive tables for request, independent decision, reviewed capability, activation and append-only events. Force RLS, no anon/authenticated direct permissions, no DELETE privileges for service role, nonce uniqueness, unique unrevoked staff/team/department capability. Actual review/activation/revoke RPCs and request-authorizer bridge are **not present**; a schema alone grants **zero** functional permissions.
- `GET /api/vox/v1/staff-directory`: exact Core-verified Superadmin AAL2, staging flags for both staff grants and directory, bounded maximum 40, city/team/role/current-state preview. NO user emails, raw client/vendor records, object grants, wallet details or invitation operations. All mutation methods 405.
- Independent Node source tests and PostgreSQL17 isolated tests. A synthetic service-role-only schema proof is not permission to access managed staging.

## Remaining integrity work before the first executable Core grant
- Future department-request/review/finalize/revoke SQL must reverify owner, neutral Staff identity, current AAL2 passed at Core bearer boundary, request/reviewer independence, exact active city/team, membership window, capability expiry, matching immutable approved pack, and audit.
- Existing Core `getVerifiedScopedStaff` resolves one staff role and scopes. It must intersect any new department grant with genuine Core per-record/agent consent permissions; **no grant by visual checkbox**.
- Owner-only staff directory is a bounded PREVIEW, not a complete paginated staff directory. Eventually use cursor pagination, exact team/city filters, neutral identity verification, soft removed account history and strict masking.
- Riya Client 360 needs a separate reviewed client subject grant type. Existing Core `OBJECT_SCOPE` / `conversation` grants currently support prospect/vendor only. Do not grant client visibility by `client_success` pack alone.
- Historical Staging 86-migration divergence remains unresolved. Never run `supabase db push` against managed environments automatically.
- External Supabase Auth Admin invitation, real staff create, enablement flags, Cloudflare, provider sends and production promotion remain disabled.

**Gate:** Only independent approved additive schema, genuine isolated Postgres replay/security tests, protected staging Auth AAL2/IDOR, owner+human reviewer and signed deployment may enable these features.
