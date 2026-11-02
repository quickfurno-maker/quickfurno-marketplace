# VOX-L1 through L5 launch-integration QA / release HOLD — 2026-10-16 IST

## Scope and prior decisions
- One existing QuickFurno Core Superadmin = Owner/Admin. NEVER create a second
  privileged identity, VOX Owner password or Staff-as-Admin profile.
- Staff remain neutral Supabase `vox_staff` principals with remotely checked
  AAL2, current team/city, independently approved department capability,
  revocation, expiry and exact object grants.
- A Team Leader is a separately approved Staff role. The FIRST Team Leader
  needs a genuinely independent human reviewer. Owner/AI cannot self-approve.
- Original Core matching, 3-vendor cap, payments, WhatsApp ownership, Jarvis
  Riya/Anisha/Aarohi and AGNI Action Broker remain unchanged.
- Feature flags and provider transport default OFF; no managed staging or
  production schema/flags/credentials/writes/contacts are changed by source QA.

## Parallel source branches (all children of independently reviewed DRAFT PRs)
| Track | Branch | Source implementation | Limit |
| --- | --- | --- | --- |
| L1 | `feat/vox-l1-eod-source-readiness-20261016` | Actual Core authenticated EOD source-existence queries: current Staff work events, canonical Aarohi prospects, vendor support threads, client conversation object existence. Strict projection and independent flags. | No all-source event provenance/watermarks, no final EOD aggregate, no official submission |
| L2 | `feat/vox-l2-client-grants-20261016` | New current `client_success` department-proof projection + scoped Riya client-case GET, exact Core object grants, canonical active city service-zone and verified Google Place lead coordinates; metadata only. | Riya signed live pause ACK/consent/atomic handover absent; no transcript or outbound sends |
| L3 Core | `feat/vox-l3-core-private-outbox-20261016` | Private signed AGNI actor-only Core route uses existing QFJ Ed25519 verifier and service_role-only outbox aggregate RPC, signs narrow HMAC metric token. | Cannot function until approved SQL migration, private signing key/transport and protected staging |
| L3 AGNI | `feat/vox-l3-agni-owner-http-20261016` | Existing authenticated Owner Gateway GET `/v2/owner/vox-outbox` invokes existing signed Core transport, current Owner callback, private key file and PG replay claim. No new Owner login. | No live signed HTTP / active monitoring / alert service until certified staging |
| L4 | `feat/vox-l4-staff-work-action-20261016` | Core-auth private BFF for seven preexisting atomic transitions, bounded Staff My Work, no browser role/city/agent privileges; separate source-backed Riya client and four-source EOD readiness UI. | Feature flags OFF; real Staff MFA and managed SQL absent; not a production Staff assignment yet |
| L5 | `test/vox-l5-cross-system-launch-qa-20261016` | Node crypto Ed25519 reviewer-packet verification & adversarial tests, CI gates, THIS honest release-hold checklist. | Synthetic cryptography is NOT a real human identity, DBA approval, AppSec signoff or first TL |

## Unit, contract and source-only QA
- L1: 8/8 new source readiness + 231/231 Core VOX Node tests, Core TypeScript PASS.
- L2: 8/8 new Riya client grant/location tests + 232/232 Core VOX, Core TypeScript PASS.
- L3 Core: 8/8 real TypeScript handler in mocked VM, Core 211/211, TypeScript PASS.
- L3 AGNI: actual signed QFJ client request tested with Ed25519 keys and mock
  `fetch`; combined 26/26 focused Vitest PASS and full 8-workspace Owner
  Gateway build PASS. Core/AGNI not exercised over a real protected network.
- L4: 6/6 new read-boundary tests, 12/12 current real route+adapter VM tests,
  full inherited VOX Web npm suite PASS, TypeScript PASS, Next production
  build PASS. Atomic write checks use synthetic server/Auth, NOT live SQL.
- L5: 8/8 adversarial Ed25519 source tests + 235/235 Core Node VOX tests.
  Test keys are synthetic. Reviewer-packet output always keeps
  `protectedStagingPermitted:false` and `productionPermitted:false`.

## Read-only authoritative managed environment snapshot — 2026-10-16
| State | Staging | Production |
| --- | --- | --- |
| Applied migration-history rows | 86 | 86 |
| Installed public VOX tables | **0** | **0** |
| Supabase Auth users | 1 | 9 |
| Verified MFA factors | **0** | **0** |
| VOX governed work action in actual production | **NO** | **NO** |

Previously observed: 34 shared migration IDs, 52 unique per environment and 7
common-ID SQL body digest differences; independent DBA must reconfirm and
reconcile exact migration provenance, owners, RLS/ACL, definer security,
sequence grants, smoke rollback, backup/PITR before applying ANY candidates.
This report never authorizes or performs schema changes.

## Actual protected staging acceptance gates — ALL REQUIRE REAL EVIDENCE
1. Independent qualified DBA reconciles 86-history, exact canonical migration
   SHA, signed standalone PG17 restore/rollback; approves migration graph,
   function owners, `search_path`, RLS, row-level grants and service-role RPC.
2. Independent AppSec red-teams Superadmin/staff separation, verified Staff
   AAL2, revoked Team Leader and department grants, cross-team/city/BOLA,
   tampered Google Place server verification, forged signed Core/Jarvis/AGNI
   requests, replay, stale concurrency and CSRF/PII leakage.
3. Independently verified external reviewer nominates FIRST TL with authentic
   expiring signature and source pin. Genuine active distinct human current
   AAL2 TL is needed to approve other department grants. Owner/AI cannot
   stand in as first TL.
4. Reviewed staging migration installed, rollback verified, no direct browser
   `service_role` or anonymous grants, current Staff six-role AAL2 tokens.
5. Signed EOD event collectors & watermarks from Core Work, Aarohi CRM,
   Service Desk, communication/Jarvis staff activity with authoritative actor
   and event IDs. Until then only partial/no-complete EOD.
6. Current canonical client case/project ownership and Staff object grant,
   real signed Jarvis pause acknowledgment with revision, channel consent
   and human handover arbitration, idempotent Core send authority. None of
   the L2 metadata pages grant this.
7. Core notification worker supervised with actual PG leases/retries/dead
   letters; in-app acknowledgments exactly once; AGNI signed Core HTTP,
   actual Owner session, AGNI PG replay insert verified on staging.
8. End-to-end protected real Staff web browser, real AAL2, exact user-owned
   city/team/project A/B denial, concurrent work claims & stale retries,
   low balance and timeout/503 behavior, disabled provider sends.
9. Independent security/DBA signoff, Owner QA certificate, signed staging
   digest, controlled canary and recorded rollback, final signed GO/NO GO.

## Failure modes and hard denial contract
- Unknown or stale Staff grants, missing MFA, zero installed tables, missing
  canonical Google service zone, malformed source JSON, untrusted/expired
  signer, absent provider consent or replay ledger -> 403/503, NEVER a
  guessed permission or background send.
- Do not count resource presence (a CRM prospect or support thread) as
  employee event/activity. Do not represent bounded 25-row windows as totals.
- Reporting cannot be promoted as a complete EOD while signed provenance
  is missing. Reviewer crypto packets cannot be promoted to real approvals.
- All new CI workflows test source only; passing CI is not stage/prod cert.

**Verdict:** implementation and source QA staged in draft source branches;
real human approvals, genuinely authenticated staging deployment and live
Core/Jarvis/AGNI/notification wiring remain blocked. Production: NO GO.
