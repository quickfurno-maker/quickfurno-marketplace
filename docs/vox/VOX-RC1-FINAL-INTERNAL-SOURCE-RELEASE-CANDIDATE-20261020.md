# VOX RC1 — One final internal source release candidate

**Candidate branch:** `test/vox-rc1-final-internal-20261020`, parent [VOX AB-7N draft #382](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/382) exact `16bb3f98efd1b166e9b7b1a324d73cb95aed108a`. Candidate remains **DRAFT, UNMERGED, NO DEPLOY**.

## Track 1 — Database and identity
- Prior AB-7L verified exact read-only managed QuickFurno Staging structural parity with archived Oct 16 schema-only backup for 2,441 columns, 212 function definitions, 75 triggers, 708 indexes, 1,103 constraints and 74 RLS policies, then installed all 30 native VOX SQL sources in network-isolated PostgreSQL 17.
- AB-7N audited real read-only live ACL for five sensitive Core tables, which are RLS-enabled but **not FORCE RLS**; 39 VOX candidate tables use FORCE RLS in disposable tests. Actual live public VOX table count remains 0 until approved installation.
- **New RC1 hardening:** `staff-directory` re-verifies current original existing Core Superadmin AAL2 Owner bearer AFTER fetching all roster and team data and BEFORE emitting even masked Staff names/metadata; denies if revoked during read. Regression added. No new Auth principal, grants, Team Leader or MFA factor created.
- Exact pinned SQL source manifest contains seven **quarantined foundational** migrations and 23 **uninstalled candidate** SQL files. DBA still must reconcile 31 staging-only and 107 repo-only migration version identifiers by SQL semantics, complete all owner/ACL reviews, and approve forward/rollback + tested restore. **DO NOT apply 107 files blindly.**

## Track 2 — Real Staff and agent/operations integration
- **New RC1 hardening:** `work-queue` re-verifies Staff Auth/AAL2, department and exact current Core object grants after canonical work source reads, including the **empty-result branch**; if a Staff member changes team/city/role or loses any grant mid-request, deny. The shared `rc1CurrentStaffScope.mjs` compares exact bounded department, prospect, vendor, support thread and conversation grants with no duplicate identifiers.
- **New RC1 hardening:** internal `staff-notifications` inbox revalidates fresh scoped Staff/Team/City/role/AAL2/department/object grants after the Core RPC and before returning private event records; revoked access denies. Staff notification POST still uses existing atomic Core RPC authorization.
- Riya client case and team chat late reauthorization from AB-7N retained; signed internal worker mid-preflight reviewer expiry detection retained. No agent send, autonomous action, outbound WhatsApp, SMS, email, external push or genuine EOD publication executed.
- External AI agents and AGNI/AOS source PRs are not merged or live certified; no claim of complete authenticated E2E before Staging installation.

## Track 3 — One immutable candidate packet and continuous QA
- New `contracts/vox/voxRC1ReleaseCandidate.mjs` verifies complete 30-file SQL SHA-256 manifest and eleven critical Core source files; pins Jarvis draft [#327](https://github.com/quickfurno-maker/qf-jarvis/pull/327) SHA `0e6f432985b156bcee148a3521165d2285384da7` and AGNI draft [#87](https://github.com/quickfurno-maker/qf-agni/pull/87) SHA `6fa59afe8627f9a585189d759daa5bee6648c359`, plus final local exact Core commit on a clean source checkout.
- Run `node scripts/mvp/vox/emit-voxRC1-release-candidate.mjs --output <ABSOLUTE_NON_REPO_PATH>` on the **final committed and clean** RC1 branch. Generates human-reviewable structured JSON outside Git without copying any keys/DB archive/personal data into the repository. Existing file is never overwritten. This **does not sign or deploy** anything and requires a separate trusted independent reviewer source.
- Generated JSON `canDeploy:false`, `canInstallDatabase:false`, `canEnableProvider:false`, `independentDbaApproved:false`, `independentAppSecApproved:false`, `firstTeamLeaderGenuineMfaVerified:false`, `protectedStagingE2eCertified:false` and `ownerGoSigned:false` until actual external review and live testing.
- Existing AB8 CI runs all focused Core/VOX/SQL suites + Next build/TS, Web locked-state and offline PG17 SQL/rollback; RC1 tests are added. Exact final GitHub commit and results must be checked independently.

## Required human/operational protected release gates (NOT internal source-complete)
1. Independent DBA: semantic migration-version reconciliation, actual complete ACL/RLS/security-definer review, approved rollback and independently restored baseline.
2. Independent AppSec and cryptographically pinned reviewer-key custody; first genuinely distinct authorized Team Leader bootstrap, real Owner + Staff AAL2 MFA, current Core grants.
3. Owner authorization to install reviewed SQL in **protected Staging**, signed Core/Jarvis/VOX Web/AGNI release with **outbound providers disabled**.
4. Genuine authenticated multi-service end-to-end scenarios for Staff Management, assignments, queues, chat, Vendor 360, Service Desk, Riya, Anisha, Aarohi, four-source EOD, internal notification worker, AGNI/AOS advisory, replay/revocation/failover/restore.
5. Separate Owner GO/NO-GO for production after authenticated staging certification.

**HARD HOLD:** source tests and manually generated SHA fingerprints are not an independent signed reviewer, real MFA factor, a migrated Staging environment or a deployed worker. All PRs remain draft/unmerged. No managed DB/Auth/provider/VPS production/staging writes or customer messages were performed by this batch.
