# VOX-09 — Protected staging activation and release-preparation gate

**2026-10-16: observational QA only; live activation NOT AUTHORIZED.**

## Authoritative read-only source observations
Connected Supabase:
- STAGING `uckafzuochmbvtiodmcl`: 86 historical applied migrations, **0 installed public vox_% tables**, 1 Auth user, **0 verified MFA factors**.
- PRODUCTION `yqpgcsduqbxulrlzwzap`: 86 migrations, **0 installed public vox_% tables**, 9 Auth users, **0 verified MFA factors**.
These values were read directly this turn. Both environments remain intact; no managed SQL, Staff identity, permission or rollout changes.

## Acceptance matrix — all HOLD unless actually independently evidenced
1. Independent human DBA reviews exact managed SQL source-of-truth, Staging-versus-production 86-history and migration SQL checksum differences; approves canonical Staff foundation, fully audited privilege/GUC ownership and restores.
2. Independent AppSec reviews RLS, security-definer view/roles, vendor support thread ACL drift, signed JWT/nonce/CSRF, revocation and indirect object identifiers. Human approval must be independent of owner and AI.
3. First Team Leader appointed through signed independent reviewer attestation, genuine neutral Supabase user/verified AAL2; Owner may not self-attest independent signoff.
4. Superadmin unchanged, Staff single neutral login + multiple department capabilities only under approved Core grants.
5. Full approved schema Staging promotion with immutable signed digest, verified backup/restore and reviewed reversible rollback; rollback never removes user data.
6. Nine protected browser-to-Core read-only routes authenticated with real AAL2, denied AAL1/anonymous, foreign city/team/object; zero privileged browser service_role secrets.
7. Atomic work queue concurrency plus multiple actual Staff revocations, neutral role drift, cross-city access and the QA hold suite.
8. EOD: signed source readers & accurate 4-source watermarks; partial Core-only report never becomes final all-source business report or auto-approved by Team Leader.
9. Riya: real client subject assignment, authentic Core consent/human handover/pause and signed Jarvis service-to-service callback before any governed provider message.
10. Anisha/Aarohi: real vendor/acquisition Core subject and consent checks, independent review of provider messaging and human escalation.
11. Notification outbox: real scheduled worker process, queue retry/dead-letter tracking, two-worker soak and revoke-mid-batch, approved retention/purge and AGNI signed metrics transport.
12. Signed AGNI/QuickFurno/Jarvis immutable release canary, rollback and owner GO/NO-GO. No production rollout without human-signed evidence.

## Source-only gate evaluator
`contracts/vox/protectedStageCertificationGate.mjs` is a pure **read-only evidence classifier** with 14 explicit gates and 9 negative tests. Even if fake JSON marks 14 items observed, it returns `stagingActivationPermitted=false`, `releasePermitted=false`, `independentSignaturesVerified=false`. It never mints a release token or invokes SQL. A human reviewer needs authoritative external signed review documents and actual protected Staging test artifacts.

**Local test:** `node --test scripts/mvp/vox/validate-vox09-staging-evidence.test.mjs` 9/9 PASS. QA preparation is not completed staging certification. All external reviewer engagement still pending; no fabricated signoff.
