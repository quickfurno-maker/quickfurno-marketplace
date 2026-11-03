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
