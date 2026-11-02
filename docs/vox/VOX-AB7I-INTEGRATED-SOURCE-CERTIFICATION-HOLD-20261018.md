# AB-7I — Four-track internal source hardening and release HOLD

Parent: [AB-7H source certified draft #368](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/368) SHA `b5415e0f9dd253a3ed2b71292e2b6f0efbec0748`. All parent PRs are DRAFT, UNMERGED.

## Independent contributions

A — `contracts/vox/ab7iStagingMigrationPreflight.mjs`: safe read-only inventory gate. Exact QuickFurno Staging public canonical tables must be present; no partial VOX schema, unsigned migration SHA or missing rollback SHA qualifies. `canApply:false` ALWAYS: does not install any candidate SQL. Staging inspection showed canonical conversations/command receipts present, VOX tables absent.

B — `ops/vox/sql-candidates/20261018080000_vox_ab7f_staff_atomic_suspend_candidate.sql` revised to require a separate nonce-bound, exact Owner/TL/target/team/city signed-decision attestation, inaccessible to service_role INSERT. Existing current TL alone cannot authorize a suspension. Isolated PG17 tests show denial of spoofed TL, forbidden service role approval creation and true transactional revocation after synthetic reviewed approval. `ab7gAuthSessionReconciliation.mjs` now truthfully distinguishes verified refresh-token revocation from **existing JWT access tokens that remain valid until expiration**. Core must check current Staff revocation on every action, as `getVerifiedScopedStaff` does.

C — `ops/vox/sql-candidates/20261018110000_vox_ab7h_signed_operator_atomic_candidate.sql` additionally binds signed operator approval to the native locked `communication_conversations.destination_hash` and `channel='whatsapp'`. Only signed no-send STOP/TAKEOVER commands. Upstream human-review keys and actual canonical communication consent/suppression gate for OUTBOUND delivery still required. No live Jarvis path change.

D — `contracts/vox/ab7iWorkerLaunchPreflight.mjs` verifies independent current release authority, exact schema/release hashes, no outbound providers, bounded jobs. Even positive review never starts a worker/scheduler nor certifies provider sends. Existing isolated internal worker adapter remains stage-gated.

## Exact certification and open blockers

Focus: 9 AB7I tests; all prior AB7G/AB7H tests retained; isolated Postgres17 AB7F–AB7I suite has genuine native SQL transaction, rollback, staff approval and destination binding. Full Core/Web/TypeScript/production-build and GitHub CI must be verified at exact integration head. This source package has NO managed database migrations, Auth account mutation, messaging, EOD live publication, AGNI action or VPS deployment. Genuine independent DBA/AppSec/first TL AAL2/Owner GO and signed protected staging E2E remain required; existing protected staging has zero VOX tables. **RELEASE HOLD.**
