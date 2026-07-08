# QuickFurno — Lifecycle Decision Integration & Unified Authorization Execution (Phase 4B-2)

> Integrates the Phase 4A deterministic policy engine into the durable lead
> lifecycle. Activates strict `auto_authorized` publishing **in code only**. No
> production worker, no deployment, no new migration, safe defaults remain
> human-approval-only.

Harness: [`scripts/phase4b2-policy-lifecycle-integration-harness.mjs`](../../scripts/phase4b2-policy-lifecycle-integration-harness.mjs)
(`npm run test:phase4b2`).

---

## 1. New policy-evaluation task

A new task intent `DISTRIBUTION_POLICY_EVALUATE` (`lead.distribution.policy_evaluate`)
is opened on entering `MATCH_RECOMMENDATION_READY`. The historical
`DISTRIBUTION_PREPARE_APPROVAL` executor path is retained for backward
compatibility with historical durable tasks/tests, but **new** transitions into
`MATCH_RECOMMENDATION_READY` create only the policy-evaluation task. Never both.

Task idempotency key is unchanged in shape:
`qf_lead_lifecycle:task:<workflowInstanceId>:<matchingEventId>:<taskIntent>` — no
timestamp, no random value.

## 2. Policy task dependencies (read-only)

1. **Exact recommendation snapshot** — `resolveLeadDistributionRecommendation(...)`
   against the exact triggering `lead.matching.completed` event id. Never reruns
   matching, reranks, truncates, or appends.
2. **Current route** — `resolveLeadDistributionRoute(...)`.
3. **Latest authoritative quality** — the existing latest-persisted quality port
   (`readLatestQualityResult`). It consumes ONLY `score_class`, `total_score`,
   `hard_block_reason`, `recommended_action`. It never calls `scoreLead()`,
   `calculateLeadQuality()`, `scoreAndStoreLead()`, or rescores.
4. **Durable policy config snapshot** — the Phase 4B-1 runtime loader
   (`loadAutomationPolicyConfigSnapshot`). Active config → validated immutable
   snapshot; no active pointer → Phase 4B-1 safe default; DB error → throw/retry;
   integrity failure → throw (fail closed). A DB outage is never converted into
   "no active config", and a config read/integrity error never auto-authorizes.

## 3. Exact PII-free policy facts

`buildLeadDistributionAuthorizationFacts(...)` builds:

```
policyKey            = lead_distribution_authorization
workflowType         = qf_lead_lifecycle
workflowInstanceId   = durable workflow instance id
leadId               = canonical task lead id
currentLifecycleState= MATCH_RECOMMENDATION_READY
routeClassification  = route classifier result
quality              = { scoreClass, totalScore, hardBlockReason, recommendedAction }
recommendation       = { recommendationEventId, recommendedVendorCount, recommendedVendorIds }
```

No client PII (name, phone, email, WhatsApp, address, raw message, budget text,
GPS) is ever read or included.

## 4. Evaluate the Phase 4A policy

The task calls the **existing** `evaluateDistributionAuthorizationPolicySafely(facts,
snapshot.config)` — no duplicated policy logic, no rewritten thresholds, no second
evaluator. Before publishing, the decision is bound to the exact config that
produced it: `decision.policyKey`/`policyVersion`/`policyFingerprint` must equal the
snapshot's; any mismatch fails loudly (`POLICY_DECISION_CONFIG_*_MISMATCH`).

## 5. Reusable policy audit builder

`buildPolicyDecisionAuditPayload(decision, snapshot)` deterministically produces the
Phase 4B-1 audit fields (`policy_key`, `policy_version`, `policy_fingerprint`,
`policy_decision`, `policy_reason_code`, `policy_config_id`, `policy_config_source`,
`policy_facts_summary`, `policy_passed_gates`, `policy_failed_gates`). It is
validated through `validatePolicyDecisionAuditContract` before any publish. No
timestamp, attempt, worker id, hostname, random id, or PII.

## 6. Decision mapping

| Decision | Event published | Notes |
|---|---|---|
| `REQUIRE_HUMAN_APPROVAL` | `lead.distribution.approval_required` | recommendation snapshot + full audit. Existing human approval flow unchanged (→ `DISTRIBUTION_APPROVAL_PENDING` → explicit approval → `distribution.approved` → `DISTRIBUTION_PENDING`). No fabricated approval. |
| `AUTO_AUTHORIZE` | `lead.distribution.auto_authorized` | `authorized_vendor_ids` **exactly equals** `recommended_vendor_ids` (same count, same order). No subset/reorder/replace/truncate/extra. Validated by `validateDistributionAutoAuthorized` before publish. |
| `MANUAL_REVIEW` | `lead.manual_review.required` | `reason` derived deterministically from the policy reason code, + recommendation id + audit. No fabricated review resolution. |
| `DEFER_SPECIAL_ROUTE` | *(none)* | Non-standard route is deferred with a `deferred_special_route` task result carrying PII-free decision metadata. No approval/auto/manual event, no assignment, no credit. The existing route owner remains responsible. |

Route ownership is checked **before** config/quality/policy, so a special route
never depends on policy config or quality availability and stays fully isolated.

## 7. Retry-stable policy result pre-read

Before evaluation, the task computes the deterministic per-task result idempotency
key and looks up any durable result event already stored for the workflow task:

- **None found** → proceed with authoritative reads + evaluation.
- **Found** → validate exact scope (entity type/lead/workflow/causation), the
  recommendation binding, the allowed result event type
  (`approval_required` / `auto_authorized` / `manual_review.required`), and the
  payload contract (`approval_required` audit decision = `require_human_approval`;
  `auto_authorized` passes the strict Phase 4B-1 validator; `manual_review.required`
  audit decision = `manual_review`). Then **reuse** the existing event: do NOT
  reload config, re-read quality, re-evaluate, or republish. Any mismatch fails
  loudly with `POLICY_RESULT_REPLAY_INTEGRITY_ERROR:<detail>`.

This preserves the existing one-task→one-result rule even if config changed
between attempts: a re-run reuses the first result rather than publishing a
conflicting payload under the same task-result key.

## 8. Unified Phase 3B authorization input

The `DISTRIBUTION_PREPARE` task now resolves the neutral
`LeadDistributionAuthorizationSnapshot` via
`resolveLeadDistributionAuthorizationSnapshot(...)`:

- **Human approval** (`distribution.approved`) → `authorizationSource =
  human_approval`, `authorizedVendorIds =` approved subset.
- **Policy auto-authorization** (`distribution.auto_authorized`) →
  `authorizationSource = policy_auto_authorization`, `authorizedVendorIds =`
  exact recommendation set.

The assignment task executes ONLY `snapshot.authorizedVendorIds`. The existing
credit-safe boundary and its param name (`approvedVendorIds`) are retained to avoid
Phase 3B churn; it now carries the neutral authorized set. Never reruns matching,
reranks, appends, or replaces skipped vendors. All Phase 3 assignment safety
(credit-safe RPC, authoritative `lead_assignments` truth read-back, replay-safe
canonicalization, 3-vendor cap) is preserved.

## 9. Route change after authorization

The route recheck immediately before assignment is preserved. If the lead is no
longer standard route, the task publishes manual review with reason
`distribution_route_changed_after_approval` and a payload identifying the
authorization event id, authorization source, recommendation id, authorized
count/ids, and route classification. No assignment, no credit mutation.

## 10. Generic distribution.completed contract

A neutral completed authorization contract is introduced
(`validateDistributionAuthorizationCompleted`): `authorization_event_id`,
`authorization_source`, `recommendation_event_id`, `authorized_vendor_count`,
`authorized_vendor_ids`, `distributed_vendor_count`, `distributed_vendor_ids`,
`skipped_vendor_ids`. The partition rules are unchanged: distributed + skipped
exactly partition the authorized set, order-preserving, disjoint, 1..3 distributed.

**Backward compatibility.** The legacy validator (`validateDistributionCompleted`,
`approval_event_id` / `approved_*`) is kept unchanged. The handler accepts BOTH via
`validateDistributionCompletedAuthorization`, which validates the neutral shape or
normalizes a legacy human payload (source = `human_approval`). To keep historical
Phase 3B behavior byte-identical, the executor emits the **legacy** completed shape
for human approvals and the **neutral** shape for policy auto-authorizations.

## 11. Human approval unchanged

The explicit `approvedBy` requirement, approved-subset validation,
recommendation-order preservation, exact recommendation binding, approval-pending
state requirement, and human-approval idempotency are all unchanged. The human
approval command service remains authoritative for human approvals.

## 12. Policy config safety

- No active pointer → Phase 4B-1 safe default → `enabled=false` → human approval.
- Valid active guarded config → may auto-authorize only when every gate passes.
- DB read failure → task fails and retries/dead-letters per the kernel policy.
- Config integrity failure → task fails closed → no auto-authorization.
- Unsupported policy version → no auto-authorization (config integrity rejects it).
- Safe-default source can never produce a valid `auto_authorized` contract (the
  strict validator requires `active_config` source + non-empty config id + zero
  failed gates).

## 13. No new migration

Phase 4B-2 adds no migration and uses the Phase 4B-1 migration
(`20260706000150_automation_policy_config_foundation.sql`) unchanged. It is not
applied to production.

## Non-goals honored

No change to quality thresholds; no rescoring inside policy execution; no matching
rerun; no vendor rerank; no different auto-authorized subset; no replacement
vendors; no assignment-RPC credit-logic change; no AOS credit math; 3-vendor
maximum preserved; special routes never merged into standard distribution; no
WhatsApp; no n8n; no provider outbox execution; no production worker; no PM2/UI
change; no deployment; no merge to main; no production Supabase or migration apply.
