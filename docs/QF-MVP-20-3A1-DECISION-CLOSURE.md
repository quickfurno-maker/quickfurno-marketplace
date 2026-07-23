# QF-MVP-20.3A1 — Marketplace Remediation Decision Closure

**Type:** SELECT-only database reconciliation + repository audit + documentation. **No writes of any kind** to either database; no migration; no runtime change.
**Status: COMPLETE — all nine decisions closed. No architectural unknown remains for QF-MVP-20.3B.**

---

## 1. Repository baseline

Branch `mvp/qf-mvp-20-marketplace-engine-v1` @ `973e76d24bb11f016c69430cf605498fa510e3f9`; tracked tree clean; `.claude/`, `.mcp.json`, `.agents/skills/`, `skills-lock.json` and the external staging workspaces excluded; `supabase/migrations/**` unchanged. Locked artifacts re-hashed and byte-identical: baseline `920a4aa0143b7c91231a3c83d01452e49b8b9a829c322f15c7df4fe9f07ecc81`, verification `7ba9792f300119b7c1aa84a4c02394186116a507c9097bd6f95f23f55e504193`.

## 2. Target proof

| Role | Name | Ref | Region | Access used |
|---|---|---|---|---|
| Production | QuickFurno | `yqpgcsduqbxulrlzwzap` | ap-southeast-1 | **SELECT-only** (catalog + aggregates) |
| Staging | QuickFurno Staging | `uckafzuochmbvtiodmcl` | ap-southeast-1 | **SELECT-only** |
| Prohibited | QF-Jarvis | `coilipywdvxklewquqvv` | ap-south-1 | **never queried** |

Every statement issued was `SELECT` against `information_schema`/`pg_catalog`/aggregates. No row-level UUIDs, phone numbers, emails, addresses or message contents were read out or are recorded here.

## 3. Production assignment schema profile (`public.lead_assignments`)

11 columns — **identical to the applied staging baseline**, confirming faithful reproduction:

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` |
| `lead_id` | uuid | **YES** | — |
| `vendor_id` | uuid | **YES** | — |
| `assigned_at` | timestamptz | YES | `now()` |
| `assignment_type` | text | YES | — |
| `vendor_status` | text | YES | `'New'` |
| `credit_deducted` | boolean | YES | `true` |
| `is_bad_lead_reported` | boolean | YES | `false` |
| `requirement_group_id` | uuid | YES | — |
| `assignment_source` | text | YES | — |
| `assignment_metadata` | jsonb | YES | `'{}'` |

Constraints/indexes (from the byte-identical baseline): PK `lead_assignments_pkey(id)`; **`UNIQUE(lead_id, vendor_id)`**; CHECK `assignment_type ∈ {client_selected, auto_assigned, admin_assigned}`; CHECK `vendor_status ∈ {New, Contacted, Follow-up Needed, Site Visit Scheduled, Quotation Sent, Converted, Won, Lost}`; FKs `lead_id→leads ON DELETE CASCADE`, `vendor_id→vendors ON DELETE CASCADE`, `requirement_group_id→client_requirement_groups ON DELETE SET NULL`; indexes `idx_assignments_lead`, `idx_assignments_vendor`, `idx_lead_assignments_requirement_group`. Inbound FKs: `bad_lead_reports.lead_assignment_id` (CASCADE), `lead_delivery_logs.assignment_id` (SET NULL), `lead_status_updates.lead_assignment_id` (CASCADE).

## 4. Grouped production assignment-state evidence

| Dimension | Value | Rows |
|---|---|---|
| total | — | **46** |
| `vendor_status` | `New` | **46 (only value)** |
| `assignment_type` | auto_assigned / client_selected / admin_assigned | 34 / 7 / 5 |
| `credit_deducted` | `true` | **46 (only value)** |
| `is_bad_lead_reported` | false / **true** | 45 / **1** |
| `assignment_source` | `<NULL>` | 46 (only value) |
| `requirement_group_id` | NULL | 46 (only value) |
| `assigned_at` | non-null | 46; range 2026-07-02 → 2026-07-18 |

**Integrity:** null `lead_id` 0 · null `vendor_id` 0 · orphan lead 0 · orphan vendor 0 · duplicate `(lead_id,vendor_id)` groups **0** · distinct leads 24 · distinct vendors 3 · **max rows/lead 3** · **max distinct vendors/lead 3** · leads over 3 rows **0** · leads over 6 distinct vendors **0** · rows with inactive vendor 0.

**Related tables:** `leads` 58 (status: New 24, Assigned 24, Duplicate 5, Clarification Required 2, Hot Lead 2, Contacted 1) · `vendors` 28 · `vendor_credit_logs` 47 (`lead_assignment_debit` 19, `correction` 16, `package_credit` 7, `manual_add` 5; 28 without `reference_id`; **0 arithmetic-inconsistent**) · **assignments missing ledger evidence = 27** (reconfirmed) · `vendor_packages` **0 rows** · `bad_lead_reports` 1 (status `Pending`, `admin_decision` NULL, `credit_restored` false) · `lead_assignment_approvals` 4 · `client_requirement_groups` 0 · vendors with negative credits 0.

## 5. Exhaustive lifecycle backfill matrix

Every observed production value is covered; no value is omitted.

| Current column | Current value | Rows | Canonical lifecycle | Evidence | Ambiguity | Migration treatment |
|---|---|---|---|---|---|---|
| `vendor_status` | `New` | 46 | **`assigned`** | assignment exists, `credit_deducted=true`, vendor has not progressed the CRM pipeline | none — single observed value | set `lifecycle_status='assigned'` |
| `vendor_status` | Contacted / Follow-up Needed / Site Visit Scheduled / Quotation Sent / Converted / Won / Lost | **0** | *n/a — CRM only* | permitted by CHECK but **unused in production** | none | no mapping needed; `vendor_status` is never read as lifecycle |
| `assignment_type` | auto_assigned 34 · client_selected 7 · admin_assigned 5 | 46 | *not a lifecycle input* | provenance only | none | preserved verbatim; also mirrored into the lineage event's `metadata` as provenance |
| `credit_deducted` | `true` | 46 | supports `assigned` | a debit occurred (ledger evidence separately incomplete for 27) | none | preserved; **never** used to fabricate ledger rows |
| `is_bad_lead_reported` | `true` | **1** | **`assigned`** (NOT `invalid`) | the single `bad_lead_reports` row is `status='Pending'`, `admin_decision=NULL`, `credit_restored=false` → **no admin decision exists** | resolved by evidence | remains `assigned`; only an *approved* bad-lead decision may later move it to `invalid` |
| `is_bad_lead_reported` | `false` | 45 | `assigned` | — | none | — |
| `assignment_source` | NULL | 46 | *n/a* | never populated | none | leave NULL |
| `requirement_group_id` | NULL | 46 | *n/a* | no requirement groups exist (0 rows) | none | leave NULL |

**Result: all 46 production rows map to `lifecycle_status = 'assigned'`.** The backfill is a single deterministic statement with no conditional branches and no ambiguous rows.

### `in_progress` — inconsistency resolved

Repository/document search found `in_progress` used only as a **draft active-set member** in the earlier QF-MVP-20.0 design; it appears in **no** production value, **no** CHECK constraint, and **no** runtime assignment-status check. The CRM pipeline (`vendor_status`) already expresses in-progress-like states (`Contacted`, `Follow-up Needed`, `Site Visit Scheduled`, `Quotation Sent`).

**Decision — option 2: `in_progress` is NOT a canonical lifecycle status.** It remains a CRM-only concept outside the assignment lifecycle and is excluded from the vocabulary and from the active set. The QF-MVP-20.0 reference to an active set containing `in_progress` is **superseded and void**; the binding definition is §6 below. (QF-MVP-20.0 is outside this task's permitted edit set, so the supersession is asserted here and mirrored in every permitted document.)

## 6. Final active-status set (defined exactly once — binding)

Canonical vocabulary (10): `requested · assigned · delivered · accepted · rejected · expired · cancelled · invalid · replaced · completed`.

```
ACTIVE_ASSIGNMENT_STATUSES = { assigned, delivered, accepted }
```

- `requested` — pre-assignment; consumes **no** active slot, **no** lifetime slot, **no** credit.
- `rejected, expired, cancelled, invalid, replaced, completed` — not active; **retain** their lifetime slot (the assignment did occur).

This single set governs the canonical RPC, database enforcement triggers, replacement logic, admin counts, tests and analytics. It must be sourced from one shared constant in SQL and TypeScript; a test asserts the two agree.

## 7. Lineage seed design (production)

Reverified count: **46 assignments, 0 duplicate `(lead_id, vendor_id)` pairs → exactly 46 lineage rows.**

**Chosen structure: one batch operation row + per-assignment events.** Rejected alternatives: a synthetic operation *per assignment* (46 meaningless operation rows that imply 46 real decisions that never happened) and nullable `operation_id` with only a source key (loses the audit anchor). One batch row records the truth — "these 46 lineage facts were reconstructed by a single reviewed backfill".

| Field | Value |
|---|---|
| receives a lineage event | **every** one of the 46 assignments (all have non-null lead+vendor, all `credit_deducted=true`) |
| `event_type` / `lifecycle_to` | `assignment_created` / `assigned` — the only pair that counts toward lifetime |
| `source_kind` | `backfill` |
| `occurred_at` | **source: `lead_assignments.assigned_at`** (never `now()`) |
| `recorded_at` | `now()` at migration time — distinct from `occurred_at` so reconstruction is visible |
| `actor_kind` | `worker` |
| `actor_id` | **NULL** — no human actor performed these; never invented |
| `operation_id` | the **single** batch `assignment_operations` row (`mode='recovery_replay'`, `actor_kind='worker'`, `reason_code='lineage_backfill_20_3B'`) |
| reason code | `lineage_backfill` |
| source authority | `lead_assignments` only |
| idempotency key | batch operation: `qf_mvp_20_a2_lineage_backfill_v1`; **per-event** idempotency is `event_idempotency_key = 'legacy_assignment_seed_v1:' \|\| assignment_id`, guarded by `UNIQUE (event_idempotency_key)` (**corrected by QF-MVP-20.3A1R** — the earlier "natural `UNIQUE(lead_id, vendor_id)`" is void) |
| `assignment_type` preservation | retained on `lead_assignments`; mirrored into lineage metadata as provenance |
| `credit_deducted` evidence | recorded as **claimed, not proven** — the 27-row gap is untouched |
| incomplete history | none exists (0 nulls/orphans); if any appeared, the row would be skipped and reported, never guessed |

**Idempotency constraint making a rerun a no-op (CORRECTED by QF-MVP-20.3A1R):** `UNIQUE (event_idempotency_key)` on `lead_assignment_events`, written with `ON CONFLICT (event_idempotency_key) DO NOTHING`, plus `UNIQUE(idempotency_key)` on the batch operation row. Re-running inserts zero rows.

The earlier proposal — `UNIQUE (lead_id, vendor_id)` on the event table with `ON CONFLICT (lead_id, vendor_id) DO NOTHING` — is **withdrawn and void**. `lead_assignment_events` is an append-only lifecycle event stream, so one (lead, vendor) pair must be able to record many events (`assigned → delivered → accepted → completed`, or `rejected`/`invalid`/`replaced`); a lifetime-vendor unique constraint would silently swallow every event after the first. **Lifetime vendor count is a query, not a constraint:**

```sql
SELECT count(DISTINCT vendor_id)
FROM lead_assignment_events
WHERE lead_id = $1
  AND event_type = 'assignment_created'
  AND lifecycle_to = 'assigned';
```

Idempotency boundaries stay **separate** and are never collapsed into one broad constraint: operations → `assignment_operations.idempotency_key`; events → `lead_assignment_events.event_idempotency_key`; ledger → `uq_vendor_credit_logs_reference`; intents → `communication_intents.idempotency_key`; assignment rows → the existing, **unchanged** `lead_assignments UNIQUE(lead_id, vendor_id)`. The authoritative transaction — never an untrusted caller — creates and validates the event key.

**The seed must not and does not:** fabricate a ledger row · claim a debit was proven · change any assignment status · change any balance · send communication · create provider records · discard uncertain history.

## 8. History retention and foreign-key decision

Lineage rows contain **only UUIDs and timestamps — no personal data**. Personal data lives in `leads`/`vendors`. Therefore erasure is performed by **anonymising the lead/vendor row**, not by deleting it; lineage is retained as audit/business evidence with no additional personal-data footprint.

| FK | Action | Rationale |
|---|---|---|
| `lead_assignment_events → leads` | **ON DELETE RESTRICT** | lifetime history must survive; blocks the destructive path that today cascades through `lead_assignments` |
| `lead_assignment_events → vendors` | **ON DELETE RESTRICT** | same |
| `lead_assignment_events → lead_assignments` | **ON DELETE SET NULL** | a future assignment-row cleanup must not erase the lifetime fact |
| `assignment_operations → leads` | **ON DELETE RESTRICT** | operation audit must survive |
| `replacement_requests → lead_assignments` | **ON DELETE RESTRICT** | approval/replacement evidence must survive |
| `credit_restoration_approvals → lead_assignments` | **ON DELETE RESTRICT** | money-path evidence must survive |

**No denormalized UUID snapshot columns are added** — RESTRICT already guarantees the referenced row cannot vanish, so snapshots would duplicate facts for no benefit (design principle: do not duplicate authoritative facts).

**Interaction with the existing CASCADEs:** `lead_assignments.lead_id/vendor_id → CASCADE` is **left unchanged** in this release. Once lineage exists with RESTRICT, deleting a lead or vendor is blocked at the lineage FK *before* the cascade can fire — so the retention guarantee holds without altering existing FKs. **Deletion/anonymization behaviour:** hard deletion of a lead/vendor with history is prohibited; the supported operation is anonymisation-in-place (redact PII columns, keep the row and its id). A soft-delete/anonymisation authority is a QF-MVP-70 deliverable and is explicitly out of 20.3B scope.

## 9. Trigger versus legacy compatibility analysis

**Production data would NOT be rejected:** max 3 rows/lead, max 3 distinct vendors/lead, 0 leads over either cap, 0 duplicates. So the caps are satisfiable against the existing 46 rows.

**But legacy *flows* would break, for three evidenced reasons:**

1. **Caller-controlled ceiling up to 9.** `admin_smart_assign_lead_to_vendors` accepts `p_total_limit` (clamped 1–9) and `manualLeadAssignmentService.ts:314` passes `ADMIN_MANUAL_TOTAL_VENDOR_LIMIT = 9` in recovery mode. A 9-vendor recovery would hit the active-3 trigger **mid-transaction**, converting a previously "successful" flow into an immediate error.
2. **Legacy RPCs write no lineage.** Enabling the lineage/lifetime trigger while legacy writers are live would either block them or leave lineage incomplete — silently corrupting the lifetime-six authority.
3. **Live production exposure (SELECT-verified this task):** the four blocker RPCs are `PUBLIC=true, anon=true, authenticated=true` in production, so an *anonymous* caller can still invoke them. Enabling triggers before closing that surface means anonymous callers would be generating trigger exceptions against authoritative tables.

Duplicate ledger writes are **not** a risk (the legacy un-ledgered RPCs write no ledger row; `uq_vendor_credit_logs_reference` guards the canonical path). Transaction-ordering conflict is **not** a risk provided every writer takes the lead lock first.

**Decision — split Migration B:**
- **B1** — canonical RPCs and credit authority, **legacy authority retained, no triggers**.
- **R1** — runtime release migrating consumers to the canonical service.
- **B2** — enable the universal enforcement + lifecycle triggers **after** zero-legacy-consumer proof.

This also **corrects the ordering defect** in the previous plan: consumers cannot migrate to an RPC that does not yet exist, so canonical authority (B1) must be deployed **before** the consumer release (R1).

## 10. Final migration and runtime release order (binding)

| # | Step | Prerequisite | Database change | Runtime change | Compatibility | Rollback | Staging gate | Production gate |
|---|---|---|---|---|---|---|---|---|
| 1 | **A — foundation** | baseline verified | 5 new tables + additive columns (`lifecycle_status`…, ledger evidence fields, widened CHECK) | none | full | drop while empty | schema-delta; legacy unchanged | staging green |
| 2 | **A2 — backfill** | A | set `lifecycle_status='assigned'` (46 rows); seed 46 lineage rows + 1 batch operation | none | full | delete backfilled lineage (idempotent re-run) | counts 46/46 | reviewed data step, founder sign-off |
| 3 | **B1 — canonical authority** | A, A2 | 5 canonical functions, **no triggers**; legacy retained service_role-only | none yet | full | drop functions | T3–T6 | staging green |
| 4 | **R1 — runtime consumer release** | **B1 deployed** | none | remove public `assignLead`; migrate all consumers to `marketplaceAssignmentService`; canonical eligibility; intents | legacy still callable server-side | revert app only | T1–T9, T11, T15–T18 | zero-legacy-caller proof |
| 5 | **B2 — universal enforcement** | R1 + zero-legacy proof | 3 triggers (active-3, lifetime-6, lineage-immutable) | none | legacy now constrained | `DISABLE TRIGGER` fast path | T1, T2, T7–T9 | data proven compliant |
| 6 | **C — public projection + hardening** | R1 (public reads repointed) | `vendor_public_v`; **revoke anon on `vendors`/`leads`**; replace always-true `leads` INSERT policy; drop 3 duplicate indexes | public reads use projection | anon loses table access | drop view; **never re-grant anon** | T12–T14 | production exposure closed |
| 7 | **D — Auth trigger** | none | `auth.users → handle_new_user` (existence-checked) | none | independent | drop trigger | T20 (dedicated window) | staging only — production already has it |
| 8 | **E — legacy revokes** | R1 + zero-legacy proof | REVOKE EXECUTE from PUBLIC/anon/authenticated on the 4 blockers (+ legacy credit) | none | legacy fails closed | re-grant **service_role only** | T10, T19 | **closes the live production bypass** |
| 9 | **QF-MVP-20.4 — historical reconciliation** | E | findings table only | investigation tool | n/a | none (read-only) | classification report | founder-approved corrections only |
| 10 | **Later — legacy removal** | sustained zero usage | DROP legacy functions | none | terminal | restore from migration | full matrix | separate reviewed migration |

The sequence contains **no** "consumer migration → canonical authority deployment" inversion.

## 11. Temporary suspension model — decision

**Existing fields are insufficient.** Evidence: `vendors.status` CHECK permits `{Pending, Approved, Rejected, Suspended}` but **no production vendor is `Suspended`** (Approved 13, Pending 15); `is_active` and `accepting_leads` are `true` for all 28 and are operational toggles, not suspensions; `verification_status` is a KYC concept; `public_visibility` is a listing flag and **must not be overloaded**. Critically, **no field can express an expiry, a reason, an actor or an evidence reference**, so a *temporary* suspension cannot be represented or auto-expired today.

**Decision: add five additive columns to `vendors`** (Migration A):

| Column | Type | Notes |
|---|---|---|
| `assignment_suspended_at` | timestamptz NULL | when the suspension began |
| `assignment_suspended_until` | timestamptz NULL | NULL = indefinite (until lifted) |
| `assignment_suspension_reason` | text NULL | controlled vocabulary |
| `assignment_suspended_by` | uuid NULL | server-derived admin |
| `assignment_suspension_reference` | text NULL | evidence (ticket/report id) |

- **Who may suspend:** superadmin (or an authorized ops admin) through a server-owned admin API; never a client, never a vendor.
- **Who may restore:** superadmin only; lifting sets all five columns NULL and is audited.
- **Expiry:** a vendor is suspended when `assignment_suspended_at IS NOT NULL AND (assignment_suspended_until IS NULL OR assignment_suspended_until > now())`. Expiry is **evaluated at read time** — no scheduled job, no background mutation.
- **Permanent legal/security block:** `status='Suspended'` (existing) — a **hard gate that no admin override may bypass**, distinct from temporary assignment suspension.
- **Eligibility:** the canonical evaluator adds "not temporarily suspended" as a **hard gate**.
- **Audit:** every suspend/restore writes `audit_logs` with actor, reason and reference.
- **Index:** partial `idx_vendors_assignment_suspended ON vendors (id) WHERE assignment_suspended_at IS NOT NULL`.
- **RLS/grants:** columns inherit `vendors` RLS; **excluded from `vendor_public_v`** (internal suspension data must never be public).

## 12. Public lead-intake decision

**Evidence (production, SELECT-verified):** policy `leads public insert` = `INSERT · roles={anon,authenticated} · WITH CHECK true`, and `anon` holds `INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` on `leads` (and on `vendors`). `leads` has **76 columns**; the always-true check lets an anonymous caller set at least these **17 internal columns**: `assignment_intent, clarification_status, internal_notes, lead_priority, lead_quality_checked_at, lead_quality_class, lead_quality_hard_block_reason, lead_quality_recommended_action, lead_quality_score, lead_quality_status, preferred_vendor_checked_at, preferred_vendor_id, preferred_vendor_status, preferred_vendor_status_reason, requirement_group_id, status, verification_status`.

This is a **concrete, exploitable defect**: `leadPassesQualityGate` (`app/actions.ts:84-104`) reads `lead_quality_score/class/hard_block_reason/recommended_action` **from the row**, so a forged insert can make a junk lead auto-distributable and consume real vendor credits. It can also pin `preferred_vendor_id` and elevate `lead_priority`. (Staging is already clean: anon has **NONE** on `leads`/`vendors`.)

**Decision — option 2: server-owned service-role intake** (option 3's definer RPC is unnecessary because a trusted server path already exists; option 1 is rejected because column-level hardening of a 76-column table is fragile and still leaves anon holding UPDATE/DELETE/TRUNCATE).

- **Design:** public forms continue to call the existing server action, which validates and inserts via the **service-role** client with an **explicit allow-list** of client-supplied fields (contact/requirement/consent/UTM only). All internal columns are server-set or left to defaults.
- **Authentication:** none required (public funnel), but the action is server-only; **no anon database privilege is required or retained**.
- **CSRF/origin:** Next.js server actions carry origin checks; the intake additionally validates `Origin`/`Referer`.
- **Rate limiting:** per-IP and per-phone sliding window at the server boundary; excess → generic rejection.
- **Validation:** required name/phone/city/service, length and format bounds, category resolved server-side against `service_categories`.
- **Allowed fields:** name, phone, whatsapp, email, city, area, service/category/subcategory, budget, timeline, message, consent flags, UTM/source. **Never** status, quality, priority, preferred vendor, requirement group, internal notes, verification.
- **Idempotency:** existing duplicate detection (`check_duplicate_lead`) plus a per-submission key so a double-submit cannot create two leads.
- **Consent capture:** `share_consent` remains mandatory (already enforced).
- **Anti-spam:** rate limit + duplicate detection + optional challenge; failures are logged, never surfaced in detail.
- **RLS/grant change (Migration C):** **drop** the `leads public insert` always-true policy and **revoke all anon privileges** on `leads` (and `vendors`). Staging already reflects the target state, so this is production-facing.
- **Sequencing:** the runtime intake change lands in **R1**; the policy/grant removal lands in **C**, strictly after R1 is live.

## 13. Wallet/package divergence view

**Evidence:** `vendor_packages` = **0 rows**; `vendors.package_name` = NULL for all 28; `package_status` = active 3, trial 5, none 20; `package_expires_at` set for 7; `paid_status` = Paid 3, Unpaid 25; `remaining_credits > total_credits` in 0 vendors.

**Interpretation:** packages exist **only as denormalized vendor metadata with no backing rows and no `remaining_leads` counter in use anywhere**. The wallet (`vendors.remaining_credits`) is therefore already the only real balance.

**Decision (locked direction confirmed by evidence): `vendors.remaining_credits` is the sole authority for assignment eligibility and the sole assignment-debit target.** `vendor_packages` is an entitlement/purchase record only; assignment debits never touch it.

**View: `public.vendor_wallet_package_divergence_v`** — read-only, `security_invoker`, `service_role`-only, **never mutates**.

| Output column | Formula / meaning |
|---|---|
| `vendor_id` | `vendors.id` |
| `wallet_remaining` | `vendors.remaining_credits` |
| `wallet_total` | `vendors.total_credits` |
| `ledger_net` | `SUM(vendor_credit_logs.credits_delta)` for the vendor (NULL-safe → 0) |
| `ledger_last_after` | `credits_after` of the newest ledger row |
| `package_status_meta` | `vendors.package_status` |
| `package_name_meta` | `vendors.package_name` |
| `package_expires_at_meta` | `vendors.package_expires_at` |
| `package_rows` | `count(*)` from `vendor_packages` for the vendor |
| `package_active_rows` | package rows with `status='Active'` |
| `package_remaining_leads` | `SUM(vendor_packages.remaining_leads)` over active rows (NULL when none) |
| `divergence_class` | classification below |

**`divergence_class` (mutually exclusive, evaluated in order):**
1. `package_metadata_without_backing_row` — `package_status <> 'none'` **and** `package_rows = 0` → **the current production condition (8 vendors)**.
2. `package_expired_but_active_metadata` — `package_expires_at < now()` and `package_status IN ('active','trial')`.
3. `active_package_null_counters` — active package row with NULL `remaining_leads`/`total_leads`.
4. `multiple_active_packages` — `package_active_rows > 1`.
5. `impossible_value` — any of `wallet_remaining < 0`, `wallet_remaining > wallet_total`, `package_remaining_leads < 0`.
6. `ledger_discontinuity` — `ledger_last_after <> wallet_remaining` (wallet drifted from the ledger).
7. `wallet_package_mismatch` — active package exists and `package_remaining_leads <> wallet_remaining`.
8. `no_active_package` — `package_rows = 0` and `package_status = 'none'` (benign).
9. `aligned` — everything else.

**Operational handling:** the view is a **report**. Divergence is triaged manually; any correction goes through `qf_apply_credit_mutation_v2` with an approval reference (`authorized_manual_adjustment` or `migration_reconciliation_adjustment`). **No automatic mutation of either balance, ever.** Expected first run: 8 vendors in class 1, 0 in classes 5/7 (0 negative, 0 remaining>total, no package rows).

## 14. Remaining risks

1. **Production anon privilege surface is wider than previously recorded** — anon holds `UPDATE/DELETE/TRUNCATE` on `leads` and `vendors` (RLS currently blocks UPDATE/DELETE/SELECT for anon because no anon policy grants them, and TRUNCATE is not reachable via PostgREST). Migration C must revoke these; until then this is the largest open exposure. **Risk: HIGH, mitigated by RLS, closed by C.**
2. **Four blocker RPCs remain anon/PUBLIC-executable in production** until Migration E. Their bodies are un-ledgered (3 of 4) — the ongoing source of ledger gaps. **Risk: HIGH, closed by E.**
3. **The 27-row ledger gap remains unresolved** by design (QF-MVP-20.4). It is not worsened by this release.
4. **Backfill is a data step** — A2 mutates 46 production rows (status + lineage). It must be reviewed and founder-approved separately from schema DDL.
5. **`vendor_status` proximity** — a future contributor could mistake it for lifecycle. Mitigated by naming (`lifecycle_status`), a comment, and a test asserting the active set is read only from the shared constant.
6. **`NOT NULL` tightening** on `lead_assignments.lead_id/vendor_id` is now proven safe (0 nulls) but is deferred to a later validate-first migration to keep this release additive.

## 15. Closure of the six prior unknowns

| Prior unknown (20.3A §17) | Status | Resolution |
|---|---|---|
| 1. Production `lifecycle_status` backfill mapping | **CLOSED** | §5 — all 46 rows → `assigned`; exhaustive matrix, zero ambiguity |
| 2. Production lineage seed | **CLOSED** (corrected 20.3A1R) | §7 — 46 `assignment_created` events + 1 batch operation, `assigned_at` sourced, idempotent via `UNIQUE(event_idempotency_key)` |
| 3. Trigger-vs-legacy ordering | **CLOSED** | §9 — B split into B1/B2 with R1 between; ordering inversion corrected |
| 4. Temporary-suspension modelling | **CLOSED** | §11 — five additive `vendors` columns; existing fields proven insufficient |
| 5. `leads` intake policy replacement | **CLOSED** | §12 — server-owned service-role intake; always-true policy and anon grants removed in C |
| 6. Wallet/package divergence formula | **CLOSED** | §13 — `vendor_wallet_package_divergence_v` with 9 classes; wallet confirmed sole authority |
| (7.) `NOT NULL` tightening | **CLOSED as deferred** | §14.6 — proven safe, deliberately deferred |

Additionally closed: **canonical active-status vocabulary** (§6, `in_progress` excluded), **history retention/FK behaviour** (§8), **final release order** (§10). **No architectural unknown remains.**

## 16. QF-MVP-20.3B prerequisites

1. This closure document accepted; the seven updated design documents are the binding specification.
2. Author migrations in the exact order of §10 — **A, A2, B1, (R1 runtime), B2, C, D, E** — as separate, narrowly-scoped, forward-only files. No drops. No history falsification.
3. Use the §6 active set from a single shared constant (SQL + TS) and the §5 backfill statement verbatim.
4. Treat **A2 as a reviewed data step** requiring founder sign-off before production.
5. Staging remains `APPLIED_AND_VERIFIED`; baseline `920a4aa0…` and verification `7ba9792f…` unchanged. The verification artifact must be updated in the same reviewed change that adds new objects, then re-run to all-PASS.
6. Migration C must revoke anon privileges on `leads` **and** `vendors` and remove the always-true INSERT policy — production-facing.
7. Migration E is the fix for the live production blocker exposure and requires zero-legacy-caller proof first.
8. No Auth user is created outside the dedicated D test window.

## 17. Sanitized SELECT-only query appendix

All queries were read-only; none returned row-level identities or personal data.

1. `list_projects` — target identity proof (3 projects; only the two QuickFurno refs used).
2. `information_schema.columns WHERE table_name='lead_assignments'` (production) — column/type/nullable/default profile.
3. Grouped aggregates over `lead_assignments` — `count(*)`, `GROUP BY vendor_status | assignment_type | credit_deducted | is_bad_lead_reported | assignment_source`, null-timestamp counts.
4. Integrity aggregates — null/orphan counts, duplicate `(lead_id,vendor_id)` groups, `max` rows-per-lead, `max` distinct-vendors-per-lead, over-cap counts, inactive-vendor joins.
5. Ledger aggregates — `vendor_credit_logs` counts by `change_type`, null-reference count, assignment-debit count, missing-evidence `NOT EXISTS` count, arithmetic-consistency count.
6. Vendor commercial/status aggregates — `GROUP BY status | verification_status | is_active | accepting_leads | paid_status | package_status | public_visibility`, package-field null counts, negative/impossible balance counts.
7. `pg_policies` for `leads` and `vendors`; `pg_get_constraintdef` for the vendors status CHECK; `information_schema.role_table_grants` for anon.
8. `has_function_privilege` over the 8 named RPC signatures for `public`/`anon`/`authenticated`.
9. `information_schema.columns` pattern match to enumerate internal `leads` column **names** (no values).
10. Staging aggregates — table count, migration-history count/version, tables-with-rows, `auth.users` count, provider-account count, anon grants.
