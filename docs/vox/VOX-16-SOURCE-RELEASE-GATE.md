# VOX-16 — Full SQL staging rehearsal and native task replay hardening

**State: source candidate only. Production and staging writes: NONE. All flags OFF.**

## Parallel lane A: exact database contract
- Added disposable `postgres:17-alpine` fixture testing **all seven 20261014 VOX migrations in chronological order**, not only migrations 01/06/07 as earlier independent QA did.
- Synthetic foundational Core roles/profiles/city and native Aarohi CRM task+event tables satisfy existing foreign-key dependencies. No real user, token, phone or vendor data enters the fixture.
- After applying exactly seven SQL files, checks required forced RLS for the VOX tables, forbids direct `anon` and `authenticated` table access, prevents executing sensitive SECURITY DEFINER functions, and allows service-role-only internal execution.
- Container isolated with `--network none` and deleted at the end. This is NOT a backed-up production/staging database restore, not a live privilege test, and not permission to apply migrations.

## Parallel lane B: native Vendor CRM exactly-once retry semantics
- Reuses canonical `vendor_tasks` and its existing unique partial `uq_vendor_tasks_idempotency` index; never constructs a parallel VOX CRM table or sends provider messages.
- Previous writer used read-before-insert, which can surface a race-driven 23505 on concurrent requests. It also returned an existing task ID for the same key without comparing current vendor, actor or task fields.
- Writer now rejects reused keys with different vendor, actor, type, title, description, priority or due date. It recovers only from `23505` duplicate-key inserts, reads the canonical committed row and returns that same task ID **only if the whole immutable payload matches**. Unknown DB errors fail closed.
- This strengthens retries for both the internal VOX Service Desk and shared CRM task writer. It does not authorize new class of task, grant, support reply, vendor mutation or wallet action.

## Source/CI evidence and unresolved launch gates
- Local PostgreSQL full sequence, privileges, 17/17 pure native task guards and unchanged seven-migration pin preflight PASS. Run CI on the exact new PR head; no source change is certified until the exact-head workflow completes.
- Still REQUIRED: reviewed Staging backup and restore proof, migration applied against a real staging backup, real staff/owner MFA AAL2, city/object/Team Leader negative tests, concurrent HTTP integration against actual vendor_tasks table, signed Jarvis/AGNI connections, consumer consent and provider delivery/rollback, load and application rollback.
- This new work is stacked on draft Core PR #233. **DO NOT double merge** constituent stacked PRs. Release remains **HOLD**.
