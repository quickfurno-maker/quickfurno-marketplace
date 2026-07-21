# QF-MVP-10.2 — Runtime Inventory

**Branch:** `mvp/qf-mvp-10-core-data-truth-v1` · **HEAD:** `cda20fd` · Evidence = repository code (no DB access).

Exhaustive per-item structural data (paths, imports/direct-dependencies, DB objects, external systems, env refs) is in **[`docs/generated/qf-mvp-runtime-inventory.json`](generated/qf-mvp-runtime-inventory.json)** (regenerate with `npm run inventory:mvp`). This document adds the **classification, authority, activation status, risk, and confidence** the generator cannot infer.

**Counts:** 31 API routes · 23 pages · 64 services · 283 lib modules · 19 provider adapters · 65 components · 51 package scripts · 68 migrations.

**Activation vocabulary — code EXISTS ≠ ACTIVE.** For each item: **EXISTS** (code only) · **WIRED** (reachable from a route/worker/service) · **CONFIGURED** (needs env) · **DEPLOYED** (in the built app) · **ACTIVE** (would take real effect by default). Classifications: `MVP_REQUIRED` · `KEEP_AS_BUILT` · `KEEP_DISABLED` · `POST_MVP` · `LEGACY_NON_BLOCKING` · `REMOVE_AFTER_PROOF` · `UNKNOWN_REQUIRES_AUDIT`.

---

## 1. API routes (31)

All `/api/admin/**` are Superadmin-gated (`session.isSuperadmin`). All `/api/aos/**` + the queue cron require a shared secret and **reject in prod when unset / mock in dev**.

| Route | Domain | Authority | Activation | Class |
|---|---|---|---|---|
| `POST /api/webhooks/whatsapp/meta` | communication | webhook processing | WIRED; **gated off** (`webhook_processing_enabled=false`), HMAC+identity before effects | MVP_REQUIRED |
| `POST /api/internal/process-consent-ack-intents` | communication | ack worker cron | WIRED; shared-secret, batch≤25 | KEEP_AS_BUILT |
| `POST /api/auth/hooks/supabase-send-sms` | identity | auth OTP hook | WIRED; **gated off** → 503 `service_unavailable` | MVP_REQUIRED (gated) |
| `… /api/vendor/auth/whatsapp/{request,verify}` | identity | vendor verify | WIRED; kill-switch default off | KEEP_AS_BUILT |
| `… /api/vendor/auth/password-reset/{request,verify,complete}` | identity | vendor reset | WIRED | UNKNOWN_REQUIRES_AUDIT |
| `GET /api/cities`, `GET /api/categories` | foundation | public taxonomy | WIRED; ACTIVE | MVP_REQUIRED |
| `… /api/admin/categories*` (4) | admin | category admin | WIRED (superadmin) | MVP_REQUIRED |
| `… /api/admin/vendors*` (6: list, status, credits, credit-log, package) | vendors/credits | vendor admin | WIRED (superadmin) | MVP_REQUIRED |
| `GET /api/admin/lead-assignment-preview` | marketplace | preview | WIRED (superadmin) | KEEP_DISABLED |
| `POST /api/admin/lead-assignment-approval` | marketplace | preview approval | WIRED; cap 3 + DB CHECK; n8n gated | KEEP_DISABLED |
| `… /api/admin/lead-assignments/{recent,failed,logs,[id]}` | marketplace | reporting (RO) | WIRED (superadmin) | KEEP_AS_BUILT |
| `POST /api/admin/process-due-lead-assignment-queue` | marketplace | delayed-fill cron | WIRED; secret, prod-reject/dev-mock | KEEP_AS_BUILT |
| `POST /api/admin/aos-runtime-settings` | automation | AOS Lock-2 toggle | WIRED (superadmin); default off | KEEP_DISABLED |
| `POST /api/aos/process-lead` | automation | n8n intake **preview** | WIRED; **side-effect-free**, secret-gated | POST_MVP |
| `POST /api/aos/{events,failure}` | automation | AOS ingest | WIRED; secret-gated, mock | KEEP_AS_BUILT |
| `POST /api/aos/whatsapp-status` | communication | **legacy** n8n status path (NOT Meta webhook) | WIRED; secret-gated, mock | LEGACY_NON_BLOCKING |

## 2. Pages (23)

| Group | Routes | Class |
|---|---|---|
| Public/client (8) | `/`, `/enquiry`, `/category/[slug]`, `/category/interiors/carpenters`, `/pricing`, `/privacy`, `/terms`, `/login` | MVP_REQUIRED (`/enquiry`, `/category/[slug]`), KEEP_AS_BUILT (rest) |
| Vendor (11) | `/vendor`, `/vendors`, `/vendors/[id]`, `/vendors/register`, `/vendor/dashboard{,/leads,/package,/profile,/notifications,/support}`, `/vendors/dashboard` | MVP_REQUIRED (dashboard, listing); note `/vendors/dashboard` legacy dup of `/vendor/dashboard` → REMOVE_AFTER_PROOF |
| Admin (4) | `/admin`, `/admin/login`, `/admin/dashboard`, `/admin/[section]` | MVP_REQUIRED |

## 3. Services (64) — by domain

### Marketplace (16)
| Service | Authority | Activation | Class |
|---|---|---|---|
| `leadService` | AW+ORCH | WIRED/ACTIVE | MVP_REQUIRED |
| `leadMatchingEngine` | AD (write=RPC) | WIRED/ACTIVE | MVP_REQUIRED |
| `leadDeliveryService` | AW (sole live assign-RPC caller) | WIRED/ACTIVE | MVP_REQUIRED |
| `leadQualityService` | AD+AW (rule-based, "No AI") | WIRED/ACTIVE | MVP_REQUIRED |
| `leadClarificationService` | AW | WIRED | KEEP_AS_BUILT |
| `manualLeadAssignmentService` | AW (admin recovery ≤9) | WIRED | KEEP_AS_BUILT |
| `delayedLeadFillService` | AW+ORCH (cron) | WIRED (needs cron) | KEEP_AS_BUILT |
| `preferredVendorLeadService` | AW | WIRED | KEEP_AS_BUILT |
| `clientRequirementGroupService` | AW+ORCH | WIRED | POST_MVP |
| `leadProcessingDiagnosticsCore` | PR | EXISTS | KEEP_AS_BUILT |
| `leadProcessingDiagnosticsService` | RO | WIRED (admin) | KEEP_AS_BUILT |
| `leadProcessingRecoveryService` | ORCH | WIRED | KEEP_AS_BUILT |
| `leadQualityRecoveryCore` / `…Service` | PR / AW | EXISTS / WIRED | KEEP_AS_BUILT |
| `vendorAccessService` | AD+AW (dashboard guard) | WIRED | MVP_REQUIRED |
| `publicVendorService` | RO | WIRED/ACTIVE | MVP_REQUIRED |

### Vendors (6)
`vendorService` (MVP_REQUIRED, uses **service_role**), `vendorAdminService` (MVP_REQUIRED, admin), `vendorProfileChangeService` (MVP_REQUIRED), `vendorSupportService` (KEEP_AS_BUILT), `vendorNotificationService` (KEEP_AS_BUILT), `vendorVerificationService` (KEEP_AS_BUILT, gated off).

### Packages & credits (3)
`vendorCreditWalletService` (MVP_REQUIRED — canonical wallet; RPC **unverified/DO-NOT-AUTO-APPLY**), `packageService` (KEEP_AS_BUILT / POST_MVP — no payment webhook), `vendorPackageOrderService` (KEEP_AS_BUILT — intents only).

### Communication / consent / Meta (18)
| Service | Authority | Activation | Class |
|---|---|---|---|
| `communicationService` | ledger+dispatch | WIRED; **Mock default** | MVP_REQUIRED |
| `communicationConsentDecisionService` | consent decision (sole) | WIRED (RO) | MVP_REQUIRED |
| `communicationConsentWriterService` | STOP/START writer (sole) | WIRED | MVP_REQUIRED |
| `outboundConsentEnforcementService` | send enforcement (sole) | WIRED; default-deny | MVP_REQUIRED |
| `communicationRecipientResolver` | recipient resolution | WIRED | MVP_REQUIRED |
| `metaWhatsAppOutboundService` | Meta transport prep | WIRED; **gated off** | MVP_REQUIRED |
| `metaWhatsAppWebhookService` | webhook processing | WIRED; **gated off** | MVP_REQUIRED |
| `communicationProviderRuntimeService` | runtime gate + ownership | WIRED | MVP_REQUIRED |
| `communicationProviderHealthService` | health probe | WIRED; gated | KEEP_AS_BUILT |
| `providerTemplateMappingService` | approved-mapping resolve | WIRED; **no mappings seeded** | MVP_REQUIRED |
| `whatsAppProviderSelection` | provider selection | WIRED; mock default | MVP_REQUIRED |
| `runtimeCommunicationService` | send construction boundary | WIRED | MVP_REQUIRED |
| `inboundWhatsAppMessageService` | inbound persistence | WIRED | MVP_REQUIRED |
| `inboundIdentityResolutionService` | sender→principal | WIRED | MVP_REQUIRED |
| `inboundConsentCommandService` | STOP/START integrator | WIRED | MVP_REQUIRED |
| `consentCommandResponseService` | ack enqueue | WIRED (best-effort) | KEEP_AS_BUILT |
| `consentAckWorkerService` | ack delivery (at-most-once, cron) | WIRED | KEEP_AS_BUILT |
| `communicationAdminService` | admin observability (RO) | WIRED | KEEP_AS_BUILT |

### SMS / auth transport (8) — all disabled by default
`supabaseSendSmsHookService` (MVP_REQUIRED, gated off→503), `clientLoginOtpDeliveryOrchestrator` (KEEP_AS_BUILT, "ships disabled"), `authenticationTransportPolicyService` (KEEP_DISABLED, default-deny), `authenticationDeliveryAttemptService` (KEEP_AS_BUILT — live ledger), `runtimeSmsProviderService` / `runtimeSmsAdapterFactory` / `smsProviderRuntimeService` (KEEP_DISABLED — no Exotel seeded), `smsProviderSelection` (KEEP_AS_BUILT), `smsProviderCanaryProbeService` (KEEP_AS_BUILT).

### Auth — client/vendor (8)
`clientAccessService` (MVP_REQUIRED), `clientOtpAuthService` (UNKNOWN_REQUIRES_AUDIT, gated off), `clientOtpAutomationService` (MVP_REQUIRED — kill-switch), `vendorAuthService` (MVP_REQUIRED, uses **service_role**), `vendorAuthChallengeService` (MVP_REQUIRED — 4 atomic RPCs), `vendorAuthAutomationService` (MVP_REQUIRED — kill-switch), `vendorPasswordResetService` (UNKNOWN_REQUIRES_AUDIT), `vendorVerificationService` (KEEP_AS_BUILT, gated).

### Admin / audit (4) + automation (1)
`adminService` (MVP_REQUIRED), `adminAuditService` (MVP_REQUIRED), `authSecurityEventService` (MVP_REQUIRED, uses **service_role**), `categoryAdminService` (MVP_REQUIRED), `aosService` (KEEP_AS_BUILT / POST_MVP — orchestration, mostly dormant).

> **Service-role usage** (bypasses RLS — audit surface): `vendorService`, `authSecurityEventService` (detected), plus RPC-executing services via SECURITY DEFINER. Confirm each service-role client is server-only in QF-MVP-40/70.

## 4. Provider adapters (19) — `lib/communication/providers/`
Meta (non-voice, template-send only): `metaCloudWhatsAppProvider`, `metaCloudWhatsAppConfig`, `metaRuntimeGate`, `metaCallbackIdentity`, `metaWebhookRawBody`, `metaWebhookAccountIdentity`, `metaWhatsAppInbound`, `metaWhatsAppWebhook`, `providerAccountOwnership` → **MVP_REQUIRED** (gated off). SMS: `exotelSmsProvider`, `exotelConfig`, `smsProvider`, `smsRuntimeGate` → **KEEP_AS_BUILT** (disabled). Shared: `providerError`, `providerOutcome`, `whatsappProvider`, `whatsappTemplateBinding` → MVP_REQUIRED. Mocks: `mockWhatsAppProvider`, `mockSmsProvider` → KEEP_AS_BUILT (**default providers**).

## 5. Workers / cron / internal endpoints
| Item | Trigger | Activation | Class |
|---|---|---|---|
| `consentAckWorkerService` via `/api/internal/process-consent-ack-intents` | external cron + secret | WIRED; needs schedule + ack templates + `CONSENT_ACK_ENCRYPTION_KEY` | KEEP_AS_BUILT |
| `delayedLeadFillService` via `/api/admin/process-due-lead-assignment-queue` | external cron + secret | WIRED; needs schedule | KEEP_AS_BUILT |
| `supabaseSendSmsHookService` via `/api/auth/hooks/supabase-send-sms` | Supabase Auth hook | WIRED; gated off | MVP_REQUIRED (gated) |
| `authenticationDeliveryAttemptService` | in-process (atomic ledger) | WIRED/ACTIVE | KEEP_AS_BUILT |

## 6. lib module groups (283)
| Group | Files | Role | Class (dominant) |
|---|---|---|---|
| `aos` | 184 | automation/orchestration scaffolding (workflows, policy, rules, kernel, agents, memory, events, sync, tools, runtime, workflow) | KEEP_AS_BUILT (runtime/events/tools/rules) / POST_MVP / KEEP_DISABLED (agents/kernel) |
| `communication` | 43 | comms policy + 19 provider adapters | MVP_REQUIRED / KEEP_AS_BUILT |
| `identity` | 16 | auth transport + OTP crypto + client/vendor identity | MVP_REQUIRED / KEEP_AS_BUILT |
| `vendors` | 4 | eligibility + category matching + visibility | MVP_REQUIRED / KEEP_AS_BUILT |
| `lead-assignment` | 4 | preview engine + queue + free-vendor interest + runtime settings | MVP_REQUIRED (runtimeSettings) / REMOVE_AFTER_PROOF (autoAssignmentEngine dup) / POST_MVP |
| `lead-quality` | 2 | budget fit + clarification presets | MVP_REQUIRED |
| `crm` | 3 | Vendor CRM foundation (types + adapters) | MVP_REQUIRED (foundation) / UNKNOWN_REQUIRES_AUDIT |
| `geo`, `google-maps`, `locations` | 6 | distance + area (multi-city) | KEEP_AS_BUILT |
| `analytics`, `agents`, `events`, `auth`, `categories`, root (`config`, `supabase`, `errors`, `types`, `quickfurno-data`, `images`) | ~24 | infra + supabase client factories | MVP_REQUIRED / KEEP_AS_BUILT |

Supabase client factories: `lib/supabase.ts`, `lib/supabaseBrowser.ts`, `lib/supabaseLogging.ts` (verify service-role factory is server-only).

## 7. Package scripts (51) & runtime config
- **MVP gate:** `test:mvp{,:marketplace,:communication}`, `verify:mvp`, `inventory:mvp`, `typecheck`, `lint`, `build` → MVP_SAFE_FUNCTIONAL.
- **Legacy governance:** 34× `test:phase*` → LEGACY_NON_BLOCKING (see QF-MVP-00-BASELINE §2.4).
- **DB integration (excluded from gates):** `test:supabase:lead`, `test:phase1b:runtime`, `grant:superadmin` → DATABASE_INTEGRATION.
- **Runtime config:** `next.config.mjs`, `middleware.ts`, `tsconfig.json`, `.eslintrc.json`, `tailwind.config.*`, `postcss.config.*`. No `vercel.json`/`Dockerfile`/`ecosystem.config` tracked (deploy = Hostinger VPS + PM2 + nginx per project memory; deployment config is out-of-repo).

## 8. Components (65)
UI only (`components/**`): admin panels, home sections, vendor dashboard, lead funnel. No authoritative writes (all via routes→services→RPC). Class KEEP_AS_BUILT; the two apostrophe-escape files touched in QF-MVP-00.5 are the only recent edits. Not launch-blocking beyond the flows their pages serve.
