# QuickFurno — Central Automation Policy Engine (Phase 4A)

> **Phase 4A builds ONLY the deterministic policy-engine foundation.**
> It is NOT integrated into the live lead lifecycle. It activates NO
> auto-authorization, publishes NO events, writes NO database rows, applies NO
> migration, and is NOT deployed. Phase 4B (later) will decide how the decision is
> consumed at `MATCH_RECOMMENDATION_READY`.

Location: [`lib/aos/policy/`](../../lib/aos/policy). Harness:
[`scripts/phase4a-policy-engine-harness.mjs`](../../scripts/phase4a-policy-engine-harness.mjs)
(`npm run test:phase4a`).

---

## 1. Policy engine purpose

The Central Automation Policy Engine is a pure, deterministic, explainable,
fail-closed decision layer that answers a single question:

> **Given authoritative facts, what automation authority is currently permitted?**

For Phase 4A it defines one policy — `lead_distribution_authorization` — which
returns exactly one of four decisions for a lead that has reached the point where
a distribution decision is needed:

- `require_human_approval`
- `auto_authorize`
- `manual_review`
- `defer_special_route`

The engine only *states* the permitted authority. It never acts on it: no vendor
selection, no truncation/append/re-rank of recommendations, no credit math, no
assignment, no event, no DB write.

## 2. Difference between the quality decision and the automation decision

These are two different authorities and must never be conflated:

| | Lead Quality Engine (`services/leadQualityService.ts`) | Automation Policy Engine (`lib/aos/policy/`) |
|---|---|---|
| Question | *Is the lead qualified, and what action is recommended?* | *Given those authoritative facts, what automation authority is permitted right now?* |
| Produces | `score_class`, `total_score`, `hard_block_reason`, `recommended_action` | `require_human_approval` / `auto_authorize` / `manual_review` / `defer_special_route` |
| Owns | Scoring model, thresholds, bands (A+/A/B/C/D) | Authorization gates on top of the quality facts |

The Policy Engine **consumes** the Quality Engine's authoritative facts. It does
**not** re-score, invent a second quality model, or change any score threshold.
The A+ band, the 70/85/... bands, and `canAutoDistributeLead` remain owned solely
by the Quality Engine.

## 3. Difference between marketplace `auto_assignment_mode` and automation authority

The marketplace runtime setting `auto_assignment_mode`
(`lib/lead-assignment/runtimeSettings.ts`) supports `off | preview | auto_suggest`.
These describe the *marketplace runtime mode*. They are a **separate concept** from
automation authority. In particular, `auto_suggest` is **not** permission to
auto-authorize distribution, deduct credits, or assign vendors. Phase 4A does not
read, import, or modify `runtimeSettings.ts`; the policy `mode` field
(`human_approval_only | guarded_auto_authorize | manual_review_only`) is an
independent, policy-owned concept.

## 4. Policy facts contract

Immutable facts the policy consumes (`LeadDistributionAuthorizationFacts`):

```
policyKey                (= lead_distribution_authorization)
workflowType
workflowInstanceId
leadId
currentLifecycleState
routeClassification      (Phase 3 route classification)
quality:
  scoreClass             (A+ | A | B | C | D)
  totalScore             (integer 0..100)
  hardBlockReason        (string | null)
  recommendedAction      (LeadQualityRecommendedAction)
recommendation:
  recommendationEventId
  recommendedVendorCount  (integer 0..3)
  recommendedVendorIds    (unique, non-empty; length === count)
```

## 5. PII exclusion (hard rule)

The facts contract and the decision result contain **no client PII**. They must
never carry: `name`, `phone`, `email`, WhatsApp number, `address`, raw client
message, budget text, or GPS coordinates. Vendor ids and durable workflow/event
ids are allowed. The explainability summary exposes hard-block **presence as a
boolean** (`hardBlockReasonPresent`) rather than any downstream reason string.

## 6. Policy config contract

`LeadDistributionAuthorizationPolicyConfig`:

```
policyVersion
mode                              (human_approval_only | guarded_auto_authorize | manual_review_only)
enabled
minimumAutoAuthorizeScore         (integer 0..100)
allowedAutoAuthorizeScoreClasses  (non-empty subset of A+/A/B/C/D)
requireNoHardBlock
requiredRecommendedAction         (LeadQualityRecommendedAction)
minimumRecommendationCount        (integer 0..3)
maximumRecommendationCount        (integer 1..3)
```

These are **automation authorization gates only**. They do **not** change any
quality classification threshold.

## 7. Safe defaults

`SAFE_DEFAULT_LEAD_DISTRIBUTION_AUTHORIZATION_POLICY_CONFIG` is the most
conservative configuration:

```
mode                              = human_approval_only
enabled                           = false
minimumAutoAuthorizeScore         = 90
allowedAutoAuthorizeScoreClasses  = ["A+"]
requireNoHardBlock                = true
requiredRecommendedAction         = "auto_distribute"
minimumRecommendationCount        = 1
maximumRecommendationCount        = 3
```

With defaults, the policy is disabled and would require human approval; even if
enabled and switched to guarded mode it would still demand A+ / score ≥ 90 / no
hard block / `auto_distribute` / 1..3 recommendations.

## 8. Fail-closed behavior

Unknown or malformed configuration must **never** expand automation authority.
Any unknown mode, out-of-range score, empty/invalid allowed-class list, invalid
vendor bounds (`max > 3`, `min > max`, `min < 0`), or missing required action
produces a validation failure. On config validation failure the decision is
`require_human_approval` with reason `policy_config_invalid_fail_closed`. A more
permissive value is never silently substituted. The safe wrapper
`evaluateDistributionAuthorizationPolicySafely(...)` additionally guarantees that
any unexpected throw fails closed to `require_human_approval` — a throw can never
leak into auto-authorization.

## 9. Decision precedence (deterministic)

Evaluated in strict order; **fail-fast on the first failing gate**:

1. **Validate facts** — malformed → `manual_review` (`policy_facts_invalid`).
2. **Route ownership** — non-standard route → `defer_special_route`
   (`special_route_owned_elsewhere`).
3. **Recommendation** — malformed snapshot → `manual_review`
   (`recommendation_snapshot_invalid`); valid-but-empty (count 0) → `manual_review`
   (`no_distribution_recommendations`).
4. **Config validation** — invalid → `require_human_approval`
   (`policy_config_invalid_fail_closed`).
5. **Enabled** — disabled → `require_human_approval` (`automation_policy_disabled`).
6. **Mode** — `human_approval_only` → `require_human_approval`
   (`human_approval_mode`); `manual_review_only` → `manual_review`
   (`manual_review_mode`); `guarded_auto_authorize` → continue.
7. **Quality gates** (guarded only): minimum score, allowed class, no hard block
   (when `requireNoHardBlock`), required recommended action. Any failure →
   `require_human_approval` with a specific reason.
8. **Recommendation-count bounds** — count within `[min, max]`. Failure →
   `require_human_approval`.
9. **All gates pass** → `auto_authorize` (`guarded_auto_authorization_eligible`).

Route ownership deliberately runs before recommendation/config gates, so a
preferred / client-selected / requirement-group lead always defers cleanly to its
existing owner service (Phase 4A only *returns* the decision; it never calls those
services).

## 10. Decision types

`DistributionAuthorizationDecision`: `require_human_approval`, `auto_authorize`,
`manual_review`, `defer_special_route`.

## 11. Decision reasons

`PolicyDecisionReason` (one precise reason per path): `policy_facts_invalid`,
`special_route_owned_elsewhere`, `recommendation_snapshot_invalid`,
`no_distribution_recommendations`, `policy_config_invalid_fail_closed`,
`automation_policy_disabled`, `human_approval_mode`, `manual_review_mode`,
`quality_score_below_policy_threshold`, `quality_class_not_allowed`,
`quality_hard_block_present`, `quality_recommended_action_not_allowed`,
`recommendation_count_below_policy_minimum`,
`recommendation_count_above_policy_maximum`,
`guarded_auto_authorization_eligible`.

## 12. Policy version

An explicit constant, never the package version or a timestamp:

```
LEAD_DISTRIBUTION_AUTHORIZATION_POLICY_VERSION = "lead_distribution_authorization_v1"
```

## 13. Config fingerprint

`computePolicyConfigFingerprint(config)` produces a deterministic SHA-256 (Node
built-in `crypto`) over a canonical projection of the semantic config fields —
fixed key order, and the allowed-class array is order-insensitive and
de-duplicated. Therefore:

- the **same semantic config** always yields the **same fingerprint**, and
- a changed threshold, mode, or any other gate yields a **different** fingerprint.

It never uses `Math.random`, `Date.now`, or a random UUID, and never throws (it
canonicalizes malformed input defensively so a fail-closed decision still carries
a fingerprint identifying *which* configuration produced it).

## 14. Determinism

For the **same facts + same config**, the decision result is byte-for-byte
identical. The result carries **no** evaluation timestamp, random id, worker id,
attempt count, or hostname. **Array-ordering policy:** `passedGates` is appended
strictly in the precedence order of §9; `failedGates` holds exactly the single
gate that stopped evaluation (empty for `auto_authorize`). Both arrays are
therefore fully deterministic. The result object and its nested arrays/summary are
frozen (`Object.freeze`).

## 15. Explainability fields

Every decision exposes: `decision`, `reasonCode`, `policyVersion`,
`policyFingerprint`, `passedGates`, `failedGates`, and a PII-free
`evaluatedFactsSummary`. Example (score below threshold):

```
decision:      require_human_approval
reasonCode:    quality_score_below_policy_threshold
passedGates:   [facts_valid, standard_route, recommendation_snapshot_valid,
                recommendations_present, policy_config_valid, policy_enabled,
                guarded_auto_authorize_mode]
failedGates:   [minimum_auto_authorize_score]
```

## 16. Policy registry

A narrow, typed table (`policyRegistry.ts`) mapping a policy key to its
fail-closed evaluator. It is **not** a plugin framework and performs **no** dynamic
code execution. Phase 4A registers exactly one policy
(`lead_distribution_authorization`). `resolvePolicyEvaluator(unknownKey)` throws
`UNKNOWN_AUTOMATION_POLICY_KEY:<key>` rather than silently defaulting.

## 17. Why `aos_agent_logs` is not authoritative workflow truth

`services/aosService.ts#logAosAgentDecision(...)` is best-effort and degrades
safely if its table is missing or an insert fails. It is therefore **not** an
authoritative store of policy decisions. Phase 4A makes **no** DB writes at all.
The authoritative record of a decision (Phase 4B) will be durable workflow events
and transition history — not agent logs.

## 18. Phase 4B integration boundary

Phase 4B (later, not now) will integrate policy evaluation into
`MATCH_RECOMMENDATION_READY` and translate the decision into one of
`REQUIRE_HUMAN_APPROVAL` / `AUTO_AUTHORIZE` / `MANUAL_REVIEW` /
`DEFER_SPECIAL_ROUTE` handling, choose the durable configuration source and
policy-fact readers, and decide how the immutable recommendation snapshot is
represented in any authorization event. None of that is implemented in Phase 4A.

## 19. No auto-authorization activated in 4A

The policy can *return* `auto_authorize`, but Phase 4A wires it to nothing. No
`lead.distribution.auto_authorized` (or any other) event is published; no vendor
is selected or assigned; no credit is touched.

## 20. No migration

Phase 4A is code-only and pure. No migration is created or changed. No production
config reader and no Supabase adapter are required; the policy modules only
`import type` from `services/leadQualityService.ts` (erased at build time), so the
engine has no Supabase dependency.

## 21. No production activation

Nothing here is deployed, merged to `main`, or activated in live orchestration.
PM2 and all protected services are unchanged.
