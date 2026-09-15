# QuickFurno Integration Memory

Last reviewed: 2026-09-14

## Supabase
Persistence and database authorities. Graphify may map schema source; applied migration/runtime truth must be verified against the target database. Never store service-role credentials in memory.

## n8n
Workflow orchestration only. Core validates and owns governed mutations.

## Meta / WhatsApp
Communication provider/runtime. Mapping, policy, activation and send state come from governed runtime evidence, not AI memory.

## GitHub
Engineering history and current source: commits, PRs, reviews and changed-file evidence.

## Graphify
Repository graph for code/docs/SQL/config, architecture traces and impact analysis. Explanatory only.

## Graphiti
Temporal memory for reviewed decisions, supersession, deployments, incidents and project events. Contextual only.

## MCP
Common AI access layer. Every MCP client still obeys QuickFurno's authority hierarchy and runtime boundaries.
