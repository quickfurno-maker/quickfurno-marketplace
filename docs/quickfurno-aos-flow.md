# QuickFurno AOS Flow

QuickFurno AOS is the future agent operating system for lead quality, vendor trust, vendor matching, lead lifecycle, operations summaries, memory, approvals, and automation. The current code under `lib/aos` is a Phase 1 foundation and is placeholder-only.

## Current AOS Boundaries

- No real AI calls are made.
- No WhatsApp messages are sent by AOS.
- No n8n webhooks are called by AOS.
- No vendor credits are deducted by AOS.
- No live lead distribution is triggered by AOS.
- Agent tools return placeholder objects or mock-safe results.
- Permission gates block dangerous actions such as database writes, WhatsApp sends, email sends, AI API calls, n8n calls, and auto assignment.

## Foundation Agents

### QF-AOS-NexusKernel

Role:

- Future orchestration layer.
- Routes task types to the correct agent.
- Builds static AOS context in Phase 1.
- Checks permission gates before action.
- Returns mock `AgentResult` data with no side effects.

Current files:

- `lib/aos/kernel/nexusKernel.ts`
- `lib/aos/kernel/taskRouter.ts`
- `lib/aos/kernel/contextBuilder.ts`
- `lib/aos/kernel/permissionGate.ts`
- `lib/aos/agents/nexus-kernel/*`

### QF-AOS-FurnoMemory

Role:

- Future shared memory/context layer.
- Will hold reusable lead, vendor, client, category, location, and agent memory.
- Current implementation is a placeholder memory snapshot.

Current files:

- `lib/aos/memory/*`
- `lib/aos/agents/furno-memory/*`

### QF-AOS-LeadLens

Role:

- Future lead quality and qualification agent.
- Will review budget, urgency, project type, city/service fit, duplicate suspicion, invalid lead signals, and CRM status recommendations.
- Current implementation is mock-only.

Current files:

- `lib/aos/agents/lead-lens/*`
- `lib/aos/rules/leadRules.ts`
- `lib/aos/rules/replacementRules.ts`

### QF-AOS-TrustShield

Role:

- Future trust and safety agent.
- Will review vendor risk, spam, suspicious behavior, document gaps, and unsafe marketplace activity.
- Current implementation is mock-only.

Current files:

- `lib/aos/agents/trust-shield/*`
- `lib/aos/rules/securityRules.ts`
- `lib/aos/rules/vendorRules.ts`

### QF-AOS-MatchForge

Role:

- Future read-only vendor matching and ranking agent.
- Will preview best vendors for a lead using city, area, category, status, active state, credits, rating, response history, paid priority, and max 3 vendor cap.
- Must not assign leads or deduct credits directly.

Current files:

- `lib/aos/agents/match-forge/*`
- `lib/aos/rules/assignmentRules.ts`

### QF-AOS-LeadFlow

Role:

- Future lead lifecycle and CRM workflow agent.
- Will recommend next status, follow-up dates, replacement lead actions, nurture stage, and operations tasks.
- Must not send messages or change lead state without explicit approval where required.

Current files:

- `lib/aos/agents/lead-flow/*`
- `lib/aos/rules/replacementRules.ts`

### QF-AOS-OpsBrief

Role:

- Future operations reporting agent.
- Will summarize daily/weekly lead volume, assignment health, vendor health, bad-lead issues, revenue signals, and admin workload.
- Current implementation is mock-only.

Current files:

- `lib/aos/agents/ops-brief/*`

## Future Inactive Agents

These agents exist as inactive/future placeholders and should stay non-operational until the AOS Control Center, permissions, logs, tests, approvals, and rollback tools are ready.

- `QF-AOS-ClientCare`: future client communication and follow-up assistant.
- `QF-AOS-VendorPulse`: future vendor health, renewal, response, and capacity assistant.
- `QF-AOS-RevenueVault`: future package, revenue, payment, and credit intelligence assistant.
- `QF-AOS-ReviewShield`: future review moderation and trust assistant.
- `QF-AOS-GrowthRadar`: future city/category growth and demand assistant.
- `QF-AOS-ContentCraft`: future SEO/content assistant.
- `QF-AOS-AdminCopilot`: future admin helper for summaries and safe suggestions.
- `QF-AOS-VaultGuard`: future security, permissions, and secret-boundary assistant.

## Future Event Flow

The target event flow should be explicit and auditable. AOS should publish and consume events, not silently mutate state.

### `lead.created`

Source:

- `services/leadService.ts:createLead` after a lead insert succeeds.

Future consumers:

- LeadLens for qualification preview.
- FurnoMemory for lead context.
- OpsBrief for daily counts.

Rules:

- No assignment.
- No credit deduction.
- No WhatsApp send.
- No AI side effect unless feature flags and logging exist.

### `lead.validated`

Source:

- Lead validation layer after required fields, consent, duplicate, city, and service checks.

Future consumers:

- LeadLens.
- TrustShield for spam/abuse patterns.

Rules:

- Invalid leads should be marked for replacement workflow, not refund workflow.
- Sensitive fields should remain masked in list-level logs.

### `lead.qualified`

Source:

- LeadLens once a lead has a quality score and recommended CRM status.

Future consumers:

- LeadFlow.
- MatchForge.
- OpsBrief.

Rules:

- A qualification result is a recommendation until live CRM update permissions are enabled.

### `vendors.matched`

Source:

- MatchForge read-only matching preview.

Future consumers:

- LeadFlow.
- Admin approval queue when sensitive.

Rules:

- Maximum 3 vendors.
- Disabled, inactive, suspended, unpaid-without-eligible-package, or zero-credit vendors must be excluded.
- Paid vendors can receive priority only after a documented rule version is active.
- Matching preview must not call the assignment RPC.

### `lead.assigned`

Source:

- Explicit user/admin-confirmed assignment workflow.

Future consumers:

- LeadFlow.
- VendorPulse.
- RevenueVault.
- OpsBrief.

Rules:

- Assignment is a side-effect boundary.
- Current assignment RPC deducts vendor credits and inserts WhatsApp log rows.
- AOS must not trigger this automatically until approvals, feature flags, and rollback controls exist.

### `report.generated`

Source:

- OpsBrief scheduled or manual report generation.

Future consumers:

- Admin dashboard.
- AOS Control Center logs.

Rules:

- Reports must be read-only by default.
- Reports can recommend actions but should not execute them.

## Required Management Foundation Before Activation

Before any agent becomes live:

- AOS Control Center under protected admin routes.
- Agent versioning for prompts and rules.
- Agent logs and audit logs.
- Test lab comparing current vs draft behavior.
- Approval queue for sensitive actions.
- Permission matrix and feature flags.
- Cost monitor.
- Rollback center.
- Masking for phone numbers and sensitive values.

## Future inactive agents added in Phase 1D

Phase 1D registered all 30 AOS agents. Agents 1–7 are foundation (testing,
rule-based); agents 8–30 are future / inactive placeholders (no AI, no WhatsApp,
no n8n, no credit deduction, no lead distribution, no DB writes). See
`lib/aos/agents/agentRegistry.ts` for the single source of truth.

| # | Agent | Status | One-line purpose |
|---|-------|--------|------------------|
| 1 | QF-AOS-NexusKernel | testing | Routes AOS tasks, checks permission gates, coordinates safe orchestration. |
| 2 | QF-AOS-FurnoMemory | testing | Stores shared lead, vendor, client, and agent context memory. |
| 3 | QF-AOS-LeadLens | testing | Rule-based lead quality scoring and qualification. |
| 4 | QF-AOS-TrustShield | testing | Rule-based spam/duplicate risk review (never blocks). |
| 5 | QF-AOS-MatchForge | testing | Vendor suggestions only, max 3, excludes disabled vendors. |
| 6 | QF-AOS-LeadFlow | testing | Assignment/notification preview only, no side effects. |
| 7 | QF-AOS-OpsBrief | testing | Read-only operations summary and daily report. |
| 8 | QF-AOS-ClientCare | future | Future client follow-up, support, and nurture assistant. |
| 9 | QF-AOS-VendorPulse | future | Future vendor health, response, renewal, and capacity assistant. |
| 10 | QF-AOS-RevenueVault | future | Future package, payment, revenue, and credit intelligence assistant. |
| 11 | QF-AOS-ReviewShield | future | Future review moderation and public trust assistant. |
| 12 | QF-AOS-GrowthRadar | future | Future city, category, SEO, and demand growth assistant. |
| 13 | QF-AOS-ContentCraft | future | Future SEO page, content, and marketplace copy assistant. |
| 14 | QF-AOS-AdminCopilot | future | Future superadmin helper for summaries, drafts, and recommendations. |
| 15 | QF-AOS-VaultGuard | future | Future secret, permission, audit, and rollback guardian. |
| 16 | QF-AOS-LeadNurture | future | Long-term lead nurturing, follow-up scheduling, custom nurture dates, reactivation. |
| 17 | QF-AOS-CalendarSync | future | CRM calendar, follow-up/site-visit reminders, future Google Calendar sync. |
| 18 | QF-AOS-SourceTracker | future | Track lead source, UTM, campaign, GCLID, FBCLID, referrer, landing page. |
| 19 | QF-AOS-AdBrain | future | Analyze Google/Meta campaign performance and suggest marketing actions. |
| 20 | QF-AOS-CityScout | future | Analyze area/city demand and suggest city/category expansion. |
| 21 | QF-AOS-VendorOnboard | future | Vendor onboarding, profile completeness, service area and verification checks. |
| 22 | QF-AOS-DealTracker | future | Track lead outcome, site visit, quotation, won/lost, vendor conversion. |
| 23 | QF-AOS-QualityAudit | future | Audit lead/vendor quality, bad matching, complaints, poor source quality. |
| 24 | QF-AOS-PackageAdvisor | future | Recommend vendor packages by category, demand, city, performance, budget. |
| 25 | QF-AOS-WhatsAppPilot | future | Future WhatsApp automation controller for clients, vendors, admin alerts. |
| 26 | QF-AOS-ReplacementDesk | future | Handle invalid lead replacement requests and recommend approval/rejection. |
| 27 | QF-AOS-FraudRadar | future | Advanced fraud, competitor testing, vendor spying, suspicious activity detection. |
| 28 | QF-AOS-SEOScout | future | Find SEO page opportunities from lead demand, service, city, area data. |
| 29 | QF-AOS-SalesCoach | future | Follow-up suggestions, objection handling, and next best action for the team. |
| 30 | QF-AOS-ExecutiveBrief | future | Founder-level daily/weekly summary, revenue projection, urgent actions, growth. |

> All Phase 1D agents (16–30) are inactive placeholders: `status: "future"`,
> `mode: "placeholder"`, `version: "v0.1-future"`, all side effects disabled,
> `requiresAdminApproval: true`. Their `service.ts` returns `status: "future_inactive"`.
