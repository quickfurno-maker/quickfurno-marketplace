# QuickFurno Unified Project Brain v1

Bootstrapped: 2026-09-14
Canonical repo: `quickfurno-maker/quickfurno-marketplace`
Bootstrap source: `main @ 2a5aa5f4cd2e77ea87d098b1a2e56881857fd464`

This folder is the permanent GitHub-readable source of reviewed QuickFurno project context for ChatGPT.

## Components

1. **Graphify** - local repository intelligence for code, docs, SQL, configs and relationships.
2. **Graphiti** - local temporal memory for decisions, supersession, incidents and deployments.
3. **Project-memory docs** - reviewed, human-readable canonical project truth.
4. **Git/GitHub** - immutable engineering history and the access bridge used by ChatGPT.
5. **ChatGPT access protocol** - defines what ChatGPT should retrieve before substantial QuickFurno work.

The local Graphify/Graphiti services are backend generators. They do not need to be directly attached to ChatGPT for the GitHub Project Brain to be useful.

## Authority order

1. Independently verified live production/database state.
2. Current code/schema on the relevant deployed commit.
3. Canonical `docs/project-memory/` documents.
4. Graphiti temporal memory and its committed snapshots.
5. Graphify repository intelligence and its committed snapshot.
6. Historical chats, notes and summaries.

A lower-authority source must never silently override a higher-authority source.
## Required reading before substantial QuickFurno work

- `CURRENT_STATE.md`
- `BUSINESS_RULES.md`
- `DECISIONS.md`
- `OPEN_ITEMS.md`
- `GRAPHITI_CURRENT_FACTS.md`
- `GRAPHITI_TIMELINE.md`
- `GRAPHIFY_SUMMARY.md`
- `CHATGPT_ACCESS.md`
- `MEMORY_PROTOCOL.md`

Read `ARCHITECTURE.md`, `INTEGRATIONS.md`, `DEPLOYMENTS.md` and `INCIDENTS.md` when relevant.

## Required update after substantial work

- update current state when truth changes;
- record durable decisions and business-rule changes;
- record deployments only after independent evidence exists;
- update open items;
- add reviewed temporal events to Graphiti when appropriate;
- refresh Graphify after repository changes;
- regenerate the committed ChatGPT snapshots;
- run `node scripts/project-memory/verify.mjs`.

The Project Brain is advisory/context infrastructure only. It must never gain authority to send messages, assign leads, debit credits, apply migrations, or bypass QuickFurno Core governance.
