# Scale Phase 15 — Immutable CI/CD, Supply Chain & Blue/Green

This is the **scale-roadmap Phase 15** release-control layer. It does not authorize the unrelated Jarvis product-roadmap Phase 15 automation scope.

## Locked release invariant

Production promotion consumes a signed `qf.release.phase15.v1` manifest. The manifest binds an exact merged Git SHA to exact OCI digest references, SPDX SBOM, Sigstore identity, GitHub build provenance, database compatibility and rollback safety. Tags are publication handles only; deployment uses digest references.

## QuickFurno rollout

1. Build once in GitHub Actions.
2. Scan and generate SPDX SBOM.
3. Publish the exact source-SHA image to GHCR and resolve its immutable digest.
4. Keyless-sign the digest, attach SBOM and Phase-15 release-manifest attestations, and attach GitHub provenance.
5. **Stage** only the inactive web slot on a separate loopback port.
6. Prove OCI revision label, container health, `/livez` and `/readyz`.
7. Human-approved promotion atomically switches the Nginx upstream.
8. Run the external HTTPS smoke.
9. Only after traffic is proven, start the new automation/conversation workers. Existing Phase-12 durable claim/idempotency controls cover the short drain overlap.
10. Stop previous workers but keep the previous web slot warm. No automatic image/container pruning is allowed in Phase 15.
11. Rollback switches traffic to the exact previous signed manifest, reactivates its workers and stops the failed generation.

## Database rule

Phase-14 migrations remain **SOURCE_ONLY** here. This phase never runs a production database migration. A future release may declare `EXPAND_COMPATIBLE` only after a separately approved migration procedure proves old and new application generations can both run safely. Contract/destructive migrations are not blue/green promotable.

## Production activation boundary

The repository ships the source-certified machinery but does not alter the current production Nginx configuration. Production activation requires all of these explicit actions:

- install the reviewed Nginx include pattern;
- create the GitHub `production` environment with required reviewers;
- provision a dedicated self-hosted runner labelled `qf-phase15-deployer` on the deployment host;
- set repository variable `PHASE15_PRODUCTION_CUTOVER_ENABLED=true`;
- configure the external environment file and Phase-15 state directory;
- perform a first owner-approved blue/green rehearsal.

Until then, promotion jobs are structurally present but fail closed / remain skipped.

## Safety

AGNI/OpenAI do not receive deployment-host credentials. Telemetry and analysis may recommend a release action, but only the human-approved CI environment can invoke the local release controller. The controller accepts only exact digest manifests and has no arbitrary shell/SQL input surface.
