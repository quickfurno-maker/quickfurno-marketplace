# QuickFurno AOS — Phase 3B: Credit-Safe Assignment Execution & Authoritative Dashboard Delivery

> Series: Kernel (1A/1B) → Lifecycle (2A) → Adapters (2B) → Distribution Control (3A) → **Assignment Execution (3B)**.
> Working branch: `phase/qf-assignment-execution-v1`. No migration. No deployment. No merge to main.

## 1. Purpose

Phase 3B executes **only the exact approved standard-route vendor subset** through the existing
credit-safe assignment boundary, derives canonical assignment truth, and advances the lifecycle to
`DISTRIBUTED` only when at least one approved vendor is actually assigned. It reruns no matching,
reranks nothing, appends no replacement vendors, performs no credit math in the AOS layer, writes no
delivery/preview log, sends no WhatsApp, and calls no n8n.

## 2. Approved-event snapshot resolver

`lead.distribution.prepare` is opened when the workflow enters `DISTRIBUTION_PENDING`; its
`payload_json.triggered_by_event` is the exact `lead.distribution.approved` event that caused the
transition. `leadDistributionApprovedSnapshotResolver.ts` loads that durable event by id and
validates (via `validateApprovedEventSnapshot`):

| Requirement | Rule |
|---|---|
| `event.id` | equals the requested approval event id |
| `event.event_type` | `lead.distribution.approved` |
| `event.entity_type` / `entity_id` | `lead` / expected lead id |
| `event.correlation_id` | expected workflow instance id |
| `payload.workflow_type` / `lead_id` | `qf_lead_lifecycle` / expected lead id |
| recommendation snapshot | `recommendation_event_id`, count 1..3, unique ids, count matches |
| approved snapshot | count 1..3, unique ids, count matches, **subset of recommended, approved-order preserving** |
| `approved_by` | required, trimmed, non-empty |

Returns a frozen snapshot: `{ approvalEventId, recommendationEventId, leadId, workflowInstanceId,
recommendedVendorIds, recommendedVendorCount, approvedVendorIds, approvedVendorCount, approvedBy }`.
No matching rerun, no new ranking.

## 3. Exact approved execution binding

The assignment boundary receives **`approvedVendorIds` only**. For recommended `[A,B,C]`, approved
`[A,C]`, Phase 3B passes `[A,C]` — never `[A,B,C]`, never refilling `B`, never appending `D`, never
re-matching.

## 4. Assignment port + real adapter

`LeadDistributionAssignmentPort.assignApprovedVendors({ leadId, approvedVendorIds })`. The real
adapter (`leadDistributionAssignmentAdapter.ts`) wraps the existing **`assignLeadToMatchedVendors`**
(RPC `assign_lead_to_paid_vendors_phase26a`) and reuses its credit math, package decrement,
assignment-insert, and lead-lock logic verbatim. The AOS layer duplicates none of it. A failed
(`ok:false`) result — including `MIGRATION_NOT_APPLIED`, connectivity, or RPC execution errors — is
**thrown** so it fails loudly into the workflow retry/dead-letter path and is never reported as a
successful distribution.

## 5. Assignment result contract + validation

`leadDistributionAssignmentValidation.ts` never trusts a malformed authoritative result. It
validates: `leadId` matches; each assigned `vendorId`/`assignmentId` is a trimmed non-empty string;
vendor ids unique; assigned count 0..3. Structural corruption (wrong lead, dup vendor, missing
assignment id, count > 3) → the mapper returns `{ ok:false }` and the executor **throws** (fail
loudly). Then the mapper checks scope: any assigned vendor **outside** the approved subset → a
deterministic manual-review outcome (never a silent accept).

## 6. `already_assigned` replay safety

The RPC returns `already_assigned` (with all existing `lead_assignments` for the lead) when a prior
attempt committed but the task retried. Phase 3B does **not** blindly trust it: it validates the
existing assigned vendor ids are a subset of the approved ids (count 1..3). If valid → treated as
replayed authoritative truth and canonicalized identically to a fresh assignment. If not →
`lead.manual_review.required` with reason `existing_assignment_outside_approval_scope`. The AOS layer
never deducts or compensates a credit.

## 7. Canonical result ordering (deterministic across fresh vs replay)

Given approved `[A,B,C]` and an actual assigned set `{C,A}` (in any DB order), the outcome is always:

```
distributed_vendor_ids = [A, C]   # approved-order intersection
skipped_vendor_ids      = [B]      # approved-order complement
```

Ordering is by the **approved snapshot**, never by DB aggregation order, so the outcome is identical
for a fresh `ok` result `[A,C]` and an `already_assigned` replay `[C,A]`.

## 8. One task → one durable result event (retry safety)

The durable `lead.distribution.completed` payload carries **only** vendor ids/counts + durable event
ids — no `rpc_status`, no `assignment_reused`, no `worker_id`, no `attempt_count`, no timestamps, no
random values, no assignment ids, no credits. Because it is byte-identical across a fresh assignment
and an `already_assigned` replay, the same task's retry resolves to the **same task-result event key**
(`qf_lead_lifecycle:task_result:{task_id}`) via the existing `LeadLifecycleEventPublisher`, leaving
**exactly one** durable event. Volatile facts live only in non-lifecycle task diagnostics
(`workflow_tasks.result_json`).

## 9. Outcome routing

| Authoritative result | Outcome |
|---|---|
| structural corruption / `ok:false` from boundary | **throw** → retry / dead-letter (fail loudly) |
| route changed to a special route since approval | `manual_review.required` — `distribution_route_changed_after_approval` |
| assigned vendor outside approved (fresh) | `manual_review.required` — `assignment_outside_approval_scope` |
| assigned vendor outside approved (`already_assigned`) | `manual_review.required` — `existing_assignment_outside_approval_scope` |
| 0 assigned (`no_eligible_vendors` / `skipped_duplicate`) | `manual_review.required` — `approved_vendors_no_longer_assignable` |
| 1..3 approved-subset assigned | `lead.distribution.completed` (partial or full) |

Zero assigned moves `DISTRIBUTION_PENDING → MANUAL_REVIEW_PENDING`; it never publishes
`distribution.completed`, never fabricates a reviewer, and never emits `manual_review.resolved`.
Partial (1 or 2 of 3) is a valid completion — QuickFurno's contract is *up to* 3 vendors; no
replacement is fabricated and matching is never rerun (replacement/recovery policy is out of Phase
3B scope).

## 10. `distribution.completed` payload contract

Required: `workflow_type, lead_id, approval_event_id, recommendation_event_id, approved_vendor_count,
approved_vendor_ids, distributed_vendor_count, distributed_vendor_ids, skipped_vendor_ids`.
`validateDistributionCompleted` enforces: approval/recommendation ids present; approved count 1..3 with
matching unique list; distributed count 1..3 with matching unique list; **distributed ⊆ approved,
approved-order preserving**; skipped unique, disjoint from distributed, approved-order preserving; and
**distributed + skipped exactly partition approved**.

```
approved [A,B,C]  valid:   distributed [A,C]  skipped [B]
                  invalid: distributed [C,A]                 (order)
                  invalid: distributed [A,D]                 (non-subset)
                  invalid: distributed [A] skipped [C]       (B lost from partition)
```

## 11. Authoritative dashboard delivery

**A `lead_assignments` row is the authoritative internal vendor-dashboard delivery truth.**
`services/vendorService.ts → getVendorAssignedLeads` reads `lead_assignments` joined to `leads`, so a
committed assignment row *is* the authorization for a vendor to see the assigned lead.

Phase 3B therefore does **not** call `deliverLeadToVendorDashboard`, `createVendorLeadWhatsappPreview`,
or `createClientAssignedVendorsPreview`. Those perform separate `lead_delivery_logs` /
`client_notification_logs` inserts and must **not** be coupled to the retry of a credit-affecting
assignment task. Lifecycle completion depends on the authoritative assignment result, not on auxiliary
preview-log success. The legacy delivery/preview logs remain untouched and are not the source of
dashboard access.

## 12. Standard route only

Before executing, Phase 3B re-runs the Phase 3A route guard. If the lead now resolves to
`preferred_vendor_route`, `client_selected_route`, or `requirement_group_route`, it does **not**
assign and does **not** call the special-route services; because the workflow is already in
`DISTRIBUTION_PENDING`, it publishes `lead.manual_review.required` with reason
`distribution_route_changed_after_approval` (a durable escape path) — never a silent special-route
completion.

## 13. Error mapping (business outcome vs transient failure)

- **Business outcomes** (no currently-assignable approved vendors, out-of-scope assignment) →
  deterministic `manual_review.required`, not infinite retry.
- **Infrastructure / RPC execution / connectivity** failures → thrown into existing workflow retry
  handling.
- **Configuration / schema-not-ready** (`MIGRATION_NOT_APPLIED`) → fail loudly (thrown); never
  reported as a successful distribution. `UNKNOWN` / DB connectivity / RPC errors are never swallowed.

The global retry policy is unchanged.

## 14. Staging DB gate (mandatory before live activation)

The Phase 3B code + injected harness are complete without production DB access, but real assignment
execution is **not** production-ready until an isolated staging/test Supabase has validated: (1)
Workflow Kernel migrations; (2) `assign_lead_to_paid_vendors_phase26a` availability; (3) lead-lock
concurrency; (4) same-task retry; (5) credit deducted exactly once; (6) assignment row created exactly
once; (7) `already_assigned` recovery; (8) partial assignment; (9) zero-assignment; (10) event
publication retry; (11) task completion retry. **Do not run real assignment against production.**

## File map

```
lib/aos/workflows/leadLifecycle/distribution/
  leadDistributionApprovedSnapshotResolver.ts   # approved event → immutable snapshot
  leadDistributionAssignmentTypes.ts            # port + result + outcome + reasons (pure)
  leadDistributionAssignmentValidation.ts       # structural result validation (pure)
  leadDistributionAssignmentResultMapper.ts     # canonical outcome (pure)
  leadDistributionAssignmentAdapter.ts          # wraps assignLeadToMatchedVendors (not run in 3B harness)
```

Modified: `leadDistributionValidation.ts` (+`validateApprovedEventSnapshot`, `validateDistributionCompleted`),
`leadDistributionTypes.ts` (approved snapshot types), `execution/leadLifecycleTaskExecutor.ts` (enabled
`lead.distribution.prepare`), `leadLifecycleHandler.ts` (strict `distribution.completed` validation),
`leadDistributionAdapters.ts` (assignment port in the executor factory), `package.json`.

## Tests

`npm run test:phase3b:aos` → `scripts/phase3b-assignment-execution-harness.mjs`. The historical
`test:phase3b` (`scripts/phase3b-recovery-harness.ts`) is preserved and untouched.
