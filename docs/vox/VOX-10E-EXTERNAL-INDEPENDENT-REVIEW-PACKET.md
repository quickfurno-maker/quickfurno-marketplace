# VOX-10E — Independent DBA / AppSec / First Team Leader reviewer packet
16 October 2026. **No external human has been hired, no human signature obtained.** Reuses VOX-09B existing source history comparison and detailed DBA/AppSec checklist.

## Human DBA review (actual independent reviewer)
- Reconcile 86 Stage + 86 Production migrations: only 34 shared version IDs; 52 unique in each; seven shared SQL-body MD5 mismatches. Obtain the exact hashed managed SQL and canonical quarantined Staff foundation, inventory security-definer/RLS ownership and grants. Independently approve one canonical versioned migration chain, backup/restore/PITR and rollback keeping historical data.
- Deliver reviewed SHA256 source, signed DBA finding letter, exact DDL allowlist and return/recovery evidence. Until then **no protected staging DDL**.

## Human AppSec review
- Review actual JWT/AAL2, neutral Staff and Superadmin separation; revoked city/team/object/department, TL self-approval/replay and cross-tenant object-level access; browser Origin/CSRF and support-thread view security; actual signed Jarvis client permission, live consent/DNC/stop and AGNI replay.
- Deliver signed findings with severity, remediation verification and explicit approve/deny. Synthetic tests alone do not suffice.

## First Team Leader external attestation
- A genuinely distinct human from Owner and candidate, independently verified identification and MFA, one-use signed Ed25519 nomination with expiry and audited Core trust registry. No fabricated signer, privileged bootstrapping or initial permission grant without this process.

## Source evidence classifier
`contracts/vox/reviewerEvidencePacket.mjs`: 9 categories, SHA-only metadata, source/test-only states. It **never** claims a reviewer was engaged or verifies a human cryptographic signature, even if all nine evidence hashes are present; staging/production approval flags remain FALSE. Focused 7/7 tests and continuous Core regression.

## External reviewer hiring
Previous [review hiring pack](https://app.notion.com/p/3fb751ba167c81d4aa93f91dc298f6aa) remains prepared. Owner previously deferred engaging consultants until final protected-staging need. This source work prepares packets ONLY; no unsolicited access grants, hiring, payment, NDA or outreach.
