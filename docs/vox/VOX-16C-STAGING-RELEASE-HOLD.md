# VOX-16C staging readiness gate — HOLD pending real database backup/restore

This branch provides a **source provenance and blocker manifest**, not permission to apply migrations. Checks all seven exact archived sha256 migration pins from first-party source. An `--authorize` or `--apply` attempt is denied until an independent signed manual approval and real staging backup/restore process is performed. Source test output is `stagingRelease=HOLD`, `migrationApplyAuthorized=false`. The script contains NO database connection string and cannot apply SQL, so a green CI job must NEVER be labelled live staging certified.

Read-only first-party Supabase Staging (`uckafzuochmbvtiodmcl`), 14 Oct 2026: 86 applied history entries, **none of the seven** VOX SQL versions; no public VOX tables. Native existing Core dependencies, vendor idempotency unique index and profile approval v3 tables confirmed. No full managed Supabase backup credentials or trustworthy restore verification available via currently authorized tools.

## Required ordered rollout before source flags may change
1. Establish audited access to the correct private Supabase Staging project and isolate an independent restore destination (never use Production or dummy restore container as proof).
2. Generate full consistent staging backup using approved managed backup/pg_dump method, record checksum with restricted storage and retention.
3. Restore the **same archive** to an isolated PG17 instance, verify DB objects/functions/grants and representative safe aggregate counts, compare source fingerprint. Store signed report with no customer PII.
4. Independent human review of all 7 migration SQL, same release digest `798b6b5182817807cabf5e6b5373960fca7f6f26ecb9896f43ec55dc2d7a0022` before ordered apply.
5. Apply to actual Staging only after steps 1–4 and owner approval; immediately verify 7 history entries, all FORCE RLS/revoked grants, deny cross-city IDOR, verified AAL2 real staff and Team Leader, same signed images, Jarvis/AGNI private auth, rollback.
6. Feature flags OFF, no provider sends/vendor-profile/wallet changes until corresponding audited executor and consent. Production stays HOLD.

Never confuse local `qf-vl05-stage-restore` Docker container (vendor lifecycle fixture) with the managed live Supabase Staging database. No migration performed in this batch.
