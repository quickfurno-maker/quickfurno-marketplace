# Phase 19 — Kubernetes-ready QuickFurno artifacts

These manifests prove portability only. They do **not** authorize or operate a production Kubernetes cluster.

## Runtime contract

- Kustomize packages base, certification, staging and production-render overlays.
- The base pins the current Phase 18 signed QuickFurno OCI digest.
- Web startup/liveness use `/livez`; readiness uses `/readyz`. Upstream/provider health never ejects a healthy web replica.
- Web autoscaling is CPU based, min 2 / max 4, with scale-up limited to one pod per minute. QuickFurno web uses the Supabase Data API, so this HPA does not create one PostgreSQL pool per pod.
- Effect-bearing workers remain fixed by default; correctness remains in durable queues/outbox/idempotency, not process-local scheduler uniqueness.
- Root filesystem is read-only; only memory-backed `/tmp` is writable. No PVC or hostPath carries business state.
- ConfigMaps and Secrets are projected at runtime so rotation does not require an image rebuild.
- Service-account tokens are disabled; pods run non-root with RuntimeDefault seccomp, no privilege escalation and all capabilities dropped.
- Default-deny NetworkPolicy is the baseline. DNS and HTTPS egress are explicit. Public ingress maps only the QuickFurno web service.
- PDB uses `maxUnavailable: 1`, so it cannot block a rolling deployment.

## Certification

CI creates an ephemeral Kind v1.31.6 cluster, performs an API-server dry-run, runs the exact Phase 18 production image by digest, checks worker artifacts from that same image, and proves `/livez` and `/readyz` separately.

The certification overlay disables external effect-bearing workers because CI intentionally has no production Supabase/provider credentials. It does not weaken their base deployment contract.

## Production boundary

The staging/production overlays are renderable packages only. They contain no credentials and Phase 19 contains no workflow that applies the production overlay. Existing Docker/VPS production remains unchanged.
