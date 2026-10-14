# VOX-10B — Reuse Core Automation Studio dry-run simulation

The Core `GET /api/vox/v1/studio-simulate?workflowKey=...` uses **existing** `cloneAutomationStudioDefinition` and `simulateAutomationStudioDefinition` from `lib/automation/studioContract.ts`, no new execution engine, database schema or paid AI analysis. Only AAL2-verified operations_manager or auditor with active Core membership/city can request simulations, after explicit private Staging feature flag `VOX_STUDIO_SIMULATION_ENABLED=staging`. The workflow must be one native registered key; all other parameters and multiple keys are refused.

Returns only the native **default definition** traversal, bounded nodes and notes. It cannot assert the *current published* workflow or runtime health, make a provider send, update a credit, mutate a draft, publish, rollback or execute anything. Explicit `source=NATIVE_DEFAULT_DEFINITION` and `runtimeState=NOT_QUERIED` prevent false live claims. All mutation methods return 405. This implements simulation only, not full Automation Studio parity; actual draft preview and publication require separate Core approvals and signed Staging tests.

No live Core/Jarvis/AGNI deployment, agent memory access or Supabase writes performed.
