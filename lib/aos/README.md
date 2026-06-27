# QuickFurno AOS

QuickFurno AOS is the future agent operating system for marketplace operations. It will eventually help with lead qualification, vendor trust, vendor matching, lead lifecycle, operations reporting, approvals, memory, and admin assistance.

Current status: Phase 1 foundation only.

## What Exists Today

- Agent folders and configs under `lib/aos/agents/`.
- Kernel placeholders under `lib/aos/kernel/`.
- Event helpers under `lib/aos/events/`.
- Memory placeholders under `lib/aos/memory/`.
- Rule placeholders under `lib/aos/rules/`.
- Disabled external tool placeholders under `lib/aos/tools/`.
- Log and approval placeholders under `lib/aos/logs/` and `lib/aos/approvals/`.
- Shared runtime types under `lib/aos/types/`.

## First 7 Foundation Agents

- `QF-AOS-NexusKernel`: orchestration and routing foundation.
- `QF-AOS-FurnoMemory`: future shared memory/context foundation.
- `QF-AOS-LeadLens`: future lead quality and qualification foundation.
- `QF-AOS-TrustShield`: future trust and safety foundation.
- `QF-AOS-MatchForge`: future read-only vendor matching foundation.
- `QF-AOS-LeadFlow`: future CRM lifecycle and follow-up foundation.
- `QF-AOS-OpsBrief`: future operations reporting foundation.

## Future Inactive Agents

- `QF-AOS-ClientCare`
- `QF-AOS-VendorPulse`
- `QF-AOS-RevenueVault`
- `QF-AOS-ReviewShield`
- `QF-AOS-GrowthRadar`
- `QF-AOS-ContentCraft`
- `QF-AOS-AdminCopilot`
- `QF-AOS-VaultGuard`

## Safety Status

- No real AI yet.
- No WhatsApp sending yet.
- No n8n webhook calls yet.
- No lead distribution yet.
- No vendor credit deduction yet.
- No automatic vendor suspension.
- No automatic bulk campaigns.
- Placeholder-only behavior.

## Future Activation Order

1. Document flows and boundaries.
2. Add AOS Control Center in protected Superadmin routes.
3. Add AOS database tables through reviewed migrations.
4. Add logs, audit trails, permissions, approvals, and rollback controls.
5. Add prompt/rule versioning.
6. Add Test Lab with old-vs-draft comparison.
7. Add read-only agent previews.
8. Add human approval for sensitive actions.
9. Add feature flags for controlled activation.
10. Enable side effects one by one only after build, QA, rollback, and audit checks pass.

## Hard Boundaries

- AOS must not import browser-only code.
- AOS must not expose secrets.
- AOS must not call live assignment or credit mutation functions directly.
- AOS must not send messages directly.
- AOS should produce recommendations first, then approved actions later.

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
