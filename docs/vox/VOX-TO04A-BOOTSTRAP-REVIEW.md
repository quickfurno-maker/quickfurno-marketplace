# VOX TO-04A: independent Team Leader bootstrap and protected launch

Status: SOURCE-ONLY / RELEASE HOLD. This document is NOT a human approval, security approval, DBA decision or signed artifact.

## Independent bootstrap protocol (mandatory)
1. Sole existing Core Superadmin nominates an already verified neutral Supabase Staff UUID, exact team/city, bounded expiry, rationale and unique nonce. Do not create a second Admin or a parallel login.
2. Staff candidate proves actual same Auth identity using true Supabase AAL2/TOTP, active neutral profile, and canonical city/team evidence.
3. Separate named human reviewer, different from nominating Superadmin and Staff candidate, examines the nomination and provides a durable externally verifiable, signed decision record. Neither AI review nor owner self-approval is evidence.
4. Independent security/DBA reviewer audits one-time nonce-bound Core bootstrap transaction after Staging schema reconciliation. Transaction must lock a specific verified candidate, consume valid distinct review, audit, enforce lease and deny replay. No generic bypass RPC.
5. Deny tests: absent reviewer, same human, forged signature, stale/replayed nonce, AAL1, foreign team, wrong city, revoked candidate, Admin role elevation, expired lease, concurrent duplicate bootstrap.
6. Revoke the first TL and verify immediate loss of reviewer authority and previously granted capability effectiveness across active sessions and queues.
7. Protected GitHub human reviewer approves immutable code and SQL SHA, signed staging OCI, genuine Auth E2E and rehearsed restore/rollback before the sole Core owner may separately authorize activation.

## Existing competing Core grant chains — DO NOT MERGE OR SHIP BOTH
- Candidate A: draft #267 SQL -> #268 Core HTTP: UUID RPC receipts, /api/vox/v1/staff-department-actions, VOX_DEPARTMENT_ACTIONS_ENABLED flag.
- Candidate B: draft #269 SQL -> #270 Core HTTP -> #272 strict body guard -> #274/#279 read-side intersection: structured receipts and supplied city/revision, /api/vox/v1/staff-departments, VOX_STAFF_DEPARTMENT_WRITES_ENABLED flag.
- Technical preference for the independent reviewer to inspect: B, due to explicit city and revision receipts and strict action bodies. This is not the reviewer’s decision. Compare SQL transaction invariants and carry any missing protections into one signed implementation before retiring the other.
- Work candidate from #275/#278 is NOT deployable until the selected grant schema, canonical client/vendor city joins, signed actor bridge and full Auth/stage tests are independently verified.

## External dependencies still unresolved
- Original staging 86-migration ledger recovery and DBA-reviewed backup/restore, real synthetic Supabase Auth AAL2, protected human review, exact IDOR and revocation E2E, client/Riya Jarvis pause acknowledgments, safe provider consent/outbox, signed Core/Jarvis/AGNI OCI, private staged rollback, and explicit owner release.
- Adjacent JSON HOLD manifest is only tracking metadata. It cannot prove a human signature or unlock staging/production on its own. CI must reject accidental RELEASED status.
