# Phase 23 — API, Event & Client Compatibility Governance

Status: IMPLEMENTED / certification gate pending merge.

Phase 23 makes rolling and blue/green releases an explicit contract. A new QuickFurno/Jarvis build must be able to overlap the previous supported build without forcing a synchronized deployment or corrupting shared state.

## API versioning

- The current governed API major is **v1**.
- New native/external APIs must carry an explicit major in the path (`/api/v1/...`) or an explicitly registered equivalent.
- Existing Next.js routes used only by the server-coupled web application are not mass-renamed in this phase.
- Additive optional response fields and response headers are compatible.
- Removing/renaming fields, changing field meaning/error meaning, or changing effect-bearing idempotency semantics requires a new API major.
- Unknown API majors fail closed; they are never silently interpreted as v1.

## QuickFurno ↔ Jarvis signed HTTP coexistence

The existing `qfj.scale.http` boundary remains on current version 1 and continues accepting the legacy V0 representation (absence of `x-qfj-scale-version`) through the previously locked window.

Accepted requests now advertise compatibility status:

- `x-qfj-current-version: 1`
- `x-qfj-min-supported-version: 0`
- legacy V0 additionally receives `deprecation: true` and `sunset: Mon, 05 Jan 2027 00:00:00 GMT`.

Every verified QuickFurno ingress emits `qf.compatibility.requests` with `boundary`, `received_version`, `mode`, and `result`. Telemetry cannot authorize or reject a request; the signed verification result remains authoritative.

V2 or any unknown future QFJ version fails closed.

## Deprecation/removal policy

A supported wire version may not be removed until all of these are true:

1. the published notice window is at least 90 days;
2. telemetry exists for the version;
3. there are at least 30 consecutive days of zero supported usage before removal;
4. the canonical signed compatibility contract is changed explicitly;
5. removal is approved as a deliberate release/phase action.

The legacy V0 removal date therefore remains **no earlier than 2027-01-05**.

## Event/schema versioning

Canonical events are identified by `eventType + eventVersion`.

- Unknown type/version fails closed.
- There is no permissive fallback and no automatic schema upgrade.
- Optional additive fields may remain at the same version only when all supported consumers tolerate them.
- New required fields, removed fields, or semantic changes require a new event version.
- Enum expansion requires explicit compatibility review.
- `eventId` remains the event idempotency identity.

Jarvis’s static canonical-event registry and existing fail-closed tests are the executable source of truth for event ingestion. Earlier unsafe v1 event contracts that were never produced remain intentionally retired; Phase 23 governs live versions going forward.

## Effect-bearing idempotency

Idempotency semantics are part of the API major. New external effect-bearing endpoints must use a version-scoped key identity.

Same major + same key + same canonical effect is a replay/existing-result condition. Same major + same key + a different canonical effect is a conflict. Reusing the same caller key under a different API major creates a different version scope rather than silently changing old semantics.

The QFJ signature continues covering the idempotency key.

## Web/native client policy

The current web app remains server-coupled and is not hard-version-blocked.

Native policy is defined but **not activated**. When iOS/Android clients are introduced, they must publish platform, semantic client version/build, and API major. Minimum supported versions must be published before enforcement; hard upgrade blocking uses HTTP 426 only after notice and telemetry.

## Database N/N-1 policy

Every meaning-changing database release follows:

**expand → bounded backfill → N/N-1 coexistence → old-version drain proof → contract**

During overlap, new columns are nullable/default-compatible, and dual-read/dual-write or compatibility triggers are required when meaning moves. Destructive contract steps are forbidden until N-1 is retired and rollback during the overlap window has been proven.

The Phase 23 PostgreSQL certification explicitly rehearses:

- N-1 writer after N deploy;
- N reader observing N-1 writes;
- bounded backfill;
- rollback from N to N-1 while expanded schema remains;
- reintroduction of N after rollback;
- destructive contract only after N-1 retirement;
- rejection of the old writer only after the contract step.

No production database is touched.

## Consumer-driven contract fixture

`qfj-phase23-consumer-fixture-v1.json` freezes:

- canonical request body digest;
- canonical QFJ v1 signing input;
- legacy-V0 coexistence behavior;
- an additive response example showing an N-1 consumer safely projecting only fields it knows.

The fixture and the Phase 23 governance contract must remain byte-identical in QuickFurno, Jarvis, and AGNI.

## Production boundary

Phase 23 performs no production API cutover, removes no V0 compatibility, changes no production event schema, applies no production DB migration, enables no native minimum-version block, moves no traffic, and expands no AGNI authority.

**Next:** Phase 24 — Shadow Migration, Dual-Run & CDC.
