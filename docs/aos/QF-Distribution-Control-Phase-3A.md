# QuickFurno AOS — Phase 3A: Distribution Control & Approval Contract

> Series: Workflow Kernel (1A/1B) → Lead Lifecycle (2A) → Orchestration Adapters (2B) → **Distribution Control (3A)**.
> Working branch: `phase/qf-distribution-control-v1`. No migration. No deployment. No merge to main.

## 1. Purpose

Phase 3A builds the **controlled distribution decision and approval contract** that sits
between "matching is done" and "vendors are assigned". It turns an authoritative
`lead.matching.completed` event into either:

- a durable **`lead.distribution.approval_required`** event carrying an immutable,
  bound recommendation snapshot (1–3 vendors), awaiting an explicit human approval; or
- a durable **`lead.manual_review.required`** event (when there are zero recommendations).

A separate, explicit human approval command then records a durable
**`lead.distribution.approved`** event. **No vendors are assigned in Phase 3A.**

## 2. Standard-route-only scope

Phase 3A applies **only** to the STANDARD marketplace route (a general auto-match lead,
`lead_intent = general_auto_match` with no preferred/target vendor and no requirement group).
The controlled approval path never touches the other two assignment models.

## 3. Why the preferred-vendor route stays separate

The preferred-vendor route (client explicitly picked one vendor from a CTA) already has its
own eligibility, single-vendor assignment RPC (`assign_lead_to_preferred_vendor`), recharge
window, and delayed remaining-slot fill inside `services/preferredVendorLeadService.ts` /
`services/delayedLeadFillService.ts`. Phase 3A must not re-implement or merge that behavior,
so the standard-route guard classifies it as `preferred_vendor_route` and **defers** it.

## 4. Why the requirement-group route stays separate

The requirement-group / client-selected route already enforces per-parent-category groups,
a 3-vendor-per-group cap, client-selection priority, a 1-hour selection window, and auto-fill
inside `services/clientRequirementGroupService.ts` (RPC `assign_vendor_to_requirement_group`).
"Client-selected vendor priority" is a sub-flow **inside** a requirement group, keyed by the
same `requirement_group_id` lead column plus group-level selection state — there is no separate
lead-level `selected_vendor_id`. Phase 3A classifies any lead with `requirement_group_id` as
`requirement_group_route` and **defers** it.

## 5. Matching recommendation snapshot contract

The resolver (`distribution/leadDistributionRecommendationResolver.ts`) loads the durable
`lead.matching.completed` event by id and validates
(`distribution/leadDistributionValidation.ts → validateRecommendationEventSnapshot`):

| Requirement | Rule |
|---|---|
| event exists | `RECOMMENDATION_EVENT_NOT_FOUND` otherwise |
| `event.id` | equals the requested recommendation event id |
| `event.event_type` | `lead.matching.completed` |
| `event.entity_type` | `lead` |
| `event.entity_id` | equals expected lead id |
| `event.correlation_id` | equals expected workflow instance id (workflow binding) |
| `payload.workflow_type` | `qf_lead_lifecycle` |
| `payload.lead_id` | equals expected lead id |
| `recommended_vendor_count` | integer in `[0, 3]` |
| `recommended_vendor_ids` | array; length equals count; all trimmed, non-empty, **unique** strings |

The resolver **never** re-runs matching and **never** calls a ranking function
(`getEligibleVendorsForLead`, `runAutoLeadMatchingForLead`, …). The recommendation order is
authoritative.

## 6. Immutable recommendation binding

The resolver returns a frozen snapshot:
`{ recommendationEventId, leadId, workflowInstanceId, recommendedVendorIds, recommendedVendorCount }`.
Every downstream decision (approval-required event, approved event) is bound to this snapshot;
the vendor id order is preserved exactly and never re-ranked, appended to, or trimmed.

## 7. Zero-recommendation behavior

If the authoritative matching event has `recommended_vendor_count = 0` and
`recommended_vendor_ids = []`, the approval-preparation task publishes
**`lead.manual_review.required`** with safe facts only:
`{ workflow_type, lead_id, reason: "no_distribution_recommendations", recommendation_event_id }`.
It **never** publishes `approval_required` for zero recommendations, never fabricates a
reviewer, and never emits `lead.manual_review.resolved`.

## 8. Approval-required flow (the standard route)

```
lead.matching.completed
  └─(handler)→ MATCH_RECOMMENDATION_READY
       └─ opens task: lead.distribution.prepare_approval  (triggered_by_event = matching event id)
            ├─ resolve immutable recommendation snapshot (no rerun)
            ├─ standard-route guard
            │    └─ special route → deferred_special_route (publishes nothing)
            ├─ count = 0 → lead.manual_review.required
            └─ count 1..3 → lead.distribution.approval_required (bound snapshot)
                 └─(handler)→ DISTRIBUTION_APPROVAL_PENDING
                      └─ explicit human approval command
                           └─ lead.distribution.approved
                                └─(handler)→ DISTRIBUTION_PENDING  (Phase 3B later)
```

The preparation task publishes **at most one** result event (Phase 2B invariant preserved via
the task-result idempotency key). A retry of the same task reproduces the same event; a changed
decision on retry would raise `DOMAIN_EVENT_IDEMPOTENCY_CONFLICT` rather than emit a second event.

## 9. Human approval command

`distribution/leadDistributionApprovalService.ts → approveLeadDistribution(input, deps)` is a
**callable backend domain service**, not a UI route:

```ts
approveLeadDistribution({
  workflowInstanceId, leadId, recommendationEventId,
  approvedVendorIds, approvedBy, reason?,
}, deps)
```

## 10. Approved subset rules

- `approvedBy`: required, trimmed, non-empty.
- `approvedVendorIds`: array, **1..3**, unique, non-empty strings.
- Approved ids must be a **subset** of the recommended ids.
- No vendor may be approved that was not recommended.

## 11. Recommendation-order preservation

Approved ids must appear in the **same relative order** as the recommendation snapshot.
For recommendation `[A, B, C]`:

| Approved | Result |
|---|---|
| `[A]`, `[A,B]`, `[A,B,C]`, `[A,C]` | valid |
| `[B,A]`, `[C,B]` | rejected (`DISTRIBUTION_APPROVED_ORDER_NOT_PRESERVED`) |
| `[A,D]` | rejected (`DISTRIBUTION_APPROVED_VENDOR_NOT_RECOMMENDED`) |

## 12. Approval identity

Approval requires that the recommendation snapshot belongs to the **same lead** and **same
workflow**, that the route is standard (special routes are rejected with
`DISTRIBUTION_SPECIAL_ROUTE_NOT_ALLOWED`), and that authoritative workflow state is loaded and
equals `DISTRIBUTION_APPROVAL_PENDING`.

## 13. Approval idempotency

Human approval is **not** a workflow task-result event, so it uses a dedicated deterministic key:

```
qf_lead_lifecycle:distribution_approval:{workflow_instance_id}:{recommendation_event_id}
```

- Same workflow + same recommendation + same lead + same approved vendors + same approver +
  same material payload → **reuse** the existing approved event (first valid approval wins).
- Same key, different approved vendors / different lead / different recommendation snapshot →
  **`DISTRIBUTION_APPROVAL_IDEMPOTENCY_CONFLICT`**.
- Unrelated persistence errors are **rethrown**, never swallowed.

## 14. Workflow state requirement

The approval service loads the workflow authoritatively (`getWorkflowInstanceById`) and refuses
any approval unless `current_state === DISTRIBUTION_APPROVAL_PENDING`, `workflow_type ===
qf_lead_lifecycle`, and the workflow's lead identity matches.

## 15. Task-result idempotency vs human-approval idempotency

| | Producer | Key |
|---|---|---|
| approval_required / manual_review.required | `prepare_approval` task | `qf_lead_lifecycle:task_result:{task_id}` (Phase 2B) |
| approved | human approval command | `qf_lead_lifecycle:distribution_approval:{workflow_instance_id}:{recommendation_event_id}` |

These are intentionally distinct so a machine task retry and a human re-approval never collide.

## 16. Auto-authorization disabled

`lead.distribution.auto_authorized` remains an **inactive future capability** in the state
machine. Phase 3A **must not** publish it, activate it, or build any automatic policy for it;
Phase 4 owns automation policy. Source and behavioral tests assert Phase 3A never emits it.

## 17–22. Explicit non-goals (enforced by tests)

Phase 3A performs **no** vendor assignment (17), **no** credit mutation/deduction (18), **no**
delivery (`deliverLeadToVendorDashboard` / vendor WhatsApp preview / client preview) (19), **no**
WhatsApp send (20), **no** n8n / webhook call (21), and **no** production worker / cron / PM2
change (22). `lead.distribution.await_approval` stays a non-side-effect marker; it never
auto-approves, fabricates an approver, or assigns.

## 23. Staging DB requirement before Phase 3B execution validation

The pure decision/approval contract is DB-agnostic and fully covered by the in-memory harness.
Before Phase 3B exercises real assignment against the durable tables, a **staging database**
should be provisioned so `workflow_instances`, `workflow_tasks`, and `domain_events` can be
integration-tested without touching production leads.

## 24. Phase 3B direction

Phase 3B consumes the durable `lead.distribution.approved` event (state `DISTRIBUTION_PENDING`)
and performs the **actual** standard-route assignment — reusing the existing tested assignment
primitives, deducting credits, and creating delivery/preview artifacts — under the same
one-task-one-result, idempotent, retry-safe kernel guarantees. Preferred-vendor and
requirement-group routes remain owned by their existing services until a dedicated future
orchestration migration.

## File map

```
lib/aos/workflows/leadLifecycle/distribution/
  leadDistributionTypes.ts                     # pure contracts + port interfaces
  leadDistributionValidation.ts                # pure snapshot/payload validation
  leadDistributionRecommendationResolver.ts    # load + normalize matching event → snapshot
  leadDistributionRouteGuard.ts                # standard vs preferred vs requirement-group
  leadDistributionApprovalPublisher.ts         # durable approved event (dedicated key)
  leadDistributionApprovalService.ts           # human approval command (backend)
  leadDistributionAdapters.ts                  # Supabase-backed default ports (not run in 3A)
```

Modified (minimal): `leadLifecycleTaskIntents.ts` (new intent), `leadLifecycleHandler.ts`
(state→task mapping + approval payload validation), `execution/leadLifecycleTaskExecutor.ts`
(prepare_approval case), `execution/leadLifecycleTaskExecutionTypes.ts` (deferred_special_route
status), `events/leadLifecycleEventPublisher.ts` (export Supabase repo for reuse).

## Tests

`npm run test:phase3a` → `scripts/phase3a-distribution-control-harness.mjs`. The prior
diagnostics harness is preserved as `npm run test:phase3a:diagnostics`.
