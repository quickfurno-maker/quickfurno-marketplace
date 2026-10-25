# QuickFurno Production TEST-only cleanup — governed immutability review packet
**Phase:** 3B-17 • **Date:** 25 October 2026 • **Decision:** Production DELETE HOLD • **Scope:** 29 test vendors (27 Pune, 2 Mumbai), 74 test leads; test-only linked records • **No managed writes from this PR**

## Evidence pinned before designing any exception
1. Fresh Production `pg_dump` custom-format archive: **4,879,114 bytes**, SHA256 `5EEAEC9949485E839126285EE2FF29E67363404BF8ABCDF063D9848A0161E797`. Four database schemas public/auth/storage/supabase_migrations. SHA and TOC verified. **Not** a full physical, global-role, PITR, Supabase Storage binary or Auth-service backup.
2. Actual isolated JARVIS PG17 UTF8 restore: **21 affected tables**' table data restored successfully; exact vendor/lead/assignment counts and checked referenced records. Scratch-only replacement of unsupported PostGIS-generated fields and one Auth enum was necessary. **Not** all FK/trigger/roles/ACLs restored.
3. Live read-only schema checks counted **66/66 FK links** and **82/82 named lead/vendor/assignment reference columns**; 73 lead_assignment_events and 36 assignment_operations have nonempty RESTRICT references, 81 credit logs are not all FK-protected; TEXT/JSON outbox references and retention require further governance.
4. Live source trigger `trg_lead_assignment_events_immutable` invokes `qf_prevent_lead_assignment_event_mutation()`, whose exact production SQL raises `QF_LEAD_ASSIGNMENT_EVENTS_IMMUTABLE` on ANY DELETE, regardless of role. `trg_lead_assignment_events_no_truncate` blocks TRUNCATE. UPDATE of lineage prohibited; only SET NULL for assignment_id/operation_id back-references allowed.
5. Nine dedicated test-vendor-linked Auth IDs, nine identities, eight sessions and nine profiles; one other Auth user. Protect Owner and staff. Auth Admin lifecycle/session revocation is separate and cannot be represented as raw SQL DELETE.
6. New isolated scratch PostgreSQL17 rehearsal **PASS** using **actual immutable function bodies extracted from `supabase/migrations/20260723000500_qf_mvp_assignment_universal_enforcement.sql`**: 29 synthetic vendors, 74 leads, 73 events and 36 assignment operations. Attempted event DELETE, UPDATE and TRUNCATE are rejected with exact expected trigger error; vendor and lead DELETE fail FK; allowed assignment FK SET NULL preserves event lineage. No trigger disabled and no Production access. Generated from source using `scripts/scale/step3b17-immutable-negative-generate.mjs`; local PG17 run script and network-none Docker CI runner provided.

## Architecture options (recommendation requires separate authority)
**Option A — operationally archive-in-place, NOT deletion:** Keep immutable events and their referenced TEST vendor/lead roots, disable test vendor eligibility through existing governed controls, and exclude/test-tag all historic TEST records in admin/client analytics through a reviewed policy. Reversible, preserves event lineage, but leaves the 29/74 records and any PII in Production: do **not** report it as a purge or meet data-deletion obligations by relabeling. Not authorized for live execution in this branch.

**Option B — independent exceptional deletion with prior audit preservation (proposed for true cleanup):** Security/DBA/Owner define a legally permitted narrowly scoped one-time amendment to immutable history protections, preserve authentic event evidence and canonical attribution in a separately access-controlled immutable archive with independently verified hashes, row counts and original UUID mappings. Scope strictly the already approved TEST UUID allowlist. Require tamper-evident custody, explicit retention policy, no dependence on active vendor/lead identities, reproducible PostGIS+Auth-aware clone, no live worker/outbox activity, stable transaction guards, independent code review and a complete rollback/restore exercise. Exact SQL/schema exception design **not yet specified or approved**; any future exception is a high-risk separate migration/release and cannot be merged into this PR.

**Option C — isolate the old Production project read-only and provision a clean project:** Preserves the original immutable ledger without deleting its rows. Requires new Auth integration, secrets, DNS, storage, Jarvis/VOX/Finance connections, signed worker routing, provider callbacks and active project billing/access; not a quick delete and requires a separate cutover program. Old records remain on archived project.

### Immediate disposition
Since the user requested actual deletion rather than an archive-in-place label change, **Option B should only advance to an independent design review**, not be silently implemented. A and C are alternatives requiring a separate Owner decision, not approvals already given. An internal second-pass review can improve the packet but is not an independent DBA/AppSec signoff.

## Review acceptance contract (P0, unsigned)
- [ ] Signed choice of A, B or C; if B, approved authority for an immutable-history test-only exception and evidence retention.
- [ ] Confirm all 29 vendors/74 leads and their 73 events are TEST-only; robust UUID manifest (encrypted off-repo), not city-only filters; no genuine financial/provider records.
- [ ] Define and test retention of event IDs, timestamps, vendor/lead ID mapping, original signatures/hashes and payment/audit obligations.
- [ ] Document roles and privileges for archive read/write, RLS and leak/rollback controls; no public SECURITY DEFINER execution grants.
- [ ] Verify fresh full-project recovery, extension-enabled database clone, actual FKs/triggers/Auth lifecycle, storage binaries/PITR/role-ACL.
- [ ] Verify 9 Auth accounts' ownership outside this business, 8 active sessions and revocation through supported Supabase Admin/identity path; Owner and other user unaffected.
- [ ] Ensure internal tasks/queues/WhatsApp/payment/credit services do not recreate, emit or charge during cleanup.
- [ ] Independently rehearse exactly scoped cleanup against the extension-capable snapshot with FK, trigger and JSON/opaque references preserved.
- [ ] Independent DBA and AppSec review, then **separate final Owner Production approval** tied to a pinned SHA, tested rollback and exact count guards.

## Certification language
**Completed:** source proof, read-only SQL/relationship audit, selected-table backup restoration, local PostgreSQL immutable-history negative test and CI hardening.

**Not completed:** independent design review or exceptional migration, full Supabase recovery certification, protected Auth deprovisioning, Production cleanup, first genuine Pune vendor cohort or live lead/credit canary.

**Hard invariant:** never disable protected triggers, drop FKs, set replication role, truncate, fake history, or use emergency superuser privileges merely to make the deletion pass. Current Production data remains 29 test vendors and 74 test leads. Separate VOX/Finance protected release remains HOLD.
