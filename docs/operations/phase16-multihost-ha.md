# Phase 16 — Multi-Host Docker High Availability

Status: implementation/certification phase.

## Locked physical layout

Current cost-balanced production layout:

- QuickFurno runs on its own dedicated VPS.
- Jarvis and AGNI run on one larger dedicated VPS initially.
- AGNI remains logically isolated from Jarvis: separate containers, networks, resource limits, credentials/secrets and release controls.
- AGNI must remain portable to a dedicated supervisory host later.
- QuickFurno and Jarvis/AGNI must never share the same physical failure domain in this layout.

This phase does not require buying a second QuickFurno VPS immediately. It certifies the architecture and operating controls required to add one without redesigning application correctness.

## QuickFurno HA target

Future topology:

Cloudflare -> redundant/provider-managed load balancer -> QuickFurno host A + host B -> shared PostgreSQL/Supabase + shared Redis/Valkey + shared object storage.

Rules:

- At least two QuickFurno hosts for HA mode.
- Critical web replicas are anti-affined by host.
- Load balancer health removal uses `/readyz`; `/livez` remains process liveness.
- Session stickiness is not required.
- Business state is never host-local.
- Redis/Valkey is coordination-only and must be shared in multi-host mode. Loopback Redis is refused.
- Durable work ownership stays in PostgreSQL leases/fences. Expired work is reclaimable and stale owners cannot complete effects.
- External secrets/config and shared object storage remain required.
- Each host emits telemetry through its local OTel agent to the Jarvis/AGNI-side gateway.
- Host identity is replaceable instance identity, not business identity.

## Load balancer design

`ops/phase16/haproxy-certification.cfg` is a CI certification harness, not the production load balancer.

Production must use a redundant/provider-managed or otherwise independently redundant load-balancing tier so that the load balancer itself is not a single point of failure.

The CI harness verifies:
1. two real QuickFurno application containers serve through one health-aware proxy;
2. one host-replica is terminated while requests are in flight;
3. health-based removal keeps requests successful;
4. the remaining replica continues serving.

## Durable work safety

The host-loss web drill is paired with the existing PostgreSQL durable-job certification:

- concurrent workers produce one lease owner;
- a crashed owner expires;
- exactly one replacement worker reclaims the job;
- the fence increases;
- stale completion is rejected;
- committed business effect remains idempotent.

Redis notifications remain advisory and cannot become the source of truth.

## Provider-neutral host bootstrap

`ops/phase16/tofu` is intentionally provider-neutral.

It validates:
- minimum two-host inventory;
- shared non-loopback Redis/Valkey;
- replaceable host IDs;
- central AGNI OTLP endpoint.

It emits cloud-init payloads that can later be attached to the chosen VPS provider without coupling QuickFurno source code to one provider.

## Current Jarvis + AGNI placement

Jarvis + AGNI may share the larger VPS now, but QuickFurno must continue when that host is unavailable. Jarvis outages therefore degrade AI assistance, not QuickFurno business authority.

AGNI is not allowed unrestricted Docker-socket access. Production authority remains READ_ONLY_RECOMMEND until separately approved.

## Safety boundary

- No production traffic cutover in Phase 16.
- No production database migration.
- No new AGNI production authority.
- No forced purchase of a second production VPS.
- Phase 15 immutable image/signature/provenance controls remain mandatory.
