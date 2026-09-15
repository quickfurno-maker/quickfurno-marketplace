# QuickFurno Business Rules Memory

Last reviewed: 2026-09-14

## BR-001 — Launch geography

**Current:** Pune only.

Mumbai is not an active launch market. Do not reintroduce Mumbai into public launch flows, matching assumptions, automation, marketing or operational defaults without a new explicit decision.

## BR-002 — AOS authority

AOS V2 is advisory. It may generate intelligence or recommendations, but it does not independently own customer/vendor side effects.

## BR-003 — Core owns business mutations

n8n, Graphiti, Graphify, MCP clients and AI agents must not bypass QuickFurno Core's governed business authorities.

## BR-004 — Runtime claims require runtime evidence

Repository source, chats or memory entries are not sufficient proof of deployment, applied migration, active provider mapping, enabled runtime or successful send. Verify the target runtime independently.

## BR-005 — Memory cannot override truth

When memory conflicts with current code or verified live state, memory is stale and must be corrected.

## BR-006 — No secrets in Project Brain

Never store API keys, service-role keys, provider tokens, passwords, OTPs, private customer contact data or other secrets in:
- project-memory Markdown;
- Graphiti episodes;
- Graphify supplemental docs;
- committed MCP prompts or logs.

## BR-007 — Project isolation

QuickFurno memory uses the project identity `quickfurno-marketplace`.
Do not mix OneDecore or Jarvis project facts into this memory group. Cross-project integrations must be recorded explicitly as boundaries, not merged context.
