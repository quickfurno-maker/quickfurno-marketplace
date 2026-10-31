# VOX RC4 Track C — Managed Staging recovery adjudication (30 Oct 2026)

**Status: HOLD / NO-GO / SOURCE-ONLY.** The authoring agent's review and managed recovery rehearsal are **NOT EXECUTED** by this source artifact; it is a programmatic preparation toolkit. No Staging, Production or Auth mutation is allowed. This document is a reviewer packet, not a qualified independent human DBA/AppSec certificate.

## Immutable source and project identity

- Managed **STAGING only** project ref: `uckafzuochmbvtiodmcl`; Production has a different project identity and is explicitly prohibited.
- AB7K 7 quarantined + 23 candidate SQL source fingerprint: `3ae02af58c07e256507532b866594486d2785e768fd4092a1b1aa8db572f8f60`.
- RC3 disposable PostgreSQL17: RAW_DIVERGENCE at two `vox_ab7j_staff_suspend_intents_candidate_v1` ACL/default-ACL catalog paths. Independent source/restored semantic analysis showed **PROVISIONAL_SEMANTIC_PARITY**, but the raw diff is retained and requires an **independent qualified DBA** interpretation.
- Last live read-only Staging state: 86 migration-ledger records, zero VOX Staff tables, one verified MFA principal. New live evidence must be collected by an authorized operator; this packet does not assert a fresh snapshot.

## Read-only evidence source

`scripts/mvp/vox/rc4-recovery-evidence.mjs` and `rc4-recovery-lib.mjs` generate catalog-only, transaction-READ-ONLY SQL and evaluate captured operator evidence. The evaluator never trusts a caller-provided release GO, self-declared restore success, unsigned signoff, or an offline/synthetic local restore as managed confirmation. No private credentials or PII are required for the inventory. Evidence must include current managed schema-migration history and version reconciliation, a fresh recoverable five-schema backup with true owner/ACL/role restore, Auth schema and extensions, Storage physical objects, Vault compatibility and PITR proof.

## Safe operator runbook and gates

1. Pin the managed Staging project identity and record capture time. Run generated read-only SQL through approved administrative access and store evidence in a private destination with checksums; never copy customer data to reports.
2. Independently verify backup, ownership, grants, policies, default privileges, SECURITY DEFINER owners and EXECUTE exposure across `public`, `auth`, `storage` and `supabase_migrations`. Include extension dependency and Vault coverage.
3. Restore into an explicitly isolated, disposable Supabase-compatible environment. Keep network and payments/providers OFF, verify physical Storage/PITR and role/ACL parity, forward migration and reverse recovery. Never restore over managed Staging.
4. Reconcile the 86 existing versions semantically and approve exact P0-6, Staff 7+23 and subsequent hard-off overlay. No `supabase db push --include-all`, history repair or forced SQL install.
5. Record separately signed qualified human DBA and AppSec decisions, verified genuine independent Owner/Team Leader AAL2, signed operator GO and feature flags OFF. Until all evidence exists, the only decision is **HOLD**.

## Demonstrable source security

The unit suite rejects false managed-restore claims, wrong project, stale/missing backup, missing or lossy ACL/role evidence, unverifiable Auth/Storage/PITR, privilege widening and swapped hashes. No installed code can autonomously certify or apply managed SQL. The production database is never a target. For local source validation only: `node --test scripts/mvp/vox/rc4-recovery.test.mjs`. Any source-only check is not a managed restoration certificate.
