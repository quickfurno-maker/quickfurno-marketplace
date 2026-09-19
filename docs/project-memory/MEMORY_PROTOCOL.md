# QuickFurno Memory Protocol

Version: 1.1
Effective: 2026-09-15

## Trigger

Use this protocol for substantial QuickFurno architecture, backend, database, AOS, n8n, communication, deployment, security, lead/vendor/credit, incident or cross-file work.

## Before work

1. Identify repository, branch and current commit.
2. Read `CURRENT_STATE.md`, `BUSINESS_RULES.md`, `DECISIONS.md` and `OPEN_ITEMS.md`.
3. Read `GRAPHITI_CURRENT_FACTS.md` and `GRAPHITI_TIMELINE.md` when historical decisions/events could affect the task.
4. Read `GRAPHIFY_SUMMARY.md`, then inspect current source when repository relationships or implementation impact matter.
5. Use the local Graphiti/Graphify services directly only when the available ChatGPT tooling can reach the authorized machine; otherwise use the committed GitHub snapshots.
6. For runtime questions, inspect the live target rather than inferring deployment from source or memory.

## During work

- Treat memory as context, never mutation authority.
- Record contradictions instead of silently merging conflicting facts.
- Prefer exact evidence: commit SHA, PR, migration version, runtime identity.
- Keep QuickFurno isolated from OneDecore/Jarvis memory identities.
- Never store secrets or private customer/vendor payloads in committed Project Brain files.
## After work

Before declaring a substantial task complete:
1. complete appropriate tests/certification;
2. know the commit/PR identity;
3. update `CURRENT_STATE.md` if current truth changed;
4. record durable choices in `DECISIONS.md`;
5. update `BUSINESS_RULES.md` if a business rule changed;
6. update `OPEN_ITEMS.md`;
7. record deployments only with independent evidence;
8. record durable incident lessons;
9. add a reviewed Graphiti episode when the event is worth retaining temporally;
10. run `scripts/project-memory/refresh.ps1` after repository changes;
11. commit refreshed snapshots with the related work;
12. run `node scripts/project-memory/verify.mjs`.

## Contradictions

Do not merge contradictory facts. Identify higher-authority evidence, mark older decisions superseded when appropriate, correct canonical docs, and retain the historical transition in Graphiti.

## Completion rule

A substantial QuickFurno task is not memory-complete until canonical project memory reflects the resulting state and its GitHub-readable snapshots are current.
