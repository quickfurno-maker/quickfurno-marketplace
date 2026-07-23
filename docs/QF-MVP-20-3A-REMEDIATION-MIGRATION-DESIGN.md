# QF-MVP-20.3A — Marketplace Authority Remediation Migration Design

**Branch:** `mvp/qf-mvp-20-marketplace-engine-v1` @ `8cd27dc` · **Type:** DESIGN + repository audit + documentation. **No SQL migration, no runtime code, no database access** (neither production nor staging) in this task.

**Companions:** [`SCHEMA-CONTRACT`](QF-MVP-20-3A-SCHEMA-CONTRACT.md) · [`CONSUMER-MIGRATION-MATRIX`](QF-MVP-20-3A-CONSUMER-MIGRATION-MATRIX.md) · [`STAGING-TEST-PLAN`](QF-MVP-20-3A-STAGING-TEST-PLAN.md) · [`ROLLBACK-PLAN`](QF-MVP-20-3A-ROLLBACK-PLAN.md)

**Environment state (from records, not re-queried):** staging `uckafzuochmbvtiodmcl` baseline `APPLIED_AND_VERIFIED` (40 PASS / 0 FAIL), 62 tables, all empty, providers inactive, no Auth users. Baseline SHA `920a4aa0…`, verification SHA `7ba9792f…`. Production `yqpgcsduqbxulrlzwzap` is **prohibited**.

---

## 0. Grounding facts that drive the design (read from the applied baseline)

These are the decisive structural facts; every design choice below follows from them.

| Fact | Consequence |
|---|---|
| `lead_assignments.vendor_status` is a **vendor CRM pipeline** field (`New, Contacted, Follow-up Needed, Site Visit Scheduled, Quotation Sent, Converted, Won, Lost`) | There is **no assignment-lifecycle column today**. The lifecycle must be a **new column**, and `vendor_status` must be left untouched (different concern, different vocabulary). |
| `lead_assignments.lead_id → leads ON DELETE CASCADE` and `vendor_id → vendors ON DELETE CASCADE` | Lifetime history computed from `lead_assignments` is **destructible**. A separate **append-only lineage table with non-cascading FKs** is mandatory (locked rule 6). |
| `lead_assignments` has `UNIQUE (lead_id, vendor_id)` | A vendor can hold **at most one** assignment row per lead, ever. Replacement therefore **transitions the existing row**; re-assigning a previously-replaced vendor to the same lead is structurally impossible without violating the constraint. |
| `lead_assignments.lead_id` / `vendor_id` are **nullable** | Orphan-tolerant today; the canonical authority must never insert NULLs, and a forward `NOT NULL` tightening is a later (validate-first) step. |
| `vendor_credit_logs` has `credits_before/delta/after`, `reason`, `updated_by text`, `reference_type/id`, `uq_vendor_credit_logs_reference UNIQUE(reference_type, reference_id) WHERE reference_id IS NOT NULL` | Strong idempotency exists. **Missing:** approval reference, trusted actor identity (only free-text `updated_by`), explicit idempotency key. `change_type` CHECK lacks the new vocabulary. |
| `bad_lead_reports` already has `lead_assignment_id`, `status`, `reviewed_by`, `credit_restored boolean` | Good **evidence source** for restoration, but `credit_restored` is an unlinked flag. Approval must live in a new table that references both the report and the resulting ledger row. |
| **No** `domain_events`, `outbox_events`, `communication_intents`, `idempotency_records` tables exist among the 62 | The communication-intent outbox and the assignment-operation idempotency store are **net-new**. |
| `vendors` has 65 columns incl. `total_credits, remaining_credits, paid_status, package_name, package_status, package_expires_at` and private contact/geo fields | The public projection must be an **explicit allow-list**, not an exclusion filter. |
| **No temporary-suspension column** exists (`status` carries `Pending/Approved/Suspended…`) | "Temporary suspension" is modelled on existing `status` for MVP; a dedicated column is explicitly **out of scope** (documented in §11). |
| 0 triggers on public tables today | All enforcement triggers are net-new; none conflict. |

---

## 1. Remediation release structure

Five forward-only migrations. Separation is deliberate: each has an independent failure blast-radius and its own rollback boundary, so an Auth problem can never be confused with an assignment problem, and a restrictive grant change can be reverted without touching the authority engine.

### Migration A — Marketplace authority foundation (ADDITIVE)
- **Purpose:** create the authority substrate with **no behaviour change**: lineage, operations/idempotency, replacement requests, restoration approvals, communication intents, plus additive columns on `lead_assignments`. Nothing is enforced yet.
- **Objects:** `lead_assignment_events`, `assignment_operations`, `replacement_requests`, `credit_restoration_approvals`, `communication_intents`; `lead_assignments.lifecycle_status` (+ `lifecycle_updated_at`, `operation_id`, `replaced_by_assignment_id`); extend `vendor_credit_logs` CHECK vocabulary + add `approval_reference`, `idempotency_key`, `actor_kind`, `actor_id`.
- **Dependencies:** baseline applied (done).
- **Rollback boundary:** fully reversible — drop the five new tables and the added columns; no existing row semantics change.
- **Additive/restrictive:** **additive only.**
- **Staging gate:** schema-delta test; existing legacy RPCs still function unchanged; zero behaviour drift.
- **Production prerequisite:** staging green; **backfill of `lifecycle_status` for existing rows is a data step, not part of A** (production has 46 assignments — see §14).
- **Compatibility impact:** none.
- **Expected catalog delta:** +5 tables, +4 `lead_assignments` columns, +4 `vendor_credit_logs` columns, +~14 indexes, +5 RLS enables, +0 policies (service_role-only tables), +1 CHECK replacement on `vendor_credit_logs`.

### Migration B — Canonical assignment and credit authority (ADDITIVE + ENFORCING)
- **Purpose:** create `qf_assign_lead_vendors_v2`, `qf_apply_credit_mutation_v2`, `qf_request_replacement_v2`, `qf_approve_credit_restoration_v2`, the canonical eligibility helper, and the **enforcement triggers** for active-3 / lifetime-6 / lineage-append.
- **Objects:** 5 new SECURITY DEFINER functions (`service_role`-only), 1 eligibility SQL function, 3 constraint triggers on `lead_assignments`/`lead_assignment_events`.
- **Dependencies:** Migration A.
- **Rollback boundary:** drop the new functions and triggers; legacy paths untouched and still working.
- **Additive/restrictive:** additive objects, but the **triggers are restrictive** — they will reject writes that breach 3-active/6-lifetime, *including writes from the legacy RPCs*. This is intentional and is the first point where legacy behaviour can change. **Gate:** legacy paths must already respect the caps, or be migrated first (see §14 ordering note).
- **Staging gate:** the full concurrency matrix (STAGING-TEST-PLAN T1–T9).
- **Production prerequisite:** B must not be applied to production until the historical data is proven compliant (production shows max 3 active and max 3 unique per lead, 0 leads above either cap — so the triggers are satisfiable, but the 27-row ledger gap is **not** touched by B).
- **Compatibility impact:** legacy RPCs continue to exist and execute (service_role-only) but now run **inside** the trigger-enforced envelope.
- **Expected catalog delta:** +6 functions, +3 triggers.

### Migration C — Public vendor projection and privilege hardening (RESTRICTIVE)
- **Purpose:** create `vendor_public_v` and remove any anon reach into monetization.
- **Objects:** `vendor_public_v` view; grants to `anon`/`authenticated` on the view; explicit revokes on base-table monetization exposure.
- **Dependencies:** none on A/B (independent), but **must follow** the runtime switch of public reads to the projection.
- **Rollback boundary:** drop the view and restore the prior (already-minimal) grants — **rollback must never re-grant anon on `vendors`**.
- **Additive/restrictive:** **restrictive.**
- **Staging gate:** no-leak tests T12–T14.
- **Production prerequisite:** production currently has `GRANT ALL ON vendors TO anon` (QF-MVP-10 PV-5) — C is the migration that closes it, and it must be preceded by repointing `publicVendorService` at the projection.
- **Compatibility impact:** breaks any consumer doing `select("*")` on `vendors` as anon. Audited: none in the repo (all public reads are server-side service-role) — see the consumer matrix.
- **Expected catalog delta:** +1 view, grant changes only.

### Migration D — Auth user profile trigger restoration (ADDITIVE, INDEPENDENT)
- **Purpose:** restore `auth.users → public.handle_new_user`. Deliberately **decoupled** from assignment work so Auth failures are diagnosable in isolation.
- **Objects:** one trigger on `auth.users`.
- **Dependencies:** none.
- **Rollback boundary:** drop the trigger only.
- **Additive/restrictive:** additive.
- **Staging gate:** T20 (profile provisioned exactly once).
- **Production prerequisite:** production already has this trigger (it predates the dump's public-only scope) — **D is staging-only remediation**; applying to production requires an explicit existence check to avoid duplication.
- **Compatibility impact:** none.
- **Expected catalog delta:** +1 trigger (in `auth`, not `public`; the public trigger count stays 0).

### Migration E — Legacy grant revocation / compatibility retirement (RESTRICTIVE) — **only after consumer migration**
- **Purpose:** revoke legacy EXECUTE and retire compatibility RPCs.
- **Objects:** REVOKE statements only. **No DROP.**
- **Dependencies:** A, B, C + proven zero legacy callers.
- **Rollback boundary:** re-grant to `service_role` only — **never** to PUBLIC/anon/authenticated.
- **Additive/restrictive:** **restrictive.**
- **Staging gate:** T10, T19.
- **Production prerequisite:** the four blocker RPCs are `anon`/`authenticated`-granted **in production only** (staging baseline already locked them to service_role). E is therefore the production-facing security fix.
- **Compatibility impact:** legacy callers fail closed. Definitions are **retained**; removal is a later reviewed migration.
- **Expected catalog delta:** grants only.

**Ordering note (important):** Migration B's triggers constrain legacy writers. Two safe orders exist: (i) A → migrate consumers → B → C → E (preferred; legacy never meets a trigger it can violate), or (ii) A → B with triggers created `NOT VALID`-style/disabled then enabled after consumer migration. **20.3B must pick (i) unless staging proves legacy paths already satisfy the caps.**

---

## 2. Canonical data model decision

Existing structures are **extended, not replaced**, wherever the existing table is already the authoritative fact-holder:

| Object | Decision | Reason |
|---|---|---|
| `lead_assignments` | **EXTEND** (add `lifecycle_status`, `lifecycle_updated_at`, `operation_id`, `replaced_by_assignment_id`) | It is already the assignment fact with PK, `UNIQUE(lead_id,vendor_id)`, and 3 inbound FKs. Replacing it would break `bad_lead_reports`, `lead_delivery_logs`, `lead_status_updates`. |
| `vendor_credit_logs` | **EXTEND** (add `approval_reference`, `idempotency_key`, `actor_kind`, `actor_id`; widen `change_type` CHECK) | The ledger + `uq_vendor_credit_logs_reference` already provide idempotency; only evidence fields are missing. |
| `bad_lead_reports` | **REUSE as evidence** (no structural change) | Already holds report, reviewer and assignment linkage. |
| `lead_assignment_events` | **NEW** | Required: `lead_assignments` cascades on lead/vendor delete, so it cannot hold immutable lifetime history. |
| `assignment_operations` | **NEW** | No idempotency store exists; needed for replay-safety and the operation/return contract. |
| `replacement_requests` | **NEW** | No replacement concept exists at all (confirmed in 20.1). |
| `credit_restoration_approvals` | **NEW** | `bad_lead_reports.credit_restored` is an unlinked boolean; approval evidence + ledger linkage is absent. |
| `communication_intents` | **NEW** | No outbox exists; `whatsapp_logs` is a legacy delivery log, not an intent. |

**Explicitly not duplicated:** vendor commercial state stays in `vendors`; consent/suppression stays in the communication authority tables; delivery records stay in `lead_delivery_logs`/`communication_*`. The lineage table stores only `(lead_id, vendor_id, first_assigned_at, origin_operation_id)` — it is a *lifetime membership* fact, not a copy of the assignment.

Full DDL-level definitions: [`SCHEMA-CONTRACT`](QF-MVP-20-3A-SCHEMA-CONTRACT.md).

---

## 3. Assignment lifecycle (locked)

New column `lead_assignments.lifecycle_status text NOT NULL DEFAULT 'assigned'`, CHECK over exactly:

`requested · assigned · delivered · accepted · rejected · expired · cancelled · invalid · replaced · completed`

**ACTIVE SET (locked, used identically by DB triggers, the service, admin views, tests and replacement):**

```
ACTIVE = { assigned, delivered, accepted }
```

- `requested` is **pre-assignment** (a candidate that has not consumed a slot or a credit) → **not active**, **no lifetime slot**.
- `rejected, expired, cancelled, invalid, replaced` → **not active**, but **retain their lifetime slot** (the assignment did occur).
- `completed` → **not active** (terminal success), retains its lifetime slot.

**Lifetime history = distinct vendors that were ever successfully assigned to the lead**, materialised in `lead_assignment_events`. A row is appended **only** at the moment an assignment is actually created (i.e. a credit debit + `lead_assignments` insert succeeded). A candidate that failed eligibility, lost a race, or was only `requested` **never** appends a lineage row and therefore **never consumes a lifetime slot**.

**Transition rules (enforced in the service; trigger-guarded for the invariants):**
`requested → assigned | cancelled` · `assigned → delivered | rejected | expired | cancelled | invalid | replaced` · `delivered → accepted | rejected | expired | invalid | replaced | completed` · `accepted → completed | invalid | replaced` · terminal: `rejected, expired, cancelled, invalid, replaced, completed`. **No transition ever deletes a row** (locked rule 6).

`vendor_status` (CRM pipeline) is orthogonal and untouched.

---

## 4. Concurrency and locking

**Isolation:** `READ COMMITTED` (PostgreSQL default) — sufficient because every invariant is protected by an explicit row lock taken *before* the read that informs the decision. `SERIALIZABLE` is **not** used (it would convert contention into serialization failures the workers would have to retry, which conflicts with "uncertain outcomes are never blindly retried" ergonomics).

**Exact order inside `qf_assign_lead_vendors_v2` (single transaction):**

1. **Resolve trusted actor** from `p_actor_kind` + server-owned context; reject `unauthorized` before any lock.
2. **Idempotency claim:** `INSERT INTO assignment_operations (idempotency_key, …) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`. If no row returned → this is a **replay**: read the stored result and return it with `already_applied = true`, performing **no** further writes.
3. **Lead lock:** `SELECT … FROM leads WHERE id = p_lead_id FOR UPDATE` — serialises *all* assignment/replacement mutations for that lead. This is the master invariant lock.
4. **Replacement-operation lock** (replacement mode only): the partial unique index on `replacement_requests` is the authority; additionally `SELECT … FOR UPDATE` the open request row.
5. **Read immutable lifetime history:** `SELECT count(*) FROM lead_assignment_events WHERE lead_id = …` (under the lead lock).
6. **Compute active count:** `SELECT count(*) FROM lead_assignments WHERE lead_id = … AND lifecycle_status IN ('assigned','delivered','accepted')`.
7. **Validate active-3 headroom** → `active_limit_reached` if none.
8. **Validate lifetime-6 headroom** for each *genuinely new* vendor → `lifetime_limit_reached`.
9. **Lock candidate vendors** `… WHERE id = ANY(sorted uuid[]) ORDER BY id FOR UPDATE` — **ascending UUID order is the global deadlock-avoidance rule**; the credit authority must lock in the same order.
10. **Validate eligibility** (canonical function, §11) per candidate.
11. **Ledger-backed debit** via the canonical credit authority (locks the same vendor row it already holds).
12. **Insert `lead_assignments`** (`lifecycle_status='assigned'`, `operation_id`).
13. **Append `lead_assignment_events`** (idempotent on `UNIQUE(lead_id,vendor_id)`).
14. **Append audit** (`audit_logs`).
15. **Create `communication_intents`** row(s) — intent only, never a send.
16. **Finalise `assignment_operations`** with the result payload; **commit atomically**.

**Deadlock avoidance:** always lead → replacement → vendors(ascending uuid). No other order is permitted anywhere in the codebase.

**Idempotent replay:** guaranteed by step 2 (`assignment_operations.idempotency_key` UNIQUE) *plus* the ledger's `uq_vendor_credit_logs_reference` *plus* `lead_assignments UNIQUE(lead_id,vendor_id)` — three independent layers, so a replay can neither double-assign nor double-debit.

**Duplicate-operation handling:** same key → stored result returned (`already_applied`). Different key, same (lead,vendor) → blocked by the unique constraint and reported as `duplicate_assignment` in `skipped`.

**Rollback guarantee:** all of 11–15 are in one transaction. A ledger failure rolls back the assignment; an assignment failure rolls back the debit. **Application-side count checks are advisory only** — the caps are additionally enforced by DB triggers so a rogue writer cannot bypass them.

---

## 5. Canonical assignment API (names fixed)

**Database:** `public.qf_assign_lead_vendors_v2(...) RETURNS jsonb` — SECURITY DEFINER, `SET search_path = 'pg_catalog','public'`, **`service_role` EXECUTE only**.
**Server:** `services/marketplaceAssignmentService.ts` — the *only* caller.

```
qf_assign_lead_vendors_v2(
  p_lead_id           uuid,
  p_mode              text,      -- automatic|client_selected|admin_manual|delayed_fill|replacement|recovery_replay
  p_candidate_vendors uuid[],    -- ordered, deterministic
  p_operation_key     text,      -- trusted idempotency key (server-generated)
  p_actor_kind        text,      -- system|client|admin|worker
  p_actor_id          uuid,      -- session-derived; VERIFIED in-body, never trusted as proof
  p_replacement_ref   uuid,      -- required iff mode='replacement'
  p_reason_code       text
) RETURNS jsonb
```

**The RPC must NOT accept** (all removed relative to legacy): a caller-controlled maximum assignment count (**no `p_total_limit`** — this closes blocker C), a caller-supplied trusted actor identity used as proof, an arbitrary credit delta, or any provider-send instruction.

**Return contract (jsonb):**
```
{ operation_id, status: applied|already_applied|partial|rejected|unauthorized,
  lead_id, assigned:[{assignment_id, vendor_id, credit_ledger_id}],
  skipped:[{vendor_id, reason_code}],
  active_count_after, lifetime_count_after,
  communication_intent_ids:[uuid] }
```

**Sanitized error/reason vocabulary (leaks no internal state):** `unauthorized · lead_not_found · lead_not_eligible · active_limit_reached · lifetime_limit_reached · vendor_not_eligible · duplicate_assignment · insufficient_credits · replacement_in_progress · approval_required · approval_invalid · conflict_retry`. No SQL text, balances, or internal reasons are returned.

**Supporting canonical functions:** `qf_apply_credit_mutation_v2`, `qf_request_replacement_v2`, `qf_approve_credit_restoration_v2`, `qf_vendor_assignment_eligible` (see schema contract).

---

## 6. Authorization model

**Rule:** no SECURITY DEFINER function treats a caller-supplied actor UUID as proof of authority. `p_actor_id` is recorded and cross-checked, never trusted.

| Path | Authorization |
|---|---|
| 1. Automatic worker | server-owned service context; RPC is `service_role`-only; `p_actor_kind='system'`, `p_actor_id=NULL`. |
| 2. Client-selected | server route establishes `auth.uid()`; **lead ownership verified before** the privileged call; the RPC re-asserts ownership in-body and returns `unauthorized` on mismatch. |
| 3. Admin manual | route enforces `session.isSuperadmin` (existing `asAdmin`→`requireSuperadmin`); the admin id is **server-derived**, never client-supplied. |
| 4. Delayed fill | secret-gated cron route + server service context (worker identity). |
| 5. Controlled replacement | requires a `replacement_requests` row in state `approved` whose `approved_by` matches the session admin; `p_replacement_ref` must resolve to it. **Approval is a database row, never a caller-supplied boolean.** |
| 6. Recovery replay | worker context + a **pre-existing** `assignment_operations.idempotency_key`; a worker can only replay, never mint new authority. |
| 7. Historical reconciliation tool | read-only role for investigation; any corrective write requires an approval row and runs through the canonical credit authority. |

**Resolutions:** the database RPC is **service_role-only**; authenticated client requests go **only** through server-owned APIs; lead ownership is checked **before** the privileged RPC *and* re-asserted inside it; admin status resolves through server session authority.

---

## 7. Credit authority

One canonical mutation authority — `qf_apply_credit_mutation_v2` — built on the strongest behaviour of the existing `qf_apply_vendor_credit_delta` (vendor row lock, post-lock duplicate-reference check, mandatory ledger row, `already_applied` on duplicate reference).

**Supported change types (extend the existing CHECK additively):**
`lead_assignment_debit` · `approved_bad_lead_restoration` · `package_purchase_credit` · `authorized_manual_adjustment` · `migration_reconciliation_adjustment`
(existing legacy values are retained for historical rows; **new writes are restricted to the five above**.)

**Every ledger row records:** vendor · delta · `credits_before` · `credits_after` · change type · reason · **trusted actor (`actor_kind` + `actor_id`)** · reference type · reference id · **idempotency key** · **approval reference (required for restoration)** · `created_at`.

**Idempotency:** `uq_vendor_credit_logs_reference (reference_type, reference_id)` remains the primary guard; the new `idempotency_key` gets its own unique index. A duplicate returns `already_applied` and writes nothing.

**Non-negative balance:** debits are conditional (`remaining_credits >= cost`) and fail with `insufficient_credits`; they never clamp. Negative results are possible **only** via `authorized_manual_adjustment` with an explicit `allow_negative` opt-in and an approval reference.

**Wallet vs package counters — decision:** **the wallet (`vendors.remaining_credits`) is the sole assignment-debit authority.** Assignment debits do **not** touch `vendor_packages.remaining_leads`. Rationale: the legacy `deduct_vendor_credit` burned package leads *and* credits, which is exactly how wallet/package divergence arose. Package grants add wallet credit via `package_purchase_credit`; `vendor_packages` becomes a **purchase/entitlement record**, not a parallel balance. To prevent silent divergence, a read-only **reconciliation view** (`vendor_wallet_package_divergence_v`, Migration C or a later ops migration) surfaces any vendor whose package-derived expectation disagrees with the wallet — reported, never auto-corrected.

---

## 8. Credit restoration approval

New table `credit_restoration_approvals` (schema contract §4). Workflow:

1. **Request** — source is a `bad_lead_reports` row (or an explicit admin request); captures original assignment, vendor, lead, evidence reference, reason, `requested_by`.
2. **Decision** — only founder / explicitly authorized admin may approve; `approved_by`, `decided_at`, `status ∈ {requested, approved, rejected, applied, failed}`.
3. **Application** — approval **does not itself mutate balances**. The restoration ledger row is written by `qf_apply_credit_restoration` → `qf_apply_credit_mutation_v2` with `change_type='approved_bad_lead_restoration'`, `approval_reference = approvals.id`, in the **same transaction** that flips the approval to `applied` and sets `restoration_ledger_id`. If the credit authority fails, the whole transaction rolls back and status becomes `failed` (recorded in a separate, later transaction by the caller) — balances are never touched without a successful ledger write.
4. **One restoration per approved assignment/reason:** partial unique index on `(original_assignment_id, reason_code) WHERE status IN ('requested','approved','applied')`. A second restoration requires an explicit audited `supersedes_approval_id` chain.

`bad_lead_reports.credit_restored` remains a **display mirror** only; the approval + ledger rows are authoritative.

---

## 9. Historical 27-row gap — disposition

**Not in the authority migration. No blind backfill.** The 27 credit-deducted assignments lacking `lead_assignment` ledger evidence (5 admin / 16 automatic / 6 client-selected) are handled by a **separate reconciliation subphase: QF-MVP-20.4 — Historical Credit-Ledger Reconciliation.**

- **Classifications:** `debit_proven` · `debit_disproven` · `debit_indeterminate`.
- **Evidence table:** `credit_reconciliation_findings` (created in 20.4, not now) — one row per investigated assignment: assignment id, vendor, lead, classification, evidence sources, confidence, investigator, reviewed_by, decision, resulting ledger id (nullable), idempotency key.
- **Read-only inputs:** balance continuity, package consumption evidence, timestamps, `whatsapp_logs`/`lead_delivery_logs` corroboration, the creating RPC path (un-ledgered legacy vs ledgered), `audit_logs`, payment/package history.
- **Approval:** every corrective write requires founder/authorized-admin approval and runs through `qf_apply_credit_mutation_v2` with `change_type='migration_reconciliation_adjustment'` and a `reference_id` equal to the assignment id (so `uq_vendor_credit_logs_reference` makes it idempotent).
- **Permitted outcomes:** proven → corrective ledger entry (approved); disproven → evidence record only, optional compensating credit through the normal restoration path; **indeterminate → NO MUTATION**, manual-review task only.
- **Prohibition:** automatic mutation for indeterminate cases is forbidden; the tool itself performs **zero** writes — it emits findings.

---

## 10. Replacement authority

States: `requested → approved → activating → completed`, plus `rejected` / `failed`.

- **One-at-a-time:** partial unique index `UNIQUE (lead_id) WHERE status IN ('requested','approved','activating')` — the database is the authority, not application logic. A second request returns `replacement_in_progress`.
- **Original assignment:** transitions to `lifecycle_status='replaced'` and sets `replaced_by_assignment_id`. **Never deleted** (locked rule 6); its lineage row remains, so the replaced vendor keeps its lifetime slot.
- **Approval:** required (`approved_by`, `decided_at`); `p_replacement_ref` must resolve to an `approved` row for this lead.
- **Candidate selection:** deterministic canonical eligibility ordering; the candidate must satisfy **lifetime-6 headroom** — if the lead already has 6 distinct lifetime vendors and the candidate is new, the replacement is rejected with `lifetime_limit_reached`. Replacement can therefore never exceed six.
- **Structural note:** because of `UNIQUE(lead_id,vendor_id)`, a previously-replaced vendor cannot be re-assigned to the same lead. This is accepted and documented behaviour for MVP.
- **Credit:** the new assignment debits normally; restoring the *original* vendor's credit is **optional and approval-gated** through §8 (never automatic).
- **Communication:** intents created atomically for both the deactivation and the new assignment; no sends in-transaction.
- **Completion/failure:** commit → `completed`; any failure → full rollback, original stays active, no partial debit, request marked `failed`.

---

## 11. Eligibility authority

One canonical implementation: `qf_vendor_assignment_eligible(...)` (SQL, STABLE, invoker) mirrored by `lib/vendors/vendorMarketplaceEligibility.ts`. It replaces the divergent evaluators found in 20.1.

**HARD GATES:** vendor `status` approved · `is_active` · `accepting_leads` · not suspended · sufficient usable credit (`remaining_credits >= cost`) · city compatibility (normalised `city`/`office_city`) · parent-category compatibility · not already assigned to this lead · active-3 headroom · lifetime-6 headroom.

**Resolutions (locked):**
- **Subcategory → RANKING signal**, not a hard gate (a parent-category match is sufficient to be assignable; exact subcategory ranks higher).
- **Area → RANKING signal**, not a hard gate. City is the hard geographic gate. (`areas_covered`/`covers_full_city`/distance rank.)
- **Package status → NOT a gate.** Packages are decoupled from auto-eligibility (QF-MVP-10 A5); package state may only influence ranking.
- **Temporary suspension → modelled on existing `vendors.status = 'Suspended'`** (no suspension column exists; adding one is **out of scope** for 20.3B and noted as an unknown).
- **Client-selected vendor exception:** a client-picked vendor may bypass **ranking** preferences only. It may **never** bypass hard gates; credits are still required.
- **Admin override:** may override **ranking** only. It can never bypass active-3, lifetime-6, authorization, the ledger, or a suspension representing a legal/security block. Every override is audited with actor + reason.
- **`public_visibility` is NOT an eligibility gate** — this removes blocker I (`evaluateClientSelectedVendorEligibility` currently hard-gates on it). Visibility governs public listing only.

---

## 12. Public vendor projection

**Fixed name: `public.vendor_public_v`** (view), plus the server DTO in `services/publicVendorService.ts`.

**Allowed public columns (explicit allow-list):** `id`, `business_name`, `city`, `office_city`, `areas_covered`, `covers_full_city`, `service_categories`, `selected_category`, `selected_subcategories`, `experience`, `years_experience`, `business_type`, `team_size`, `monthly_capacity`, `starting_price`, `rating`, `completed_projects`, `portfolio_urls`, `profile_image_url`, `cover_image_url`, `public_description`, `public_business_hours`, `public_service_area_summary`, `area_normalized`, `sublocality`, `neighborhood`, `custom_service_area`, `created_at`, plus a derived boolean `is_premium` (from paid/package state — a **binary display flag only**, never the underlying values).

**Explicitly excluded:** `total_credits`, `remaining_credits`, `paid_status`, `package_name`, `package_status`, `package_expires_at`, any package identifier, internal suspension reason (`status`, `verification_status`, `message`), internal audit/ops fields (`last_assigned_at`, `accepting_leads`, `public_visibility`, `source_url`, `utm_*`, `location_permission_status`, `service_radius_km`), and private contact/geo (`user_id`, `phone`, `email`, `whatsapp_number`, `gst_number`, `office_address_line1/2`, `office_landmark`, `office_pincode`, `office_latitude/longitude`, `latitude`, `longitude`, `formatted_address`, `google_place_id`).

**Posture:** `security_invoker = true` so the querying role's RLS on `vendors` still applies (the view must not become a definer-bypass). Row filter inside the view reproduces the current public-listing rule (approved + active + visible, honouring `show_free_vendors_publicly`). **Grants:** `SELECT` on the view to `anon`, `authenticated`; **no** new grants on `vendors`. Staging already gives anon zero table access; **production** additionally requires revoking `GRANT ALL ON vendors TO anon`.

**Migration of existing queries:** `publicVendorService.getPublicVendorsForCategory` / `getPublicVendorProfileBySlugOrId` switch from `adminClient().from("vendors").select("*")` to the projection with an explicit column list; **`select("*")` is removed from all public paths**. Owner (`getMyVendor`, RLS-scoped) and admin/CRM paths keep full commercial truth.

**Regression tests:** T12–T14 (no-leak scan of every public payload, anon column-privilege assertions, owner/admin still complete).

---

## 13. Communication intent boundary

New `communication_intents` table is the authoritative outbox. The assignment transaction **may** insert an intent atomically; it **may not** call Meta, send WhatsApp/SMS, call n8n, write a final delivery record, or retry an uncertain outcome.

**Fields:** `id` · `aggregate_type` · `aggregate_id` · `channel` · `template_purpose` · `recipient_ref` (hashed/opaque) · `payload_ref` · `idempotency_key` (UNIQUE) · `status` (`pending|claimed|dispatched|delivered|failed|uncertain`) · `available_at` · `attempt_count` · `uncertain_outcome` (bool) + `uncertain_reason` · `created_at` · `dispatched_at`.

**Ownership boundary:**
- **Marketplace Core** — decides and writes the intent. Owns nothing after commit.
- **Communication authority** — sole interpreter of consent/suppression; claims intents; selects provider; owns delivery state.
- **Provider worker** — executes the send post-commit; writes provider outcome.
- **n8n** — may only execute Core-approved intents; never mutates assignment or credit truth.
- **Jarvis** — may recommend/draft; **no** write path to intents, assignments or credits.

**Uncertain outcomes are terminal** (`uncertain`) and are never blindly retried (locked rule 14). This also removes blocker J: `assign_lead_to_vendors` writing `whatsapp_logs` inside assignment authority is replaced by an intent; `whatsapp_logs` becomes legacy read-only.

---

## 14. Legacy consumer migration & grant/revoke sequence

Full matrix (current call → defect → new call → change → compatibility → test → revoke prerequisite): [`CONSUMER-MIGRATION-MATRIX`](QF-MVP-20-3A-CONSUMER-MIGRATION-MATRIX.md).

**Blocker H — the public no-auth `assignLead` action (`app/actions.ts:167`) must be REMOVED** (it has no UI caller; 20.1 proved it) **before** legacy authority is revoked. `sendClientSelectedVendorEnquiry` stays but gains ownership binding + rate limiting.

**Exact grant/revoke order (no drops in the first migration):**
1. Add canonical objects (Migration A).
2. Add canonical RPC/service (Migration B).
3. Keep legacy RPCs **service_role-only** (already true in staging; production needs E).
4. Migrate runtime consumers (application release).
5. Prove **zero** legacy callers (repo grep + staging traffic assertion).
6. **Revoke** legacy EXECUTE from `PUBLIC`, `anon`, `authenticated` (Migration E).
7. Retain compatibility definitions temporarily.
8. Remove definitions only in a later reviewed migration.

**Role posture:** `PUBLIC` — no EXECUTE on any mutation function, ever. `anon` — only `vendor_public_v` SELECT and `get_public_eligible_vendors` EXECUTE. `authenticated` — RLS-scoped reads + `is_admin`/`owns_vendor`; **no** mutation RPC. `service_role` — the canonical engine and all mutation RPCs. `postgres` — owner/migration role only; not used by the application.

---

## 15. Auth trigger prerequisite (Migration D)

- **Event/timing:** `AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()`.
- **Function identity:** `public.handle_new_user()` — already exists in staging (part of the 39), SECURITY DEFINER with pinned `search_path`. **Not recreated.**
- **Idempotent behaviour:** guard with an existence check (`pg_trigger` where `tgname='on_auth_user_created'` on `auth.users`) so re-application is a no-op; use `CREATE TRIGGER` only when absent (production already has it).
- **Rollback:** `DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;` — isolated, affects nothing else.
- **Staging Auth test:** T20 — create one Auth user **only inside the dedicated Auth test window** (explicitly out of scope for 20.3A; no Auth user is created now), assert exactly one `profiles` row, assert no duplicate on retry, then clean up.
- **Security:** the trigger runs as definer on a managed-schema table; it must write only `profiles` and must not read or expose auth secrets. Keeping it in its own migration means an Auth regression can be diagnosed and reverted without touching marketplace authority.

---

## 16. Advisor triage (from the recorded 20.2C2R run — not re-queried)

**Security**

| Finding | Level | Disposition |
|---|---|---|
| `rls_enabled_no_policy` × 32 | INFO | **Expected & correct** — RLS on with no policy is fail-closed for anon/authenticated; these are service_role-only tables. **Non-blocking. No action.** Add an explicit assertion test in 20.3B so it stays intentional. |
| `leads public insert` always-true policy | WARN | **Fix in 20.3B (Migration C scope).** Public lead intake must run through the server (service-role) path; the permissive anon/authenticated INSERT policy is replaced by a server-owned intake. Currently mitigated in staging (anon has no table grant). **Non-blocking for staging; must close before production public exposure.** |
| `get_public_eligible_vendors` anon-executable SECURITY DEFINER | WARN | **Expected temporary compatibility** — evidence-backed public listing (`leadService.ts:347` via `publicClient`). Revisit when the projection replaces it. **Non-blocking.** |
| `rls_auto_enable` anon/authenticated-executable | WARN | **Supabase/platform-managed.** Do not drop or alter. **Non-blocking.** |
| `is_admin` / `owns_vendor` authenticated-executable | WARN | **Expected** — RLS predicates must be executable by the evaluating role. **Non-blocking.** |

**Performance**

| Finding | Level | Disposition |
|---|---|---|
| 147 unused indexes | INFO | **Non-actionable until real workload** — staging is empty with no traffic. **Do NOT remove indexes based on empty-staging advice.** Re-evaluate in QF-MVP-70 with production-like load. |
| 36 multiple permissive policies | WARN | **Test in 20.3B but defer the fix** — policy consolidation is behaviour-sensitive; schedule as QF-MVP-70 operations work. Non-blocking. |
| 18 unindexed foreign keys | INFO | **Partially fix in 20.3B:** add covering indexes only for FKs the canonical engine will join on hot paths (assignment/lead/vendor lineage). Defer the rest to QF-MVP-70. Non-blocking. |
| 7 `auth_rls_initplan` | WARN | **QF-MVP-70 operations work** — wrap `auth.<fn>()` in scalar subqueries. Behaviour-neutral but touches 7 policies; not worth coupling to the authority migration. Non-blocking. |
| 3 duplicate indexes (`vendors` city/status, `vendor_dashboard_users` vendor) | WARN | **Fix in 20.3B** — genuinely redundant, safe, tiny; drop one of each pair in Migration C. Non-blocking. |
| Platform Auth connection info | INFO | **Platform-managed.** No action. |

**No advisor finding is a launch blocker.**

---

## 17. Remaining unknowns (must be closed in 20.3B)

1. **`lifecycle_status` backfill for production's 46 existing assignments** — staging is empty so the default covers it; production needs an explicit, reviewed backfill mapping (`vendor_status` + `is_bad_lead_reported` → lifecycle) before the triggers are enabled there.
2. **Lineage backfill for production** — `lead_assignment_events` must be seeded from existing `lead_assignments` (46 rows) in the same reviewed step; until then lifetime-6 has no history on production.
3. **Trigger-vs-legacy ordering** — confirm on staging whether legacy RPCs can satisfy the new triggers, to choose order (i) or (ii) in §1.
4. **Temporary-suspension modelling** — no column exists; MVP uses `status='Suspended'`. A dedicated column is deferred.
5. **`leads` intake policy replacement** — exact server-owned intake contract for the always-true INSERT policy.
6. **Wallet/package divergence view** — confirm the exact expectation formula before implementing the reconciliation view.
7. **`NOT NULL` tightening** on `lead_assignments.lead_id`/`vendor_id` — desirable, requires a validate-first pass on production data.

---

## 18. QF-MVP-20.3B prerequisites

1. This design + the four companion documents reviewed and accepted.
2. Unknowns §17.1–§17.3 resolved (backfill mapping, lineage seed, trigger ordering).
3. Migration order fixed (§1 order (i) preferred).
4. Staging remains `APPLIED_AND_VERIFIED`; baseline `920a4aa0…` and verification `7ba9792f…` unchanged.
5. Migrations authored as **separate, narrowly-scoped, forward-only** files; no drops; no history falsification; staging-first.
6. Consumer migration (matrix) planned as an application release that lands **before** Migration E.
7. No Auth user is created until the dedicated Auth test window in the D test plan.
