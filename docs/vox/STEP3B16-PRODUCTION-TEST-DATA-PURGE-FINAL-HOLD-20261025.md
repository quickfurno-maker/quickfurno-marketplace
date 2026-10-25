# QF Production test-only data purge — final independent release gate (25 October 2026)

## User authorization, verified source and recovery
The Owner authorized removal of all QuickFurno Production TEST leads (74) and TEST vendors (29: Pune 27, Mumbai 2), plus their test-only credits, assignment and notification artifacts. This does NOT authorize breaking an immutable audit ledger, erasing genuine records, bypassing Auth, or deleting payment/security/audit evidence without the necessary governed retention review.

Fresh direct IPv6 pg_dump of public, auth, storage, supabase_migrations; 4,879,114 bytes; SHA256 **5EEAEC9949485E839126285EE2FF29E67363404BF8ABCDF063D9848A0161E797**. Independent manifest/hash/pg_restore TOC PASS. On authorized JARVIS, isolated locally bound UTF8 PostgreSQL 17 data-only restores from this exact archive passed 9/9, 15/15 (including Auth users/sessions/identities/profiles), and finally **21/21** nonzero affected tables; exact recovered counts and selected 0 orphan relationships, temporary restored PII erased and scratch server stopped. Evidence under secured backup directory: `quickfurno-production-restore-allactive-plus-20261025-evidence.json`. NOTE: local scratch omits Supabase extension-specific generated PostGIS geography and normalizes an Auth enum for data-only checks. **NOT complete Supabase restore** of PostGIS, all constraints/triggers, role+ACL+PITR, Storage binaries or complete Auth environment.

## COMPLETE read-only Production reference audit
All **66/66** FK relations targeting public.vendors, public.leads or public.lead_assignments were enumerated and individually counted against the target roots. All **82/82** named uuid/text vendor/lead/assignment reference columns inventoried and checked (including 5 TEXT-based references). Nonzero direct links include 135 delivery rows, 73 assignment events, 71 assignments, 41 client notifications, 36 assignment operations, 36 matching runs, 32 lead scores, 15 vendor notifications, eight dashboard links, six clarification requests, one bad-lead report. **Non-FK credits 81**, TEXT assignment_queue lead IDs 7, TEXT approval lead IDs 4; related selected-vendor JSON may contain additional references and requires scoped retention.

Production Auth users 10, **nine distinct test-vendor linked Auth users, nine identities, eight active/persisted sessions, nine vendor profiles**, one nonvendor Auth account. Do NOT delete Auth users or revoke sessions through raw SQL. The Owner identity must remain preserved; covered Admin Auth APIs and cross-application dependencies remain to be certified before user deprovisioning.

Current Storage object metadata returned zero rows, public.payments zero. Neither proves third-party media/finance/transport log retention is irrelevant.

## HARD STOP — append-only legal/security invariant verified from live SQL
Production has active `trg_lead_assignment_events_immutable`: BEFORE DELETE OR UPDATE FOR EACH ROW invoking `qf_prevent_lead_assignment_event_mutation()`. Its function explicitly raises:
`QF_LEAD_ASSIGNMENT_EVENTS_IMMUTABLE`, explaining **DELETE is never permitted, for any role**. A separate `trg_lead_assignment_events_no_truncate` forbids TRUNCATE. Assignment-event lead_id/vendor_id FKs use RESTRICT, with **73 linked rows**, so child-first deletion of lead/vendor roots necessarily fails. This is intentional protected event lineage, not a transient backup/connection failure. Existing code/SQL has no authorized exception path.

Therefore the actual Production purge is **NOT EXECUTABLE without a separately reviewed, security-approved immutable-audit exception + tested audit-preservation design**. Disabling triggers, dropping FKs, role escalation, TRUNCATE CASCADE, forged migration history or silently mutating event identities would directly defeat audited marketplace credit and assignment authority and is PROHIBITED in this source-only batch. This is a genuine blocking dependency; CI passing is not a substitute for approval.

## Safe next controlled work
1. Independent DBA/AppSec/Owner approve immutable ledger disposition, retention and scoped archive / provable audit trail for **only** these test UUIDs, with exact hash and rollback. Historical finance/audit retention reviewed first.
2. Test the exact approved schema/migration and deletion procedure on a genuine extension-capable, security-isolated clone with full triggers/FKs, auth roles and snapshot recovery. No direct application of draft migration to managed Production.
3. Certify Supabase full recovery (including role/ACL, PostGIS, PITR, Auth lifecycle, media/storage), plan nine dedicated test identity revocations via supported Admin APIs.
4. With final independent signoffs, recheck ROOT ID allowlist, counts, cities, no genuine signups, no outbound jobs, runtime assignment kill-switch and idempotence; controlled transaction deleting child test-only references first; postflight no orphan/non-target mutations; preserve audit and restore evidence.
5. Until then the Production test records remain on HOLD (29 vendors,74 leads); no external real vendor/lead canary or paid marketing. Protected VOX/Finance independent Production hold remains.

## Source-only fail-closed governance tests
`scripts/scale/step3b16-purge-governance.mjs` and `.test.mjs` implement a **pure, non-deploying** evidence gate. 10 behavioral tests PASS; the gate never outputs executable GO and rejects missing ledger-specific independent review, full rollback, nine Auth identity/session plan, non-test exclusion, final Owner approval and expected root-count drift. It includes no SQL DELETE, no privileged tool actions and no way to bypass the immutable trigger. Release stays HOLD.
