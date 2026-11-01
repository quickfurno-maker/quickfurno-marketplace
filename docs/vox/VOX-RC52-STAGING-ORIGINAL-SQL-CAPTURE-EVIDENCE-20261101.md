# RC52 — authentic managed-Staging original SQL, read-only capture

**Date:** 2026-11-01. **Scope:** connected QuickFurno Staging project only. **Database operations:** SELECT-only metadata and stored original migration statements from `supabase_migrations.schema_migrations`. No DDL, DML, provider communication, payments, user data exports or Production access.

The real Staging migration ledger has 86 versions, 85 with nonempty SQL. The **31 exact managed-only versions** identified by the pinned RC40 source inventory were found and their **851 original stored SQL statements** were read-only exported into **39 private files** (30 regular version files plus 9 contiguous chunks for a large 821-statement baseline). All raw SQL is held **outside Git**, under JARVIS `D:\QuickFurno-Workspace\Private\VOX-RC52-STAGING-ORIGINAL-SQL-20261101`. Do not paste raw SQL into issues, Notion or artifacts.

A second independent SELECT on the **same connected Staging ledger** returned per-version count and `md5(array_to_string(statements,chr(10)))`, compared against local reconstructed statements: **31/31 content checksums and counts verified**. Local SHA-256 canonical digests were computed; no SQL was executed. This is authenticated-connected evidence, **not an independent qualified DBA source-authenticity attestation**.

Against the **RC40 source-only** inventory:
- **31/31** managed-only original SQL version payloads now privately captured (provisionally clears the *missing bytes* blocker; no migration readiness claim).
- **24/31** managed versions have an exact canonical SHA-256 match to some source-only SQL file.
- Those represent **22 distinct source files**, not 24: two pairs of managed migration versions have duplicate SQL content and must be independently adjudicated.
- **7 managed SQL versions** have no exact source-only digest match: `20260722000100`, `20260926045802`, `20260926050242`, `20260929161707`, `20261002080447`, `20261003081215`, `20261013144901`.
- **85/107 distinct source-only SQL files remain unmatched by exact digest**; independent alias/dependency review required. No guessed alias, SQL rewriting, identity repair or deployable migration was created.
- Two duplicate managed-SQL pairs: `20261002083321`/`20261002083346`; `20261002083936`/`20261002085216`.

Read-only Staging catalog spot check still shows Core receipt table, candidate credit approval table, dedicated EOD reader role and signed EOD RPC **not installed**. An uninstalled object is not evidence of a failed deployment; it is a deliberately preserved hold.

**Private assessment tool:** `scripts/mvp/vox/rc52-private-managed-sql-assessment.mjs`; its synthetic regression test corrupts a SQL statement, drops a baseline slice and changes second-read verification to show all cases fail closed. **Local redacted output only:** `D:\QuickFurno-Workspace\Artifacts\VOX-RC52-ORIGINAL-MANAGED-REDACTED-ASSESSMENT-20261101.json`. Never commit actual SQL or the private checksum manifest.

**Next mandatory gates:** independent review of original SQL and historical managed catalog; adjudicate 7 mismatches + duplicate pairs + 85 outstanding source files; full real isolated restore with Auth, Vault, Storage, PostGIS and ACL/roles; qualified DBA/AppSec; real Owner/TL/Staff AAL2 and approved managed Staging UAT/rollback; explicit separate Production GO. Managed Staging changes, Production, payment/credit activation, provider sends and official EOD remain **HOLD**.
