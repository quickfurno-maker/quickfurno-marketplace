# QuickFurno Phase 16 host model

This directory holds portable multi-host HA certification and bootstrap assets.

- `haproxy-certification.cfg`: CI-only health/failover proxy.
- `tofu/`: provider-neutral host inventory and cloud-init generator.
- Canonical placement contract: `../../contracts/qfj-phase16-topology-v1.json`.

Production target requires a redundant external load-balancing tier. The HAProxy file here is not itself the production topology.
