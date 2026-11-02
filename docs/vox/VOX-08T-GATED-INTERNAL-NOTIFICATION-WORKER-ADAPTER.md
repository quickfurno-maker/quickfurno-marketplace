# VOX-08T — Staging-only safe one-shot internal outbox runner adapter

**Source-only; not scheduled or deployed anywhere.** This is the minimal integration adapter using the existing 08N Core RPC worker. No new work queue, process daemon, credentials, Admin identity or outbound provider transport.

`worker/voxInternalNotificationCycle.mjs` exposes one bounded `runVoxInternalNotificationCycle()` calling the previously tested 08N `runIsolatedNotificationOutboxOnce()`. Defaults disabled. Requires staging environment, three independently active feature flags, injected existing Core RPC, an injected **trusted server-side verification of an independently approved, unexpired signed release**, bounded jobs and neutral worker UUID. Returned summary never contains PII, job IDs or provider claims. AGNI summary callback errors never repeat a potentially committed Core SQL action. Source has NO setInterval, cron registration, HTTP route or live service-role credentials.

**Caution:** In tests, the release-verifier is a synthetic callback; a browser- or model-supplied object is **not** real external human approval. Real receipt verification must be implemented, certified and wired by the independently approved Core release owner. Tests of an assumed valid verifier do not authorize any actual staging process.

**Actual QA:** 9/9 new isolated runner tests PASS: default disabled/production forbidden/missing flags, missing reviewer provenance, rejected/expired/forged approval, outage, bounded claim, safe internal only, telemetry outage and no send credentials. Entire Core VOX regression executed separately.

**Pending before use:** Independent human DBA+AppSec+first TL signed approval, canonical Staff SQL managed staging, actual neutral Staff AAL2, signed immutable Core deployment, tested Core credential scope, live worker scheduler supervision, AGNI existing verified Core transport, dead-letter human runbook, DPI/DPDP retention signoff, true multiworker load and rollback. No provider push/WhatsApp/SMS.
