# VOX-08H — Current-day Staff EOD: Core-only read-only API
**Date:** 16 October 2026. **State:** SOURCE / OFFLINE TESTED ONLY — NOT PROTECTED STAGING APPROVED.

## Reuse rather than duplicate
Core already had `contracts/vox/coreWorkEodPreview.mjs` with correct per-revision self-event counts, IST business-day checks and explicit `PARTIAL_UNVERIFIED_TOTAL`. VOX-08H adds the missing safe HTTP bridge `GET /api/vox/v1/eod-preview`; it reuses `getVerifiedScopedStaff` for real Supabase AAL2, existing Core canonical prospect/vendor/support-thread tables, existing candidate work/event tables, and the previous partial report projection. **No new SQL, second report/automation execution engine, Owner identity, Staff role, provider message, approval or mutable endpoint.**

## Explicit activation gates — ALL OFF by default
The new GET responds 503 unless ALL are explicitly set to `staging` in an independently authorized protected Core staging deployment:
- `VOX_STAFF_GRANTS_ENABLED`
- `VOX_DEPARTMENT_ENFORCEMENT_ENABLED`
- `VOX_WORK_QUEUE_READ_ENABLED`
- **new** `VOX_EOD_PREVIEW_ENABLED`

These values in source are *not* a bypass for existing human DBA/security approval and do not install missing candidate SQL. Production/staging currently have zero VOX Staff tables; the route therefore remains inoperable with default flags.

## Data flow and containment
1. Reject arbitrary query parameters, arbitrary past date/team/city and all mutating HTTP verbs. Derive the CURRENT IST date on the server; create exact UTC 24h bounds using `+05:30`.
2. Verify bearer token with Supabase Auth and its actual AAL2 claim, current neutral Staff identity, live membership/expiry/revocation, city/team, and department-specific current grants using existing Core `getVerifiedScopedStaff`.
3. Core service-role SELECT ONLY from `vox_work_events_candidate_v1` filtered by **exact actor UUID AND event occurred_at range BEFORE limit**. A sentinel 101st event aborts with 503 instead of claiming truncated counts as authoritative.
4. Re-fetch ALL referenced `vox_work_items_candidate_v1` by exact IDs with **same team + city**, maximum 100; reject if any associated work row disappears or is from another scope.
5. **NEW** `currentEodCanonicalProof.mjs` checks no subject outside current Staff grants before any canonical source read. A Support thread must also have a current Core vendor grant. Verify prospect city, vendor active service zone in same city, and exact support thread -> vendor binding. Reject duplicates, missing expected rows, forged or extraneous proof rows.
6. Feed only fully verified source IDs and own work events to existing `projectCurrentCoreWorkEod`; return **aggregate only**, no IDs/PII/transcript/source reason. It must always remain `PARTIAL_UNVERIFIED_TOTAL` because the other three source-watermark families are not verified. `canSubmit:false`, `canAcknowledge:false`, `canExport:false`, `providerMessagesSent:0`, `actionsEnabled:false`.
7. Never turn verified VIEW permission into CLAIM/SEND/DONE/WHATSAPP permission. Owner/admin, team_leader and auditor are denied this *self activity* API: they require their own separate reviewed reporting adapters, not impersonation.

## Deliberate limitations / independent future signoff
- This reports **current IST day only**, counts at most 100 event rows, no historical pagination and NO audited complete 4-source daily total; high-volume actors may receive 503 rather than silently undercount. The 101 sentinel is deliberate.
- `vox_work_events_candidate_v1` may need a separately reviewed `(actor_id,created_at)` index for large datasets. **No existing candidate SQL hash or migration was edited here.** Evaluate EXPLAIN on disposable PG17 and obtain DBA signoff before real staging enablement.
- Genuine staging has no VOX Staff tables, no enrolled/verified Staff MFA, no independent first Team Leader approval. No genuine Auth AAL2 session or live end-to-end endpoint test is claimed.
- Service-role code is server-only. Race between independent Supabase reads must be examined during protected staging revision/ACL adversarial tests. Current post-query proof is a fail-closed projection guard, not an atomic transaction.
- Core Staff work event `actor_id` is an actual SQL transition actor and records historical work even if now reassigned; current subject/team/city grant revalidation still gates preview.

## Isolated QA commands (Node 20.20.2+)
```bash
node --check contracts/vox/currentEodCanonicalProof.mjs
node --test scripts/mvp/vox/validate-to08h-current-day-eod.test.mjs scripts/mvp/vox/validate-to03c-core-work-eod.test.mjs
# After npm ci: runtime route test uses only in-memory fake Supabase objects
npm ci --ignore-scripts --no-audit --no-fund
node --experimental-vm-modules --test scripts/mvp/vox/validate-to08h-eod-http.spec.mjs
npm run typecheck
```
The dedicated GitHub Action `.github/workflows/vox-to08h-eod-protected.yml` is pull-request-only, read-only checkout and no deploy secrets. PR remains **DRAFT and unmerged** pending independent SQL Auth and protected staging certification.

## Latest source QA on isolated branch
Current base integration branch HEAD 40d84a006a4d17e00c758299452a51f95c2f8d37. At source verification: all VOX *.test.mjs 189/189 PASS (includes 12 newly added pure tests); TypeScript tsc --noEmit PASS; eslint targeted route PASS; VM executed actual transpiled GET handler with fake Auth/DB 13/13 PASS, including default-off gates, happy-path masked aggregates, AAL1/revoked grant, 101 overflow, foreign city, invalid vendor, empty log and 405 writes. These mocked tests are NOT live Supabase credential tests. No managed SQL or vendor contact effects.
