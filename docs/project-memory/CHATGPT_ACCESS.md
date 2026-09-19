# ChatGPT Access Protocol

Effective: 2026-09-15

QuickFurno Project Brain is ChatGPT-first. Do not require Claude, Codex CLI, or another AI client to use project memory.

## How ChatGPT should enter the brain

For substantial QuickFurno work, retrieve these GitHub files before relying on conversational memory:

1. `docs/project-memory/CURRENT_STATE.md`
2. `docs/project-memory/BUSINESS_RULES.md`
3. `docs/project-memory/DECISIONS.md`
4. `docs/project-memory/OPEN_ITEMS.md`
5. `docs/project-memory/GRAPHITI_CURRENT_FACTS.md`
6. `docs/project-memory/GRAPHITI_TIMELINE.md`
7. `docs/project-memory/GRAPHIFY_SUMMARY.md`
8. `docs/project-memory/MEMORY_PROTOCOL.md`

If the task depends on implementation detail, inspect current repository code in addition to these summaries.

## Authority rule

ChatGPT must not treat Graphiti, Graphify, or old chats as stronger than independently verified live state or current deployed code/schema.

## Normal usage

The user may simply say:

`Use QuickFurno Project Brain and continue.`

or ask a normal QuickFurno task. The retrieval protocol should run before substantial work.

## Why snapshots exist

The local Graphiti and Graphify runtimes are private backend tools. ChatGPT Plus cannot directly attach this private local MCP server. Therefore reviewed Graphiti/Graphify outputs are committed as GitHub-readable snapshots so ChatGPT can retrieve the same project context through the connected GitHub source.

Do not expose the local Graphiti or Neo4j ports publicly merely to work around that product limitation.
