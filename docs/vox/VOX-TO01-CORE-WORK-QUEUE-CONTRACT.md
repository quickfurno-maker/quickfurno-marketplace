# VOX Team Operations TO-01 — source-only queue and EOD projection contract

**Release HOLD. Pure authorization-aware output projection, no database/API mutation.**

This branch is stacked on the unmerged VOX Phase A staff recovery candidate commit `9ccb54b960bfc6f640ac7a8080345922b2eb1866`. It must be independently reviewed before integration.

## What this implements
- `contracts/vox/teamOperations.mjs`: strict read-only queue and EOD event projections with bounded inputs and no sensitive source body, customer/vendor details, or executable actions.
- Verified Core AAL2 actor context is a **caller prerequisite**, not supplied by this pure module and not accepted from browsers. Use existing `getVerifiedScopedStaff` and governed owner bearer flows.
- Exact canonical city/team matches, role- and object-scoped subject reference projection, privacy-safe Team Leader metadata, no user-selected unrestricted city.
- Read-only report preview with a source completeness watermark deliberately marked UNVERIFIED. No claims of completed staff work from fabricated metrics.
- Negative and positive synthetic test cases under `scripts/mvp/vox/validate-to01-team-contracts.test.mjs`.

## What does NOT exist yet
No durable `vox_work_items` table, no migrations, no real queue Core GET, no assignment/claim/transfer/close RPC, no notifications, no internal chat, no WhatsApp reply broker, no actual scheduled daily report, no Core API rollout and no production/staging schema change. **These must be developed in TO-02/03 after independent schema and Core governance review.**

## Security design prerequisites
- Input rows MUST be fetched from Core scoped queries with active grants and exact team/city, not public clients or service-role-wide unfiltered scans.
- The projection is a second-boundary data minimizer, not the first-line authorization mechanism.
- Use row-level scope, tenant-safe cursor pagination, revision-matched atomic transactions for future actions, separate 2-person approval for permission grants, and no direct provider/financial actions.
- Never identify staff by mutable email. Ensure AAL2, role grants and revocations remain current.
- Preserve unrelated 3-vendor marketplace lead matching.

## Verify on Node 20+ (safe, offline, no credentials)

```bash
node --test scripts/mvp/vox/validate-to01-team-contracts.test.mjs
```

Any CI success on this branch proves only the pure source contract tests; full DB/identity staging remains an independent prerequisite. See Notion TO-01..TO-04 Delivery Board and QA Gate Matrix.
