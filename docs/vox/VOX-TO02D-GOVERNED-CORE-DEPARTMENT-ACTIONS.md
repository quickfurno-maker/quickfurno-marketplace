# VOX TO-02D — Staff multi-department governed action bridge

**Source-only / OFF by default.** Stacked atop TO-02C synthetic PG17 reviewed grants; no managed database has these SQL candidate RPCs.

New `POST /api/vox/v1/staff-departments` is a Core-only, double-gated, authenticated API with four proposed operations:

- **request**: existing Core Superadmin AAL2 user requests one pack/city/team/neutral staff membership, bounded expiry and reason.
- **review**: different Core-verified, scoped AAL2 Team Leader for the exact team; SQL denies requester, target, foreign teams, escalations and stale revisions.
- **activate**: Core-verified Superadmin, only after independent approved TL decision persisted, verified active target and team, atomic single-grant + audit.
- **revoke**: Core-verified Superadmin can revoke an exactly versioned pack grant; SQL audit and no delete.

Each RPC uses PostgreSQL row locks, unique request nonces and individual audit events. Multiple department packs are separate reviewed requests, not a magical blanket entitlement. The existing single primary `staff_role`, object scopes, verified Auth AAL2 and Core consent/handover are unchanged. A new pack alone **does not grant access to any customer/vendor/client record** until an independently reviewed `getVerifiedScopedStaff` intersection and source-specific grants exist.

**Critical limitations:** No Web write button, employee invitation, UI mutation, true end-to-end Auth staff AAL2, batch atomicity across packs, synthetic provider communication or managed staging migration. Flags `VOX_STAFF_GRANTS_ENABLED` and `VOX_STAFF_DEPARTMENT_WRITES_ENABLED` must both be explicitly `staging`, but do NOT enable before independent source/DB/rollback review. SQL migration candidates live in `ops/vox/sql-candidates` and are intentionally outside the deployable migration history.

Verify:
- `node --test scripts/mvp/vox/validate-to02d-department-api.test.mjs` — source guard only;
- TO-02C isolated PostgreSQL17 real SQL RPC checks — synthetic data;
- final staging E2E remains blocked by historic migration reconciliation, protected reviewer, real staff MFA and approved signed artifact.

**RELEASE HOLD, DRAFT, NOT DEPLOYED.**
