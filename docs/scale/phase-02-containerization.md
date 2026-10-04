# Phase 02 — QuickFurno Production Containerization

Status: implementation complete pending exact-head CI certification.

This phase containerizes QuickFurno without changing marketplace authority, matching,
credits, payments, CRM, communication governance, Jarvis boundaries or provider activation.

## Certified image model

One immutable QuickFurno image contains:
- Next.js standalone web/API runtime
- native automation worker
- conversation transport worker
- Aarohi acquisition worker artifact

The runtime role is selected by `QF_RUNTIME_ROLE`:
- `web`
- `automation-worker`
- `conversation-transport`
- `aarohi-acquisition`

Aarohi remains opt-in in Compose through the `aarohi` profile.

## Runtime baseline

- Node: 20.20.2
- linux/amd64 base image pinned by digest
- one primary process/container
- no PM2 inside the image
- non-root UID/GID 10001
- read-only root filesystem
- explicit tmpfs scratch only
- Linux capabilities dropped
- no-new-privileges
- bounded PID/CPU/memory controls
- bounded JSON log rotation
- exact Git SHA stored in OCI label and health diagnostics

## Health contract

- `GET /livez`: process/application liveness only
- `GET /readyz`: instance readiness only
- neither endpoint calls Supabase, Jarvis, Meta, Google, OpenAI or payments
- dependency/provider health is monitored separately and must not cause healthy replicas to self-evict

The auth middleware excludes both health routes.

## Configuration contract

Runtime containers refuse to start when any canonical database/auth input is absent:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

The first two are also mandatory **build inputs** because Next.js public/Edge code can
inline them during compilation. The service-role credential is runtime-only and must
never be supplied as a Docker build argument or image layer.

The image contains no `.env*` files and production config is supplied externally.

## Build contract

Example shape only:

```bash
docker build \
  --build-arg GIT_SHA=<exact-git-sha> \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=<public-project-url> \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<public-anon-value> \
  -t quickfurno:<exact-git-sha> .
```

Production deployment must build from an exact tracked commit/archive, never from a
dirty server checkout.

## Compose contract

`ops/container/compose.production.yml`:
- publishes only the web role, and only to loopback by default
- publishes no worker ports
- keeps web/automation/conversation independently scalable
- keeps Aarohi behind an explicit profile
- uses an external environment file
- uses a private Docker network
- applies read-only/capability/resource/logging controls to every role

The edge/nginx layer remains the only intended public ingress path.

## CI certification

`npm run test:scale:container` statically ratchets the contract.

The exact-head container CI job additionally proves:
- Compose model parses with default and Aarohi profiles
- exact-SHA image builds
- OCI revision matches the reviewed SHA
- image user is 10001:10001
- entrypoint is deterministic
- hardened read-only web container reaches `/livez` and `/readyz`
- final image contains no dotenv files
- final image does not contain npm
- all worker artifacts parse under runtime Node
- missing mandatory config exits fail-closed
- unknown runtime roles exit fail-closed

## Production cutover

Phase 02 does **not** deploy the container to production.

Current production remains the PM2/nginx release at:
`e5451bf2c6a0bbdd0e38702935c11f503f2c6eef`.

Container cutover must happen only after the later deployment/rollback phases prove:
- private pre-ingress smoke
- exact environment injection
- nginx/edge routing
- orphan listener cleanup
- rollback to the exact prior release/image
- no direct public exposure of app ports

## Rollback principle

Before any future cutover:
1. retain the exact prior production artifact
2. record the new image digest + Git SHA
3. verify the new image privately
4. switch ingress atomically
5. if any postcondition fails, restore the prior artifact without rebuilding it

No business-state rollback is coupled to image rollback.
