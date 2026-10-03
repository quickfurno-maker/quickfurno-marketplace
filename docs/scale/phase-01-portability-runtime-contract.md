# Phase 01 — Infrastructure Portability & Runtime Contract

Status: implementation contract for the QuickFurno + QF JARVIS scale-readiness program.

This contract exists so Docker, multi-host deployment, AWS and eventual Kubernetes remain **runtime/infrastructure changes**, not marketplace or agent-architecture rewrites.

## 1. Permanent authority rules

1. QuickFurno Core owns marketplace truth and effect authorization.
2. Jarvis owns reasoning/orchestration/proposals, not marketplace truth.
3. PostgreSQL owns durable business state.
4. Redis/Valkey may accelerate coordination but is never the only durable record of credits, payments, assignments, consent, lead state or provider intent.
5. No container, host, process, Redis node or AI provider is allowed to become a unique owner of business truth.
6. Kubernetes concepts never enter domain code.

## 2. Portability capabilities

These are **capabilities**, not mandatory generic frameworks. Existing clean modules satisfy a capability when they already isolate the concern.

| Capability | Contract | Current implementation | Future replacement |
| --- | --- | --- | --- |
| Transactional truth | PostgreSQL semantics, versioned migrations | Supabase PostgreSQL | RDS/Aurora/managed PostgreSQL |
| DB/API access | isolated persistence/API boundary | `lib/supabase.ts` + server services/RPCs | PostgreSQL/Data API adapter |
| Durable work | intent survives process/Redis loss | Postgres jobs/outboxes/leases | same; optional SQS/Kafka wake-up adapter |
| Ephemeral coordination | loss is recoverable | none shared yet | Redis/Valkey/ElastiCache |
| Wake-up | best-effort signal, DB is fallback | tight DB polling | Redis/Valkey notification + jittered DB fallback |
| Distributed scheduling | deterministic occurrence ID + atomic ownership | partially DB-governed; some process loops | DB lease/unique occurrence + N schedulers |
| HTTP transport | timeout, bounded response, injectable | `HttpTransport`, QF↔Jarvis signed transports | same on any runtime |
| Service endpoint | URL/DNS from config, no fixed host | QF/Jarvis base URL config | Docker DNS / ALB / Kubernetes Service |
| Secret source | supplied at runtime; no business logic dependence on secret manager | env and bounded file mounts | K8s Secrets / AWS Secrets Manager / Vault |
| Object storage | durable objects outside app host | Supabase Storage where used | S3/R2/S3-compatible |
| Telemetry | business logic emits vendor-neutral signals | logs + governed observation files | OpenTelemetry backend |
| Global runtime control | globally consistent enable/disable policy | DB runtime settings in QF; some Jarvis local control files | DB/control-plane + local emergency kill switch |
| Jarvis durable turn store | shared, atomic, replay-safe | **local filesystem spool today** | PostgreSQL shared durable turn store |
| Auth identity | provider authentication mapped to business identity | Supabase Auth | internal principal mapping + OIDC provider |
| Edge protection | no business correctness dependency | nginx/Cloudflare target | Cloudflare/ALB/other edge |

## 3. QuickFurno audit classification

### Already portable / preserve

**QF ↔ Jarvis transports**
- Base URLs are injected through configuration.
- HTTPS is required except explicit loopback development.
- requests are signed.
- requests have bounded timeouts.
- response identities are validated.
- no fixed Jarvis IP is embedded in domain code.

**Provider transport**
- `lib/communication/httpTransport.ts` is injectable, abortable and response-size bounded.
- Meta implementation is already contained in a provider adapter.
- Razorpay cryptographic/provider rules are contained in payment modules.
- Google browser loader is contained in Google Maps modules.
- Hard-coded provider hostnames inside provider adapters are acceptable; provider identity belongs in the adapter, not the marketplace domain.

**Supabase**
- Most runtime access is centralized through `lib/supabase.ts`.
- Service-role, public and request-scoped clients are deliberately separated.
- Direct Supabase imports in auth/session boundary modules are an accepted current provider boundary, not a reason to rewrite all persistence now.
- Phase 21/22 own the eventual Supabase/Auth exit strategy.

**Runtime state**
- No business-durable filesystem write was found in QuickFurno's normal web/worker runtime during this audit.
- permanent marketplace state is already DB-backed.

### Must change before horizontal scale

#### QF-P01-01 — production dotenv/file discovery
QuickFurno worker entrypoints search `.env.local`, `.env.production` and `.env`.
The PM2 conversation worker explicitly sets `QF_ENV_FILE=.env.local`.

**Target:** production containers receive explicit environment/secret injection and do not discover configuration from the working directory. Local dotenv convenience may remain for development.

Owner: Phase 02 + Phase 13.

#### QF-P01-02 — high-frequency DB polling
Conversation transport uses an idle poll around 100 ms and busy poll around 10 ms. Phase 00 measured roughly 18 known coordination/poll queries/sec at low business traffic.

**Target:** durable Postgres outbox + best-effort Redis wake-up + adaptive/jittered DB recovery polling.

Owner: Phase 06 + Phase 07.

#### QF-P01-03 — process-local scheduler loops
Aarohi acquisition and native automation include process-local recurrence loops.

**Target:** N scheduler replicas must be safe. Scheduled occurrences receive deterministic identities and DB-atomic creation/claim/fencing. Process timers become wake-up mechanisms, never unique authority.

Owner: Phase 07 + Phase 12.

#### QF-P01-04 — PM2/symlink host lifecycle
Correctness/deployment currently assumes one mutable host, PM2 process inventory and release symlink.

**Target:** OCI image + externally injected config + container lifecycle. PM2 must cease to be a correctness dependency.

Owner: Phase 02 + Phase 15.

#### QF-P01-05 — ingress/process isolation
Phase 00 found staging and detached historical listeners on the production host, with several app ports externally reachable.

**Target:** declared service inventory, internal container networking, default-deny host/provider firewall and one approved ingress path.

Owner: Phase 02 + Phase 10.

### Accepted single-host implementation that is not domain coupling

- nginx today
- PM2 until Docker cutover
- VPS paths in deployment scripts/config
- loopback URLs in test/local tooling
- production provider URLs inside provider adapters

These can change without changing business/domain architecture.

## 4. Jarvis audit classification

### Strong portable foundations — preserve

- versioned strict event/command contracts
- signed QuickFurno ↔ Jarvis HTTP transports
- injected provider ports/adapters
- bounded timeouts and allowlisted provider hosts
- PostgreSQL replay/conversation/operational-memory stores
- Temporal durable orchestration behind an explicit client seam
- non-root/read-only/digest-pinned Jarvis OS container
- runtime secret files as bounded read-only inputs
- injected clocks/sleep/model gateways in core worker logic
- deterministic cycle/run identities in proactive intelligence
- graceful signal handling in production worker entrypoints

### Must change before multi-host Jarvis

#### QFJ-P01-01 — filesystem durable turn spool
`apps/quickfurno-gateway/src/durable-turn-spool.ts` persists accepted, processing, completed and failed turns by atomic filesystem rename.
The QuickFurno WhatsApp production worker uses the same file spool.

This is a **real durable business-work boundary**, not telemetry. It is safe for a single owner on one host but is not horizontally portable.

**Target contract:**
`DurableTurnSpool` remains the application interface.
Add a PostgreSQL-backed shared implementation with atomic claims, leases/fencing, replay/conflict semantics and recovery.
The file implementation may remain for local development/single-host rollback, but production multi-host certification must use the shared implementation.

Owner: Phase 07 + Phase 12.

#### QFJ-P01-02 — explicit SINGLE_OWNER production worker
Production worker configuration deliberately requires `deploymentMode: SINGLE_OWNER`.

This is good fail-closed design today.

**Target:** do not remove SINGLE_OWNER until QFJ-P01-01 is solved and N-replica conversation ordering/claims are certified. Then introduce an explicitly versioned shared-owner deployment mode rather than silently changing semantics.

Owner: Phase 12.

#### QFJ-P01-03 — filesystem global kill switch
Jarvis WhatsApp model execution uses a local file-presence kill switch.

Local fail-safe shutdown is valuable and should remain as defense in depth, but one host's file cannot be the sole global control once replicas span hosts.

**Target:** authoritative distributed disable state/control-plane signal + local file emergency override. Either source may disable; neither may independently enable against a global disable.

Owner: Phase 12 + Phase 13.

#### QFJ-P01-04 — file observation/control-plane snapshots
Jarvis worker writes operational/agent-flow snapshots to local/shared mounted files consumed by Jarvis OS.

These are **telemetry only**, explicitly powerless over business correctness.

**Target:** keep during single-host Docker stage; replace/fan out through OpenTelemetry/central observation later. Failure must continue to affect visibility only.

Owner: Phase 14.

#### QFJ-P01-05 — polling workers
Aarohi Phase 2 and conversation scheduling contain polling/cadence loops.

Provider/source polling may remain where upstream systems require it, but Core/Jarvis durable internal work should use wake-up signals when possible. All loops need jitter/backoff and distributed ownership proof before N replicas.

Owner: Phase 07 + Phase 12.

## 5. Configuration and secret contract

Production runtime MUST:
- have an explicit environment identity
- receive mandatory config externally
- fail closed when security-critical config is absent/ambiguous
- accept stable DNS/service URLs, never require a machine IP
- support key rotation without image rebuild
- keep secret values out of logs/image layers/client bundles

Permitted implementations:
- environment variable
- read-only runtime secret file
- future secret-manager/CSI injection

Domain code must not depend directly on AWS Secrets Manager, Vault or Kubernetes APIs.

## 6. Scheduler contract

Every scheduled business occurrence needs:
- deterministic occurrence/idempotency ID
- authoritative due time
- atomic first-owner/claim semantics
- lease expiry or transaction-bounded claim
- retry policy
- duplicate-safe effect
- observable lateness/queue age

A timer/cron may **wake** processing. It may never prove that only one process will execute the occurrence.

## 7. Cache/Redis contract

Redis/Valkey is permitted for:
- wake-up
- short-lived cache
- shared invalidation
- rate limits
- counters
- distributed locks where a DB transaction is not the authority

Every key class needs:
- namespace
- owner
- TTL/retention
- max cardinality expectation
- failure behavior
- invalidation rule

Redis loss must not lose a committed business action.

## 8. Distributed lock contract

Prefer database constraints/transactions for business invariants.

When a distributed Redis lock is used:
- lock ownership token is required
- bounded TTL is required
- stale holder must not be allowed to overwrite a newer owner when fencing matters
- lock loss must fail safe
- lock cannot replace an idempotency constraint for irreversible effects

## 9. Object-storage contract

Application hosts do not own durable media.

Object references stored in Core use stable logical keys/metadata rather than filesystem paths. Provider implementation may be Supabase Storage today and S3/R2 later.

## 10. Telemetry contract

Runtime emits:
- structured stdout/stderr logs
- bounded-cardinality metrics
- trace/correlation IDs
- build/image revision
- config/policy revision

PII, prompts, phone numbers, secrets and unbounded entity IDs are not metric labels.

OpenTelemetry becomes the vendor-neutral transport in Phase 14.

## 11. Container/Kubernetes contract

Every long-running runtime role must eventually satisfy:
- one primary process/container
- no unique local business state
- graceful SIGTERM/drain
- liveness != readiness
- explicit startup/readiness
- resource expectations
- immutable image identity
- multiple replicas safe, or an explicit `SINGLE_OWNER` gate that refuses scale-out
- configuration injected externally
- no fixed host IP
- no Kubernetes API dependency inside business code

## 12. No-premature-abstraction rule

Do **not**:
- wrap every PostgreSQL query in a fictional cloud interface
- replace existing provider modules merely to rename them "ports"
- introduce Kafka/SQS only for portability
- duplicate Jarvis's mature contract framework inside QuickFurno
- create microservices solely because Docker exists

A new abstraction is required only where changing infrastructure would otherwise require changing business logic.

## 13. Phase mapping

| Finding | Required before | Remediation |
| --- | --- | --- |
| QF dotenv discovery | production Docker | Phase 02/13 |
| QF polling | worker horizontal scale | Phase 06/07 |
| QF schedulers | >1 scheduler replica | Phase 07/12 |
| PM2/symlink dependency | Docker cutover | Phase 02/15 |
| exposed/orphan listeners | launch hardening | Phase 02/10 |
| Jarvis file durable spool | >1 Jarvis worker host | Phase 07/12 |
| Jarvis SINGLE_OWNER | horizontal agent workers | Phase 12 |
| Jarvis local kill switch | >1 Jarvis worker host | Phase 12/13 |
| file observations | centralized operations | Phase 14 |
| Supabase/Auth coupling | provider migration | Phase 21/22 |
| object-store provider | storage migration | Phase 05/21 |
| cloud compute | AWS/K8s migration | Phase 19/29 |

## 14. Phase 01 exit contract

Phase 01 is complete when:
- every identified singleton/local-state/provider/runtime coupling has a disposition
- no current business-domain rewrite is required for Docker
- portability rules are versioned in repo
- a CI ratchet prevents accidental new hard-coded infrastructure coupling in QuickFurno
- Jarvis local durable spool/global-control limitations are explicitly carried into Phase 07/12/13
- Phase 02 can Dockerize QuickFurno without revisiting authority architecture
