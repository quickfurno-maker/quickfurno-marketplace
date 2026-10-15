# VOX-15 — Private staging source preflight (not a deployment)

The exact VOX SQL source inventory contains 7 versioned migrations, SHA256-canonicalized and explicitly pinned with staging=false, production=false in the preexisting post-G1 migration ledger. This CI source preflight verifies pinned versions, order, bytes, evidence status, and disabled Core/Web execution gates. Six negative mutations are rejected.

On 14 October 2026 read-only first-party staging Supabase checks returned 86 migration history entries, zero matching the seven VOX versions, and **zero installed VOX tables**. Canonical Core prerequisite tables for clients, vendors, city/zones, Aarohi and HUMAN conversation revision were present. **No schema change was performed.**

Release must remain **HOLD** until the reviewed pre-deploy recovery checklist is completed: (1) consistent full staging backup plus checksum and successful restore rehearsal; (2) ordered reviewed seven-migration dry-run against isolated schema and documented backward/recovery path; (3) signed staging candidate and feature flags OFF; (4) genuine owner/staff AAL2 MFA; (5) per-city/per-object authorization, stale revision, revocation and Team Leader isolation; (6) Jarvis signed event + persistent replay/consent test and vendor task concurrency; (7) log, load and rollback; (8) explicit owner final approval before enabling any business execution.

The output `qf.vox.staging.source-preflight.v1` is source evidence only, never a staging certificate. It does not connect to Supabase, write a database or authorize releases. Actual live DB history must be independently re-read immediately before migration apply. Do not run SQL in production or double merge stacked drafts.
