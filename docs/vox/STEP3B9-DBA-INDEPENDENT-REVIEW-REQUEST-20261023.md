# 3B-9A — Independent DBA review request (NO APPROVAL RECORDED)
**Recipient:** qualified independent PostgreSQL/Supabase DBA to be designated by Owner. No actual external reviewer has been engaged by creating this file.

**Subject:** QuickFurno VOX/Finance V2: review 104 ledger differences and complete recovery/permission proof BEFORE protected Staging DDL.

**Pinned source:** PR #403 draft / `e52a30553225628a0f611933a313ab0337f92f62`. Phase 3B9 reviewer handoff packet is source-only and must receive its own immutable SHA after commit. Managed Staging `uckafzuochmbvtiodmcl` still 86 migration rows, 0 `vox_%` and 0 `finance_v2_%` public tables on 23 Oct SELECT-only check.

**Review scope and required outputs:**
1. Independently inspect all 104 entries in `ops/vox/certification/STEP3B9-INDEPENDENT-REVIEW-HANDOFF-20261023.json` (52 STAGING_ONLY + 52 PRODUCTION_ONLY; 34 identical versions); **72 of 104 register items have no identified runnable SQL source in current repository** — recover authenticated historical source before assuming they match.
2. For each version: resolve exact SQL/ownership and checksums, when/where applied, effect on current schema/data/triggers, extensions, views, default grants and deployment ordering. Assign reviewer identity, date and explicit per-item decision. Missing source is a stop condition, not equivalent SQL.
3. Independently verify privileged routines, auth and storage schema rules, `search_path`, grant inheritance, secrets handling, schema migrations history consistency and rollout safety.
4. Prove restore of **global roles, ACL/default privileges, auth state, storage binaries and PITR** for the approved backup under realistic dependency and concurrency conditions. Four-schema `pg_dump` replays **do not** prove complete recovery. Record hash, retention, recovery point and RTO/RPO.
5. Approve or reject *exact proposed SQL hashes*, rollback and signed Staging-only change procedure separately. No changes to production or databases during review.

**Human-only signoff:** status PENDING. Reviewer: NOT ASSIGNED. Evidence and per-item signatures: NONE. Owner go: NONE. Managed SQL authorized: NO. Request copies must not contain passwords, tokens, PII or connection strings.
