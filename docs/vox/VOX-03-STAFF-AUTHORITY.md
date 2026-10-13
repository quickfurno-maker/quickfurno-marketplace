# VOX-03 Staff authority — Core-owned, deny-by-default

**Source implementation complete for review; NOT APPLIED to Staging/Production.** This branch stacks on PR #201 (which stacks on #199). Database-backed staff membership, teams, explicit per-object grants and append-only grant/audit are new only where schema inspection found no existing VOX staff tables. Existing Supabase Auth and `profiles` remain the sole identity records, existing `cities`, `marketplace_service_zones`, Aarohi, Vendor CRM, support and communication tables remain canonical.

## New source migration

`20261014010000_vox_v1_scoped_staff_authority.sql` provisions four tables:
1. `vox_staff_teams_v1`: canonical `cities.id` FK, city-scoped team; **default inactive**.
2. `vox_staff_memberships_v1`: verified `profiles.id`, one team and scoped role; **default inactive**, nonexpired, revoke field.
3. `vox_staff_object_scopes_v1`: explicit scoped UUID grants for prospect/vendor/support_thread/conversation, expiry, revocation and reason, no duplicate active grant.
4. `vox_staff_grant_audit_v1`: append-only provenance slot with actor, staff, approval reference and unique request ID; service role has **no update or delete grant**.

All tables have RLS ON and FORCE, no anon/authenticated direct access, service-role-only back-end table access. **No provisioning API or arbitrary team/grant create endpoint included**, so activation is held until Core approval and staff provisioning workflow are reviewed and tested. No superadmin auto-provisioned by migration.

## Auth contract and narrow endpoint

`GET /api/vox/v1/my-work` requires a real Supabase Auth `getUser(Bearer)` result, nonexpired and AAL2 JWT matching that verified Auth user, active Core admin `profiles` row, active nonexpired staff membership, active team, active canonical `cities` row, a maximum of 200 active grants and exact object IDs. Staff cannot provide a role, city, vendor or prospect in body/query. Staff city comes from trusted team. Aarohi records use canonical `aarohi_prospects.city_id`. Vendor CRM records additionally intersect explicit vendor grants with **Core `vendors.service_zone_id` → `marketplace_service_zones.city_id`** (zone must remain active). Support cases require **both** a thread grant and an authorized vendor grant. HUMAN-state WhatsApp requires both an explicit conversation grant and an exact scoped prospect/vendor identity, never client/Riya, AI-owned or provider message bodies. All views are bounded ≤8, sanitized and no-store; POST/PATCH/PUT/DELETE return 405.

Role matrix here is intentionally restrictive: acquisition agent has prospect only, vendor-success agent has assigned vendor/support/human, support agent has assigned vendor/thread/human, operations_manager is still *object-scoped*, auditor has read-only metadata and no human/support content. No implicit role-wide data access. **Owner Superadmin uses separately existing read gateway**; these staff grants do not expand owner's permissions.

## Rollout requirements (not met)
- [ ] Review source migration with DBA; Staging backup, restore proof and migration tracking.
- [ ] Apply only to isolated Staging, then verify schema, RLS, FORCE, all direct grants, anonymity and tenant isolation.
- [ ] Build *Core-only* approved staff team/grant provisioning with dual approval, immutable audit and unique request idempotency. No manual service-role grant from VOX browser.
- [ ] Test real Supabase Auth AAL2 for owner and delegated staff, profile revocation and factor revocation (no browser-generated verified role), same signed Staging Core and VOX projects.
- [ ] Independent synthetic real HTTP role/city/vendor/prospect/thread/conversation/expired token/expired grant/replay/IDOR tests.
- [ ] Confirm canonical city↔zone↔vendor relations on representative cells and expose no cross-city mapping loopholes.
- [ ] Test staff self-service TOTP enrollment, support provider/service window and Core outbox; no send until atomic approval.
- [ ] Signed isolated Staging artifact, exact host origins/cookies/CSRF, WAF/origin controls, memory/concurrency and rollback.

**No public DNS cutover and no deployment**, pending all gates. All sensitive writes remain under canonical Core authority; no new WhatsApp sender, account balance modification, vendor activation or AOS/AGNI action.
