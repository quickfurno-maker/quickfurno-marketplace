# VOX-09B — Independent human DBA/AppSec/Team Leader reviewer packet

**16 Oct 2026. External independent review is not yet booked or signed.** This packet prepares the evidence; it cannot self-approve deployment.

## Direct public metadata-only read-only migration audit from connected Supabase
Staging `uckafzuochmbvtiodmcl`: 86 applied migration history records; 0 VOX tables; 1 Auth user and 0 verified MFA factors. Production `yqpgcsduqbxulrlzwzap`: 86 records; 0 VOX tables; 9 Auth users and 0 verified MFA. Across histories: exactly **34 common migration version IDs**, **52 Staging-only and 52 production-only IDs**, **seven shared-version SQL statement MD5 mismatches**. There was one empty-statement MD5 in each environment. No data/DDL, Auth or role writes were performed. A hash difference requires investigating actual source and role differences, not automatically overwriting migrations.

`contracts/vox/migrationParityEvidence.mjs` is a pure source-level read-only ledger comparator, rejecting duplicate/bad metadata; even matching version names/hashes never sets safeToApplySql or approval true. Synthetic tests reproduce the real observed counts but are NOT source statements or human attestations.

## Reviewer checklists (independent humans)
**DBA:** independently identify versioned canonical Core Staff foundation, quarantined-migration handling, schema objects+owners, global PostgreSQL role grants, RLS and security-definer functions; reconcile all 52+52 unique migration histories and seven shared SQL-body hash mismatches, decide ordering, approve exact staging migration digest; verify protected Staging backup/restore/PITR and typed rollback preserving user data; sign an independent reviewed artifact in a system the Owner cannot forge.

**AppSec:** inspect neutral Staff Supabase Auth AAL2 and role metadata freshness; canonical city/object/department current approvals, RLS/secure function grants, support-thread grant drift, security-definer view; test anon/AAL1/foreign city/foreign team/revoked reviewer/member/signed JWT replay; verify Riya client subject grants, canonical Google Place, real Jarvis pause/consent and no unapproved outbound provider. Sign separate independently reviewed code+schema evidence.

**First Team Leader independent reviewer:** a real person other than Owner and proposed candidate, real MFA credential, recognized reviewer identity, durable signed one-use Ed25519 event tied to reviewed member/team/city and <24h exp; Core verifies before activating. Never self-sign, invent signing key, bypass human reviewer or provision Staff on draft migrations.

**Release Owner:** after all independent gates, approve signed immutable digest and actual protected Staging canary, cross-role/cross-city/revocation tests, worker outbox load/drain, AGNI signed transport, real four-source EOD and Riya/Anisha/Aarohi human escalations, backup and rollback; production only after human GO/NO-GO.

**Review form fields (BLANK until real human review):** reviewer legal name/independent organization; reviewer class; evidence digest and repository exact SHA; scope and date; verified factor proof; explicit approve/deny with findings; authenticated signed review ID. No prefilled fake human decisions.

## Current authorization state
Four V1 source PRs #312,#313, AGNI #84 and #314 are all draft/unmerged. VOX-08R/08S/08T/09B drafts add more isolation evidence but DO NOT install data. Automated CI proves source consistency only. Environment release remains HOLD.
