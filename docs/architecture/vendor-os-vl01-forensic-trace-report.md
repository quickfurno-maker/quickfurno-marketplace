# Vendor OS VL-01 — Read-only trace and launch-baseline reconciliation
Date: 2026-10-12 IST
Phase: VL-01 (IN PROGRESS; source-level milestone only)
Canonical Notion blueprint: https://app.notion.com/p/3f7751ba167c810ba80fe0caf0180b29
Canonical consolidated audit: https://app.notion.com/p/3f7751ba167c819cbf3ee498b7863452
Originating PR: https://github.com/quickfurno-maker/quickfurno-marketplace/pull/181

## Scope of this change
- Reuse the existing native Automation Worker, durable request/job/attempt/transport ledgers and Automation Studio. No replacement worker or orchestration engine.
- Read-only, superadmin-guarded exact-job trace; workflow/UI linkage means a visual pointer, not proof an editable draft executed.
- Merge the latest Core main source (including separately gated Anisha memory source) without enabling migrations or production memory.
- Align new vendor Studio action authoring to current Core retirement policy: vendor.response_reminder is retired despite an older PR description; vendor.document_reminder is nonproducible. Four eligible vendor notification action families are vendor.lead_offer, vendor.onboarding_reminder, vendor.package_expiry_warning and vendor.low_credit_warning.
- Strengthen exact UUID input validation consistently between UI/API/service; unknown provider certainty remains explicitly unverified.
- Core authorization is an observation, not successful provider delivery. Ambiguous/uncertain outcome is UNKNOWN, not a waiting queue claim.
- Timeline evidence scans are bounded; expose whether source data exceeded row cap, and report only the sources actually present.

## Evidence baseline (READ-ONLY; point-in-time only)
QuickFurno production Supabase: 28 vendors; 14 approved; eight linked dashboard accounts; six approved without linked account; six recorded office-coordinate pairs, zero formal location verification and zero linked service zones; zero CRM vendor profiles/package orders/payments; 71 assignment rows, none >3 vendors; 49 historical assignment rows without current operation link; 44 assignment debit ledger rows and 16 credit correction entries. Do not infer lost credits from incompatible older references.
135 lead-delivery logs contain 134 WhatsApp preview-only records and one provider-linked delivery. Transport/provider certainty must remain separate from dashboard delivery status.
Automation: 83 jobs, 7 client successes, 18 failures and 58 cancelled; 14 vendor variable failures. Fresh native worker heartbeat with jobsProcessed=0 and NATIVE_QUEUE_EMPTY is not proof of a broken worker or healthy new workflow; verify if any eligible producer event exists before diagnosing.
Conversations: 12 assigned records, no ANISHA. 169 inbound records identity_unknown. Conversational account disabled while transactional transport remains active.
Jarvis memory staged 29/29; source merged and CI successful, production migration/activation, browser checkbox and AGNI alert proof remain independently gated.

## Evidence gaps that this PR DOES NOT close
- Authenticated browser and real database integration test for exact Studio trace (must pass before production release).
- Join provider-delivery/webhook and communication-intent events to exact job ID, and actor/AOS/AGNI trace correlations.
- Historical financial reconciliation and six approved-without-login vendor repairs.
- Repair of lead template key vendor_new_lead vs approved lead_assignment_alert binding.
- Production worker contract and duplicate executor ownership inspection, signed deployed revisions, live Meta receipt, AOS shadow freshness, actual AGNI alert ingestion.
- Production memory migrations, opt-in notice approval, any live payment/provider/canary or WhatsApp sends.

## Release policy
SOURCE-ONLY, NO PRODUCTION DEPLOYMENT. Never replay expired jobs, alter vendor identity or credit balances, modify billing, apply pending memory migrations, enable providers, or grant autonomous AGNI actions in this phase without separate owner approval. An existing historical saved Studio graph containing a retired action must remain visual/historical only, not be published as enabled work.

## VL-01 exit still pending
1. Exact VPS QuickFurno/Jarvis/AGNI/worker source digest and runtime config comparison.
2. Complete authorization and privacy/replay integration on isolated Auth + Postgres services.
3. Truthful provider uncertainty and bounded source trace in a live authenticated staging view.
4. Historical vendor/ledger/assignment inventory with safe exceptions and approved corrections only.
5. AGNI signed source/incident and worker trace contracts for next phases.
