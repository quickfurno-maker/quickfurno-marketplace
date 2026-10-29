# VOX Staging — exact real-archive offline restoration and migration rehearsal (29 Oct 2026)

**Verdict: PASS for disposable logical data restoration and schema compatibility. NOT managed Staging approval.**

The 27 October QuickFurno Staging custom-format PostgreSQL 17 backup was verified against SHA-256 `57F3B8D446BBB0B47332B24CBF0BA8385D72269ED923ABC393EC8B73DAE129A1`. The only restore target was a fresh `--network none` disposable `public.ecr.aws/supabase/postgres:17.11.0.002` container, never managed Staging or Production.

The restore procedure:
1. Validate the exact backup SHA and fingerprint all 30 VOX SQL source files against the existing, fail-closed AB7K pinned manifest.
2. Restore the **actual five-schema Staging schema** (public, auth, storage, supabase_migrations, vault), installing required PostGIS/pgcrypto/uuid-ossp/pg_stat_statements dependencies first.
3. Recreate Supabase Vault **after** the archive's `vault` schema, because `vault.secrets` is extension-owned and not created by the schema-only archive.
4. Preserve the six existing `NOT VALID` CHECK constraints, temporarily defer them **only inside the disposable clone**, and restore all archived data using the isolated Supabase administrative role with restoration triggers disabled; then reinstall all six original `NOT VALID` constraint definitions.
5. Install the seven exact quarantined foundation SQL files and 23 later SQL candidates from the source branch, in exact manifest order, **in the disposable clone only**.
6. Validate 39 VOX tables, 39 FORCE RLS tables, and historical data counts, then destroy the disposable container and ephemeral data logs in a `finally` block.

Latest repeated result:

```text
PASS REAL_STAGING_SCHEMA_RESTORE
PASS SUPABASE_VAULT_EXTENSION_RECREATED
PASS SIX_NONVALIDATED_CHECKS_TEMPORARILY_DEFERRED_OFFLINE
PASS REAL_STAGING_ARCHIVE_DATA_RESTORE
PASS SIX_ORIGINAL_NOT_VALID_CONSTRAINTS_RESTORED
PASS 30_VOX_SQL_SOURCE_FILES_REAL_RESTORED_SCHEMA
RESTORED_SCHEMA_POSTCHECK 39|39|2|106
DISPOSABLE_RESTORE_CONTAINER_AND_DATA_LOG_REMOVED
```

**Scope limits:** This exercise restored database data/schema against the archived snapshot, **not original server roles/ACL/ownership**, physical Storage objects, cluster roles, PITR, or production disaster recovery. The archive dates to 27 Oct; it does not prove exact parity with today's managed Staging. Six `NOT VALID` CHECKs remain semantically preserved. The data set contains 106 historic automation-action rows, 21 of which do not satisfy the newer unvalidated scope constraint; none were discarded or normalized. This is offline compatibility evidence, not authorization to alter existing records.

**Reproduce on authorized JARVIS computer** (no managed database credentials needed):

```powershell
& 'ops/security/tests/invoke-vox-restored-staging-30-migration-pg17.ps1' `
  -BackupPath '<private_path_to_20261027_staging-five-schema.pgcustom>' `
  -SqlSourceRoot '<path_to_the_reviewed_VOX_AB7K_source_worktree>'
```

The source worktree contains the seven quarantined SQL files, 23 uninstalled candidates, and exact signed source fingerprint; this report does not move any of those SQL files into executable `supabase/migrations/`.

**Remaining release gates:** fresh managed Staging drift, live roles/ownership/ACL parity and rollback plan, independent human DBA and AppSec signoff if required by current approval policy, first genuine neutral Staff Team Leader Auth AAL2 bootstrap, P0-6 admin `is_active` migration and live 59-policy negative checks, then staged migration and actual staff end-to-end tests. Production and external actions stay HOLD.
