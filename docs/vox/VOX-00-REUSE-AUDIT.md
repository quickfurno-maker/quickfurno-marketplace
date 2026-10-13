# VOX-00 — Evidence-backed reuse audit and integration gate (13 October 2026)

**Status: IN PROGRESS / SOURCE AUDIT — NOT PRODUCTION OR STAGING CERTIFIED.**

**Product:** `vox.quickfurno.in` — staff-only QuickFurno Vendor Operations OS (Aarohi Acquisition CRM, Vendor CRM, both WhatsApp operational inboxes, service desk, staff/teams, protected approvals, native Automation Studio, scoped Jarvis Agent Flow Studio, AOS advisory, AGNI evidence).
**Baseline:** QuickFurno Core `397ae95921aba1cbca446d9db03c765057bd0775`; Jarvis `febd9813947fd2d7a09008914051c1047cc0642d`. These are **Git main source**, not asserted deployed runtime digests.
**Approved master:** https://app.notion.com/p/3f8751ba167c811b8d38f9a382f2b370
**UX/contracts:** https://app.notion.com/p/3f8751ba167c81eba21df245def78934

## Confirmed source inventory (recheck actual Staging schemas and signed runtime before enabling)

| Capability | Evidence in current source | Disposition | Important gap / release gate |
| --- | --- | --- | --- |
| Aarohi acquisition CRM | `app/admin/aarohi/pipeline/page.tsx`; `services/aarohiCrmService.ts`; `app/admin/aarohi/prospects/[id]/page.tsx` | REUSE + CONNECT | Current acquisition pipeline is read-only CRM projection; identity-link/source evidence and true staff scope need audit. |
| Aarohi exception inbox | `app/admin/aarohi/inbox/page.tsx` | REUSE + CONNECT | Explicitly an attention queue, **not** a provider message inbox. Never label it a WhatsApp message sender. |
| Aarohi cross-channel conversations | `app/admin/aarohi/conversations/page.tsx` | REUSE + CONNECT | Cross-channel conversation index; distinguish from decrypted provider messages. |
| Aarohi authorization | `app/admin/aarohi/layout.tsx`; `lib/aarohi/permissions.ts` | EXTEND | Existing `aarohi.view` role gate exists. VOX must add verified per-team/city/assigned-prospect checks, not inherit global admin permissions. |
| Vendor CRM foundation | `services/vendorCrmService.ts`; `app/admin/vendor-crm/page.tsx`; `components/admin/crm/VendorCrmDirectory.tsx` | REUSE + CONNECT | Existing SIX CRM-owned tables: `vendor_internal_notes`, `vendor_crm_profiles`, `vendor_contacts`, `vendor_tags`, `vendor_tag_assignments`, `vendor_tasks`. **Do not duplicate them.** Current directory requires Superadmin; VOX delegated staff ABAC not certified. |
| Vendor support | `app/vendor/dashboard/support/page.tsx`; `components/vendor-dashboard-v2/support/VendorSupportThreads.tsx` | REUSE + EXTEND | Confirm backing tables, role/auth, private attachments, SLA/case transitions and actual outbound. |
| Governed WhatsApp Human Desk | `app/admin/whatsapp/human-desk/page.tsx`; `services/whatsAppHumanDeskService.ts` | REUSE + CONNECT | Core already distinguishes `prospect` (Aarohi), `vendor` (Anisha), `client` (Riya) and uses guarded conversation outbox. Current staff access is Superadmin-only and queue `state=HUMAN`, `human_takeover=true`; it is **not yet** a full all-thread staff inbox. |
| Core Automation Studio | `components/admin/AutomationStudio.tsx`; `app/api/admin/automation-studio/route.ts`; `services/automationStudioService.ts`; `lib/automation/studioContract.ts` | REUSE + CONNECT | Existing `client_journey`, `vendor_journey`, `campaigns`, `recovery`, `orphan_cleanup`, `stale_cleanup`; Studio has draft/publish/simulate/trace. Current API Superadmin-only, and no VOX direct Core action grant. |
| Core Vendor approval | `app/admin/vendor-approvals/page.tsx`; `services/vendorProfileChangeService.ts`; pending reviewed approval SQL | REUSE + EXTEND | Review UI and public-profile atomic RPC have source/Staging evidence; PR #196 coverage and PR #197 outbox **source merged only, not persistently Stage-applied** at last verified check. Preserve one Core finalizer. |
| Jarvis Aarohi acquisition domain | Jarvis `packages/aarohi-agent/src/contracts/acquisition-case.ts` and AVG-series; `apps/api/src/aarohi-phase2` | REUSE + CONNECT | `HANDED_OFF_TO_ANISHA` requires real Core active attestation; generic case state never creates a vendor or authorizes outreach. |
| Jarvis Anisha runtime and consent | Jarvis `apps/api/src/quickfurno-whatsapp/anisha-vendor-preflight.ts`, `anisha-memory-lifecycle.ts` | REUSE + CONNECT | Isolated Stage memory consent/erase proof exists; live Meta and staff takeover require separate genuine E2E. |
| Jarvis Agent Flow Studio | Jarvis `apps/jarvis-os/src/app/(protected)/agent-flows/page.tsx`, `AgentFlowPhase3Studio.tsx` | REUSE / VIEW ADAPTER | Reuse existing typed flows for Aarohi+Anisha; do not clone agent runtime, prompt or provider selection. |
| Vendor coverage approval and event fanout | Core PR #196, PR #197 | EXTEND / HOLD | Reviewed migrations must be backed up and serially staged, RLS verified, consumers disabled until their identities and ACKs are certified. |
| Staff teams, portfolios, case SLA | Some CRM tasks/owner fields exist, complete scoped operations not verified | EXTEND OR NEW-CANDIDATE | **Do not add tables** until exact Supabase existing schemas and policies are inventoried. |
| VOX isolated staff application | Not found as a separate deployable in inspected Core/Jarvis source | NEW-CANDIDATE | Design only until G0 contracts and host guard; do not expose on DNS placeholder before auth/MFA. |

## Crucial discoveries that change the implementation plan

1. **Aarohi CRM is not missing.** Its pipeline, prospect details, cross-channel conversation index, attention queue, staff tasks and service tables already exist. Build VOX acquisition workspace by adapting those contracts instead of creating a second acquisition CRM.
2. **Vendor CRM is not missing.** Its service expressly limits writes to six operational tables, has append-only notes, archived contacts/tags/tasks and server-paged Core read-only facts. Reuse these tables and their safe ownership constraints.
3. **Human WhatsApp takeover already has a governed Core entry point.** Need expand from a Superadmin-only HUMAN-state queue to a scoped staff Inbox without inventing a separate Meta sender or unapproved agent-pause mechanism.
4. **Core Automation Studio already implements its own versioned canvas and runtime-facing API.** VOX exposes vendor-only, role-scoped adapters; never rebuild the engine.
5. **Jarvis Agent Flow Studio already renders Aarohi and Anisha.** VOX needs role-scoped, vendor-specific viewing/configuration requests, not a new Jarvis.
6. **Authorization is the leading P0 gap.** Existing privileged CRM, approval, WhatsApp and Studio routes are commonly Superadmin-only. Before any staff exposure, implement source-endpoint ABAC and scoped service APIs, never simply mount the existing admin pages unguarded.

## Seven independent delivery lanes (VOX-00 initial assessment)

- **A / Platform + IAM:** STAFF_AUTH_CONTRACT_PENDING; exact staff membership/MFA and multi-city ABAC; shared VPS capacity baseline 7.8 GiB RAM, 5.1 GiB available, 71 GiB disk free, 0 swap, many existing services without finite memory caps. No upgrade needed for development; production host remains HOLD pending load and security.
- **B / Lifecycle CRM:** REUSE_FIRST_CONFIRMED for both Aarohi and Vendor CRM; prospect-to-vendor link must be Core-attested and idempotent.
- **C / Service Desk:** EXISTING_SUPPORT_AND_HUMAN_DESK_FOUND; case/queue/staff SLA and staff authorization still require live schema audit.
- **D / Core governance:** SOURCE_MERGED_FOR_196_197; staging migration/RLS and sensitive family executor coverage not certified.
- **E / Jarvis + WhatsApp:** EXISTING_AGENT_AND_TAKEOVER_PATHS_FOUND; channel-specific numbers/consent/signed handoff and production provider must be verified.
- **F / Automation + intelligence:** EXISTING_CORE_STUDIO_AND_JARVIS_CANVAS_FOUND; business Studio remains Core-native worker execution and AOS advisory only; exact AOS/AGNI adapter status needs live inspection.
- **G / QA + release:** SOURCE_AND_HOST_BASELINE_STARTED; genuine login, staff role/IDOR, event replay, consumer ACK, provider uncertainty, RSS/peak, load and rollback remain explicit gates.

## Implementation principles / no-duplicate contract

- Canonical **Core** owns registered vendor, eligible categories, Google-verified place, matching ≤3, lead/assignment, wallet, consent, outbound authority and approved changes. VOX cannot write these fields directly.
- Existing **Aarohi** durable prospect identity cannot be merged with Core vendor_id from phone/hash alone; Core registration/activation evidence required.
- **Jarvis** owns model inference, prompts, opt-in memory and agent-flow engine; VOX operators get only scoped control/trace.
- **Native Core Worker** owns provider sends/retries. VOX has no direct Meta, Razorpay, arbitrary SQL, or second automation executor.
- VOX owns **only missing** staff teams, assignments, cases, SLAs and audited internal notes, after verifying existing tables first.
- Status vocabulary: SOURCE_ONLY / ISOLATED_TESTED / STAGING_SCHEMA_ACTIVE / SIGNED_STAGING_DEPLOYED / STAGING_E2E_PASS / PROD_CANARY / PROD_CERTIFIED. No source availability assertion implies real user capability.

## G0 acceptance (remaining, not yet passed)

- [ ] Map real Staging schema/migrations/RLS for the six Vendor CRM tables, Aarohi core tables, support and messaging; document exact service identities and privacy retention.
- [ ] Verify actual Jarvis/Aarohi conversion/handoff version and both dedicated WhatsApp channels, no phone-only merges.
- [ ] Establish staff authentication/ABAC contract and review Superadmin privilege delegation safely.
- [ ] Verify existing approvals and native worker producer/consumer runtime and actual staging SQL state; no premature activation.
- [ ] Define VOX BFF read/command API contracts, one-writer schema ownership and independent branch locks.
- [ ] Test signed Jarvis+AGNI shared host resources under representative concurrency, peak metrics and rollback.
- [ ] Design independent staff-side negative suites for wrong-role, wrong-city, wrong-channel, consent, stale/replay/financial exceptions and no duplicate provider sends.
- [ ] Produce consolidated certified G0 report and sign off before staging VOX interactive staff features.

## Next PR lanes after G0 (safe parallel development)

A builds VOX BFF and staff identity. B adapts acquisition + vendor CRM and source-timestamped Vendor 360 read models. C owns case/queue/inbox staff workflow and preserves Core communication outbox. D finishes reviewed protected Core RPCs sequentially. E builds signed Jarvis read/handover adapters and memory fences. F scopes existing business and agent studios, AOS and AGNI. G authors role/consent/replay/load and independent certification. All sensitive mutations remain disabled until their own gates pass.
