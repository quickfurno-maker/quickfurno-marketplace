# Phase 06 — Redis/Valkey Coordination Layer

## Architecture decision

QuickFurno may use Redis/Valkey only as an **ephemeral coordination plane**. PostgreSQL remains the durable source of truth for credits, payments, lead assignment, consent/suppression, vendor state, durable jobs/outboxes and every effect-bearing business decision.

## Certified capabilities

- provider-neutral coordination port
- Redis/Valkey adapter isolated behind the port
- distributed fixed-window rate limiting
- short-TTL shared cache with tag-version invalidation
- owned distributed locks with fencing tokens
- best-effort wake-up publication for durable Postgres-backed work
- opaque SHA-256-derived subject/resource/cache key material
- TTL discipline for every persistent coordination key
- explicit unavailable result on Redis failure

## Failure semantics

Redis absence or outage must not block QuickFurno startup. Cache users bypass to durable sources. Rate-limit callers retain their reviewed edge/local fallback. Correctness-sensitive lock callers must fall back to PostgreSQL authority or refuse unsafe work. A missed wake-up is harmless because durable DB polling/recovery remains.

## Valkey runtime

The reference Valkey deployment is digest pinned, private-network only, read-only except for tmpfs, persistence-disabled, memory bounded and configured with volatile-ttl eviction.

## Exit-gate certification

The Phase 06 harness instantiates two web replicas and two worker replicas and proves shared rate limiting, cache invalidation, fencing, wake-up delivery, TTL/opaque-key discipline and safe outage behavior.
