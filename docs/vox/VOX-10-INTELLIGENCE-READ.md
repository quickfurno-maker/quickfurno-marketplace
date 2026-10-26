# VOX-10 — Actual canonical AOS V2 owner health, read-only

Core route `GET /api/vox/v1/aos-health` calls the **existing** `getAosV2AdminSnapshot()` from `services/aosV2AdminService.ts`. It does not add an AOS execution system, vendor data model, model calls or cost. Core owner AAL2 validation is mandatory, because the underlying AOS run counts are platform-wide and not safely partitioned by VOX staff city/team. The route is **disabled by default** unless `VOX_AOS_HEALTH_ENABLED=staging` on a private signed Staging deployment.

Output is a sanitized aggregate: counts of runs/completions/failures/recommendations and observational advisory runtime state. `latestRuns`, `latestRecommendations`, underlying lead/vendor IDs, reasoning traces, prompts, raw memories and account data are all omitted. When underlying persistence fails, counts report **null / observation UNAVAILABLE** rather than misleading zeros. No RPC or toggles to activate AOS, approve >3 vendor assignments, change wallets or send Meta WhatsApp.

This is a **real source adapter to existing AOS**, not an AGNI or Jarvis runtime connection. AGNI remains explicitly NOT_CONNECTED and Jarvis NOT_VERIFIED. AOS public health, signed cross-VPS AGNI telemetry, Jarvis agent-flow read/write integration, process memory and governed actions all still need separate security and deployment tests. Source tests validate default OFF, owner scope, DTO privacy and all method refusals; signed Staging Auth-positive verification has NOT occurred.

No live VPS, Docker, Supabase or Core deployment.
