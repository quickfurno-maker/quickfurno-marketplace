# VOX-05 Automation and intelligence reuse registry

**Source-only, not runtime activation.** VOX uses *actual QuickFurno Core* `AUTOMATION_STUDIO_WORKFLOWS` from `lib/automation/studioContract.ts` to generate a strictly staff-scoped, read-only catalog via `GET /api/vox/v1/studio-catalog`. No separate engine, workflow evaluation, scheduler or provider sender is created. Only operations_manager/auditor may see this catalog after Core AAL2 and staff city/team validity is checked.

Jarvis agent-flow types Aarohi and Anisha are shown as **NOT_CONNECTED**, explicitly not a live state or a direct editable canvas; the existing Jarvis Flow Studio remains authoritative. AOS and AGNI are likewise labelled NOT_CONNECTED, not falsely reported healthy or live. Core workflows say NOT_QUERIED for runtime status to distinguish registered source types from actual worker health.

This is the initial safe VOX control-plane integration seam; actions to simulate, draft, publish, roll back, send templates, approve or activate require separate signed Core/Jarvis guarded APIs, audit, replay fencing and delegated role review. No production runtime or metadata was queried and no DB changes occurred.
