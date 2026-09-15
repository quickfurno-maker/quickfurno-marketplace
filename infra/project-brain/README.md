# QuickFurno Local Project Brain Runtime

This directory runs the private Graphiti + Neo4j backend for QuickFurno Unified Project Brain.
It is **not** part of the QuickFurno web application's execution path.

## Start

```powershell
powershell -ExecutionPolicy Bypass -File .\infra\project-brain\start-local.ps1
```

The launcher:
- reads the existing Windows user `GEMINI_API_KEY` without printing it;
- creates/reuses an ignored local Neo4j password;
- starts Neo4j `5.26.0` and Graphiti Core `0.30.2`;
- binds all published ports to `127.0.0.1` only;
- verifies the Graphiti `/health` endpoint before success.

## Local endpoints

- Graphiti MCP: `http://127.0.0.1:18000/mcp/`
- Graphiti health: `http://127.0.0.1:18000/health`
- Neo4j browser: `http://127.0.0.1:17474`
- Neo4j Bolt: `bolt://127.0.0.1:17687`

## Runtime model

- LLM: `gemini-3.5-flash-lite`
- Embedder: `gemini-embedding-001`, 768 dimensions
- Group ID: `quickfurno-marketplace`
- Image: `quickfurno/graphiti-mcp:0.30.2-gemini-c035afb-r1`
- Queue concurrency: 1, intentionally conservative for Gemini rate-limit stability.

The image includes a narrow compatibility patch for Graphiti `0.30.2`: its Gemini factory otherwise leaves `small_model` unset and falls back to retired `gemini-2.5-flash-lite`.

## ChatGPT snapshots

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\project-memory\refresh.ps1
```

to refresh Graphify, validate Graphiti, export Graphiti snapshots, and run the Project Brain verifier.

Never commit `.neo4j-password`, runtime markers, API keys, or `graphify-out/`. Never expose these local ports publicly simply to connect ChatGPT.
