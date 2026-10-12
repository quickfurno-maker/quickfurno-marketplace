# Anisha A2h — Real Jarvis-to-Core HTTPS Gate

Date: 2026-10-12 IST. **Cross-repository client-to-application gate PASS 12/12 locally.** Persistent hosted staging and production remain **HOLD**.

## What was certified

The actual Jarvis `quickfurno-http.ts` Ed25519 consent, CLAIM/ACK client and `anisha-memory-purge-worker.ts` were bundled from exact Jarvis commit `82972d573bb3a83275dc5d5fe85c50cfc0241b39` using esbuild. The bundle ran as a **read-only mounted** resource alongside the actual QuickFurno Next.js app inside the existing one-shot Linux Docker A2g certification environment.

Core source for first 12/12 execution: A2g draft head `a5822ac20f609e1b70f73e28335ce14973130bc9` plus the new A2h test update. Generated private keys, certificates and synthetic database responses only.

Full 12/12:
- 9 previous actual Core Next.js HTTPS routes: good signature, bad signature, unsigned claim, safe ACK sequencing, duplicate ACK rejected, and tampered/unauthorized consent rejected.
- **Actual Jarvis signed HTTP client → actual Core HTTPS Next claim** succeeds and exact vendor+lease binds.
- **Actual Jarvis purge worker → Core HTTPS ACK** succeeds only after synthetic delete action completes.
- **Actual Jarvis consent reader** fails closed because the Core conversation authority is intentionally not supplied in this test.

Execution: isolated Docker Linux container `--network none`, no published ports or production credentials, ephemeral self-signed TLS and Ed25519, no Supabase/Meta provider messages. Image from locked Core `npm ci` and Node20.20.2. No actual vendor, payment, credit, lead or production data changed.

## Repeatability

Tracked Core test: `scripts/mvp/jarvis/certify-anisha-https-next-routes.mjs`. Optional read-only mount `ANISHA_CERT_JARVIS_BUNDLE=/tmp/a2h-jarvis-client.mjs` enables the extra 3 true Jarvis tests; without it the original 9 Core-only checks run.

Tracked Jarvis entrypoint: `apps/api/src/quickfurno-whatsapp/anisha-a2h-staging-client.ts`.

Added separate CI job `paired-jarvis-core-https-cert` to Core `.github/workflows/anisha-memory-stacked-branch-ci.yml`. It pins Jarvis SHA, installs locked workspace dependencies, builds packages, bundles the production signing client and purge worker, builds Core image, and runs the 12-case test with strict network isolation. **Only call remote CI green after GitHub reports SUCCESS at the exact new Core head.**

## What is NOT certified

- This synthetic-database application path is not a Core authenticated conversation/valid vendor grant or a positive long-term memory read from live Supabase.
- The erase action in this Core app pair test is a local synthetic callback; real PostgreSQL erasure, TTL and two-cycle re-enrollment were separately tested in previous local Postgres and hosted isolated Supabase branches (A2d–A2f). Do not combine these into one falsely claimed end-to-end deployment.
- There is **no persistent, isolated, externally reachable Core + Jarvis HTTPS staging service** with matching short-lived stage credentials, vendor dashboard auth and a full real database write/read/revoke/purge/ACK through the *deployed* workers yet.
- The A1→A3 Jarvis PR stack and Core A3/memory PRs are still **DRAFT**. Do not merge or deploy to production without human release review.
- Consent UI and purpose notice remain **draft**: `docs/legal/anisha-optional-memory-consent-notice-review.md` needs owner/privacy review. Consent grant cannot be inferred from WhatsApp consent. No production activation permission has been given.

## Next release sequence

1. Security review PR dependencies, stage-only deployment topology and test vendor authorization. Select isolated stage infrastructure (never mutate shared QF-Jarvis or production projects for trial). Prepare backup and exact rollback of stages.
2. Deploy exact approved Core and Jarvis images over real stage HTTPS, attach isolated Supabase DB schemas and genuine stage-only secret references, disable Meta/provider sends.
3. Exercise synthetic authorized vendor dashboard session and full signed Core vendor authority → Jarvis structured preference write → recall → revocation and immediate read block → actual physical deletion + Core ACK; confirm no old record after fresh enrollment and TTL behavior.
4. Owner explicitly approves vendor notice text and privacy/legal review; only then allow vendor canary activation with monitored fail-closed rollback.
5. AGNI incident/erasure/AI cost watch remains a separate governed monitoring setup.

Production long-term memory and provider sends remain OFF.
