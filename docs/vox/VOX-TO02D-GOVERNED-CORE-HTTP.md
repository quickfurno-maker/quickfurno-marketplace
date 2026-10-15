# TO-02D — Core HTTP bridge for reviewed staff department capabilities

**DRAFT source candidate, completely OFF.** Only Core's server-side `adminClient` can invoke candidate SQL RPCs; neither the VOX browser nor agents receive service-role credentials. No staff user, capability or database record has been created in managed Staging/Production.

## API `POST /api/vox/v1/staff-department-actions`
Requires BOTH `VOX_STAFF_GRANTS_ENABLED=staging` and **new** `VOX_DEPARTMENT_ACTIONS_ENABLED=staging` on Core, otherwise immediate 503. The SQL RPCs are a separate **NON-DEPLOYABLE** candidate under `ops/vox/sql-candidates` in draft PR #267.

- `request`: existing verified Core Superadmin with current genuine bearer and AAL2 only. Strict target/team UUIDs, one pack, reason, bounded lease and nonce. Returns new Core pending request, no grants.
- `review`: separately verified Core AAL2 neutral Team Leader with exact team scope. Only approved/rejected request at revision zero, no activation.
- `activate`: independently reviewed request revision one, existing verified Core Superadmin, SQL locks the request/membership and checks reviewer still valid. Returns capability ID, **zero object grants**.
- `revoke`: Core Superadmin, revision two, SQL locks capability and appends durable event, no communications.
- Response never includes staff contact, Auth tokens or cross-entity records.

**Required before enabling:** review the complete request→decision→activation→revoke SQL against real source PostgreSQL 17; verify actor IDs are actually obtained from **remote Supabase Auth AAL2**, not browser field. Role/city/subject Core authorization must intersect current membership and per-object grants (a department alone confers no client/vendor access). Set up audited, server-only neutral Auth invitation through separate approval. Independent GitHub reviewer + DBA recovery signoff and real stage rollback still HOLD.

Existing `vox_staff_memberships_v1.staff_role`, two-person legacy grants, vendor fair matching and Jarvis consent/handover remain unchanged. Real runtime is **NOT certified** by Node source pattern tests.
