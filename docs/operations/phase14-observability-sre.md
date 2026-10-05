# Phase 14 — OpenTelemetry Observability & SRE Controls

## Operating contract

Telemetry is **read-only and powerless**. PostgreSQL/QuickFurno Core remains authoritative for business state. Redis/Valkey, metrics, traces, logs, dashboards and alert rules may accelerate diagnosis but never decide lead assignment, credits, payments, approvals, consent, campaign eligibility, or AI actions.

All application telemetry is OTLP and backend-neutral. QuickFurno and Jarvis send only to their host-local OpenTelemetry Collector agents; those agents forward over mTLS to AGNI's central Collector gateway. AGNI owns the canonical Prometheus, Tempo, Loki and Grafana stack so neither supervised application owns its own source of observability truth. W3C Trace Context (`traceparent` / `tracestate`) is used for distributed tracing; QuickFurno ↔ Jarvis additionally binds the W3C trace ID to the signed `x-qfj-trace-id`. A mismatch is rejected as `QFJ_CONTRACT_INVALID`.

Metric labels are bounded enums or route classes only. Never add phone numbers, email addresses, names, postal addresses, prompt or message text, subject IDs, conversation IDs, lead IDs, request IDs, correlation IDs, trace IDs, idempotency keys, or arbitrary exception messages to metric labels.

Every production service must emit resource identity:
- `service.name`
- `service.version`
- `service.instance.id`
- `deployment.environment.name`
- `qf.image.sha`
- `qf.migration.head`
- `qf.config.schema.version`

## AGNI control boundary

AGNI performs continuous deterministic detection without model tokens. OpenAI is invoked only for bounded incident investigation or an explicitly governed report and receives sanitized machine facts rather than raw logs, prompts or customer content. High/critical remediation proposals require JEV critic evidence before QuickFurno Core can present them for human approval.

The production write path is one-way and capability-bound:

`AGNI Control Plane → QuickFurno Core approval → signed one-time capability → AGNI Action Broker → allowlisted Host Agent → restricted driver → post-action verification`

A human approval authorizes only the exact action fingerprint, target, environment, optional live revision and short expiry window. AGNI has no arbitrary shell, SSH, SQL or root interface. The default production template enables only synthetic health checks and configured service restart; bounded Cloudflare rate limiting is certified but dormant until separately configured with an allowlisted target and durable automatic rollback.

## SLO views

The canonical dashboard covers HTTP traffic/latency/errors, database latency/pool pressure, durable queues and outbox age, worker throughput/retries/DLQ, matching latency/candidate counts, business funnel events, WhatsApp/provider delivery, Jarvis model latency/errors/cost, Redis/runtime cache health, and host CPU/memory/restart signals.

Availability target for paging burn calculations: 99.9% successful server requests over the rolling service window. Latency and freshness alerts are operational guardrails and do not silently mutate business behavior.

## HTTP 5xx

**Impact:** client/vendor APIs, webhooks, or callbacks may fail.

1. Identify `service.name`, image SHA, migration head and config schema from alert labels.
2. Open the Tempo trace linked by the affected time window and route.
3. Distinguish QuickFurno HTTP, DB, Jarvis gateway/provider, and callback spans.
4. Compare the first bad image/config/migration identity with the last healthy period.
5. Roll back only through the release procedure; telemetry itself has no rollback authority.

## Latency

Check p50/p95/p99 alongside DB pool wait, queue age, provider saturation and host capacity. Do not increase concurrency until the bottleneck is identified; more concurrency can amplify DB/provider saturation.

## Queue age

Inspect queue depth and oldest age by bounded lane. Check worker heartbeat, wake-up signal/fallback-poll ratio, DB pool wait and provider pressure. Use existing idempotent replay/recovery operations only; never edit durable queue rows ad hoc.

## DLQ

A non-zero failed count requires classification before replay. Preserve idempotency and revision fences. If outcome is indeterminate, do not retry blindly; follow the owning worker's existing recovery contract.

## Database

Correlate app DB query duration/pool saturation with Postgres exporter metrics and `pg_stat_statements` top-call/top-time deltas. Look for lock waits and pool queueing. Never use telemetry output as a write path.

## Jarvis provider

Check `qfj.model.duration`, `qfj.model.errors`, cost, concurrency-admission pressure and circuit/fallback events. Provider prompt/output content is intentionally absent from telemetry. Use governed provider-mode/kill-switch procedures; no dashboard control changes model authority.

## Redis

Redis/Valkey is acceleration/coordination only. If unavailable, verify database polling fallback and wake-up metrics, then restore cache/coordination without treating Redis as source of truth.

## Synthetic trace drill

The Phase 14 certification generates one synthetic failed request with these spans in a single trace:

`cloudflare.edge → quickfurno.http → quickfurno.job → quickfurno.db → quickfurno.jarvis.client → jarvis.gateway → jarvis.provider (ERROR) → quickfurno.callback`

The gate asserts one trace ID, correct ancestry across the remote W3C propagation boundary, a provider error status, required release identity, and absence of forbidden high-cardinality/PII attributes.

## Alert identity

Every alert template includes user impact, a runbook reference, and the service/image/migration/config identity dimensions needed to correlate a regression with a deployment.
