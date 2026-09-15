# QuickFurno Current State

Last reviewed: 2026-09-15
Evidence class: repository source plus independently validated local Project Brain runtime where stated
Repository: `quickfurno-maker/quickfurno-marketplace`
Source branch: `main`
Source commit: `2a5aa5f4cd2e77ea87d098b1a2e56881857fd464`
Source event: merge of PR #84, QuickFurno Pune launch / AOS V2 boundary.

## Launch scope

- Current source-level launch scope is **Pune only**.
- Mumbai is not an active launch city unless a later explicit decision supersedes this rule.

## AOS / automation

- AOS V2 is a seven-agent advisory architecture in current source.
- AOS recommendations do not themselves own business side effects.
- QuickFurno Core remains the authority boundary for governed actions.
- n8n is orchestration, not business authority.

## Communication / database

- Governed Meta/WhatsApp infrastructure exists in source.
- Source presence does not prove a migration is applied or a provider mapping is active.
- Source validators at this commit pin the migration source tree at 111 migrations.
- Runtime/deployment state must be independently verified before being promoted here.

## Project Brain runtime

- Canonical project-memory docs and ChatGPT access protocol are active in `feat/qf-project-brain-v1`.
- Graphify `0.9.61` is installed with MCP + SQL support; validated graph: 14,447 nodes, 28,548 edges, 652 communities.
- Graphiti Core `0.30.2` + Neo4j `5.26.0` run locally in isolated Docker services.
- Graphiti group is `quickfurno-marketplace`; six reviewed bootstrap episodes are processed successfully.
- Graphiti uses Gemini `gemini-3.5-flash-lite` and `gemini-embedding-001` through a local secret-safe launcher.
- Graphiti MCP and Neo4j bind to `127.0.0.1` only; they are not public services.
- ChatGPT access today is through committed GitHub-readable canonical and derived snapshots, not direct local MCP attachment.
- `GRAPHITI_CURRENT_FACTS.md`, `GRAPHITI_TIMELINE.md`, and `GRAPHIFY_SUMMARY.md` are the current derived snapshots.

## Open source state

- PR #73 (`QF-MVP-82A — real-time unified WhatsApp inbox`) was still open at bootstrap.
- Its historical PR description required current staging UI/Realtime smoke before merge.
- Because `main` has advanced, rebase/review compatibility before treating it as merge-ready.

## Deployment truth

The Project Brain local runtime is validated, but this work does **not** certify or alter the QuickFurno staging/production application deployment.
Use independently observed deployed SHA, migration history, process/runtime identity and health evidence for application deployment claims.
