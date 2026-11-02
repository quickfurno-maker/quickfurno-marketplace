# VOX-05 staff two-person review: atomic, non-activating foundation

**Source-only migration, NOT applied to live Staging or production.**

Depends on reviewed VOX-03 staff-team/membership/object-scope tables. Adds service-role-only `vox_staff_access_requests_v1` and append-only `vox_staff_access_decisions_v1`, both FORCE RLS and no browser grants. Every request has unique nonce, specified staff subject/team, role or exact object target, reason and expiration. Pending state is the only initial state.

`qf_vox_review_staff_access_v1(request_id,reviewer_id,expected_revision,APPROVE|REJECT,decision_ref)` is an atomic, row-locked, audited **review-only RPC**: checks the reviewer against trusted Supabase `auth.users.raw_app_meta_data.admin_role='Superadmin'` plus active Core `profiles`; rejects reviewer being requester or target, stale revision, duplicate/replay, invalid decision or expired grant; appends the review receipt and increments revision transactionally. Execution privileges are revoked from PUBLIC/anon/authenticated and allowed only to service_role. **Approval deliberately DOES NOT WRITE ANY MEMBERSHIP OR PER-OBJECT GRANT TABLE.** There is no grant-activation endpoint or direct browser control.

A real Core HTTP caller must still verify reviewer token with Supabase `auth.getUser()`, assure `aal2` and derive reviewer ID from trusted response, **not browser JSON**, before calling this service-role-only RPC. Mandatory second-gate grant finalizer must check the reviewed request, subject/role/scope/city and exact version and write the actual grant+audit atomically. **That finalizer is NOT created by this batch.** Hence even approved requests cannot authorize staff yet.

## Verified local disposable SQL test
Network-disabled `postgres:16-alpine` with synthetic profiles, cities and Supabase auth.users fixtures; both prerequisite VOX-03 migration and new VOX-05 review SQL executed. Marker:

`VOX_05_APPROVAL_DISPOSABLE_POSTGRES_PASS review=APPROVED audit=1 applied_grants=0 forced_RLS=2 replay_denied=true self_denied=true wrong_role_denied=true browser_denied=true`

The test checks positive distinct-Superadmin decision, durable one-decision ledger, **no automatic scope issuance**, replay/stale rejection, self-review denial, non-Superadmin reviewer rejection and authenticated browser inability to invoke the RPC. Container was removed after test.

**Not yet certified:** real Staging schema, Supabase Auth user/2FA session, Core identity-bound approval HTTP, delegated admin manager permissions, active staff grant finalizer, revocation UI and end-to-end authorization. No live effect.
