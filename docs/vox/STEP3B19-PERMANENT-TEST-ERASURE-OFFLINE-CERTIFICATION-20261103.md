# STEP3B19 — Permanent TEST data erasure: actual full-schema offline certification
**Date:** 3 November 2026 • **Target:** Production and Staging QuickFurno TEST-only cohorts • **Status:** Source evidence complete; managed deletion **HOLD** • **No secrets or raw personal data in this document**

## Explicit owner directive
The Owner has explicitly requested and authorized **permanent deletion**, not archive-in-place, of Pune/Mumbai TEST vendors/leads and related TEST-only records in QuickFurno Production and Staging. The Owner's approval does not authorize deletion of unrelated Owner/staff authentication, independent business configuration, outside-scope Staging canary, genuine customer data, or bypass of platform/tool security restrictions.

Permanent means both removing the LIVE rows and separately resolving residual copies in managed database backups, private test snapshots, provider/export systems, and object stores. SQL row deletion alone is **not proof of permanent erasure**.

## Evidence — verified logical archives and independent offline restores
The following input files were independently checked for bytes, SHA-256 and PostgreSQL TOC, and restored using PostgreSQL 17.6 in an isolated JARVIS Docker environment with `--network none`, no published port and READ-ONLY source archive mounts. Both `pg_restore --single-transaction --exit-on-error --no-owner --no-acl` executions exited 0.

| Archive | Size | SHA-256 | TOC items |
| --- | ---: | --- | ---: |
| Production snapshot 2026-11-03 | 4,891,678 bytes | `679457E1FEFB79FBB2996F11E3BAD6077FCE476C430FA3996F82565066BF516F` | 2,522 |
| Staging snapshot 2026-11-03 | 2,156,310 bytes | `720165400E7B8807CAFEC19D81AF9B9C606FD234A1D3B95FD6B285D996FBD1A5` | 2,535 |

These archives cover `public,auth,storage,supabase_migrations`, but DO NOT certify platform backup recovery of original roles/ACL, Vault/Auth service operation, Storage binary objects or Supabase PITR. The local verification deliberately omitted original owner/ACL, and **must not be described as full managed recovery**. Existing local and managed backup copies themselves contain TEST data and require separate retention/erasure treatment.

## Live scope (read-only census, NO managed writes)
| Check | Production | Staging |
| --- | ---: | ---: |
| Pune/Mumbai TEST vendor roots | 29 | 26 |
| Pune/Mumbai TEST lead roots | 74 | 7 |
| Lead assignments | 71 | 9 |
| Immutable lead-assignment events | 73 | 6 |
| Test-linked vendor credit logs | 81 | 6 |
| Test-linked Production Auth users | 9 of 10 Auth users | 0 of 2 Auth users |
| Outside-scope Staging vendor | 0 | **1 (canary: preserve)** |
| Recorded vendor payment rows | 0 | 0 |

Source IDs were compared with the isolated backup using sorted UUID-set MD5 **drift fingerprints**, not forensic hash signatures. Production test-vendor fingerprint `767228fc486c378f500df83af36da4b6`, test-lead `fccc2594dd5ce49bc12c590f6f9f2dff`; Staging vendor `b3437e2ec13bcc794f77783eab598749`, lead `de829b5d5c1f5e2109407805454bcbf7`. A new live census immediately before release MUST match an encrypted, exact-ID allowlist, not just city/count.

## Scratch-only deletion rehearsal — actual FK/trigger/schema; PASS
Unlike the older synthetic/selected-table tests, these were performed against two *complete restored PG17 schemas* (272 valid FKs each; all public base tables RLS enabled). The first guard-negative tests demonstrated that protected event DELETE and referenced vendor/lead deletion were correctly rejected by active triggers/FKs in both restored databases.

**Production scratch:** removed exactly 29 target vendors, 74 target leads, 73 protected assignment events, 36 assignment operations, 81 vendor credit logs and their actual FK/opaque references. Verified exact test-linked automation graph: 83 action requests, 83 jobs, 25 execution attempts, 51 transport requests deleted. **32,114 unrelated transport requests retained**. 22 test-linked communication messages and 48 downstream delivery events were removed child-first, together with verified test-only communication intents, approvals/queues, profiles, AOS traces and notifications. Final public-table target UUID scan returned **zero matches**, and vendor/lead/assignment/event/credit tables each counted zero.

**Staging scratch:** removed exactly 26 TEST vendor roots, 7 TEST leads, 6 immutable assignment events, 68 frozen campaign-audience members, 8 append-only internal notes, related CRM contacts/profiles/tasks/tags and matching/communication artifacts. Verified 70 test-linked automation actions + 70 jobs, 17 attempts and 42 transports deleted; preserved **36 unrelated actions/jobs, 42 unrelated attempts and 115 unrelated transports**. Final public-table target UUID scan: **zero matches**. The single out-of-scope staging canary remained present.

**Critical nuance:** These scratch tests required temporary no-DELETE trigger exceptions for assignment history, frozen campaign audience, append-only vendor notes, and automation history. The exceptions were performed **only inside disposable network-isolated copies**, with the triggers re-enabled before the scratch transaction committed. No production/staging trigger was disabled, no managed SQL/DDL/Auth write happened, and no live data was deleted. Postflight in both scratch databases: zero invalid foreign keys, zero disabled noninternal triggers.

These results prove that the *identified SQL dependency graph* can be erased without leaving UUID matches in the public schema. They do NOT prove that text-only personally identifiable information in unrelated records, out-of-band providers/exports, Auth API identities, snapshots, or database WAL/physical backups has been erased.

## Current production release blockers (P0)
- [ ] Independent review and approval of a separately designed **one-time, exact-ID test erasure exception** covering immutable ledger, campaign snapshots, notes, and automation history. No broad/general-purpose bypass. Do not deploy scratch SQL as a managed migration.
- [ ] Validate the new Production live census through the permitted connector before change. As of the 3 Nov evening check, the connected Production SQL service blocked even SELECT-only calls through safety controls. **Do not change connection path or route around that block.**
- [ ] Approve and verify a worker/ingestion/outbox/provider freeze, lead assignment state, protected FINANCE/VOX controls, stable transaction locks, no genuine activity, and an independently verified recovery/rollback point.
- [ ] Run approved procedure in **Staging first**, revalidate exact IDs, 1 canary survivor, 2 unrelated Auth users, unchanged non-TEST configuration and authorized trigger/ACL restore, negative protected operation tests and genuine/staff role QA.
- [ ] Run separately pinned Production operation only after Staging certification; preserve 1 non-test Auth user and configuration.
- [ ] Use supported **Supabase Auth Admin APIs** to revoke/deprovision only 9 *dedicated* Production test-vendor identities (8 sessions and 23 refresh tokens observed), never raw `DELETE auth.users`. Account cross-use and Owner exemption must be verified.
- [ ] Check WhatsApp/Meta/Jarvis/VOX queues and providers, hidden personal data without UUID keys, and Storage object content; confirm no new side effects or test data re-ingestion.
- [ ] Document managed snapshot retention/expiry and secure destruction timing for local TEST snapshots; do not claim immediate permanent disappearance from all backups.

## Safe release guidance
1. Existing `scripts/scale/step3b16-purge-governance.mjs` remains **pure advisory** and always requires a separately approved manual Production change even when input evidence is valid. Do **not** bypass it. Current immutable historical exception, original ACL/PITR/Auth/Storage recovery, worker freeze and independent DB/AppSec review are **not** certified.
2. Prioritize an approved dry-run and Staging UAT. Owner permanent-deletion authorization is recorded in the Notion Launch Command Center; no additional owner preference confirmation is required just to prepare.
3. Do not claim vendor registration or Finance/Lead/Provider live activation ready until full end-to-end certification is complete.

## Evidence custodians
Privately retained JARVIS report: `D:\QuickFurno-Workspace\Artifacts\QF-PERMANENT-TEST-ERASURE-20261103.md`. Private SQL files are explicitly offline-only and must not be checked into this repository or launched against managed databases. Related issue: [#413](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/413). This packet adds verified evidence to the existing approval path, **not an executable purge**.

## Same-branch 3B20 release-gate reinforcement (3 Nov 2026)

The existing pure advisory `scripts/scale/step3b18-evidence-gates.mjs` was extended in place (no new deletion system, endpoint, SQL migration or live connection) to recognize the November **Production and Staging** backups and the actual full-schema offline PG17 restore evidence.

- Production archive SHA-256 now pinned to `679457E1FEFB79FBB2996F11E3BAD6077FCE476C430FA3996F82565066BF516F`; separate Staging pinned to `720165400E7B8807CAFEC19D81AF9B9C606FD234A1D3B95FD6B285D996FBD1A5`.
- Exact Production 29 vendor/74 lead roots and Staging 26 vendor/7 lead roots are separately fingerprint-checked, with a **Staging survivor guard** requiring one outside-scope vendor and two unrelated Auth users.
- Offline recovery checks require 141/142 RLS-enabled public base tables and 272 validated FKs in Production/Staging respectively, **in addition** to the independent full Supabase role/ACL/Auth/PITR/Storage restore/rollback gate.
- Separate exceptional review is mandatory for assignment-history immutability, frozen campaign snapshots, append-only vendor notes, and append-only automation history. Worker+outbox/provider freeze, managed Production read access, Staging **live** cleanup certification, Auth and provider-copy review and backup-retention plan remain independently blocking.
- Every input field is **advisory evidence**. Even hypothetical all-green evaluation returns `REQUIRES_SEPARATE_PRODUCTION_CHANGE`, never permission to run SQL. Real currently missing evidence must stay false, including live Staging erasure, independent DBA/AppSec approval, verified Production read access and worker freeze.
- Existing cleanup source tests updated and added seven regression cases covering November archive pinning, exact-ID drift, canary preservation, ACL/PITR distinction, protected histories, denied production access and realistic release-HOLD. Combined four relevant cleanup source suites: **45/45 passed locally**, no managed writes.

**Do not treat passing CI or Owner's permanent-deletion authorization as completion of protected live cleanup.**

## STEP3B20 — Operable Staging preflight and explicitly blocked live erasure handoff

The next engineering batch uses the existing release gate and adds two **read-only/operator-facing** inputs, not a new cleanup engine:

1. `ops/vox/sql-review/STEP3B20-STAGING-PREDELETE-READ_ONLY.sql` — repeatable Staging-only SELECT inventory returning the exact scoped vendor/lead ID fingerprints, expected unrelated canary and Auth survivors, payments, linked immutable events, relevant no-delete triggers and outstanding runtime/communication counts. No UUID lists, secrets, or personal data are printed.
2. `scripts/scale/step3b20-current-cleanup-readiness.mjs` — non-networked, no-write **actual-evidence snapshot**, invoking the existing 3B18 advisory release gate. Run `node scripts/scale/step3b20-current-cleanup-readiness.mjs` from repo root to see all explicit HOLD reasons. Evidence not actually verified is `false`, not assumed green. Tests verify the checker remains non-destructive and the current decision is HOLD.

**Staging SELECT-only spot check, 3 November 2026 15:22 UTC:** 26 target vendors, 7 leads, one unrelated canary, 6 immutable events, two unrelated Auth users, zero vendor-linked test Auth accounts and zero payments. Seven named no-delete/immutable history triggers remain ENABLED; existing automation has 106 requests/jobs and 157 transport requests. These are row counts, **not** proof workers are idle or provider queues frozen.

### Concrete reviewer/operator sign-off required for the first LIVE Staging transaction
- **DBA owns**: exact fixed test-ID allowlist; original ID hashes; no genuine user/payments; a narrowly reviewed exception for the **four** protected history families; actual trigger/FK/ACL restoration and replacement immutable evidence custody. A local exception test **is not** a managed approval.
- **AppSec owns**: no credential exposure, identity/Owner isolation, trigger-hardening, access logging, retention legality, provider/communication consent copies and safe guard restoration. None may be marked complete by CI alone.
- **SRE/Operator owns**: Stage tenant/worker/queue/communication outbound freeze, stable row-lock and drift checks, genuine Auth/roles/Storage/PITR recovery, independent rollback validation and an isolated maintenance window. A scheduler with historical queued rows must not be assumed quiescent.
- **Operator executes**: approved Staging exact-ID transaction ONLY once the above gates pass, then validate 0 targeted IDs/references, 1 unrelated canary, 2 unrelated Auth identities, 0 invalid FKs, 0 disabled protected triggers and no unintended outbox/provider effects. Failures roll back atomically.
- **Production release**: only after completed Staging live proof, new Production permitted read-only census and independently pinned approval. Production's managed SQL verification was blocked by connection safety checks; **do not change connection path to evade that check**. Separate supported Auth Admin deprovisioning applies only to 9 dedicated TEST vendor accounts after Owner-account cross-app verification.
- **Data-retention closure**: count deletion from active rows separately from Supabase PITR snapshots, private backup copies, external messages and partner archives. Report permanent erasure only when their retention/deletion dispositions have been verified.

**Owner authorization for permanent removal is already recorded. No more Owner preference questions are needed. Current blocker is reviewed execution evidence, not consent.**

The 3B20 code contains **zero managed DELETE/DDL/privileged Auth actions**. Current evidence evaluated through the existing source gate is `HOLD`. Dedicated Staging/Production activation and external signoffs must not be fabricated.
