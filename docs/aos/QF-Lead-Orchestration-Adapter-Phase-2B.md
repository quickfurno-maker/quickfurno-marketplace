# QuickFurno Lead Orchestration Adapter - Phase 2B

## Purpose

Phase 2B adds a safe adapter layer between durable `workflow_tasks` and the existing authoritative QuickFurno lead services. It does not activate live orchestration, does not start a worker, and does not change the live lead submission path.

The intended shape is:

`Workflow Kernel -> workflow task -> Phase 2B executor -> service port -> authoritative service -> result mapper -> durable domain event -> Workflow Kernel`

## Adapter Architecture

Phase 2B is split under `lib/aos/workflows/leadLifecycle/`:

- `adapters/leadLifecycleServicePorts.ts` defines narrow ports.
- `adapters/leadQualityServiceAdapter.ts` wraps scoring and latest persisted quality reads.
- `adapters/leadClarificationServiceAdapter.ts` wraps clarification preview preparation.
- `adapters/leadMatchingRecommendationAdapter.ts` wraps read-only vendor recommendation preparation.
- `events/leadLifecycleResultMapper.ts` maps authoritative quality outcomes to lifecycle driver events.
- `events/leadLifecycleEventPublisher.ts` publishes durable workflow domain events with deterministic idempotency.
- `events/leadClarificationCompletedBridge.ts` provides a non-activated clarification completion event builder.
- `execution/leadLifecycleTaskExecutor.ts` executes one claimed task with injected ports.
- `execution/leadLifecycleTaskCoordinator.ts` completes or retries one claimed task. It has no polling loop.

## Task To Service Mapping

| Workflow task | Phase 2B behavior |
| --- | --- |
| `lead.quality.score` | Load lead inputs, call `scoreAndStoreLead`, map the authoritative result, publish one lifecycle event. |
| `lead.clarification.prepare` | Call `createClarificationRequestForLead`, return request metadata only. |
| `lead.quality.rescore` | Read the latest persisted authoritative score from `lead_scores`; do not recalculate. |
| `lead.matching.prepare` | Use read-only vendor evaluation via `getEligibleVendorsForLead`, preserve rank order, publish max 3 recommendations. |
| `lead.distribution.await_approval` | Return an internal waiting marker only. |
| `lead.distribution.prepare` | Deferred in Phase 2B; no assignment. |
| `lead.nurture.prepare` | Deferred in Phase 2B; no provider send. |
| `lead.manual_review.prepare` | Deferred in Phase 2B; no human decision is fabricated. |

## Authoritative Boundaries

The existing services remain authoritative:

- `services/leadQualityService.ts` owns quality formulas, thresholds, hard gates, score classes, and decisions.
- `services/leadClarificationService.ts` owns clarification request creation and response persistence.
- `services/leadMatchingEngine.ts` owns vendor eligibility and ranking logic.
- `services/leadDeliveryService.ts` owns assignment, credits, dashboard delivery, and preview logs, but Phase 2B does not call those functions.
- `services/leadService.ts` remains the live lead submission path and is not modified or activated for durable orchestration.

## Quality Mapping Table

The mapper uses `recommended_action`, `hard_block_reason`, `score_class`, `canAutoDistributeLead(...)`, and `getLeadQualityDecision(...)`.

| Authoritative action / condition | Lifecycle event |
| --- | --- |
| `auto_distribute` and `canAutoDistributeLead(...)` true with `A+` | `lead.quality.resulted` with tier `A+` |
| `auto_distribute` and `canAutoDistributeLead(...)` true with `A` | `lead.quality.resulted` with tier `A` |
| `clarification_required` | `lead.quality.resulted` with tier `B` |
| `nurture` | `lead.quality.resulted` with tier `C` |
| `reject_or_manual_review` with only normal below-threshold quality block | `lead.quality.resulted` with tier `D` |
| `reject_or_manual_review` with a real hard block | `lead.manual_review.required` |
| `duplicate_no_bill` | `lead.manual_review.required` |
| `consent_required_no_distribution` | `lead.manual_review.required` |
| `invalid_phone_no_distribution` | `lead.manual_review.required` |
| `manual_review_suspicious_name` | `lead.manual_review.required` |
| `A` or `A+` plus any hard block | `lead.manual_review.required` |

## Hard-Block Safety

An `A` or `A+` numeric tier with `hard_block_reason != null` never maps to `lead.quality.resulted` as matching-ready. It maps to `lead.manual_review.required`. This prevents a high numeric score from bypassing consent, duplicate, invalid phone, suspicious name, missing city/service, or other authoritative blocks.

## Clarification Prepare Behavior

`lead.clarification.prepare` only calls `createClarificationRequestForLead(...)` and returns request metadata:

- request id
- status
- missing fields
- question count

It does not emit `lead.clarification.completed`, does not send WhatsApp, and does not call n8n.

## Clarification Completion Bridge

`buildClarificationCompletedEvent(...)` is a pure, non-activated helper for future API integration after `saveClarificationResponses(...)` succeeds.

It produces:

- `eventType = lead.clarification.completed`
- `entityType = lead`
- `entityId = leadId`
- `payload.workflow_type = qf_lead_lifecycle`
- `payload.lead_id = leadId`
- `payload.request_id = requestId | null`

It does not produce `lead.manual_review.resolved`, does not fabricate `reviewed_by`, and does not send communication.

## Rescore Source Of Truth

The live clarification response flow already calls `recalculateLeadAfterClarification(...)` inside `saveClarificationResponses(...)` and stores the new score. Therefore `lead.quality.rescore` reads the latest persisted row from `lead_scores` and maps that authoritative result. This avoids double rescoring.

## Read-Only Matching Recommendation

Phase 2B uses `getEligibleVendorsForLead(...)`, which uses the existing eligibility and ranking path. It preserves the returned order and publishes at most the first 3 vendor ids.

If no vendors are eligible:

- `recommended_vendor_count = 0`
- `recommended_vendor_ids = []`

If vendors are eligible:

- ids are returned in authoritative rank order
- count is capped at 3
- no assignment occurs

## Forbidden Matching Calls

Phase 2B must not call `runAutoLeadMatchingForLead(...)` because that path can proceed into assignment, credit-affecting RPC execution, delivery logs, WhatsApp preview logs, and client assignment preview logs.

Phase 2B also does not call:

- `assignLeadToMatchedVendors`
- `assignLeadToVendors`
- `deliverLeadToVendorDashboard`
- `createVendorLeadWhatsappPreview`
- `createClientAssignedVendorsPreview`

## Durable Result Event Format

Every Phase 2B lifecycle event is persisted to `domain_events` with:

- `entity_type = lead`
- `entity_id = leadId`
- `payload.workflow_type = qf_lead_lifecycle`
- `payload.lead_id = leadId`
- `correlation_id` set to the workflow instance id when available
- `causation_id` set to the triggering driver event id when available

## Event Idempotency

Result event idempotency keys are deterministic:

`qf_lead_lifecycle:task_result:{workflow_task_id}:{event_type}`

The publisher inserts the event. On an expected unique conflict, it refetches the existing event by idempotency key and verifies:

- event type
- entity type
- entity id
- payload scope

If the existing event differs, it throws `DOMAIN_EVENT_IDEMPOTENCY_CONFLICT`. Unrelated database errors are rethrown.

## Task Execution Contract

The executor accepts one claimed task. It validates:

- `task.status === processing`
- supported task type
- non-empty `lead_id`
- non-empty `workflow_instance_id`
- `payload.workflow_instance_id === task.workflow_instance_id`

It returns a structured execution result. The coordinator persists completion through `markWorkflowTaskCompleted(...)` and handles failures through the existing retry policy and failure service.

## Deferred Task Behavior

`lead.distribution.prepare`, `lead.nurture.prepare`, and `lead.manual_review.prepare` return `deferred_not_enabled`.

A future generic worker must treat this as a completed internal marker for Phase 2B, not as successful assignment, nurture delivery, or manual review resolution. Later phases must introduce explicit side-effect executors with their own approval and safety contracts.

## Manual Review Safety

Phase 2B adapters may publish `lead.manual_review.required`. They never publish `lead.manual_review.resolved`, never fabricate `reviewed_by`, and never generate human outcomes such as `ALLOW_CLARIFICATION`, `APPROVE_FOR_MATCHING`, `SEND_TO_NURTURE`, `REJECT`, or `CLOSE`.

## Preview Pipeline Vs Durable Workflow Events

The existing preview AOS bridge in:

- `lib/aos/events/emitLeadCreatedEvent.ts`
- `lib/aos/events/emitLeadClarificationRequiredEvent.ts`
- `lib/aos/events/safeAgentEventPipeline.ts`

is separate from durable workflow event persistence.

Preview AOS pipeline != durable Workflow Kernel domain events.

Phase 2B does not delete, replace, or route durable workflow events through n8n.

## No Live Activation

Phase 2B does not modify `services/leadService.ts`, does not register the lifecycle in the live lead submission path, does not claim tasks automatically, and does not run old direct automation and new Workflow Kernel automation simultaneously.

## Disabled Side Effects

Phase 2B performs:

- no assignment
- no credit deduction
- no dashboard delivery
- no WhatsApp send
- no n8n call
- no outbox provider command
- no production worker startup
- no PM2 change
- no deployment
- no merge
- no database migration

## Safe Database Test Requirements Before Live Activation

Before a later live activation phase:

- run against an isolated database
- verify domain event idempotency conflicts
- verify task ownership and retries
- verify lifecycle state transitions through the kernel
- verify no duplicate scoring on clarification completion
- verify recommendation-only matching does not mutate credits
- verify distribution remains approval-gated

## Phase 3 Direction

Phase 3 may add controlled worker activation, explicit approval flows, distribution execution, nurture execution, and manual review tooling. Those must remain separate from this Phase 2B adapter layer and require their own safety tests before production use.
