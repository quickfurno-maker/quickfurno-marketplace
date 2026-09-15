# QuickFurno Current State

Last reviewed: 2026-09-15
Evidence class: current repository source plus independently validated local Project Brain runtime where stated
Repository: `quickfurno-maker/quickfurno-marketplace`
Source branch: `main`
Source commit: `a6fd6952630594ff1ee2a9d373c50b7d1ebc8155`
Source event: merge of PR #85, `fix: enforce Pune-only launch scope`, on 2026-09-15.
Project Brain branch: `feat/qf-project-brain-v1`

## Launch scope

- Current source-level launch scope is **Pune only**.
- PR #85 is the current source baseline and enforces Pune-only launch scope.
- Mumbai is not an active launch city unless a later explicit reviewed decision supersedes this rule.

## AOS / automation

- AOS V2 is advisory in current source.
- AOS recommendations do not themselves own business side effects.
- QuickFurno Core remains the authority boundary for governed actions.
- n8n is orchestration, not business authority.

## Communication / database

- Governed Meta/WhatsApp infrastructure exists in source.
- Source presence does not prove a migration is applied or a provider mapping is active.
- The current source tree contains **111 SQL migrations** under `supabase/migrations/`.
- Source migration count must not be represented as the live applied migration count.
- Runtime/deployment state must be independently verified before being promoted here.
## Project Brain runtime

- Permanent ChatGPT entry point: `docs/project-memory/` in this repository.
- Graphify `0.9.61` is installed locally with SQL support; current graph statistics are generated into `GRAPHIFY_SUMMARY.md` rather than hard-coded here.
- Graphiti Core `0.30.2` + Neo4j `5.26.0` run locally in isolated Docker services.
- Graphiti group is `quickfurno-marketplace`; six reviewed bootstrap episodes are processed successfully.
- Graphiti uses Gemini `gemini-3.5-flash-lite` and `gemini-embedding-001` through a local secret-safe launcher.
- Graphiti MCP and Neo4j bind to `127.0.0.1` only; they are not public services.
- ChatGPT access is through committed GitHub-readable canonical and derived snapshots, not direct localhost MCP attachment.
- `GRAPHITI_CURRENT_FACTS.md`, `GRAPHITI_TIMELINE.md`, and `GRAPHIFY_SUMMARY.md` are derived snapshots and remain lower authority than canonical/live evidence.

## Open source state

- PR #73 (`QF-MVP-82A - real-time unified WhatsApp inbox`) was open at Project Brain bootstrap.
- Its historical PR description required current staging UI/Realtime smoke before merge.
- Re-check its current GitHub state and compatibility before treating it as merge-ready.

## Deployment truth

The Project Brain local runtime is validated, but this work does **not** certify or alter the QuickFurno staging/production application deployment.
Use independently observed deployed SHA, migration history, process/runtime identity and health evidence for application deployment claims.
