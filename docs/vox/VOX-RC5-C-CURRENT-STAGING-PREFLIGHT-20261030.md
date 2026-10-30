# VOX RC5 Track C — Current managed Staging preflight and fail-closed evidence

**30 October 2026 — READ ONLY / MANAGED RESTORE NOT CERTIFIED / RELEASE HOLD**.

## Live observed managed Staging (Supabase project `uckafzuochmbvtiodmcl`)
Direct **read-only SQL** returned PostgreSQL `server_version_num=170006`, **86 migration ledger records**, latest `20261013144901`, **P0-6 not recorded**, **0 VOX Staff public tables**, **one verified MFA principal**, and **59 admin-policy function references**. Relevant Core tables `communication_conversations`, `communication_preferences`, `communication_suppressions`, `communication_consent_events` and `profiles` are owned by `postgres` and have RLS ENABLED (not FORCE); `anon` cannot SELECT any of them; `authenticated` cannot SELECT the four communication tables, but can SELECT `profiles`; `service_role` has SELECT. Extensions `pgcrypto`, `postgis` and `supabase_vault` are installed. No personal identities/records, secret values or keys were selected.

`scripts/mvp/vox/rc5-live-staging-preflight.sql` generates only a catalog/count JSON snapshot; expected project identity is a **label, not proof**. The authorized operator must independently verify the target project through the Supabase connection. `rc5-staging-preflight.mjs` validates the supplied independently attested project ID, approved pre-migration ledger, baseline ACL/RLS, extensions and distinct MFA principal requirements, but **always returns HOLD**, even if every observed catalog check passes. In particular, it cannot claim current full-fidelity managed backup/recovery, signed migration GO, or qualified external human DBA/AppSec approval.

## Tests and remaining release gates
`node --test scripts/mvp/vox/rc5-staging-preflight.test.mjs scripts/mvp/vox/rc4-recovery.test.mjs` **43/43 PASS**. Includes spoofed project, production target, wrong ledger, P0-6 already applied, exposed Staff schema, unsupported extension, weakened grants and SQL mutation attempts.

The RC3 isolated PostgreSQL local parity remains provisional with two recorded raw ACL-default/owner differences requiring qualified human DBA interpretation. Complete an authorized current managed Staging backup with role/ACL/owner, Supabase Auth, Vault, Storage objects and PITR, rehearse restoration to a truly isolated supported environment, and obtain independent DBA/AppSec approval before any protected Staging migration. Production stays HOLD.
