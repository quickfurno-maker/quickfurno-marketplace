# VOX release candidate #300 — exact SQL migration preflight / DBA decision packet

**Verified 15 October 2026; read-only Supabase staging and production queries.** No managed SQL, Staff invitation, human reviewer, provider message or deployment occurred.

## Decision this packet requires

There are **two unapproved VOX authority tracks in the same 417-file main-target draft**:

| Track | Source in PR #300 | Objects/effects |
|---|---|---|
| Historical VOX Staff/operational authority | Seven `supabase/migrations/20261014010000`–`20261014070000` files | Creates teams, memberships, object grants, Staff request/review/finalization, Team Leader review, operational intent, and an internal Aarohi task/event executor |
| New reviewed department and work candidates | `ops/vox/sql-candidates/20261015010000`, `20261015020000`, `20261015030000` | Different department capability authority, current independent reviewer proof and Core work transaction with 24-capacity guard |

The first group is under Supabase's **managed migration discovery path**. A normal merge/release that applies new migrations can run these SQL files. Merely labelling them SOURCE ONLY in comments does **not** prevent SQL execution. The second group is currently candidate-only. **No safe or final automatic ordering between the two tracks has been authorized.**

## Live metadata observed

- QuickFurno Staging: 86 recorded migration entries, none of the seven VOX Oct14 migration version IDs; 13 checked VOX Staff/legacy/dept/work objects absent. Baseline Core `cities`, `profiles`, `aarohi_tasks`, `aarohi_events`, `aarohi_prospects` present.
- QuickFurno Production: same findings for these specific checks.
- The complete 86-by-86 migration ledger comparison previously found 34 common version IDs, 62 common names, 28 same-name/different-version pairs, 22 Staging-only names and 24 Production-only names. **Matching names do not prove same SQL bytes**.
- The synthetic PostgreSQL17 same-database candidate/revocation/restore test in #297 passed, but is **not** a real staging backup/restore.

## What has to happen before merging #300 to main

1. Assign a real independent database/security reviewer who inspects **all 417 changed files**, all seven legacy managed SQL files, actual original immutable 86-migration SQL bytes, dependencies, RLS/SECURITY DEFINER, grant tables and reviewed department candidate B with its activation reviewer-versus-target fix. One canonical Staff authority stack must be selected explicitly; the alternate must be retired/quarantined through reviewed code changes.
2. Take and checksum a real restricted Staging backup with role/schema/migration ledger. Restore to an isolated environment, test both baseline marketplace operations and exact chosen VOX SQL once, and record independent immutable digest, rollback and human approval. Do **not** rewrite existing ledger versions based on filename similarity.
3. Record independently signed first Team Leader reviewer authorization and verify real Supabase Auth AAL2, current neutral Staff membership/city and single-use Core nonce; the sole Owner cannot be the same reviewer.
4. On signed *protected staging*, test Staff invitation and revocation, anonymous/AAL1/AAL2, team and city IDOR, 50-way different-item work capacity, vendor public directory preservation, max-three-vendor matching, Google Places canonical location, Aarohi/Anisha/Riya human takeover+consent with no unapproved sends, AGNI read-only monitoring and rollback rehearsal.
5. Only then prepare **a distinct production-authorization record** signed by Owner and independent security/DBA reviewer, with exact source commit/OCI digest and deploy/rollback operator. No production deployment is authorized by this Markdown or the automated checker.

## Source integrity and fail-closed command

Run `node scripts/mvp/vox/verify-pr300-managed-migration-hold.mjs` for the exact Git blob SHA-1 source hash audit of the seven currently managed SQL and three new candidate SQL. `--release-check` must return **exit 42** while live schema/DBA/independent approvals are missing. Tests also detect missing/duplicated SQL and metadata tampering.

The checksum test guards **reviewed source bytes**, not executable DB migration provenance: the actual original SQL SHA-256, genuine human signatures, vault-controlled credentials, and independently verified Staging backup are outside this source CI. The job that expects exit 42 is GREEN because it correctly refuses authorization; it **does not technically disable a separate automatic migration pipeline**. Therefore #300 must remain DRAFT and not merged until migration discovery and release permissions are independently reviewed.

**Final stage:** RELEASE HOLD. No merge, auto-apply, live user/role creation or provider send.
