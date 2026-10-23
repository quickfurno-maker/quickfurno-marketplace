# 3B-9D — Managed migration statement evidence, **not** executable SQL recovery

## Independent DBA briefing
Source checkout: Phase3B9A–C head `0b17ec8d432d641fcf6a5d04f5abc867fa770044`. A 23-Oct-2026 SELECT-only probe of QuickFurno Staging and QuickFurno Production Supabase showed **86 applied migration versions each**. Migration ledgers have `statements` arrays in **85/86 Staging** and **85/86 Production**; both lack stored statements for version `20260817000000`. No managed schema or ledger changed.

The 104 divergent versions are 52 each environment. Earlier Git history scan across available JARVIS local refs located no historical `supabase/migrations` paths for **72** items absent from the current runnable source. **All 72 have SQL statement arrays in their corresponding managed migration history**, which creates a controlled source-recovery path. We have captured only metadata (`version`, name, count, byte count and SHA-256 of canonical joined SQL statement arrays) in `ops/vox/certification/STEP3B9D-{STAGING,PRODUCTION}-LEDGER-FINGERPRINTS-20261023.json`.

Critical: among the **34 shared versions**, **26** have matching managed SQL array fingerprints, **7** have **different** arrays under the same version, and **1** has no statements on either side. Details and fingerprints are recorded in `STEP3B9D-LEDGER-RECONCILIATION-20261023.json`. Differences can include actual code changes or differences in serialization/DDL. They have NOT been adjudicated as harmless. Escalate all seven before replay or repair.

## Controlled recovery steps for the independent DBA
1. Validate migration ledger custody, permissions, complete historical backups, and the original migration application process. Independently inspect scope and source for each row, including the seven conflicting shared-version fingerprints.
2. Retrieve needed original statement arrays through **approved encrypted, access-restricted recovery**, preferably from authenticated Staging/Production snapshots. **DO NOT put retrieved SQL into GitHub, Notion, chat, public logs, PR attachments or shared CI artifacts**; historical SQL may contain secrets, keys, personal data or privileged grants.
3. Have a reviewer verify each extracted SQL against the ledger SHA-256 calculation before creating any reviewed, sanitized migration source artifact. The SHA is the UTF-8 encoding of `array_to_string(statements, E'\\n-- LEDGER STATEMENT BOUNDARY --\\n')`; this is a **statement-array fingerprint**, not necessarily the original migration-file SHA.
4. Compare SQL semantics, grants, SECURITY DEFINER functions, triggers, ordering, data dependencies and applied schema state. Obtain explicit DBA dispositions on the entire 104-row matrix and each of the seven conflicting shared versions.
5. Rehearse full recovery of global roles/ACL, default privileges, physical storage objects, auth state and PITR. The four-schema pg_dump clone restore does NOT certify complete Production rollback.
6. Do not run unreviewed SQL. Requires **separate explicit Owner Staging GO** after independent DBA and AppSec signed findings.

**Still PENDING:** SQL body extraction, source custody, independent semantic review, complete rollback rehearsal, authorized DDL. The 72 are **locatable in managed ledgers but NOT recovered/reviewed runnable source files**. This discovery reduces source-location uncertainty, not the change-approval threshold.
