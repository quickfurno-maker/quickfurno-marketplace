# QF-MVP-20.3A — Schema Contract

Exact object definitions for the remediation release. **No SQL is created in this task** — this is the specification 20.3B implements verbatim.

Conventions: all new tables live in `public`; all use `uuid` PKs defaulting to `gen_random_uuid()`; all timestamps are `timestamp with time zone`; all new tables are **RLS-enabled with no policies** (fail-closed for `anon`/`authenticated`) and **granted only to `service_role`**; all new SECURITY DEFINER functions pin `SET search_path = 'pg_catalog','public'` and are **`service_role` EXECUTE only** after `REVOKE ALL … FROM PUBLIC`.

**Locked active set** (used identically everywhere): `ACTIVE = {assigned, delivered, accepted}`.

---

## 1. `lead_assignments` — EXTEND (do not replace)

Existing (unchanged): `id`, `lead_id`, `vendor_id`, `assigned_at`, `assignment_type`, `vendor_status`, `credit_deducted`, `is_bad_lead_reported`, `requirement_group_id`, `assignment_source`, `assignment_metadata`, PK `lead_assignments_pkey`, `UNIQUE(lead_id, vendor_id)`, FKs to `leads`/`vendors` (ON DELETE CASCADE) and `client_requirement_groups` (SET NULL).

**Additive columns:**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `lifecycle_status` | `text` | NOT NULL | `'assigned'` | CHECK ∈ `requested, assigned, delivered, accepted, rejected, expired, cancelled, invalid, replaced, completed` |
| `lifecycle_updated_at` | `timestamptz` | NOT NULL | `now()` | set on every transition |
| `operation_id` | `uuid` | NULL | — | FK → `assignment_operations(id)` ON DELETE SET NULL |
| `replaced_by_assignment_id` | `uuid` | NULL | — | FK → `lead_assignments(id)` ON DELETE SET NULL; set when `lifecycle_status='replaced'` |

**Additive indexes:**
- `idx_lead_assignments_active` — `(lead_id) WHERE lifecycle_status IN ('assigned','delivered','accepted')` (hot path for active-count).
- `idx_lead_assignments_operation` — `(operation_id)`.

**Not changed now:** `lead_id`/`vendor_id` remain nullable (tightening is a later validate-first migration); `vendor_status` untouched (CRM pipeline, orthogonal).

---

## 2. `lead_assignment_events` — NEW (append-only lifetime lineage)

**Purpose:** immutable proof of *which vendors were ever assigned to a lead*. Exists because `lead_assignments` cascades on lead/vendor deletion and therefore cannot hold durable lifetime history.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `lead_id` | `uuid` | NOT NULL | — | **FK → `leads(id)` ON DELETE RESTRICT** (deliberately non-cascading) |
| `vendor_id` | `uuid` | NOT NULL | — | **FK → `vendors(id)` ON DELETE RESTRICT** |
| `first_assignment_id` | `uuid` | NULL | — | FK → `lead_assignments(id)` ON DELETE SET NULL (row survives assignment deletion) |
| `origin_operation_id` | `uuid` | NULL | — | FK → `assignment_operations(id)` ON DELETE SET NULL |
| `first_assigned_at` | `timestamptz` | NOT NULL | `now()` | immutable |
| `origin_mode` | `text` | NOT NULL | — | CHECK ∈ `automatic, client_selected, admin_manual, delayed_fill, replacement, recovery_replay, migration_backfill` |
| `created_at` | `timestamptz` | NOT NULL | `now()` | immutable |

- **Unique:** `UNIQUE (lead_id, vendor_id)` — one lineage row per (lead, vendor) forever; makes the append idempotent.
- **Index:** `idx_lead_assignment_events_lead (lead_id)`.
- **Immutable fields:** every column. Enforced by trigger `trg_lead_assignment_events_immutable` rejecting `UPDATE`/`DELETE`.
- **Retention:** permanent. Never pruned; it is the lifetime-six authority.
- **RLS/grants:** RLS enabled, no policies; `service_role` only.

**Lifetime count** = `SELECT count(*) FROM lead_assignment_events WHERE lead_id = $1`. A row is appended **only** when an assignment actually succeeds (credit debited + assignment inserted). Failed/`requested` candidates never append.

---

## 3. `assignment_operations` — NEW (idempotency + operation result)

**Purpose:** one row per logical assignment operation; the replay guard and the source of the returned contract.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `idempotency_key` | `text` | NOT NULL | — | **UNIQUE** — the replay guard |
| `lead_id` | `uuid` | NOT NULL | — | FK → `leads(id)` ON DELETE RESTRICT |
| `mode` | `text` | NOT NULL | — | CHECK ∈ `automatic, client_selected, admin_manual, delayed_fill, replacement, recovery_replay` |
| `actor_kind` | `text` | NOT NULL | — | CHECK ∈ `system, client, admin, worker` |
| `actor_id` | `uuid` | NULL | — | server-derived; NULL for system/worker |
| `replacement_request_id` | `uuid` | NULL | — | FK → `replacement_requests(id)`; required iff `mode='replacement'` (CHECK) |
| `reason_code` | `text` | NULL | — | controlled vocabulary |
| `status` | `text` | NOT NULL | `'in_progress'` | CHECK ∈ `in_progress, applied, already_applied, partial, rejected, failed` |
| `result` | `jsonb` | NOT NULL | `'{}'::jsonb` | the sanitized return contract, replayed verbatim |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `completed_at` | `timestamptz` | NULL | — | |

- **Indexes:** `UNIQUE (idempotency_key)`; `idx_assignment_operations_lead (lead_id, created_at DESC)`.
- **Immutable:** `idempotency_key`, `lead_id`, `mode`, `actor_kind`, `created_at`.
- **Retention:** permanent (audit); prune policy is a QF-MVP-70 decision.
- **RLS/grants:** RLS on, no policies, `service_role` only.

---

## 4. `replacement_requests` — NEW

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `lead_id` | `uuid` | NOT NULL | — | FK → `leads(id)` ON DELETE RESTRICT |
| `original_assignment_id` | `uuid` | NOT NULL | — | FK → `lead_assignments(id)` ON DELETE RESTRICT |
| `original_vendor_id` | `uuid` | NOT NULL | — | FK → `vendors(id)` ON DELETE RESTRICT |
| `replacement_assignment_id` | `uuid` | NULL | — | FK → `lead_assignments(id)` ON DELETE SET NULL; set on completion |
| `reason_code` | `text` | NOT NULL | — | controlled vocabulary (e.g. `bad_lead`, `vendor_unresponsive`, `admin_recovery`) |
| `evidence_reference` | `text` | NULL | — | e.g. `bad_lead_reports.id` |
| `status` | `text` | NOT NULL | `'requested'` | CHECK ∈ `requested, approved, activating, completed, rejected, failed` |
| `requested_by` | `uuid` | NULL | — | server-derived |
| `approved_by` | `uuid` | NULL | — | founder/authorized admin; NOT NULL when status ∈ `approved, activating, completed` (CHECK) |
| `decided_at` | `timestamptz` | NULL | — | |
| `failure_reason` | `text` | NULL | — | sanitized |
| `idempotency_key` | `text` | NULL | — | UNIQUE when present |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL | `now()` | |

- **One-at-a-time (the authority):** `CREATE UNIQUE INDEX uq_replacement_requests_open_per_lead ON replacement_requests (lead_id) WHERE status IN ('requested','approved','activating');`
- **Index:** `idx_replacement_requests_lead (lead_id, created_at DESC)`.
- **Immutable:** `lead_id`, `original_assignment_id`, `original_vendor_id`, `created_at`.
- **RLS/grants:** RLS on, no policies, `service_role` only.

---

## 5. `credit_restoration_approvals` — NEW

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `original_assignment_id` | `uuid` | NOT NULL | — | FK → `lead_assignments(id)` ON DELETE RESTRICT |
| `vendor_id` | `uuid` | NOT NULL | — | FK → `vendors(id)` ON DELETE RESTRICT |
| `lead_id` | `uuid` | NOT NULL | — | FK → `leads(id)` ON DELETE RESTRICT |
| `evidence_type` | `text` | NOT NULL | — | CHECK ∈ `bad_lead_report, admin_request, reconciliation_finding` |
| `evidence_reference` | `text` | NOT NULL | — | e.g. `bad_lead_reports.id` |
| `reason_code` | `text` | NOT NULL | — | controlled vocabulary |
| `requested_by` | `uuid` | NULL | — | |
| `status` | `text` | NOT NULL | `'requested'` | CHECK ∈ `requested, approved, rejected, applied, failed` |
| `approved_by` | `uuid` | NULL | — | founder/authorized admin; NOT NULL when status ∈ `approved, applied` (CHECK) |
| `decided_at` | `timestamptz` | NULL | — | |
| `restoration_ledger_id` | `uuid` | NULL | — | FK → `vendor_credit_logs(id)` ON DELETE RESTRICT; set only on `applied` |
| `supersedes_approval_id` | `uuid` | NULL | — | FK → self; audited chain for a second restoration |
| `idempotency_key` | `text` | NOT NULL | — | **UNIQUE** |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL | `now()` | |

- **One restoration per assignment+reason:** `CREATE UNIQUE INDEX uq_restoration_per_assignment_reason ON credit_restoration_approvals (original_assignment_id, reason_code) WHERE status IN ('requested','approved','applied');`
- **CHECK:** `status='applied'` ⇒ `restoration_ledger_id IS NOT NULL`.
- **RLS/grants:** RLS on, no policies, `service_role` only.

---

## 6. `communication_intents` — NEW (authoritative outbox)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `aggregate_type` | `text` | NOT NULL | — | CHECK ∈ `lead_assignment, replacement, credit_restoration, lead` |
| `aggregate_id` | `uuid` | NOT NULL | — | e.g. the assignment id |
| `channel` | `text` | NOT NULL | — | CHECK ∈ `whatsapp, sms, email, dashboard` |
| `template_purpose` | `text` | NOT NULL | — | internal template key (not a provider template id) |
| `recipient_ref` | `text` | NOT NULL | — | opaque/hashed destination reference — **never plaintext phone/email** |
| `payload_ref` | `jsonb` | NOT NULL | `'{}'::jsonb` | minimal, non-PII variable references |
| `idempotency_key` | `text` | NOT NULL | — | **UNIQUE** (e.g. `assignment_id:template_purpose:recipient_ref`) |
| `status` | `text` | NOT NULL | `'pending'` | CHECK ∈ `pending, claimed, dispatched, delivered, failed, uncertain` |
| `available_at` | `timestamptz` | NOT NULL | `now()` | scheduling / backoff |
| `attempt_count` | `integer` | NOT NULL | `0` | |
| `uncertain_outcome` | `boolean` | NOT NULL | `false` | terminal marker |
| `uncertain_reason` | `text` | NULL | — | sanitized |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `dispatched_at` | `timestamptz` | NULL | — | |

- **Indexes:** `UNIQUE (idempotency_key)`; `idx_communication_intents_claimable (status, available_at) WHERE status='pending'`; `idx_communication_intents_aggregate (aggregate_type, aggregate_id)`.
- **CHECK:** `uncertain_outcome = true` ⇒ `status='uncertain'` (uncertain is terminal; **never auto-retried**).
- **RLS/grants:** RLS on, no policies, `service_role` only.
- **Retention:** terminal rows retained for audit; pruning is QF-MVP-70.

---

## 7. `vendor_credit_logs` — EXTEND

Existing columns retained. **Additive:**

| Column | Type | Null | Notes |
|---|---|---|---|
| `approval_reference` | `uuid` | NULL | FK → `credit_restoration_approvals(id)` ON DELETE RESTRICT; **required** when `change_type='approved_bad_lead_restoration'` (CHECK) |
| `idempotency_key` | `text` | NULL | UNIQUE when present (`uq_vendor_credit_logs_idempotency`) |
| `actor_kind` | `text` | NULL | CHECK ∈ `system, client, admin, worker` |
| `actor_id` | `uuid` | NULL | server-derived trusted actor (complements free-text `updated_by`) |

**`change_type` CHECK — replaced additively.** Retain all existing legacy values (historical rows must stay valid: `package_purchase, admin_credit_grant, lead_assignment_debit, invalid_lead_refund, manual_adjustment, manual_add, manual_set, manual_remove, package_credit, preview_test, correction`) **plus** the new canonical values: `approved_bad_lead_restoration, package_purchase_credit, authorized_manual_adjustment, migration_reconciliation_adjustment`.

**New writes are restricted by the canonical function** to exactly five types: `lead_assignment_debit, approved_bad_lead_restoration, package_purchase_credit, authorized_manual_adjustment, migration_reconciliation_adjustment`.

Unchanged and still authoritative: `uq_vendor_credit_logs_reference UNIQUE (reference_type, reference_id) WHERE reference_id IS NOT NULL`.

---

## 8. Enforcement triggers (Migration B)

| Trigger | On | Timing | Enforces |
|---|---|---|---|
| `trg_lead_assignments_active_cap` | `lead_assignments` | `BEFORE INSERT OR UPDATE OF lifecycle_status` | rejects any transition producing **> 3** rows in the ACTIVE set for that `lead_id` (counts under the caller's lead lock) |
| `trg_lead_assignment_events_lifetime_cap` | `lead_assignment_events` | `BEFORE INSERT` | rejects an append producing **> 6** distinct vendors for that `lead_id` |
| `trg_lead_assignment_events_immutable` | `lead_assignment_events` | `BEFORE UPDATE OR DELETE` | raises unconditionally (append-only) |

All three raise sanitized errors (`active_limit_reached`, `lifetime_limit_reached`, `lineage_immutable`). They are the **defence-in-depth** layer: application counts are advisory, the triggers are authoritative.

---

## 9. Canonical functions (Migration B) — all SECURITY DEFINER, `service_role`-only, `search_path` pinned

| Function | Signature (type-only) | Purpose |
|---|---|---|
| `qf_assign_lead_vendors_v2` | `(uuid, text, uuid[], text, text, uuid, uuid, text) → jsonb` | the sole assignment authority (§5 of the design) |
| `qf_apply_credit_mutation_v2` | `(uuid, integer, text, text, text, text, text, uuid, text, boolean) → jsonb` | sole credit mutation; vendor row lock, mandatory ledger row, `already_applied` on duplicate reference |
| `qf_request_replacement_v2` | `(uuid, uuid, text, text, uuid) → jsonb` | creates/approves a replacement request; one-at-a-time enforced by the partial unique index |
| `qf_approve_credit_restoration_v2` | `(uuid, uuid, text) → jsonb` | flips approval to `applied` **and** writes the restoration ledger row in one transaction |
| `qf_vendor_assignment_eligible` | `(uuid, uuid, integer) → jsonb` | canonical eligibility; STABLE, SECURITY INVOKER (pure read) |

**Prohibited parameters** on `qf_assign_lead_vendors_v2`: any caller-controlled maximum count (no `p_total_limit`), any actor identity treated as proof, any credit delta, any provider-send instruction.

---

## 10. `vendor_public_v` — NEW view (Migration C)

`CREATE VIEW public.vendor_public_v WITH (security_invoker = true) AS SELECT <allow-list> FROM public.vendors WHERE <public listing predicate>;`

**Allow-list (exact):** `id, business_name, city, office_city, areas_covered, covers_full_city, service_categories, selected_category, selected_subcategories, experience, years_experience, business_type, team_size, monthly_capacity, starting_price, rating, completed_projects, portfolio_urls, profile_image_url, cover_image_url, public_description, public_business_hours, public_service_area_summary, area_normalized, sublocality, neighborhood, custom_service_area, created_at`, plus derived `is_premium boolean` (binary only).

**Excluded (never selected):** `total_credits, remaining_credits, paid_status, package_name, package_status, package_expires_at`, any package identifier, `status, verification_status, message` (internal suspension reason), `last_assigned_at, accepting_leads, public_visibility, source_url, utm_source, utm_medium, utm_campaign, location_permission_status, service_radius_km` (internal ops), `user_id, phone, email, whatsapp_number, gst_number, office_address_line1, office_address_line2, office_landmark, office_pincode, office_latitude, office_longitude, latitude, longitude, formatted_address, google_place_id` (private).

**Grants:** `SELECT` → `anon`, `authenticated`, `service_role`. **No** new grant on `vendors`. Production additionally requires `REVOKE ALL ON public.vendors FROM anon`.

**Also in Migration C:** drop the 3 duplicate indexes (`vendors`: `idx_vendors_city`|`vendors_city_idx`, `idx_vendors_status`|`vendors_status_idx`; `vendor_dashboard_users`: `idx_vendor_dashboard_users_vendor`|`_vendor_id` — keep one of each pair), and add covering indexes for the hot-path unindexed FKs only.

---

## 10b. QF-MVP-20.3A1 additions and confirmations (binding)

**FK actions confirmed** (retention decision, §8 of the closure): `lead_assignment_events → leads` **RESTRICT**, `→ vendors` **RESTRICT**, `→ lead_assignments` **SET NULL**; `assignment_operations → leads` **RESTRICT**; `replacement_requests → lead_assignments` **RESTRICT**; `credit_restoration_approvals → lead_assignments` **RESTRICT**. No denormalized UUID snapshot columns are added (RESTRICT already guarantees the referent survives). Existing `lead_assignments` CASCADEs are unchanged. Erasure = anonymisation-in-place; lineage holds only UUIDs/timestamps.

**`vendors` — additive suspension columns (Migration A):**

| Column | Type | Null | Notes |
|---|---|---|---|
| `assignment_suspended_at` | `timestamptz` | NULL | suspension start |
| `assignment_suspended_until` | `timestamptz` | NULL | NULL = indefinite |
| `assignment_suspension_reason` | `text` | NULL | controlled vocabulary |
| `assignment_suspended_by` | `uuid` | NULL | server-derived admin |
| `assignment_suspension_reference` | `text` | NULL | evidence reference |

Suspended predicate (read-time, no scheduled job): `assignment_suspended_at IS NOT NULL AND (assignment_suspended_until IS NULL OR assignment_suspended_until > now())`. Partial index `idx_vendors_assignment_suspended ON vendors (id) WHERE assignment_suspended_at IS NOT NULL`. These columns are **excluded from `vendor_public_v`**. `status='Suspended'` remains the separate permanent legal/security block (CHECK already permits it; unused in production today).

**`public.vendor_wallet_package_divergence_v` — NEW read-only view** (`security_invoker`, `service_role` only). Columns: `vendor_id, wallet_remaining, wallet_total, ledger_net, ledger_last_after, package_status_meta, package_name_meta, package_expires_at_meta, package_rows, package_active_rows, package_remaining_leads, divergence_class`. `divergence_class` ∈ `package_metadata_without_backing_row, package_expired_but_active_metadata, active_package_null_counters, multiple_active_packages, impossible_value, ledger_discontinuity, wallet_package_mismatch, no_active_package, aligned` (evaluated in that order). **Never mutates.** `vendors.remaining_credits` is the **sole** assignment-debit authority; `vendor_packages` is an entitlement record only (production has **0** package rows).

**Backfill (Migration A2 — reviewed data step, not DDL):** `lifecycle_status='assigned'` for all 46 production rows (unconditional — `vendor_status='New'` is the only observed value); 46 lineage rows from `lead_assignments` with `first_assigned_at := assigned_at`, `origin_mode='migration_backfill'`, `actor_kind='worker'`, `actor_id=NULL`, all pointing at **one** batch `assignment_operations` row (`idempotency_key='qf_lineage_backfill_v1'`); written `ON CONFLICT (lead_id, vendor_id) DO NOTHING` so re-running is a no-op.

**`in_progress` is not part of the lifecycle vocabulary.** `ACTIVE = {assigned, delivered, accepted}` — defined once, sourced from one shared SQL+TS constant.

## 11. Expected catalog delta (staging, post-A+B+C+D)

| Object | Before | After | Δ |
|---|---|---|---|
| public base tables | 62 | 67 | +5 |
| public functions | 40 (39 QF + 1 managed) | 45 | +5 canonical |
| SECURITY DEFINER (QuickFurno) | 33 | 37 | +4 (eligibility is INVOKER) |
| views | 0 | 2 | +2 (`vendor_public_v`, `vendor_wallet_package_divergence_v`) |
| `vendors` columns | 65 | 70 | +5 (assignment-suspension fields) |
| triggers on public tables | 0 | 3 | +3 |
| triggers on `auth.users` | 0 | 1 | +1 (Migration D) |
| policies | 67 | 67 | 0 (new tables are RLS-on/no-policy) |

20.3B must update the verification artifact's expectations **in the same reviewed change** that adds these objects, and re-run the corrected verifier.
