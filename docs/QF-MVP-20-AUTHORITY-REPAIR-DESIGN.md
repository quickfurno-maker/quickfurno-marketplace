# QF-MVP-20.0 — Marketplace Authority Repair Design

**Branch:** `mvp/qf-mvp-20-marketplace-engine-v1` · **Type:** DESIGN & DOCUMENTATION ONLY (no runtime code, no migration, no DB/provider access).
**Evidence baseline:** the six QF-MVP-10 docs (`QF-MVP-10-RECONCILIATION-RESULTS.md`, `-DATABASE-RECONCILIATION.md`, `-MIGRATION-LEDGER.md`, `-AUTHORITY-AUDIT.md`, `-CLEANUP-PLAN.md`, `QF-MVP-EXECUTION-BOARD.md`). No production was re-queried; no live fact is invented beyond those documents.

Companion docs: [`QF-MVP-20-MIGRATION-PLAN.md`](QF-MVP-20-MIGRATION-PLAN.md) (section K) · [`QF-MVP-20-ACCEPTANCE-TEST-PLAN.md`](QF-MVP-20-ACCEPTANCE-TEST-PLAN.md) (section L).

## 0. Problem statement (from QF-MVP-10 production reconciliation, 22 Jul 2026)

The production reconciliation confirmed live defects this phase must repair by design:

- **Active authority bypass (BLOCKER):** four SECURITY DEFINER assignment RPCs are executable by **PUBLIC / anon / authenticated** with **no in-body caller-authorization or lead-ownership proof** — `admin_smart_assign_lead_to_vendors`, `assign_client_selected_vendor_to_group`, `assign_vendor_to_requirement_group`, `assign_lead_to_preferred_vendor`. Each also accepts a caller-controlled ceiling clamped only to 1–9.
- **No canonical authority enforces the founder limits.** Live: `UNIQUE(lead_id,vendor_id)` and `lead_assignment_approvals.selected_vendor_count ≤ 3` exist; **no** trigger/constraint enforces **3 active** or **6 lifetime unique**. `app_settings.max_vendors_per_lead = 4` is configuration drift.
- **Credit-ledger gap:** of 46 credit-deducted assignments, 27 lack matching `lead_assignment` ledger evidence (5 admin / 16 auto / 6 client-selected). Legacy `deduct_vendor_credit` / `restore_vendor_credit` / `increment_vendor_credits` mutate balances with **no** ledger evidence and (restore) **no** approval input.
- **Public monetization exposure (HIGH):** anon `SELECT` on `vendors.{total_credits, remaining_credits, public_visibility, paid_status, package_name, package_status, package_expires_at}`; RLS limits rows, not columns.
- **Assignment writes comms:** `assign_lead_to_vendors` inserts directly into `whatsapp_logs` inside the assignment path.
- **`HISTORY_DRIFT`:** only 4 migration-history rows vs 68 repository migrations; unrecorded ≠ absent — canonical objects (`qf_apply_vendor_credit_delta`, `uq_vendor_credit_logs_reference`, `apply_communication_consent_command`) exist live.

**Design goal:** one canonical, deterministic Marketplace Transaction Engine that is the sole authority for assignment, credit, and replacement; enforces 3-active / 6-lifetime internally; writes immutable ledger + audit evidence atomically; emits a Core-approved communication **intent** (never sends); and exposes a monetization-safe public projection. All of the above is **design** — nothing is applied here.

---

## A. Canonical assignment authority

### A.1 One engine, one entry point

Replace the six divergent live RPCs (§G) with a single canonical transaction authority. Proposed:

- **Database transaction core:** `qf_assign_lead_vendors_v2(...)` — SECURITY DEFINER, **`service_role` execute only**, the sole writer of `lead_assignments` + assignment-linked credit ledger + assignment audit + communication intent, all in one transaction.
- **Server-owned orchestrator:** `marketplaceAssignmentService` (Node, service-role client) — the only caller of `qf_assign_lead_vendors_v2`. It resolves and proves the actor context (§B), evaluates deterministic eligibility (§H) to produce the candidate order, and passes an internal (not caller-supplied) ceiling.

No route, RPC, or client may call the debit/assign primitives directly; all traffic funnels through the orchestrator → single RPC.

### A.2 Modes (one authority, explicit mode enum)

`qf_assign_lead_vendors_v2` takes an `assignment_mode` discriminator so a single transaction body serves every path:

| Mode | Trigger | Actor context (§B) |
|---|---|---|
| `automatic` | system auto-match | server service context (no end-user actor) |
| `client_selected` | authenticated client picks vendors | proven client session identity, must own the lead |
| `admin_manual` | superadmin assigns | proven superadmin session |
| `delayed_fill` | 1-hour recharge/fill worker | server service context |
| `replacement` | approved controlled replacement (§D) | proven approver + approval reference |
| `recovery_replay` | idempotent recovery worker | server service context + prior idempotency key |

### A.3 Inputs (contract)

```
qf_assign_lead_vendors_v2(
  p_lead_id            uuid,
  p_vendor_ids         uuid[],            -- ordered candidate list (deterministic, from orchestrator)
  p_assignment_mode    text,             -- enum above
  p_actor_kind         text,             -- 'system' | 'client' | 'admin' | 'worker'
  p_actor_id           uuid,             -- NULL for system/worker; MUST match session for client/admin (verified in-body, not trusted)
  p_idempotency_key    text,             -- caller-stable natural key (see A.4)
  p_approval_ref       uuid,             -- required for replacement; else NULL
  p_reason_code        text              -- controlled vocabulary, for audit
) returns qf_assignment_result
```

- **No caller-controlled ceiling.** There is no `p_limit`/`p_max` parameter. The 3-active and 6-lifetime caps are internal constants / DB-enforced policy (§C). Any excess candidates beyond available slots are rejected deterministically, not silently clamped to a caller number.
- `p_vendor_ids` is an **ordered** list; the engine consumes it in order until active slots fill, skipping ineligible/duplicate vendors, giving deterministic results (§A.7).

### A.4 Idempotency key

- Natural, caller-stable key per logical assignment attempt: `sha256(lead_id | assignment_mode | sorted(vendor_ids) | approval_ref | attempt_epoch_bucket)`.
- Persisted in a dedicated `assignment_transactions` table with `UNIQUE(idempotency_key)`; the credit ledger reference (§E) reuses the resulting assignment UUID.
- Replay with the same key returns the original result (`already_applied`) and performs **no** new writes/debits (§C.7).

### A.5 Transaction boundaries

One DB transaction performs, in order, all-or-nothing:

1. Prove actor authorization (§B); reject with `unauthorized` on failure — before any lock.
2. Acquire deterministic locks (§C.6): `SELECT ... FOR UPDATE` on the lead row, then vendor rows in sorted UUID order.
3. Re-read active-count and lifetime-unique history under lock (§C).
4. For each eligible candidate within remaining active slots: insert `lead_assignments` row; call the credit authority (§E) to debit + write the mandatory ledger row keyed to the assignment UUID; append assignment audit; append communication **intent** (§J).
5. Persist the `assignment_transactions` idempotency record.
6. Commit. If any step fails, the whole transaction rolls back (assignment + debit + ledger + intent all reverted).

Communication is **never** sent inside this transaction — only the intent row is written (§J).

### A.6 Output contract (`qf_assignment_result`)

```
{
  status: 'applied' | 'already_applied' | 'partial' | 'rejected' | 'unauthorized',
  lead_id: uuid,
  assigned: [ { assignment_id, vendor_id, credit_ledger_ref } ],
  skipped:  [ { vendor_id, reason_code } ],     -- deterministic, sanitized
  active_count_after: int,        -- 0..3
  lifetime_unique_after: int,     -- 0..6
  idempotency_key,
  communication_intent_ids: [ uuid ]
}
```

- `partial` = some candidates assigned, others deterministically skipped (slots exhausted / ineligible / would breach lifetime-6).
- `rejected` = nothing assignable (e.g. already at 3 active, or 7th unique vendor requested).

### A.7 Determinism

- Candidate order is fixed by the orchestrator's deterministic eligibility ranking (§H) — no randomness, no AI, no predictive scoring.
- Given identical lead state, vendor state, and candidate list, the engine produces identical `assigned`/`skipped` output. Ties broken by a stable key (vendor UUID ascending) documented in §H.

### A.8 Sanitized error codes

Public/caller-facing codes are a fixed vocabulary that leak no internal state: `unauthorized`, `lead_not_found`, `lead_not_eligible`, `active_limit_reached`, `lifetime_limit_reached`, `vendor_not_eligible`, `duplicate_assignment`, `insufficient_credits`, `replacement_in_progress`, `approval_required`, `approval_invalid`, `conflict_retry`. No raw SQL error, no balance, no internal reason strings.

### A.9 Audit & communication-intent output

Every successful assignment writes: (a) an immutable assignment-linked credit ledger row (§E), (b) an `audit_logs` entry (actor, mode, lead, vendors, before/after counts, approval ref), and (c) one communication **intent** per assigned vendor (§J). These are transactional siblings of the assignment insert.

---

## B. Authorization (a SECURITY DEFINER function must not trust a supplied actor ID)

Core principle: **the RPC never trusts `p_actor_id` as proof of identity.** Identity is proven from trusted context; the supplied ID is only cross-checked against it.

| Path | Who calls | How identity/authorization is proven |
|---|---|---|
| **1. System automatic** | `marketplaceAssignmentService` (server, service-role) | Trusted **server-owned service context**: the RPC is `service_role`-execute-only, and the orchestrator runs with the service-role key server-side, never reachable by a browser. `p_actor_kind='system'`, `p_actor_id=NULL`. |
| **2. Client-selected** | authenticated client via a server route | The route establishes the Supabase **session** (`auth.uid()`); the orchestrator verifies `auth.uid()` **owns the lead** (`leads.client_id = auth.uid()` or the client-account linkage) before invoking the service-role RPC. In-body, the RPC re-asserts `p_actor_id = <session-derived client id>` and that the lead belongs to that client. A mismatch → `unauthorized`. |
| **3. Admin manual** | superadmin via `/api/admin/**` | Route enforces `session.isSuperadmin` (existing gate); the orchestrator passes the **session-derived** admin id, and the RPC records it. The RPC does not accept an arbitrary admin id from the client — it is derived server-side from the authenticated admin session. |
| **4. Founder/admin-approved replacement** | superadmin, with an approval record | Requires a valid `replacement_approvals` row (§D) whose `approved_by` matches the session admin and whose status is `approved`; `p_approval_ref` must resolve to that row. No approval row → `approval_required`. |
| **5. Recovery worker replay** | internal worker (service-role) | Server-owned service context + a **prior** `assignment_transactions.idempotency_key`. The worker may only replay an existing key; it cannot mint a new authorization. |

Enforcement mechanics:

- **Execute grant:** `qf_assign_lead_vendors_v2` and all credit/replacement primitives are `REVOKE EXECUTE FROM public, anon, authenticated; GRANT EXECUTE TO service_role`. End users never call them directly — they hit server routes that run the service-role orchestrator.
- **In-body re-check:** for client/admin modes the RPC does not accept identity on faith; the orchestrator passes a **session-verified** id (from `auth.uid()` / `session.isSuperadmin`), and the RPC's job is to enforce the ownership/authorization invariant (lead ownership, approval validity), returning `unauthorized` otherwise.
- **Defense in depth:** even if a future caller reached the RPC, the `service_role`-only grant plus in-body ownership/approval checks fail closed.

---

## C. Active-three and lifetime-six

### C.1 Definitions

- **Active assignment:** a `lead_assignments` row whose lifecycle state is in the active set `{ assigned, delivered, accepted, in_progress }` (exact enum finalized against live status vocabulary during staging snapshot, §K.3). Active = currently occupying one of the 3 slots.
- **Historical/lifetime vendor:** any vendor that has **ever** held an assignment for the lead, regardless of later state — including `cancelled`, `rejected`, `expired`, `replaced`, `invalid`. These vendors **remain** part of the lifetime unique-vendor set.
- **Lifetime unique count:** the count of **distinct vendor_ids ever assigned to the lead**, computed from immutable history (§C.5), never reconstructed from only currently-active rows.

### C.2 Cancelled / rejected / expired / replaced / invalid

All of these **stay** in lifetime history. A vendor that was assigned and later replaced still counts toward the lifetime-six cap — a lead may cycle through at most 6 distinct vendors ever. This directly prevents the "delete-and-reassign to dodge the cap" hole.

### C.3 How replacement changes active count

- Replacement deactivates one active assignment (state → `replaced`) and activates one new assignment — net active count unchanged (still ≤ 3).
- The replaced vendor **remains** counted in lifetime-unique; the replacement vendor, if new, consumes one of the remaining lifetime-6 slots. If the replacement vendor was already in the lead's history, lifetime-unique does not increase.

### C.4 Concurrency safety

- The transaction takes `FOR UPDATE` on the lead row first (serializes all assignment mutations for that lead), then vendor rows in sorted order (deadlock-free). Two concurrent assignments to the same lead cannot both read "2 active" and both insert a 3rd — the second blocks on the lead lock, then re-reads 3 active and is rejected.
- Lifetime-6 is enforced under the same lead lock against the immutable history table (§C.5).

### C.5 Immutable history model (required)

The lifetime-unique count must survive deletion/mutation of active rows. Design:

- **Append-only `lead_assignment_events`** (or an immutable `lead_vendor_history`) table: one row per (lead, vendor) the first time that vendor is ever assigned, never deleted. `UNIQUE(lead_id, vendor_id)`.
- `lead_assignments` may carry lifecycle state transitions, but the **lifetime set is read from the append-only table**, not from live assignment rows. Even if an assignment row is later removed, the history row persists.
- Lifetime check: `SELECT count(*) FROM lead_assignment_events WHERE lead_id = p_lead_id` under the lead lock; adding a genuinely new vendor is rejected if that count is already 6.

### C.6 Required locks

1. `SELECT ... FROM leads WHERE id = p_lead_id FOR UPDATE` (serialize per lead).
2. `SELECT ... FROM vendors WHERE id = ANY(sorted vendor_ids) ORDER BY id FOR UPDATE` (credit debit safety + deterministic lock order).
3. Credit authority takes its own vendor-row lock (already present in `qf_apply_vendor_credit_delta`) — compatible because we lock vendors in the same sorted order first.

### C.7 Required indexes / constraints

- `UNIQUE(lead_id, vendor_id)` on `lead_assignments` (**exists** live — keep).
- `UNIQUE(lead_id, vendor_id)` on `lead_assignment_events` (new, append-only).
- Partial index on active assignments: `... WHERE state IN (active set)` for fast active-count.
- **DB-enforced ceiling (belt-and-braces):** a `BEFORE INSERT/UPDATE` trigger (or deferred constraint trigger) that rejects a transition producing > 3 active or a history insert producing > 6 lifetime unique — so even a future rogue writer cannot exceed the caps. This is the "no reviewed trigger exists" gap from QF-MVP-10 §I closed.
- Retire the `app_settings.max_vendors_per_lead = 4` drift: the cap is an internal constant `MAX_ACTIVE = 3` / `MAX_LIFETIME_UNIQUE = 6`, not a mutable setting (correct the row to 3 via an approved change, but the engine does not read it as authority).

### C.8 Idempotent replay

Replay with an existing idempotency key returns the stored result and writes nothing (no new assignment, no new debit, no new event, no new intent). See §A.4 and §E idempotency.

---

## D. Replacement workflow (one at a time)

### D.1 States

`replacement_requests` lifecycle: `requested → approved → activating → completed` (or `→ rejected` / `→ failed`). A partial unique index enforces **one in-progress replacement per lead**: `UNIQUE(lead_id) WHERE state IN ('requested','approved','activating')`.

### D.2 Steps

1. **Request:** admin (or system on a bad-lead signal) creates a `replacement_requests` row referencing the **original active assignment** and a reason. The partial unique index blocks a second concurrent request for the same lead → `replacement_in_progress`.
2. **Approval:** founder/authorized-admin approves → `replacement_approvals` row (actor, reason, original assignment ref, approval ref). Credit **restoration** (if the original lead was bad) requires this approval (§E.2, rule 7).
3. **Original state:** the original assignment transitions to `replaced` (never deleted); its history row in `lead_assignment_events` **remains**.
4. **Candidate:** a deterministic eligible replacement vendor (§H) is chosen; must not exceed lifetime-6 (a genuinely new vendor consumes a lifetime slot; if none remain → `lifetime_limit_reached`).
5. **Credit handling:** the replacement assignment debits the new vendor via the credit authority (§E) with a mandatory ledger row. If founder-approved bad-lead restoration applies to the original vendor, a **reversing** ledger entry is written with full approval evidence (§E.2) — never a bare `restore_vendor_credit`.
6. **Activation:** invoke `qf_assign_lead_vendors_v2` in `replacement` mode with `p_approval_ref`; atomically: deactivate original, activate replacement, debit, ledger, audit, communication intent.
7. **Completion/failure:** on commit → `completed`; on any failure → `failed`, full rollback, original stays active, no partial debit.
8. **Idempotency:** the replacement idempotency key includes the approval ref; replay is a no-op returning the original outcome.
9. **Concurrency:** the per-lead partial unique index + the lead `FOR UPDATE` lock guarantee only one replacement mutates a lead at a time.
10. **Lifetime-6:** enforced exactly as §C against the immutable history table — replacement cannot be used to exceed 6 lifetime unique vendors, and cannot silently delete history to reset the count.

---

## E. Credit authority

### E.1 One ledger-backed mutation authority

Canonicalize on the strongest parts of the live `qf_apply_vendor_credit_delta` (MD5 `45ad58beb9cb1dd8ea4f77466909cc0e`): SECURITY DEFINER, `service_role` only, locks the vendor row, post-lock duplicate-reference check, writes `vendor_credit_logs`, returns `already_applied` on duplicate reference. It is the **only** function permitted to change `vendors.remaining_credits` / package lead counts.

**Every mutation records (mandatory, immutable):**

| Field | Meaning |
|---|---|
| vendor | vendor id |
| delta | signed change |
| before_balance | balance before |
| after_balance | balance after |
| change_type | `lead_assignment_debit` / `replacement_debit` / `approved_restoration` / `package_grant` / ... (controlled vocab) |
| reason | controlled reason code |
| actor | proven actor (§B) |
| reference_type | e.g. `lead_assignment` |
| reference_id | assignment UUID (or approval id for restoration) |
| idempotency proof | `uq_vendor_credit_logs_reference` = `UNIQUE(reference_type, reference_id) WHERE reference_id IS NOT NULL` (**exists** live) |
| timestamp | write time |

The assignment engine (§A) calls this authority inside its transaction, keyed to the new assignment UUID, so **every assignment debit is ledgered** — closing the 27/46 gap going forward.

### E.2 Approved restoration evidence (rule 7)

Restoration is never a bare balance bump. A restoration requires an approval record and writes a reversing ledger entry:

- **approver:** founder or specifically-authorized admin (identity proven, §B).
- **approval status:** `approved` (with `approved_at`).
- **original assignment:** reference to the assignment being reversed.
- **source evidence:** bad-lead report id or other source evidence.
- **reason:** controlled reason code.
- **reversing ledger entry:** a positive-delta `vendor_credit_logs` row (`change_type='approved_restoration'`, `reference_type='credit_restoration'`, `reference_id=approval_id`) under the unique-reference index.

No path may restore credit without this evidence chain.

### E.3 Legacy credit-function retirement (do not drop immediately)

`deduct_vendor_credit`, `restore_vendor_credit`, `increment_vendor_credits` all mutate balances with no ledger evidence (restore also has no approval input). Retire in sequence — **no immediate DROP**:

1. **Consumer audit:** grep the repository for every caller (services, RPCs that call them internally, routes). Record in the migration plan consumer inventory (§K.1).
2. **Reroute:** migrate each consumer to the canonical credit authority.
3. **Revoke execute:** `REVOKE EXECUTE` from `public/anon/authenticated`; keep `service_role` temporarily only if an unmigrated internal caller remains.
4. **Shim (optional, temporary):** if a caller cannot be migrated immediately, replace the legacy body with a thin wrapper that calls the canonical authority and writes the ledger row (so even legacy names produce evidence) — clearly marked deprecated.
5. **Disable:** once zero consumers remain, revoke all execute.
6. **Eventual removal:** drop only after a reviewed migration proves zero consumers and the shim window has elapsed (§K.14).

---

## F. Historical ledger gap — non-destructive investigation

Production: 46 credit-deducted assignments, 19 with matching assignment-debit ledger rows, **27 without** (5 admin / 16 automatic / 6 client-selected). **No blind creation of 27 rows.**

### F.1 Per-assignment classification

For each of the 27, classify into exactly one:

- **debit_proven** — independent evidence shows a debit truly occurred but was not ledgered.
- **debit_disproven** — evidence shows no debit occurred (so no corrective ledger row; possibly a double-count elsewhere).
- **debit_indeterminate** — evidence insufficient → **no mutation**, route to manual review.

### F.2 Acceptable evidence sources (read-only, staging/forensic)

- **Current balance continuity:** does the vendor's balance history reconcile with/without this debit?
- **Package consumption evidence:** was a package "remaining leads" decrement recorded around the assignment time?
- **Timestamps:** assignment `created_at` vs credit-log timestamps / other debits in the window.
- **Legacy logs:** `whatsapp_logs` / delivery / notification rows tied to the assignment (corroborating that the assignment was acted on).
- **Assignment creation path:** which RPC created it (legacy un-ledgered vs ledgered) — a strong prior.
- **Admin audit:** `audit_logs` around the assignment.
- **Payment/package history:** package grants/orders that explain balance movement.

### F.3 Outcomes

| Classification | Outcome |
|---|---|
| debit_proven | write a **historical evidence record** + a **corrective ledger entry** (clearly typed `historical_reconciliation`, referencing the assignment and the evidence), under approval, in a reviewed migration — **not in this phase**. |
| debit_disproven | write a **historical evidence record** only (documents that no debit is owed); if a compensating credit is owed to the vendor, route through approved restoration (§E.2). |
| debit_indeterminate | **no mutation**; create a **manual-review** task with the collected evidence. |

### F.4 Guardrails

- The investigation itself performs **no automatic mutation** — it produces a classified evidence report.
- Any corrective/compensating write is a **separate, approved, reviewed** step (QF-MVP-20 implementation on staging first; production only after founder sign-off, §K.10).
- Indeterminate rows are never "resolved" by writing a speculative ledger row.

---

## G. Legacy RPC closure

Public/anon SECURITY DEFINER paths are the **first security priority**, but **do not revoke before repository consumers are identified** (§K.1 gates the revoke).

| RPC | Known risk | Consumers to locate | Temp compatibility | Execute-grant change | Replacement authority | Deprecation state | Removal prerequisite |
|---|---|---|---|---|---|---|---|
| `admin_smart_assign_lead_to_vendors` | **BLOCKER** — PUBLIC/anon exec, no admin check, clamp 1–9, legacy debit, **no ledger** | `manualLeadAssignmentService`, `delayedLeadFillService`, admin routes | keep body temporarily; add server-side superadmin gate at the route while consumer migration proceeds | after consumer inventory: `REVOKE ... FROM public,anon,authenticated` | `qf_assign_lead_vendors_v2` (`admin_manual`/`delayed_fill`) | `deprecated_gated` | zero repo consumers + canary green |
| `assign_client_selected_vendor_to_group` | **BLOCKER** — PUBLIC/anon exec, no lead-ownership, clamp 1–9, legacy debit, no ledger | client-selected group flow, requirement-group services | route-level session+ownership gate | `REVOKE` after inventory | `qf_assign_lead_vendors_v2` (`client_selected`) | `deprecated_gated` | zero consumers + canary |
| `assign_vendor_to_requirement_group` | **BLOCKER** — PUBLIC/anon exec, no caller check, clamp 1–9, legacy debit, no ledger | requirement-group assignment services | route gate | `REVOKE` after inventory | `qf_assign_lead_vendors_v2` (`client_selected`/`admin_manual`) | `deprecated_gated` | zero consumers + canary |
| `assign_lead_to_preferred_vendor` | **BLOCKER** — PUBLIC/anon exec, no ownership, no total-count/lifetime-6 check, incomplete city/category compat; **does** write ledger | preferred-vendor direct-enquiry flow | route gate; add lifetime/total-count guard at orchestrator | `REVOKE` after inventory | `qf_assign_lead_vendors_v2` (`client_selected`) | `deprecated_gated` | zero consumers + canary |
| `assign_lead_to_paid_vendors_phase26a` | service_role-only; strong canonical base; **lifetime-6 absent** | auto-match engine (service-role) | keep as internal base; fold into v2 | already service_role only — keep until v2 replaces | folded into `qf_assign_lead_vendors_v2` (`automatic`) | `superseded` | v2 deployed + auto-match migrated |
| `assign_lead_to_vendors` | service_role-only; mandatory ledger; **lifetime-6 absent**; **inserts `whatsapp_logs`** directly | manual/legacy assignment paths | keep temporarily; strip comms side effect into intent (§J) | service_role only — keep until migrated | `qf_assign_lead_vendors_v2` (`admin_manual`) + comms intent | `superseded` | consumers migrated + comms boundary live |

Order of operations: **(1)** inventory consumers → **(2)** add route-level auth gates to neutralize the public/anon bypass immediately (does not require dropping the RPC) → **(3)** deploy v2 → **(4)** migrate consumers → **(5)** revoke execute → **(6)** deprecate → **(7)** remove after proof.

---

## H. Eligibility authority

One canonical, deterministic eligibility definition (consolidating the 5 divergent implementations noted in QF-MVP-10 §A2). **Public visibility is NOT an assignment-eligibility authority.**

### H.1 Hard eligibility gates (must all pass to be assignable)

| Gate | Rule |
|---|---|
| Approved/active status | vendor status normalized to `approved` **and** `active` (not suspended, not pending, not rejected) |
| Vendor is active | `is_active = true` |
| Accepting leads | `accepting_leads = true` (defaults true when column absent/null, per live behavior) |
| Sufficient credits | `remaining_credits ≥ cost` (cost = 1 for MVP) |
| City normalization | lead city normalized == a vendor service city (canonical city source of truth) |
| Parent category compatibility | lead parent category ∈ vendor parent categories (deterministic matcher, synonym-aware) |
| Not temporarily suspended | no active temporary suspension flag |
| Lifetime-6 headroom | assigning would not exceed the lead's 6 lifetime unique vendors |
| Active-3 headroom | lead has a free active slot |
| Not duplicate | vendor not already assigned to this lead (`UNIQUE(lead_id,vendor_id)`) |

### H.2 Ranking signals (order candidates, never gate)

| Signal | Use |
|---|---|
| Subcategory match | prefer exact subcategory over parent-only match |
| Area proximity | **ranking signal**, not a hard gate (area is soft; city is the hard geo gate) — unless founder later designates a specific area as a hard gulf, default: ranking |
| Package status | prefer paid/active-package vendors in ordering **only**; not an eligibility gate (packages decoupled from auto-eligibility per QF-MVP-10 §A5) |
| Recency/fairness | stable deterministic tiebreak (e.g. least-recently-assigned, then vendor UUID ascending) |

### H.3 Boundaries

- **Public visibility separation:** `public_visibility` governs public listing only. It never determines assignment eligibility.
- **Package status relationship:** package status is a ranking signal and a commercial fact, not an auto-assignment gate.
- **Admin override boundary:** an admin may assign a vendor that fails a *ranking* preference, but **cannot** override the hard gates (credits, city, category, active-3, lifetime-6, duplicate) — those are invariants. An admin override is itself audited.
- **Determinism:** identical inputs → identical eligibility verdict and identical candidate order (§A.7).

Single source: `vendorMarketplaceEligibility` (server) mirrored by the in-RPC gate; legacy `vendorEligibility` retained for public-listing/package-badge display only.

---

## I. Public vendor projection

### I.1 Decision: server-owned projection + column-safe database view

Two complementary layers (defense in depth):

1. **Database view `vendor_public_v`** exposing only public-safe columns, with `anon`/`authenticated` granted `SELECT` on the **view** and the base `vendors` monetization columns revoked from `anon` (grant restriction, §K.8).
2. **Server-owned DTO** (`publicVendorService` projection) that selects only the safe field set — the API never returns raw vendor rows.

### I.2 Excluded from every public projection/payload

`total_credits`, `remaining_credits`, `paid_status`, `package_name`, `package_status`, `package_expires_at`, `public_visibility` (as a value — used only to filter rows, never emitted), internal suspension reasons, internal audit data, and any private contact data not intentionally public.

### I.3 RLS / grants strategy

- Revoke `anon` (and `authenticated` where not the owner) `SELECT` on the monetization columns of `vendors` (column-level revoke), or route all public reads exclusively through `vendor_public_v` and revoke direct base-table `SELECT` for `anon`.
- Public-listing RLS continues to gate **rows** (approved + visible); the view/DTO gates **columns**.

### I.4 Access separation

- **Public:** `vendor_public_v` / DTO — no monetization.
- **Vendor owner:** may read own commercial truth (credits, package) via an owner-scoped path (`owns_vendor`) — rule 9.
- **Admin/CRM:** authorized views expose package + credit truth — rules 10.

### I.5 Regression tests

Automated no-leak assertions (see §L): every public API payload is scanned for the forbidden field names; a test asserts `anon` cannot `SELECT` monetization columns; owner/admin paths still return the commercial truth.

---

## J. Communication boundary

**Assignment transactions must not send provider messages** and must not be the final WhatsApp-log delivery authority (fixes `assign_lead_to_vendors` writing `whatsapp_logs`).

### J.1 Atomic intent, post-commit execution

- Inside the assignment transaction, the engine writes a **communication intent** row (Core-approved) to an outbox-style table (`communication_intents` / reuse the existing communication authority's outbox contract) — atomic with assignment + ledger + audit.
- A **separate worker**, after commit, picks up intents and hands them to the communication authority (which owns consent, provider selection, and sending). Assignment authority never calls Meta and never writes legacy `whatsapp_logs` as final delivery.

### J.2 Contract

- **Idempotency:** intent has a natural key `(assignment_id, template_key, vendor_id)` `UNIQUE`; written once per assignment (test in §L). Replay of the assignment does not create a second intent.
- **Delivery state:** `pending → claimed → dispatched → delivered | failed | uncertain` (owned by the communication authority, not the assignment engine).
- **Retry classification:** definitive-retryable may retry; **uncertain outcomes are terminal and never blindly resent** (rule 16 / D9). This reuses the existing communication D9 enforcement.
- **Boundary:** Core authority = decide + record intent; provider execution = communication authority + worker. n8n/Meta only execute Core-approved intents (rules 13–15).
- **Meta stays inactive** in QF-MVP-20 — the intent boundary is designed and testable offline; activation is QF-MVP-40.

---

## Cross-cutting: what this phase does NOT do

No runtime code, no migration file, no DB/staging/production access, no provider access, no deployment. All of A–L is design to be implemented in later QF-MVP-20 sub-phases, staging-first, per the migration plan.

---

## Z. QF-MVP-20.6 — Marketplace Engine V1 final staging closeout (2026-07-24)

**Status: `MARKETPLACE_ENGINE_V1_STAGING_COMPLETE_READY_FOR_VENDOR_CRM`.** This design (A–L) is now
implemented and applied on authorized staging `uckafzuochmbvtiodmcl` as the locked sequence
A → A2 → B1 → G → R1 → B2 → C → D → E → 20.4 → 20.5A. A final fail-closed closeout audit (read-only, no
migration/runtime/data change, no production access) confirmed every launch-critical contract. Full
starting commit `19572eba5bdf3e138bf18a3ed3419228c73cfe35`.

**Eleven staging migrations (all applied exactly once, 11 local / 11 remote paired):** baseline
`20260722000100`; `…000100` marketplace authority foundation; `…000200` lineage backfill; `…000300`
canonical assignment authority; `…000400` lineage append-only grants; `…000500` universal enforcement;
`…000600` public projection hardening; `…000700` auth onboarding trigger; `…000800` legacy RPC EXECUTE
revocation; `…000900` credit-ledger reconciliation exception register; `…001000` profiles privilege +
admin_role cleanup.

**Gates:** B1/G 165/165, R1 62/62, B2 61/61, C 83/83, D 110/110, E 51/51, 20.4A 39/39, 20.4C 42/42,
20.5A 40/40, `verify:mvp` exit 0, typecheck/lint/build clean, `git diff --check` exit 0.

**SELECT-only staging verifiers (each run once):** D 37/37, E 21/21, 20.4C 22/22, 20.5A 23/23 — all PASS.
The B1/B2/C verifiers pass their launch-critical rows; a handful of forward-looking "later migration not
yet applied" scope-fence rows correctly invert now that the full sequence is applied (self-documenting
`details`, e.g. "Migration D not started"). These are phase-time preconditions, **not** defects, and are
re-proved positively by the closeout state matrix below.

**Final staging state matrix — 26/26 (affirmative):** 11 migrations applied; all public tables, `auth.users`,
`profiles`, `lead_assignments`, `vendor_credit_logs`, `vendors`, `vendor_packages` and the exception
register hold **0 rows**; assignment authority `qf_assign_lead_vendors_v2` exists **exactly once**; the
credit-ledger writer `qf_apply_vendor_credit_delta` is present; the four B2 enforcement triggers exist;
`vendor_public_v` is present with **no** private/credit columns; PUBLIC/anon hold no direct `vendors`
privilege and PUBLIC/anon/authenticated hold no direct `leads` privilege; the D auth trigger +
`handle_new_user()` + `is_admin()` are present; the six legacy assignment RPCs have **zero** untrusted
EXECUTE; profiles RLS is on with `authenticated` **SELECT-only** and `service_role` **SELECT/INSERT/UPDATE
only**; `profiles.admin_role` is absent; owner-binding columns are absent; the register carries its two
immutability triggers.

**Final authority map:** the sole executable assignment writer is
`services/canonicalAssignmentAuthority.ts` → `qf_assign_lead_vendors_v2` (service_role); the sole credit
writer is `services/vendorCreditWalletService.ts` → `qf_apply_vendor_credit_delta` (service_role), which
writes `vendor_credit_logs`. Every legacy assignment/credit RPC has **zero** executable runtime call sites
(comments confirm they are not called and not fallbacks). Jarvis/n8n appear only in the communication
layer — no direct marketplace-Core write authority. **QuickFurno Core is the sole marketplace authority.**

**Business invariants (all PASS):** one canonical assignment authority; max 3 active / 6 lifetime per lead;
controlled append-only replacement; every credit mutation ledger-backed; historical ambiguous cases carry
**no financial change** in an immutable, **empty** exception register (27 candidates recorded nowhere, not
inserted); monetization-safe public projection; trusted auth-role source with no authenticated
`profiles.role` escalation; service-role least privilege; untrusted legacy-RPC revocation; non-authoritative
absent `admin_role`.

**Deferred (fail-closed), non-blocking:** client-selected owner binding remains
`R1_BLOCKED_PENDING_OWNER_BINDING` (no owner-binding columns, path not called); production rollout/cutover;
historical exception population; destructive legacy-object cleanup (the six RPCs are retained but revoked
from untrusted roles). **Production was not migrated by this branch** — every `db push` targeted staging.

**Next authorized phase: QF-MVP-30 — Vendor CRM** (not started here). Evidence pack (outside Git):
`qf-staging-workspace/QF-MVP-20.6-MARKETPLACE-CLOSEOUT-20260724T162126Z/`.
