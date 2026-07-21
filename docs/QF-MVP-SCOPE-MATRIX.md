# QF-MVP — Scope Matrix

**Branch:** `mvp/qf-mvp-00-core-cleanup-v1` · **Base:** `a4d289a` · **Status:** LOCKED

Classification vocabulary (only these): `MVP_REQUIRED` · `KEEP_AS_BUILT` · `KEEP_DISABLED` · `POST_MVP` · `LEGACY_NON_BLOCKING` · `REMOVE_AFTER_PROOF` · `UNKNOWN_REQUIRES_AUDIT`.

Evidence rule: the "Current evidence/status" column cites repository artifacts observed on this branch. Where implementation completeness is not verifiable from file presence alone, status is `requires audit` and the classification reflects that. File presence proves *existence of code*, not *production-readiness* — production state is `requires audit` until QF-MVP-10.3 measures it.

**Owners:** `CORE` = QuickFurno Core team · `CRM` = Vendor CRM module · `COMMS` = communication/Meta · `AUTOMATION` = n8n · `JARVIS` = Jarvis repo · `ADMIN/OPS` = founder/admin ops · `PLATFORM` = build/governance.

---

## MVP_REQUIRED

| Capability | Current evidence / status | Classification | Active dev required | Launch blocker | Owner | Notes |
|---|---|---|---|---|---|---|
| Marketplace transaction flow (intake→qualify→eligible→assign→replace→close) | `leadService`, `leadMatchingEngine`, `leadQualityService`, `leadDeliveryService`, `manualLeadAssignmentService`, `delayedLeadFillService`, `preferredVendorLeadService` present; end-to-end completeness `requires audit` | MVP_REQUIRED | Yes (QF-MVP-20) | Yes | CORE | Deterministic only; 3-active / 6-lifetime caps must be enforced + audited |
| Packages & credits (validate, deduct idempotently, ledger, approved restore) | `packageService`, `vendorCreditWalletService`, `vendorPackageOrderService`, `adminAuditService` present; idempotency + restore-approval `requires audit` | MVP_REQUIRED | Yes (QF-MVP-20.7) | Yes | CORE | Credit restoration requires founder/admin approval |
| Consent & suppression authority | `communicationConsentDecisionService`, `communicationConsentWriterService`, `consentPolicy.ts`, `outboundConsentScope.ts`, migrations `…consent_evidence…`, `…consent_command_writer_rpc` | MVP_REQUIRED | Verify + wire (QF-MVP-40) | Yes | COMMS | Sacred boundary; no path may bypass |
| Meta non-voice WhatsApp (inbound/outbound/delivery/consent/ack) | `lib/communication/providers/metaCloud*`, `metaCallbackIdentity`, `metaWebhookRawBody`, `metaWebhookAccountIdentity`, `metaWhatsAppInbound/Webhook`, `metaWhatsAppOutboundService`, `consentAckWorkerService`; runbooks in `docs/` | MVP_REQUIRED | Verify + activate (QF-MVP-40) | Yes | COMMS | Voice excluded; activation gated on Meta approvals |
| Vendor CRM (directory, profile, tasks, segments, campaigns) | `docs/quickfurno-crm-foundation.md`, `docs/quickfurno-crm-flow.md`; module implementation `UNKNOWN_REQUIRES_AUDIT` | MVP_REQUIRED | Yes (QF-MVP-30) | Yes | CRM | Extension tables only; no duplication of Core facts |
| n8n workflows (Core-authorized execution) | `docs/n8n`, `docs/n8n-workflows`, `docs/N8N_VENDOR_CREDIT_SYNC_CONTRACT.md`, AOS docs; `aosService` | MVP_REQUIRED | Yes (QF-MVP-50) | Yes | AUTOMATION | Executes only; never an authority |
| Jarvis integration (sanitized context + action-request API) | `docs/QF-Jarvis-Integration-Boundary.md` (boundary documented); integration `UNKNOWN_REQUIRES_AUDIT` | MVP_REQUIRED | Yes (QF-MVP-60) | **No** (Core runs Jarvis-offline) | JARVIS + CORE | Optional intelligence; kill-switched |
| Operations dashboard (queues, controls, KPIs) | `adminService`, `adminAuditService`, `communicationAdminService`, `vendorAdminService`, `categoryAdminService`; dashboard completeness `requires audit` | MVP_REQUIRED | Yes (QF-MVP-70) | Yes | ADMIN/OPS | Must expose kill switches + failures |
| Audit records (business + comms) | `adminAuditService`, `authSecurityEventService`, ack-intent + delivery-event tables | MVP_REQUIRED | Extend per phase | Yes | CORE | Every important action explainable |
| Pune-first launch | multi-city tables/fields present (`categoryAdminService`, city fields) | MVP_REQUIRED | Yes (QF-MVP-80) | Yes | ADMIN/OPS | Multi-city stays; Pune activated first |

---

## KEEP_AS_BUILT (retain; no new MVP work unless a small safety fix is needed)

| Capability | Current evidence / status | Classification | Active dev required | Launch blocker | Owner | Notes |
|---|---|---|---|---|---|---|
| SMS fallback | `runtimeSmsProviderService`, `smsProviderSelection`, `runtimeSmsAdapterFactory`, `exotelSmsProvider`, `smsProviderCanaryProbeService`; docs `QF-SMS-*` | KEEP_AS_BUILT | No | No | COMMS | Meta primary; SMS is fallback |
| Multi-provider / provider-neutral architecture | `lib/communication/providers/*` (meta, exotel, mock, sms/whatsapp interfaces), `providerTemplateMappingService` | KEEP_AS_BUILT | No | No | COMMS | Additional providers don't block launch |
| Advanced retry / fallback behaviour | `authenticationTransportDecision`, `authenticationTransportPolicyService`, `authenticationDeliveryAttemptService`; docs `QF-Authentication-Transport-Resilience-*` | KEEP_AS_BUILT | No | No | COMMS | Uncertain outcomes never auto-resent |
| Multi-city capability | city/area fields across lead + vendor services; `categoryAdminService` | KEEP_AS_BUILT | No | No | CORE | Other cities = later controlled activation |

---

## POST_MVP (explicitly excluded from MVP)

| Capability | Classification | Launch blocker | Notes |
|---|---|---|---|
| AI lead scoring | POST_MVP | No | MVP qualification is deterministic |
| AI vendor ranking | POST_MVP | No | MVP selection is deterministic |
| Predictive conversion scoring | POST_MVP | No | — |
| Jarvis-controlled vendor assignment | POST_MVP | No | Assignment stays deterministic in Core |
| AI-controlled package priority | POST_MVP | No | — |
| Meta voice calling | POST_MVP | No | Explicitly excluded |
| WhatsApp voice agents | POST_MVP | No | Explicitly excluded |
| Voice campaigns / call recording / transcription | POST_MVP | No | Explicitly excluded |
| Autonomous package changes | POST_MVP | No | Requires Core/admin approval |
| Autonomous credit changes | POST_MVP | No | Restoration requires approval |
| Autonomous vendor suspension | POST_MVP | No | Requires Core/admin approval |
| Advanced analytics warehouse | POST_MVP | No | `docs/quickfurno-analytics-foundation.md` is foundation only |
| Mobile apps | POST_MVP | No | — |
| Microservice conversion | POST_MVP | No | Stay a modular monolith |
| Event sourcing | POST_MVP | No | — |
| RCS campaigns | POST_MVP | No | `docs/QF-RCS-Future-Campaign-Readiness.md` = readiness only |

---

## LEGACY_NON_BLOCKING (kept on disk; diagnostic only; never a mandatory MVP gate)

| Capability | Current evidence / status | Classification | Launch blocker | Owner | Notes |
|---|---|---|---|---|---|
| Historical commit-range validation | `scripts/phase5f-d3b-*`, `scripts/phase8b1bd6w1-*` etc. | LEGACY_NON_BLOCKING | No | PLATFORM | Kept; not a dev gate |
| Harness blob-SHA freezes | D3-B / D4-B authority blocks | LEGACY_NON_BLOCKING | No | PLATFORM | Not changed to satisfy stale pins |
| Successor-authority transfers | D4-B / D3-B transfer blocks | LEGACY_NON_BLOCKING | No | PLATFORM | Diagnostic history only |
| Harness-policing-harness checks | D3-B policing D4-B/Wave1 | LEGACY_NON_BLOCKING | No | PLATFORM | Known-RED on drift; non-blocking |
| Mandatory per-PR mutation suites | `scripts/phase*` mutation runners | LEGACY_NON_BLOCKING | No | PLATFORM | May be used diagnostically, not required |
| Per-change database proof suites | opt-in DSN probes in `scripts/phase8b1bd6w*` | LEGACY_NON_BLOCKING | No | PLATFORM | Never run against production |
| Old phase-governance npm scripts | `test:phase*` (40+ scripts) | LEGACY_NON_BLOCKING | No | PLATFORM | Superseded by `verify:mvp` (QF-MVP-00.3) |

---

## UNKNOWN_REQUIRES_AUDIT (resolve in QF-MVP-10)

| Capability | Why uncertain | Classification | Owner | Notes |
|---|---|---|---|---|
| Production database state vs. repository | no DB access in documentation task; managed history may be drifted | UNKNOWN_REQUIRES_AUDIT | CORE | QF-MVP-10.2/10.3 measures + reconciles |
| Vendor CRM implementation completeness | only foundation docs observed | UNKNOWN_REQUIRES_AUDIT | CRM | QF-MVP-30 scopes real build vs. existing |
| AOS ↔ n8n wiring status | `aosService` + AOS docs present; live wiring unverified | UNKNOWN_REQUIRES_AUDIT | AUTOMATION | QF-MVP-50 confirms |
| Admin dashboard coverage of all queues/controls | admin services present; UI coverage unverified | UNKNOWN_REQUIRES_AUDIT | ADMIN/OPS | QF-MVP-70 completes |
| Migration production-applied set | repo has 68 migrations; applied set unknown here | UNKNOWN_REQUIRES_AUDIT | CORE | Migration Ledger (QF-MVP-10.3) |

> No capability above is claimed "already built and production-ready" without evidence. Where only foundation/docs exist, status is `UNKNOWN_REQUIRES_AUDIT` and the roadmap phase that resolves it is named.
