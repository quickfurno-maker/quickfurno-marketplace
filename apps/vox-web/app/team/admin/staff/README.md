# TO-02 Admin Staff Setup — visual planning only

User-approved structure: one **Admin** (existing Core Superadmin identity) and **Staff** (neutral Auth profile). Team Leader is a scoped staff capability. The same Staff login can have multiple approved department packs.

This draft only renders capability options obtained via `fetchAdminStaffCapabilityCatalog()`, which in turn requires the existing verified VOX Auth AAL2 session **and** the Core owner-only `GET /api/vox/v1/staff-capability-catalog`. The Core endpoint is in a separate stacked draft PR #263.

## What exists
- Responsive Admin team setup page `/team/admin/staff`, gated by VOX portal flags and exact Core Superadmin catalog response. Not visible in main Team navigation unless Admin check succeeds.
- Multi-select department preview: Client Success/Riya, Vendor Success/Anisha, Acquisition/Aarohi, Service Desk. Local in-memory UI state only.
- Independently validated capability keys and stage-only Core response; no browser access to service-role secrets.

## Deliberately not implemented yet
- No real Add Staff account creation, email collection, Auth Admin invitation or password enrollment.
- No Core persistent department memberships, row-level grants, approval mutation, team transfer, outbound send or EOD report.
- Create/invite button is disabled. No fake staff identity or simulated submission success.

## Next real integration gates
1. Review Core membership/approved-grants schema and stage restoration before adding department table and atomic review/activation.
2. Add owner-only staff roster and verified team/city picker (not user-typed IDs), then protected invitation and capability request with separate Team Leader review and Core finalizer.
3. Isolated PostgreSQL concurrency tests, neutral Staff MFA AAL2, cross-city IDOR, immediate revoke and provider send-denial.
4. Protected signed staging image/independent reviewer. Release remains HOLD.

The existing Core team grants remain the sole source of truth until the extension has its own safe migration and review.
