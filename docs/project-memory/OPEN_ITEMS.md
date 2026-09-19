# QuickFurno Project Brain - Open Items

Last reviewed: 2026-09-15

## Completed foundation

- PB-001 Canonical `docs/project-memory/` foundation and verification: complete.
- PB-002 Graphify `0.9.61` + SQL support, graph generation, architecture-query validation and local Git refresh hook: complete.
- PB-003 Graphiti `0.30.2` + Neo4j `5.26.0`, isolated `quickfurno-marketplace` group and reviewed initial seed: complete.
- PB-004 ChatGPT access bridge through GitHub-readable Graphiti/Graphify snapshots: complete.
- End-to-end refresh script for Graphify, Graphiti validation/export, snapshot compaction and verification: complete.
- Local Graphiti/Neo4j remain private localhost services and have no QuickFurno app runtime dependency.

## PB-005 - Ongoing lifecycle

After substantial QuickFurno work:
- update canonical docs when truth changes;
- add reviewed temporal events to Graphiti when a durable historical event should be retained;
- run `scripts/project-memory/refresh.ps1` after repository changes;
- commit the refreshed Project Brain snapshots with the relevant engineering change;
- run `node scripts/project-memory/verify.mjs` before declaring memory-complete.

## Future enhancement

Direct ChatGPT custom-MCP attachment may replace the GitHub snapshot bridge if the user's ChatGPT product later supports the required private/custom MCP capability. Do not expose local Graphiti publicly merely to obtain this.

## Existing QuickFurno work to keep visible

- PR #73 was open at bootstrap and needs current compatibility review plus the historical staging UI/Realtime smoke before merge.
- Application runtime/deployment state must be independently audited before promotion into `CURRENT_STATE.md`.
