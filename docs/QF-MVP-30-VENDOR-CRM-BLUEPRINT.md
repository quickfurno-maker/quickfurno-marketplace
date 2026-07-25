# QF-MVP-30 — Vendor CRM V1 — Implementation Blueprint (FROZEN)

**Status: `VENDOR_CRM_V1_BLUEPRINT_FROZEN_READY_FOR_FOUNDATION_IMPLEMENTATION`.**

**Branch:** `mvp/qf-mvp-30-vendor-crm-v1` · **Type:** AUDIT + DESIGN ONLY (no migration, no runtime, no DB/provider/Jarvis access).
**Starting commit:** `dcead0b2a4573923252e23ce3563e1505adf74b4` (QF-MVP-20 Marketplace Engine V1 staging-complete).

> **Locked product boundary.** Vendor CRM is an internal module in the existing QuickFurno repo + authoritative
> database. **Core decides · Vendor CRM organizes · Jarvis recommends · n8n executes · Meta delivers · Admin
> approves sensitive actions.** CRM owns relationship/enrichment extension data; it MUST NOT own or duplicate
> authoritative Core truth (vendor identity, verification, enabled state, capability, geo eligibility, package
> entitlement, credit balance, lead/assignment eligibility, consent, suppression, campaign recipient
> authorization).

---

## 1. Current-state inventory (what already exists)

Code existence ≠ deployed/active. States below are repository facts.

| Area | Object(s) | Responsibility | Data class | Reuse decision |
|---|---|---|---|---|
| Admin shell/UI | `components/admin/AdminShell.tsx`, `AdminPrimitives.tsx`, `AdminSectionPage.tsx`, `adminConfig.ts` | Admin chrome, section router, tables/drawers/filters | UI | **REUSE_AS_IS** |
| Vendor directory (basic) | `admin` section `vendors`; `services/vendorAdminService.ts`, `adminService.ts` | Vendor list + verification/status admin | Core read | **REUSE_WITH_SMALL_CHANGE** (extend read model) |
| Operations CRM | `components/admin/CRMDashboard.tsx` (`/admin/crm`) | **Lead** pipeline/follow-up/nurture, read-mostly | Lead-ops | **OUT_OF_SCOPE** (lead CRM ≠ vendor CRM; keep separate) |
| Vendor notes | `public.vendor_internal_notes` (`…000006`): id, vendor_id→vendors CASCADE, note, created_by→profiles | Free-text vendor notes | CRM ext | **REUSE_WITH_SMALL_CHANGE** (add category, visibility, append-only) |
| Lead CRM notes/tasks | `public.crm_lead_notes`, `public.crm_lead_tasks` (`…000013`) | Lead-scoped notes/tasks | Lead-ops | **OUT_OF_SCOPE** (lead-scoped; pattern reference only) |
| Campaign metrics | `public.campaign_performance` (`…000013`): campaign(text), leads/hot/won, spend, cpl | Ad-campaign analytics rollup by name | Report | **OUT_OF_SCOPE** as a lifecycle entity (marketing-spend rollup, not a vendor-outreach campaign) |
| Workflow tasks | `public.workflow_tasks` (AOS kernel) | Automation step tasks | Automation | **OUT_OF_SCOPE** (not CRM tasks) |
| Audit | `public.audit_logs` (`…000006`): admin_user_id, action, entity_type/id, metadata, ip/ua | Sensitive-action audit | Audit | **REUSE_AS_IS** |
| Admin notifications | `public.admin_notifications` | Admin inbox | Ops | **REUSE_AS_IS** |
| Vendor comms/support | `vendor_notifications`, `vendor_support_threads/messages`, `vendor_profile_change_requests` | Vendor-facing notices/support/change-requests | Core-adjacent | **REUSE_AS_IS** (not CRM-owned) |
| Package / credit | `vendor_packages`, `vendor_package_orders`, `vendor_credit_logs`; `vendorPackageOrderService.ts`, `vendorCreditWalletService.ts` | Entitlement + ledger | **Core (authoritative)** | **REFERENCE ONLY** |
| Consent / suppression | `communication_consent_events`, `communication_preferences`, `communication_suppressions`, `communication_consent_command_receipts`; `communicationConsentDecisionService.ts` | Consent decision + suppression authority | **Core (authoritative)** | **REFERENCE ONLY** (Core recheck source) |
| Communication delivery | `communication_intents` (outbox), `communication_templates`, `communication_provider_template_mappings`, `communication_delivery_events`; metaWhatsApp*/runtimeCommunicationService | Provider-neutral send authority (Meta gated/off) | **Core (authoritative)** | **REFERENCE ONLY** (campaign execution boundary) |
| Public projection | `vendor_public_v` (Migration C) | Monetization-safe public vendor read | Core read | **UNCHANGED** (no private CRM data added) |

**Missing for Vendor CRM V1 (NOT_PRESENT):** vendor CRM profile extension, vendor contacts, vendor tags +
assignments, vendor tasks, deterministic vendor segments, vendor campaigns + audiences + events, vendor
engagement events.

## 2. Reuse / replace matrix (summary)

- **REUSE_AS_IS:** AdminShell/Primitives/section router; `audit_logs`; `admin_notifications`; vendor
  comms/support tables; the consent/suppression/communication authority services; `vendor_public_v`.
- **REUSE_WITH_SMALL_CHANGE:** `vendorAdminService`/`adminService` directory read (extend, additively);
  `vendor_internal_notes` → superseded by a richer `vendor_notes` (migrate reads; keep old table until proof).
- **REPLACE_AFTER_PROOF:** none required for V1 (all new CRM tables are additive; no Core object is replaced).
- **OUT_OF_SCOPE:** lead-ops CRM (`CRMDashboard`, `crm_lead_*`), `campaign_performance`, `workflow_tasks`.
- **NOT_PRESENT (build in V1):** the seven CRM tables in §4.

## 3. Core-truth reference map (read-only; authoritative copies PROHIBITED)

| Fact | Authoritative Core source | CRM access in V1 |
|---|---|---|
| Vendor ID | `vendors.id` | reference (FK) |
| Display/business identity | `vendors.business_name/owner_name/city` | reference |
| Verification / status | `vendors.status` ('Pending/Approved/Rejected/Suspended') | reference |
| Active/enabled | `vendors.is_active` | reference |
| Categories/capabilities | `vendors.service_categories[]` (+ `service_categories` taxonomy) | reference |
| Geography/service areas | `vendors.city`, `areas_covered[]`, `covers_full_city` (+ `cities`) | reference |
| Package + expiry | `vendor_packages`, `vendor_package_orders` | safe admin read/service |
| Credit facts | `vendors.total_credits/remaining_credits`, `vendor_credit_logs` | safe admin read/service |
| Lead / assignment history | `lead_assignments`, `lead_assignment_events`, `lead_delivery_logs` | safe admin read/service |
| Acceptance/response facts | `lead_assignments.status`, delivery logs | derived report (non-authoritative) |
| Complaint facts | `bad_lead_reports` (when present) | derived report |
| Consent | `communication_consent_events` / `communication_preferences` via `communicationConsentDecisionService` | **service call at recheck** |
| Suppression | `communication_suppressions` | **service call at recheck** |
| Communication authorization / template | `communication_templates`, `communication_provider_template_mappings` | **service call at recheck** |

**Duplicate-truth risk classification:** V1 introduces **zero** authoritative copies. `vendor_crm_profiles`
may cache a *display-only* `last_synced_*` snapshot ONLY if labeled non-authoritative and never used for a
decision — **default: do not cache; read live.** No CRM column may gate eligibility/consent/suppression.

## 4. Minimum V1 data model (CRM extension, additive)

All tables: `public` schema, RLS enabled, `service_role` writer, admin/account-manager read via RLS,
**no** anon/authenticated-generic access, `created_at`/`updated_at`, `created_by`/`updated_by`→`profiles`,
FK to `vendors(id)` (delete behavior per row), audit via `audit_logs`. **Foundation** = 30.1B; **Campaign** = 30.4.

| Table | Purpose | PK | Vendor FK | Key columns | Uniqueness | Subphase |
|---|---|---|---|---|---|---|
| `vendor_crm_profiles` | 1:1 CRM enrichment/relationship state | `vendor_id` (PK=FK) | `vendor_id`→vendors **CASCADE** | onboarding_stage, relationship_status, account_manager_id→profiles, next_follow_up_at, last_interaction_at, inactive_reason, company_type, website_url, social_links jsonb, business_years, team_size, capability_notes, residential_commercial scope, budget_band, monthly_capacity, material_warranty_notes, preferred_localities[], excluded_localities[], travel_radius_km, campaign_notes | `vendor_id` unique | 30.1B |
| `vendor_contacts` | Decision-maker/contact people (PII) | `id` uuid | `vendor_id`→vendors **CASCADE** | name, role_title, phone, email, is_primary, notes | `(vendor_id, lower(phone))` | 30.1B |
| `vendor_tags` | Normalized tag catalog | `id` uuid | — | name, normalized_name, color, is_active | `normalized_name` unique | 30.1B |
| `vendor_tag_assignments` | Tag ↔ vendor | `id` uuid | `vendor_id`→vendors **CASCADE** | tag_id→vendor_tags CASCADE, assigned_by | `(vendor_id, tag_id)` unique | 30.1B |
| `vendor_notes` | Admin-visible vendor notes (append-only) | `id` uuid | `vendor_id`→vendors **CASCADE** | body, category, visibility('admin'), author_id | — (immutable rows) | 30.1B |
| `vendor_tasks` | Follow-up/onboarding/renewal tasks | `id` uuid | `vendor_id`→vendors **CASCADE** | type, title, description, owner_id→profiles, due_at, priority, status, completion_result, source('manual'/'suggested'/'system'), idempotency_key | `idempotency_key` unique (nullable) | 30.1B |
| `vendor_segments` | Deterministic segment definitions | `id` uuid | — | name, description, rule jsonb (typed AST, §8), is_active, created_by | `lower(name)` unique | 30.3 |
| `vendor_campaigns` | Campaign lifecycle head | `id` uuid | — | name, purpose, consent_scope, template_key(ref), schedule_at, status(§9), segment_id→vendor_segments, approved_by, approved_at | — | 30.4 |
| `vendor_campaign_audiences` | Immutable frozen audience snapshot | `id` uuid | `vendor_id`→vendors **RESTRICT** | campaign_id→vendor_campaigns, eligibility_decision, exclusion_reasons[], per_recipient_idempotency_key, frozen_at | `(campaign_id, vendor_id)` unique | 30.4 |
| `vendor_campaign_events` | Per-campaign execution/status events | `id` uuid | — | campaign_id, event_type, actor, payload jsonb | — | 30.4 |
| `vendor_engagement_events` | Per-vendor engagement/result | `id` uuid | `vendor_id`→vendors **CASCADE** | campaign_id (nullable), event_type, channel, occurred_at, metadata jsonb | — | 30.4 |

**FK delete behavior:** enrichment/notes/tasks/contacts/tags/engagement **CASCADE** from vendor delete (CRM
extension follows the vendor). The **campaign audience snapshot** uses **RESTRICT** (immutable audit — a
frozen recipient set must not silently lose rows). Rejected: speculative fields, any authoritative Core copy.

## 5. CRM profile field classification (V1, Pune launch)

- **A. Core facts, displayed read-only (NOT stored in CRM):** city, service areas, categories, verification,
  package, credits, lead/assignment history, consent/suppression state.
- **B. CRM-owned enrichment (`vendor_crm_profiles`):** onboarding_stage, relationship_status,
  account_manager_id, next_follow_up_at, last_interaction_at, inactive_reason, company_type, website_url,
  social_links, business_years, team_size, capability_notes (workshop/factory/machinery/design/manufacturing/
  installation/turnkey — free-text, NOT authoritative capability), residential/commercial scope, budget_band,
  monthly_capacity, material/warranty notes, preferred/excluded_localities (CRM preference, NOT eligibility),
  travel_radius_km, campaign_notes.
- **C. Sensitive private (`vendor_contacts`, restricted RLS, never public):** decision-maker name/phone/email.
- **D. Post-MVP:** documents/KYC store, scoring, richer capability taxonomy, financials.

GST/PAN remain in Core `vendors.gst_number` (admin-only, never public via `vendor_public_v`); CRM does not copy them.

## 6. Directory & combined profile read model

- **Decision:** **server-side query composition in a service read model** (`vendorCrmReadService`), reusing
  `vendorAdminService`/`adminService`, joining Core `vendors` + CRM extensions. No new public view; **not**
  through `vendor_public_v`. An admin-only DB view is deferred unless profiling proves it necessary.
- **Directory filters (where the source fact exists):** category, specialization/capability (CRM note +
  categories), city/area/pincode, verification (`status`), enabled (`is_active`), package/credit state,
  onboarding_stage (CRM), tags (CRM), last_interaction_at (CRM), package expiry, campaign-eligibility preview
  (live Core recheck), account_manager (CRM).
- **Vendor profile composition:** one combined read = Core panels (identity/verification/geo/categories,
  package/credit read-only, lead/assignment history, communication/consent read-only) + CRM tabs (profile
  enrichment, contacts, notes, tags, tasks). Private CRM data is admin/account-manager only.

## 7. Notes / tags / tasks contracts

**NOTES — canonical authority `vendor_internal_notes` (evolved in place; QF-MVP-30.1B decision):** admin-visible,
vendor-linked, author + timestamp, optional category, correction lineage via `supersedes_note_id`,
**append-only** (no update/delete; correction = new note) — an immutability trigger mirrors the 20.4C/B2
pattern. The existing `vendor_internal_notes` table (migration 006, **zero runtime call sites**) is evolved
in place into the **single** canonical notes authority — **not** a new `vendor_notes` table — so there is no
competing writable notes path and existing data is preserved (blueprint §7 supersedes the earlier
"new `vendor_notes`" sketch in §1/§4; see the 30.1B foundation record).

**TAGS (`vendor_tags` + `vendor_tag_assignments`):** normalized tag catalog, `normalized_name` unique,
optional active/archive; assignment uniqueness `(vendor_id, tag_id)`; assigned_by audited.

**TASKS (`vendor_tasks`):** vendor, type, title, description, owner, due_at, priority, status
(open/in_progress/done/cancelled), completion_result, source (manual/suggested/system), audit actor,
`idempotency_key` unique (for later automation-suggested creation). **Types:** onboarding, documents,
verification, package_renewal, low_credit, inactivity, complaint, campaign_response_followup. **Jarvis may
later *suggest* tasks (source='suggested') but never writes directly** — suggestions enter via a Core/admin
service, not a Jarvis DB write.

## 8. Deterministic segment contract

- **Representation:** a **typed rule contract (JSON AST)** of **approved predefined predicate types** plus
  bounded AND/OR combinations. **No arbitrary SQL, no AI score, no copied eligibility truth.** Predicates
  reference Core facts via the safe read model (category, city/area, verification, is_active, package/credit
  state, package expiry window, last_interaction/inactivity window) and CRM facts (tags, onboarding_stage).
- **Evaluation:** every preview returns, per vendor, an **inclusion/exclusion decision + reason codes +
  evaluation timestamp**. Segments are **previews**, not authorizations — campaign eligibility is a separate
  Core recheck (§9).
- **Examples:** verified carpenters in Pune; modular factories in selected areas; vendors missing documents
  (CRM onboarding_stage); low-credit vendors (`remaining_credits < N`); package expiring ≤15 days; inactive
  vendors with no response in 30 days; campaign-eligible painters in Kharadi.

## 9. Campaign readiness lifecycle (design only; nothing sends)

`DRAFT → SEGMENT_SELECTED → AUDIENCE_EVALUATED → CORE_RECHECKED → SNAPSHOT_FROZEN → PENDING_APPROVAL →
APPROVED → EXECUTION_REQUESTED → RUNNING → PAUSED → COMPLETED | FAILED | CANCELLED`.

- **Campaign head:** purpose, consent_scope, **approved Meta template key reference** (Core-owned template),
  schedule, admin approval (approved_by/at).
- **Core recheck (fail-closed, at SNAPSHOT_FROZEN):** for each candidate, Core re-decides authoritative vendor
  state (verified + active), **consent**, **suppression**, **frequency policy**, **communication authorization**,
  **template approval**, and **campaign approval** — via the existing communication/consent authority services,
  never CRM columns. Any failure ⇒ excluded with a reason code.
- **Immutable audience snapshot (`vendor_campaign_audiences`):** frozen per-recipient rows with
  eligibility_decision, exclusion_reasons, and a **per-recipient idempotency key**; RESTRICT delete; never
  re-evaluated after freeze.
- **Approval + execution boundary:** APPROVED requires admin. **n8n later receives only the frozen,
  Core-approved audience**; **CRM cannot send directly to Meta**; pause/resume/cancel update campaign state;
  aggregate metrics + engagement events are stored (`vendor_campaign_events`, `vendor_engagement_events`).

## 10. Access / security / privacy matrix

| Role | Directory (Core read) | CRM profile/notes/tags/tasks | Contacts (PII) | Segments | Campaigns | Audience snapshot |
|---|---|---|---|---|---|---|
| founder/admin (`is_admin()`) | read | read/write (notes append-only) | read/write | read/write | read + **approve** | read |
| account manager (if modeled; else admin) | read (own book) | read/write (own vendors) | read/write | read | draft only | read |
| vendor self | own Core only | **none** | **none** | none | none | none |
| authenticated generic | none | **none** | **none** | none | none | none |
| anon | none (public via `vendor_public_v` only) | **none** | **none** | none | none | none |
| service_role | writer | writer | writer | writer | writer + recheck | writer (freeze) |
| n8n / Jarvis | — | — | — | — | receives frozen approved audience only; **no service-role key** | read frozen only |

**Proven properties:** private contacts/notes/tasks/campaign data are never public and never on
`vendor_public_v`; vendor users cannot see other vendors' CRM data (RLS own-row/admin only); generic
authenticated users get **no** CRM access; **no service-role key reaches Jarvis/n8n**; campaign eligibility
**fails closed** (Core recheck); audit actor + reason retained for sensitive actions; **public projection
unchanged**.

## 11. Implementation sequence (4–6 focused days)

- **30.1B — CRM foundation schema + security (~1.5d):** `vendor_crm_profiles`, `vendor_contacts`,
  `vendor_tags`, `vendor_tag_assignments`, `vendor_notes` (append-only), `vendor_tasks`; indexes, RLS, grants,
  audit; offline validator + SELECT-only staging verifier. *Excludes:* segments, campaigns, UI beyond wiring.
  *Migration:* one additive migration. *Acceptance:* least-privilege grants, RLS own-row/admin, no Core copy,
  append-only notes proven.
- **30.2 — Directory + combined vendor profile (~1.5d):** admin directory UI + filters; detail tabs;
  read-only package/credit/lead/communication panels; notes/tags/tasks actions. *Excludes:* segments/campaigns.
  *Migration:* none (or a read view if proven). *Acceptance:* combined read, private data admin-only.
- **30.3 — Deterministic segments (~1d):** typed rule contract; preview/evaluation with inclusion/exclusion
  reasons + timestamp; safe Core reads. *Acceptance:* explainable, no arbitrary SQL, no eligibility copy.
- **30.4 — Campaign readiness (~1.5d):** `vendor_campaigns`, `vendor_campaign_audiences` (immutable),
  `vendor_campaign_events`, `vendor_engagement_events`; draft lifecycle; Core recheck; snapshot freeze;
  approval + execution-request boundary. *Acceptance:* fail-closed recheck, immutable snapshot, no direct send.
- **30.5 — Staging integration + closeout (~0.5–1d):** apply migrations staging-first (preflight→apply→verify);
  functional journeys; security checks; empty + seeded evidence; QF-MVP-40 readiness. *Acceptance:* all
  verifiers PASS, boundaries proven, no Core regression.

## 12. Decision & risk matrix

| Topic | Decision |
|---|---|
| One database / modular monolith | **Yes** — same repo + authoritative DB; CRM is a module. |
| Core facts vs CRM extensions | Core authoritative + read-only in CRM; CRM stores only enrichment/relationship. |
| RLS / grants | RLS on all CRM tables; `service_role` writer; admin read via `is_admin()`; no anon/authenticated-generic. |
| PII | Contacts/notes/tasks/campaign are private; never public; never on `vendor_public_v`. |
| Immutability | Notes append-only; audience snapshot immutable (RESTRICT). |
| Task ownership | `owner_id`→profiles; automation-suggested tasks via service, `source` + idempotency. |
| Segment representation | Typed JSON rule AST of approved predicates; no arbitrary SQL/AI. |
| Campaign approval | Admin-approved; Core recheck fail-closed before freeze. |
| n8n boundary | Receives only frozen Core-approved audience; no direct CRM→Meta send; no service-role key. |
| Jarvis boundary | Recommends only (suggested tasks/segments via service); never a direct DB writer; no authority. |
| Public projection | `vendor_public_v` unchanged; no CRM data exposed. |
| Deletion / archive | CRM extension CASCADEs with vendor; audience snapshot RESTRICT; notes append-only. |
| Audit | `audit_logs` for sensitive actions (tags, tasks, campaign approve/execute) with actor + reason. |

**Genuine blockers:** **none.** (Optional refactors — e.g. an account-manager role model, a directory DB
view, superseding `vendor_internal_notes` — are not blockers.)

## 13. Non-goals (V1)

AI scoring/ranking; Meta sends / n8n workflow authoring; owner binding; historical exception population;
second database; duplicated Core truth; public exposure of GST/PAN/contacts; QF-MVP-40/50/60/70/80 work.

## 14. Next phase

**QF-MVP-30.1B — CRM foundation schema and security** (one additive migration + validator + SELECT-only
staging verifier, staging-first), per §11. No foundation implementation is started in this blueprint phase.

## 15. QF-MVP-30.1B — Foundation schema GENERATED + notes-bootstrap CORRECTED (not applied)

**Status:** `VENDOR_CRM_FOUNDATION_NOTES_BOOTSTRAP_CORRECTED_READY_FOR_PREFLIGHT` (offline; **no managed DB
access**; migration **generated but unapplied**). One forward-only migration
`supabase/migrations/20260723001100_qf_mvp_vendor_crm_foundation.sql` establishes the six foundation tables.

**Blocker corrected (QF-MVP-30.1BP → 30.1B1).** A staging preflight proved the staging baseline squash
`269c9265` **omits the entire migration-006 table set** — `vendor_internal_notes` (and `lead_internal_notes`,
`lead_timeline_events`, `audit_logs`, `admin_notifications`, `reviews`, `ai_agents`, `localities`) are
**absent** on staging, though `vendor_internal_notes` is **present** (minimal shape) on production. The
original migration's unconditional `ALTER TABLE public.vendor_internal_notes …` would have failed
(`42P01 relation does not exist`) on staging.

**Canonical notes decision — single authority, PRESENCE-IDEMPOTENT two-path bootstrap (rejected: a new
`vendor_notes`).** Section 5 now `CREATE TABLE IF NOT EXISTS public.vendor_internal_notes (…legacy base
shape…)` **before** any dependent ALTER, then converges **both** start states — **ABSENT** (staging, table
created) and **LEGACY_MINIMAL** (production, no-op create) — to one exact final contract: columns
`id, created_at, vendor_id, note, created_by, category, supersedes_note_id`; PK `id`; vendor FK **RESTRICT**;
created_by FK **SET NULL**; self-supersede FK **RESTRICT**; **NOT-VALID** `vin_note_nonempty` /
`vin_vendor_required` / `vin_category_check` (lossless — legacy rows never validated/rejected/rewritten);
legacy "vendor notes admin all" policy dropped; append-only immutability triggers; server-only grants. No
`vendor_notes` table; no note row created/deleted/rewritten; existing production rows preserved. A new
`vendor_notes` was rejected because it would leave a competing writable notes path.

**Migration-006 divergence follow-up.** This correction handles `vendor_internal_notes` **only** because
30.1B requires it. The other omitted 006 tables (`audit_logs`, `admin_notifications`, …) are **not** created
opportunistically here and must be **revalidated on staging before any later phase reuses them** — in
particular **QF-MVP-30.4 must not assume `audit_logs`/`admin_notifications` exist**; its audit integration
must first confirm or bootstrap them.

**Access model — A (server-only).** PUBLIC/anon/authenticated hold **zero** direct privilege on every CRM
table (RLS default-deny, no untrusted policy); `service_role` (which the existing `adminClient` admin path
uses) is the only writer — **SELECT+INSERT** on notes (append-only), **SELECT+INSERT+UPDATE** on the five
lifecycle tables, and **never** DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN. The service-role key never
reaches the browser/Jarvis/n8n.

**History preservation.** Every CRM→`vendors` FK is **ON DELETE RESTRICT** (vendors are soft-deleted anyway;
confirmed no runtime hard-delete); every actor→`profiles` FK is **ON DELETE SET NULL**; tags/tasks/contacts/
assignments archive via state, notes are append-only — **no hard delete** for application roles.

**Core non-duplication.** A machine-checked prohibited-column list (verification/enabled/city/service-area/
categories/package/credits/eligibility/consent/suppression/communication-authorization) is enforced by the
migration self-verify, the validator and the verifier — CRM stores **zero** authoritative Core copies.

**Contracts.** onboarding_stage/relationship_status/note-category/contact-channel/task-type/priority/status/
source are closed CHECK sets mirrored in `lib/crm/vendorCrmContracts.ts`. Uniqueness: profile PK=vendor_id,
`vendor_tags.normalized_name` unique, active tag-assignment partial unique, active-primary-contact partial
unique, task `idempotency_key` partial unique. No segments/campaigns/AI/KYC/owner-binding.

**Artifacts + gates (post-correction):** migration `20260723001100` (`9212f746…`); validator
`scripts/mvp/crm/validate-qf-mvp-30-1b.mjs` **46/46** (28 migration + 3 verifier fixtures, incl. two-path
bootstrap fixtures W/X/Y/Z/AA/BB); SELECT-only verifier `supabase/staging-verification/verify_qf_mvp_30_1b.sql`
(**25 rows**, adds the path-agnostic notes-final-contract row W25); contract manifest
`scripts/mvp/crm/qf-mvp-30-1b-foundation-contract.json` (`notes_bootstrap_mode: CREATE_IF_ABSENT_THEN_CONVERGE`,
`supported_start_states: [ABSENT, LEGACY_MINIMAL]`); blueprint validator 36/36; all Marketplace gates green;
`verify:mvp` exit 0. **Next: a fresh QF-MVP-30.1B staging preflight.**

## 16. QF-MVP-30.1BP2 — corrected staging preflight (COMPLETE, NOT applied)

**Status:** `VENDOR_CRM_FOUNDATION_PREFLIGHT_COMPLETE_READY_FOR_APPLICATION_REVIEW`. **Date:** 2026-07-24
(18:29–18:31 UTC) · **Linked target:** authorized staging `uckafzuochmbvtiodmcl` (production/QF-Jarvis not
contacted). **Nothing applied** — one `supabase db push --linked --dry-run` + catalog-SAFE SELECT-only
checks. **Identity:** correction commit HEAD `d5ee7cff70abdefc8651b0d666605b7a6d9020c7` (parent
`6e3670b…`, grandparent `bf432800…`, origin identical, **0/0**, clean). Full hashes exact — migration
`9212f746…`, validator `5935a881…`, verifier `e10caa56…`, manifest `26bd3ab3…`; applied 11 byte-unchanged.

**Corrected source re-proved (both paths):** `create table if not exists public.vendor_internal_notes`
precedes the first dependent ALTER; both ABSENT and LEGACY_MINIMAL converge to the one final contract;
validator 46/46; verifier 25 rows.

**Workspace:** outside Git, no seed/functions; 11 SQL (all repo-backed byte-identical) → 30.1B ABSENT →
copied the corrected migration (byte-identical `9212f746…`) → **12**.

**Safe live pre-state (to_regclass — no error on absent tables):** `20260723001100` absent; remote **11**;
**all six CRM foundation tables ABSENT** (incl. `vendor_internal_notes` = ABSENT — the create-if-absent
path); 006 omissions recorded (audit_logs/admin_notifications/lead_internal_notes absent, informational);
all public rows 0; auth.users/profiles/vendors/lead_assignments/vendor_credit_logs = 0; 20.4C register
present + empty; vendor_public_v present; A–E posture intact; admin_role absent; no segment/campaign; owner
binding deferred; 68 public tables.

**History:** **12 local / 11 remote**; `20260723001100` local-only, **sole pending**. **Dry run (once, exit
0):** `DRY RUN: migrations will *not* be pushed`; exactly one proposed — `20260723001100_…foundation.sql`.
**No-write proof:** re-listing history + re-running the safe pre-state returned **identical** results (remote
11, six CRM objects still absent, all data 0). Transcript + captures outside Git in
`qf-staging-workspace/QF-MVP-30.1BP2-CORRECTED-PREFLIGHT-20260724T182909Z/`.

**Migration-006 divergence boundary:** only `vendor_internal_notes` is handled here; `audit_logs`/
`admin_notifications`/other omitted 006 tables are NOT created/assumed — **QF-MVP-30.4 must revalidate them
before reuse**. **Next: QF-MVP-30.1B staging application review.**

## 17. QF-MVP-30.1BA — staging application (APPLIED + VERIFIED)

**Status:** `VENDOR_CRM_FOUNDATION_APPLIED_AND_VERIFIED_ON_STAGING`. **Date:** 2026-07-24 (18:56–18:59 UTC) ·
**Linked target:** authorized staging `uckafzuochmbvtiodmcl` (production/QF-Jarvis not contacted). Migration
`20260723001100` is **APPLIED** via exactly one `supabase db push --linked` (18:57:24→18:57:34 UTC, **exit
0**); exactly that migration, no earlier migration, no repair/reset, no second push. Applied at HEAD
`51126e094bb7c79ada044c9d26d19d77e8924d94` (parent `d5ee7cf…`, origin identical, 0/0, clean). Hashes exact
(migration `9212f746…`, verifier `e10caa56…`).

**ABSENT path executed + verified.** The pre-state proved `vendor_internal_notes` ABSENT; the apply log shows
16 `drop … if exists … does not exist, skipping` NOTICEs (the converge block running on the freshly-created
table) and the in-transaction `$verify$` NOTICE confirming the six tables, the sole append-only notes
authority, RESTRICT vendor FKs + SET NULL actor FKs, no Core-truth columns, no segment/campaign, and A–E/
20.4C/20.5A + vendor_public_v + owner-binding-deferral intact. Trailing `pgdelta-target-ca.crt ENOENT` is the
known non-blocking cache artifact.

**History:** before **12 local / 11 remote** (sole pending) → after **12 local / 12 remote**, all paired
once, applied once.

**Locked verifier `verify_qf_mvp_30_1b.sql` (`e10caa56…`) ran once: 25 rows, 25 PASS / 0 FAIL.** Proven live:
six foundation tables present; no rival `vendor_notes`; RLS on all six; PUBLIC/anon/authenticated zero;
service_role SELECT+INSERT on notes / SELECT+INSERT+UPDATE on the five lifecycle tables, no DELETE/TRUNCATE;
notes append-only triggers; every CRM→vendors FK RESTRICT; **W25** notes final contract (exact 7 columns,
created_by SET NULL, PK, legacy policy absent) — the ABSENT bootstrap converged to the canonical shape;
tag/profile/contact/task uniqueness + idempotency; no Core-truth columns; no segment/campaign; vendor_public_v
intact; B1/B2/C/D/E/20.4C/20.5A posture + owner-binding deferral preserved.

**Zero-data-write:** a post-application SELECT-only pass confirmed all six foundation tables hold **0 rows**;
`auth.users`/`profiles`/`vendors`/`lead_assignments`/`vendor_credit_logs` and the 20.4C register remain 0;
all public rows total 0; public table count **68 → 74** (exactly the six new CRM tables — **no** unrelated
006 table created). No note content inserted; no Core backfill; no RPC.

**Gates:** 30.1B 46/46, blueprint 36/36, all Marketplace gates green, `verify:mvp` exit 0, `git diff --check`
exit 0. Transcript + captures outside Git in `qf-staging-workspace/QF-MVP-30.1BA-APPLICATION-20260724T185637Z/`.

**Migration-006 divergence:** only `vendor_internal_notes` was created from the omitted set; the other 006
tables were **not** created (table count +6 exactly) and must be revalidated before reuse — QF-MVP-30.4 must
not assume `audit_logs`/`admin_notifications` exist. **Next: QF-MVP-30.2 — Vendor CRM Directory and Combined
Vendor Profile** (not started).

## 18. QF-MVP-30.2 — Directory + combined profile (IMPLEMENTED, runtime/UI)

**Status:** `VENDOR_CRM_DIRECTORY_AND_PROFILE_IMPLEMENTED_REVIEWED_READY_FOR_STAGING_SMOKE`. Runtime/UI only —
**no migration, no managed DB access, no RLS/grant/policy/function change, no `vendor_public_v` change, no
Core authority change, no segments/campaigns.** Built on the applied 30.1B foundation.

**Canonical routes (chosen).** `/admin/vendor-crm` (directory) and `/admin/vendor-crm/[vendorId]` (combined
profile), as **static** App-Router segments that take precedence over the dynamic `/admin/[section]` router.
A "Vendor CRM" entry was added to `adminConfig` (Command Center group, `AdminSectionKey` union + nav group);
the `[section]` router keeps its `default` case so it stays typesafe and is never reached for this static
route. **Rejected:** routing through `/admin/[section]` (would collide with the lead-ops `/admin/crm`
dashboard and force CRM logic into the shared `AdminSectionPage`).

**Reuse.** REUSE_AS_IS: `AdminShell`/`AdminPrimitives` (PageHeader/Toolbar/SelectFilter/DataTable/Tabs/
SectionCard/InfoGrid/StatusBadge/EmptyState), `getAdminSession`, `adminClient`/`serverClient`, `lib/errors`.
NEW: `lib/crm/crmAuth.ts` (guard), `services/vendorCrmService.ts`, `app/actions/vendorCrmActions.ts`,
`lib/crm/vendorCrmValidation.ts`, `app/admin/vendor-crm/**`, `components/admin/crm/**`. RETIRED: none.

**Authorization + service-role containment.** Routes self-guard (`getAdminSession()` → redirect unless
`isSuperadmin`). Every server action → `requireCrmAdmin()` (canonical `profiles.role = 'admin'` **and**
`app_metadata.admin_role = 'Superadmin'`, founder/admin only) **before** any `adminClient()`. The service is
`import "server-only"`; client components import only **types** from it (erased at build) and never a
service-role credential — enforced by the phase validator.

**Canonical CRM service ops.** Reads: `listVendorCrmDirectory`, `getVendorCoreFacts`, `getVendorCrmProfile`,
`listVendorContacts`, `listVendorTags`, `listVendorTagAssignments`, `listVendorNotes`, `listVendorTasks`.
Mutations: `upsertVendorCrmProfile`, contact `create/update/archive`, tag `create/update/archive/assign/
remove`, `createVendorNote` (append-only — **no update/delete**), task `create/update/complete/cancel`.
Invariants: writes only the six CRM tables; **no Core write**; **no hard delete** (archive via `is_active`/
`removed_at`/`status`); deterministic server-side tag normalization; normalized phone; task idempotency;
**actor always from the session**.

**Directory read model.** Server-paged (`.range`, bounded ≤ 100, deterministic `created_at desc, id` sort);
CRM extensions (profile/tags/tasks/primary-contact) **batch-loaded per page** (a fixed handful of `in(...)`
queries — **no N+1**); Core+CRM filters via URL params so all fetching stays server-side behind the guard.
No public view, no RPC, no migration. Filters needing new schema/index are left visibly deferred.

**Combined profile sections.** Overview (Core read-only + CRM relationship edit), Contacts (create/archive,
primary, "a contact does not grant consent"), Tags (assign/remove/create, no duplicate active), Notes
(chronological, **append-only — no edit/delete control**), Tasks (create/complete/cancel, overdue,
idempotency), Core context (package/credit/lead/consent read-only, Core-owned). No CRM form edits any Core
fact.

**Migration-006 divergence honored.** No `audit_logs`/`admin_notifications` dependency — the CRM tables'
actor/timestamp fields are the V1 mutation audit evidence.

**Validator + gates.** `scripts/mvp/crm/validate-qf-mvp-30-2.mjs` **32/32** (7 service + 2 client one-defect
fixtures). 30.1B 46/46, blueprint 36/36, all Marketplace gates, `verify:mvp` exit 0, typecheck/lint/build
clean, `git diff --check` exit 0. **Next: a bounded QF-MVP-30.2 staging smoke/integration review, then
QF-MVP-30.3 — Deterministic segments** (not started).

## 20. QF-MVP-30.3A — deterministic segment foundation (GENERATED, NOT APPLIED)

**Status:** `QF_MVP_30_3A_DETERMINISTIC_SEGMENT_FOUNDATION_GENERATED_READY_FOR_STAGING_APPLICATION_REVIEW`

Architecture source: `qf-staging-workspace/QF-MVP-30.3-ARCHITECTURE-PREFLIGHT-20260725T073538Z/QF-MVP-30.3-ARCHITECTURE-PREFLIGHT-REPORT.md`
(SHA-256 `D0E535590345C0D50339F5E2E6DC603647B86339469AA1EFCFCB621531F409D7`). Generated at HEAD
`e8b2e738…`. **Nothing applied to staging; no runtime implementation started.**

### 20.1 Owner decisions (LOCKED)

1. **Dynamic definition evaluation. No membership persistence.** No `vendor_segment_memberships`,
   no audience-member table, no cached membership truth, no recipient list, no campaign audience
   snapshot, no provider execution table. QF-MVP-30.4 owns immutable frozen campaign audience
   evidence and send-approval separation.
2. **The 30.2 validator's global "no migration newer than `20260723001100`" ceiling is removed** —
   it was only ever true before 30.3 and would break every future phase. Replaced by phase-scoped
   invariants (§20.6).
3. **`verify_qf_mvp_30_1b.sql` is NOT edited.** It is a locked, point-in-time, pre-segments verifier;
   its W18 "no segment tables" assertion is intentionally historical. A new
   `verify_qf_mvp_30_3.sql` supersedes it for the post-30.3 schema state.
4. **No package-expiry / package-order predicate.** No expires-before/after, days-to-expiry, active
   package order, package-order status, or inferred current-package expiry — and no invented "active
   package" definition. `core.remaining_credits` and `core.total_credits` ARE permitted: the preflight
   (§15) explicitly allows them because Core denormalizes them onto `vendors`, so they need no join
   and are read-only here.
5. **No free-text predicate**, which removes PostgREST pattern-filter injection from the segment
   evaluation path structurally rather than defending against it.
6. **No AI or provider authority** — no scoring, embeddings, semantic matching, ranking, prediction,
   Jarvis decision, campaign send, Meta/n8n/provider execution, consent grant, suppression bypass,
   owner binding, assignment, package or credit mutation.

**A segment is a saved question, never an authorization. 30.3 never authorizes sending.**

### 20.2 Migration `20260723001200_qf_mvp_vendor_segment_foundation.sql`

**One table: `public.vendor_segments`** — deterministic saved segment DEFINITIONS. No members, no
recipients, no eligibility decision.

Columns: `id`, `name`, `description`, `status`, `schema_version`, `definition` (jsonb),
`definition_version`, `definition_fingerprint`, `created_at`, `updated_at`, `archived_at`,
`created_by`, `updated_by`, `archived_by`.

Constraints: `vsg_pkey`; three actor FKs → `profiles` **ON DELETE SET NULL / ON UPDATE RESTRICT**
(never CASCADE); `vsg_name_nonempty`, `vsg_name_len` (≤120), `vsg_description_len` (≤2000);
`vsg_status_check` (`draft|active|archived`); `vsg_archived_consistency`
(`(status='archived') = (archived_at is not null)`); `vsg_schema_version_check` (= 1);
`vsg_definition_version_check` (≥ 1); `vsg_definition_is_object`; `vsg_definition_size` (≤ 8 KB);
`vsg_fingerprint_shape` (`^[0-9a-f]{64}$`).

Indexes: `uq_vendor_segments_live_name` — **partial unique** on `lower(btrim(name))`
`where status <> 'archived'`; `ix_vendor_segments_status_updated`; `ix_vendor_segments_fingerprint`.

Trigger `trg_vsg_touch` reuses the existing `qf_crm_touch_updated_at()` helper.

**RLS + grants (identical posture to the six 30.1B tables):** RLS enabled, no untrusted-role policy;
`revoke all … from public, anon, authenticated, service_role`; then
`grant select, insert, update … to service_role` — **never DELETE, never TRUNCATE**. Hard delete is
impossible at the privilege layer; segments are archived, never removed.

**Prohibited columns** (machine-checked by the migration's own `$verify$` block and the validator):
any Core-truth copy (`vendor_id`, verification, `is_active`, `city`, `service_categories`,
`areas_covered`, package, credits, eligibility, consent, suppression, communication authorization)
and any membership smuggling (`member_count`, `members`, `recipient_count`, `recipients`,
`approved_audience`).

**Migration-006 divergence handled explicitly:** `audit_logs` and `admin_notifications` are absent on
staging and are neither created nor referenced. Provenance lives on the table's own actor/timestamp
columns plus `definition_version`/`definition_fingerprint` — the QF-MVP-30.2 evidence model.

The migration alters no Core table, backfills no data, performs no destructive DDL, and creates no row.

### 20.3 Typed rule AST

`lib/crm/segmentRuleContracts.ts` (closed registries) and `lib/crm/segmentRuleValidation.ts`
(validate → normalize → canonicalize → fingerprint). Both **pure**: no DB, no `server-only`, no
secret — so the rule engine is executed directly by the offline validator.

**Permitted Core fields (read-only, no join, never copied):** `core.status`, `core.is_active`,
`core.city`, `core.service_categories`, `core.areas_covered`, `core.covers_full_city`,
`core.remaining_credits`, `core.total_credits`, `core.last_assigned_at`, `core.created_at`.

**Permitted CRM fields:** `crm.onboarding_stage`, `crm.relationship_status`,
`crm.residential_commercial_scope`, `crm.travel_radius_km`, `crm.years_in_business`,
`crm.next_follow_up_at`, `crm.last_interaction_at`, `crm.tag_id` (active assignments, by id),
`crm.has_open_task`, `crm.has_overdue_task`, `crm.has_active_primary_contact` (existence only).

**Prohibited inputs** (refused with an explicit reason, not a generic "unknown field"): package
expiry/order fields; consent, suppression, communication authorization, campaign eligibility;
lead/assignment content; contact name/phone/email; note bodies; unbounded free text
(`capability_notes`, `campaign_notes`); `gst_number`; any AI score.

**Operators:** `eq`, `neq`, `in`, `not_in`, `lt`, `lte`, `gt`, `gte`, `between`, `is_null`,
`is_not_null`, `is_true`, `is_false`, `array_contains_any`, `array_contains_all`,
`within_last_days`, `older_than_days`. **Value kinds:** enum, enum array, integer, integer pair,
boolean, uuid, uuid array, bounded day window, none. A `field` is always a **registry key**, never a
raw column name; there is no free-text/LIKE operator.

### 20.4 Canonical JSON, version and fingerprint

Canonical form emits fixed key order (`schema_version, combinator, groups` /
`combinator, predicates` / `field, op, value`), sorts and de-duplicates array values, sorts
predicates and groups deterministically, and collapses exact duplicate predicates.
**Fingerprint = sha256 hex of the canonical JSON**, matching the DB `vsg_fingerprint_shape` check.
Semantically identical rules always produce the same fingerprint; any semantic change always produces
a different one. `schema_version` is locked to **1**; a bump is an explicit migration.

**Bounds:** ≤ 3 groups, ≤ 8 predicates per group, ≤ 24 total, ≤ 25 array values, ≤ 8 KB canonical,
name ≤ 120, description ≤ 2000, day windows 1…3650.

**Semantics:** AND within a group, explicit AND/OR between groups. A predicate over NULL evaluates
**false** — it never matches and never throws; only `is_null` matches NULL ("unknown" excludes). All
relative windows resolve against a **single `evaluatedAt`** (never a per-predicate `now()`) in
**Asia/Kolkata**, compared against absolute UTC `timestamptz`. Stable output order is
`created_at DESC, id ASC`, identical to the directory read model.

### 20.5 Lifecycle and QF-MVP-30.4 handoff

`draft → active → archived`; create/update/archive only; **no hard delete**. One live segment per
case-insensitive name; archived names are reusable. A duplicate *definition* (same fingerprint under
a different name) is surfaced, not blocked. Actor and timestamps are always server-derived.

30.4 records `segment_id` + `definition_version` + `definition_fingerprint` at approval and freezes
recipients separately. Editing a segment changes the fingerprint, so an approved campaign fails
closed on mismatch — **an approved audience can never silently change**. That guarantee needs no
second version-history table, which is why one table is sufficient.

### 20.6 Validators and verifier

- **New** `scripts/mvp/crm/validate-qf-mvp-30-3.mjs` (`npm run test:crm:30-3`) — **118 checks**,
  10 migration + 2 contract one-defect fixtures, and the real rule engine executed.
- **Corrected** `validate-qf-mvp-30-2.mjs` — the invalid ceiling is replaced by 02a (foundation
  migration present), 02b (30.2 declares no migration of its own), 02c (regression: a valid later
  migration no longer breaks the validator), 02d (30.2 runtime references no segment/campaign
  object). All previous security/runtime assertions retained; **62 checks**.
- **New** `supabase/staging-verification/verify_qf_mvp_30_3.sql` — 22 SELECT-only rows, for exactly
  one pre-fixture run after 30.3B. `verify_qf_mvp_30_1b.sql` is **unchanged**.

**Next: QF-MVP-30.3B — staging preflight and application of `20260723001200`. Not started; the
migration is generated and offline-validated only. No runtime implementation (routes, actions,
services, UI, preview queries) exists yet — that is QF-MVP-30.3C.**

## 19. QF-MVP-30.2C1 + 30.2S4 — bounded security correction + direct staging smoke

**Status:** `VENDOR_CRM_DIRECTORY_AND_PROFILE_STAGING_SMOKE_COMPLETE_READY_FOR_SEGMENTS`

**Commits.** Implementation `d11a3482e751c340355e8326063205ab24a9f43e` (13 paths, unchanged); bounded
correction `fc81103ec368f8b195bb8a4a8dce5829d99c732d` (6 paths, parent = implementation SHA). No migration,
no environment file, no Supabase SQL touched by either.

**Two real defects corrected (source review, nothing else in scope).**

1. **Unsafe PostgREST `.or()` search interpolation.** `listVendorCrmDirectory` interpolated the raw search
   term into an `or=(...)` expression whose grammar is delimited by commas, parentheses, dots and quotes,
   and whose `ilike` value is a SQL LIKE pattern — a crafted term could append an OR condition and widen an
   admin's result set. `sanitizeDirectorySearch()` (in `lib/crm/vendorCrmValidation.ts`) now normalizes
   NFKC, strips control/format characters, allow-lists Unicode letters/marks/digits plus space `' - . + @ &`,
   collapses whitespace and caps the term at **80** characters; structural characters (`, ( ) " \`) and LIKE
   wildcards (`% _ *`) cannot survive. Stripping was chosen over escaping deliberately: it removes the
   double-escaping ambiguity between PostgREST string-quoting and SQL LIKE escaping, so a structural
   character can never reach a downstream escaper to be mis-escaped. The service **additionally** double-quotes
   each `ilike` value, so the expression stays structurally fixed even if the allow-list is later widened.
   *Consequence recorded:* `_` and `%` are not searchable literals — a name containing them is not findable
   by typing them.
2. **Raw error message exposure in the admin route UI.** Both route files assigned `e.message` to the
   rendered error state, so a Postgres/PostgREST message could surface SQL, identifiers or row values in the
   admin UI. Both now render a fixed `CRM_*_LOAD_ERROR` constant and log only the error **class**
   (`name` + `code`) server-side; neither module references `.message` at all. The server-action path already
   mapped everything through `fail()` and is unchanged.

**Correction lock.** The 30.2 validator grew **32 → 59** checks: a new `S09_safe_search` service rule with
fixture H, `R01_no_raw_route_error` / `R02_no_message_logging` route rules with fixtures RF1/RF2, and **20
executed** sanitizer cases plus 2 wiring assertions. Section 5b runs the real `.ts` sanitizer, so
`test:crm:30-2` registers the type-stripping loader.

**Foundation baseline (inherited, not re-executed).** Per governance the prior block is classified a
**procedural access block**; the locked 25/25 verifier was not re-run. Baseline cited from
`qf-staging-workspace/QF-MVP-30.1BA-APPLICATION-20260724T185637Z/`: authorized staging
`uckafzuochmbvtiodmcl`, **12** applied migrations (all `local == remote`) ending `20260723001100`, locked
verifier **25 PASS / 0 FAIL** (machine-counted from the raw JSON), six CRM tables live, no Core mutation.
The link to today's tree is asserted mechanically: verifier SHA `e10caa56…` and migration SHA `9212f746…`
both still match, and no migration newer than `20260723001100` exists.

**Live runtime contract (re-proved this phase).** Through wrapper-mediated service-role HTTP: all six CRM
tables reachable; the exact application column contract accepted on each (7/11/6/7/7/14 columns); and
`service_role` **cannot DELETE** any of the six (zero-row probes all refused `42501`) nor UPDATE
`vendor_internal_notes` — hard delete is impossible at the privilege layer, not merely unused by the code.

**Staging smoke — 127/127 checks PASS**, fixture namespace `QF_STAGING_VENDOR_CRM_SMOKE_V1`, one synthetic
Superadmin and one synthetic disabled/unverified vendor (both `@example.invalid`, no real PII). Journeys ran
against the built app on a non-default local port, driving the **real Next.js server actions** over HTTP with
a genuine `@supabase/ssr` session. Covered: authorization (unauthenticated → `/admin/login`; non-admin →
`error=unauthorized`; Superadmin allowed); directory load, search by name/owner/phone, bounded pagination,
filter state; **10 injection-shaped search payloads proved unable to widen results** and 4 wildcard-only
terms proved to degrade to *no filter* rather than a wildcard match; profile load, invalid and unknown
vendor id → 404, and **no database/secret detail rendered** on any page; CRM profile create/update with
server-derived actor; contact create → primary → update → archive with **no consent row created**; tag
create, normalized_name, duplicate-variant rejection, assign, duplicate-active protection, lifecycle
removal; append-only notes (count grew by exactly 2, nothing replaced, no note mutation action exists);
task idempotency-key dedupe, allowed update, forced-`done` rejected, complete with result/actor/time, cancel
without hard delete. **All 15 Core vendor facts byte-identical before and after.** Zero rows in
`vendor_package_orders`, `vendor_credit_logs`, `lead_assignments`, `communication_consent_events`,
`communication_suppressions`, and no segment/campaign object exists. No Meta/n8n/Jarvis/WhatsApp/SMS/email
or webhook request; no production or QF-Jarvis contact.

**Migration-006 divergence** continues to be honored via the inherited baseline — no `audit_logs` /
`admin_notifications` dependency was introduced or assumed.

**Gates.** 30.2 **59/59**, 30.1B 46/46, blueprint 36/36, marketplace R1 62 · B2 61 · C 83 · D 110 · E 51 ·
20.4A 39 · 20.4C 42 · 20.5A 40, `test:mvp` 66/66, `verify:mvp` exit 0, typecheck/lint clean, clean
`.next` rebuild with a **zero-hit** prohibited-ref scan across cache/static/server/manifests/maps, and
`git diff --check` exit 0. **Next: QF-MVP-30.3 — Deterministic segments (not started).**
