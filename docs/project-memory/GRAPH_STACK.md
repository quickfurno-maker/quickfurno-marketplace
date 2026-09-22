# Graphify + Graphiti Runtime

Last reviewed: 2026-09-15

## Graphify

- Package: `graphifyy 0.9.61`; CLI: `graphify`.
- Installed with MCP and SQL support locally.
- Generated `graphify-out/` stays untracked.
- The current graph size and build commit are exported automatically to `GRAPHIFY_SUMMARY.md`.
- A local post-commit/post-checkout Graphify hook is installed in the shared QuickFurno Git repository metadata.
- ChatGPT does not depend on the local Graphify MCP endpoint; it reads the committed summary and current GitHub source.

## Graphiti

- Source pin: `getzep/graphiti @ c035afb7990b6077331a81e98b04efcfd9bf8184`.
- Graphiti Core: `0.30.2`.
- Neo4j: `5.26.0`.
- Group: `quickfurno-marketplace`.
- LLM: `gemini-3.5-flash-lite`.
- Embedder: `gemini-embedding-001`, 768 dimensions.
- Lightweight image: `quickfurno/graphiti-mcp:0.30.2-gemini-c035afb-r1`.
- Local MCP: `http://127.0.0.1:18000/mcp/`.
- Neo4j browser/Bolt: `127.0.0.1:17474` / `127.0.0.1:17687`.
- Six reviewed bootstrap episodes are processed; raw historical chats were not bulk imported.
## Compatibility note

Graphiti `0.30.2` leaves Gemini `small_model` unset and would otherwise fall back to retired `gemini-2.5-flash-lite`. The pinned QuickFurno image applies a narrow build-time patch so both main and small-model calls use the configured Gemini 3.5 model.

## ChatGPT bridge

Current ChatGPT usage is GitHub-first:
- Graphiti exports `GRAPHITI_CURRENT_FACTS.md` and `GRAPHITI_TIMELINE.md`.
- Graphify exports `GRAPHIFY_SUMMARY.md`.
- the refresh pipeline compacts Graphiti's raw export into concise Markdown for easier ChatGPT retrieval;
- ChatGPT retrieves those snapshots plus the canonical memory docs before substantial QuickFurno work;
- private local MCP ports remain unexposed.

## Start / refresh

```powershell
powershell -ExecutionPolicy Bypass -File .\infra\project-brain\start-local.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\project-memory\refresh.ps1
```

Secrets remain outside Git. The Project Brain is contextual/advisory and has no authority to perform QuickFurno business mutations.
