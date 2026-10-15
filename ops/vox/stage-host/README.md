# VOX Staging target — existing JARVIS VPS (owner-approved)

**Status: CONFIGURATION-ONLY. RELEASE HOLD.** Approved host selection is
**not** consent to publish VOX, apply Supabase SQL, send WhatsApp or skip reviews.

## Host facts confirmed via authenticated read-only SSH (15 October 2026)

- `qf-staging` on owner-authorized JARVIS PC resolves by SSH config to
  `200.141.10.108` (srv1873796).
- VPS RAM 7.8 GiB, ~5.2 GiB available during check, no swap;
  root filesystem 96 GiB / ~71 GiB free. Load ~0.06/0.29/0.38.
- Docker Engine 29.6.1; Traefik is an **existing container** publishing ports
  80/443; system nginx inactive. Several active Jarvis, AGNI, n8n and
  `qf-core-staging` containers share this VPS. Avoid resource contention.
- No port 3107 listener; a private loopback-only mapping is reserved for VOX.
- The Cloudflare proxied `vox.quickfurno.in` A record is still a
  **TEST-NET-1 placeholder 192.0.2.0**; leave it unchanged.
- The Supabase staging project's Auth Site URL is still localhost; redirect
  flow and callback route require implementation and testing **before change**.
- Core staged VOX `/api/vox/v1/overview` previously returned 404;
  the seven relevant Core SQL migrations are NOT deployed to managed staging.

## Containment of the prepared artifact

`compose.yml` is intentionally **off** unless explicitly selected using
`--profile vox-private-review-only` AND an approved immutable
`VOX_STAGE_IMAGE=...@sha256:<64 hex>` is available locally. No source builds,
network image fetch, Traefik labels, external ingress, service-role keys,
secret files, deployment or database mutation are allowed in this closed-stage
template.

- Host mapping: `127.0.0.1:3107:3000` **only**.
- Private isolated `internal: true` bridge network (deliberately no Auth/Core
  egress; this is for disabled-feature and image runtime checks only).
- 768 MiB hard RAM, 0.5 CPU, 128 PIDs, no capabilities,
  no-new-privileges, non-root uid/gid 10001, read-only root filesystem,
  limited ephemeral `/tmp`, capped logs, no restart policy.
- **All VOX access, owner/agent, proposal, CRM and messaging flags disabled.**
- No output from this template is evidence of live AAL2/Core/Auth flow.

## Safe verification (never starts a container)

```bash
node ops/vox/stage-host/verify-template.mjs --self-test
node ops/vox/stage-host/verify-template.mjs
# A synthetic digest is ONLY for validating compose syntax locally:
VOX_STAGE_IMAGE=ghcr.io/quickfurno-maker/vox-stage@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  docker compose -f ops/vox/stage-host/compose.yml --profile vox-private-review-only config --quiet
```

`verify-template.mjs` emits `releaseStatus: RELEASE_HOLD` even when a safe
template is identified. **Do not run docker compose up at this stage.**

## Next gates before first private runtime smoke

1. Resolve the 25 migration version aliases and six staging-only source files
   or obtain a formal signed and independently reviewed alternate recovery
   scope; retain original 86-row staging ledger.
2. Independent owner and DBA signoff for genuine staging backup, restore,
   Auth/Storage coverage, original ownership event-trigger exception.
3. Separate independent human staging reviewer, not owner self-review;
   GitHub staging environment currently has no secrets and only the
   repo owner as collaborator. Do not disable review.
4. Build and cryptographically sign an immutable VOX web image in approved
   CI from the **merged and independently reviewed** source. Verify digest,
   source provenance, dependency snapshot and SBOM.
5. Before staged Core/VOX private integration, restore/verify Core 7/7 SQL
   in the authorized Staging project with approval and test synthetic staff
   TOTP AAL2, city/role/vendor IDOR, revocation, rate limits, consent,
   signed Jarvis, AGNI owner-only, rollback and no sends. Only then add
   least-privilege staged Auth/Core egress and secrets under separate review.
6. Public hostname cutover ONLY after TLS, Traefik routing, Cloudflare
   source/IP restriction and signed canary certification.

**Never** copy passwords, live DB dumps, staff JWTs, private signatures or
service-role secrets into this repository, VPS staging README or CI logs.
