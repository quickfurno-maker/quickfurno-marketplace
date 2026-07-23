# QF-MVP-20.3R1 — Marketplace Runtime Consumer Migration

**Status: `R1_CONSUMER_MIGRATION_IMPLEMENTED_REVIEWED_READY_FOR_COMMIT_REVIEW`.**

> Repository/code phase only. **No migration was created or applied. No database was accessed** —
> not production, not staging, not QF-Jarvis. Nothing was pushed or deployed.

Executed at branch `mvp/qf-mvp-20-marketplace-engine-v1`, HEAD
`4bcdcc55c181ca374e93c9093d45c45620379031`, origin synchronized 0/0, worktree clean at start.

---

## 1. The authority this phase migrates onto

```
public.qf_assign_lead_vendors_v2(
  p_lead_id           uuid,
  p_mode              text,
  p_candidate_vendors uuid[],
  p_operation_key     text,
  p_actor_kind        text,
  p_actor_id          uuid,
  p_replacement_ref   uuid,
  p_reason_code       text
) returns jsonb
```

Introduced by the applied, immutable migration
`20260723000300_qf_mvp_canonical_assignment_authority.sql`
(SHA-256 `46ce7377a217a13620305572f1be9038a56c911ce76a556b4d52f91fe107177e`).

| Locked property | Where it is enforced |
|---|---|
| Max **3 active** assignments per lead | `c_active_cap` inside the authority (step 7 + loop guard) |
| Max **6 lifetime** distinct vendors per lead | `c_lifetime_cap`, counted over `assignment_created`/`assigned` lineage |
| Exactly **1 wallet credit** per assignment | `c_credit_cost`, via `qf_apply_credit_mutation_v2` |
| **No caller-controlled ceiling** | the signature has no limit parameter at all |
| `vendor_packages` never debited | the authority only touches the wallet ledger |
| Deterministic operation key → replay | `assignment_operations.idempotency_key` + SHA-256 `request_fingerprint` |
| Reused key + different request → `idempotency_conflict`, zero mutation | step 3a |
| Service-role only | `anon`/`authenticated` hold no execute privilege |

---

## 2. Runtime consumer inventory and classification

Traced across `app/`, `services/`, `lib/`, `components/` — build output (`.next/`),
`node_modules/` and VCS metadata excluded. Classification was confirmed by reading each call
site, not by grep alone.

### MIGRATE_NOW — migrated in this phase

| # | Call site (before) | Legacy RPC | Canonical mode | Actor |
|---|---|---|---|---|
| 1 | `services/leadDeliveryService.ts:54` | `assign_lead_to_paid_vendors_phase26a` | `automatic` | `system` / NULL |
| 2 | `services/leadService.ts:373` (admin path only) | `assign_lead_to_vendors` | `admin_manual` | `admin` / superadmin id |
| 3 | `services/manualLeadAssignmentService.ts:471` | `admin_smart_assign_lead_to_vendors` | `admin_manual` | `admin` / superadmin id |
| 4 | `services/delayedLeadFillService.ts:444` | `admin_smart_assign_lead_to_vendors` | `delayed_fill` | `worker` / NULL |
| 5 | `services/clientRequirementGroupService.ts:371` | `assign_vendor_to_requirement_group` | `delayed_fill` | `worker` / NULL |

Consumer 5's only live caller is `processRequirementAutoFill` — a system fill of the remaining
primary slots after the client-selection window, i.e. genuinely a `delayed_fill` operation by a
worker. Its `assignmentType` argument (`"auto_assigned"`) was the only value ever passed and has
been removed.

### BLOCKED_CLIENT_SELECTED_OWNER_BINDING — fail-closed in this phase

| # | Call site (before) | Legacy RPC | New behaviour |
|---|---|---|---|
| 6 | `app/actions.ts:167` `assignLead` — **PUBLIC, unauthenticated** | `assign_lead_to_vendors` | pinned to `client_selected` → blocked |
| 7 | `services/leadService.ts` default `assignmentType` | `assign_lead_to_vendors` | blocked |
| 8 | `services/preferredVendorLeadService.ts:256` | `assign_lead_to_preferred_vendor` | blocked → `preferred_vendor_pending` + delayed-fill queue |
| 9 | `services/delayedLeadFillService.ts:425` | `assign_lead_to_preferred_vendor` | blocked → fill continues with system vendors |
| 10 | `services/clientRequirementGroupService.ts:619` | `assign_client_selected_vendor_to_group` | blocked → selection recorded as INTENT, auto-fill scheduled |

Every one of these performs **no database round-trip at all** on the blocked path: the block is
decided in `validateCanonicalAssignmentRequest` before an operation key is even constructed. No
assignment, no credit, no ledger row, no lineage event, no communication intent, no shared client
contact.

Consumer 6 also closes the long-standing unauthenticated-assignment gap (QF-MVP-20.1 Blocker H):
that action could previously assign vendors and spend vendor credits with no authenticated caller.

### OUT_OF_SCOPE_WITH_REASON

| Call site | Reason |
|---|---|
| `services/vendorCreditWalletService.ts:53` (`qf_apply_vendor_credit_delta`) | Admin wallet grant/adjustment, not an assignment debit. Its only caller is `services/vendorAdminService.ts:167`. Assignment debits go through the authority's ledger path. |
| `services/packageService.ts:66` (`assign_package_to_vendor`) | Package assignment, not lead assignment. |
| `lib/aos/runtime/leadAssignmentApprovalService.ts` | Preview/approval only; it never assigns. |
| `lib/aos/workflows/leadLifecycle/distribution/leadDistributionAssignmentAdapter.ts` | Delegates to the `assignLeadToMatchedVendors` boundary and therefore inherits consumer 1's migration. Its authoritative read-back of `lead_assignments` is unchanged. |
| `services/vendorService.ts`, `services/adminService.ts`, `services/adminAuditService.ts`, diagnostics/recovery services | Read `lead_assignments` or update non-credit lifecycle fields (`vendor_status`, `is_bad_lead_reported`). They create no assignment and move no credit. |

### LEGACY_COMPATIBILITY_NOT_RUNTIME

`scripts/mvp/staging/validate-staging-baseline.mjs`, `scripts/mvp/staging/validate-qf-mvp-20-3b1.mjs`,
`scripts/mvp/reconciliation/lib/sql.mjs` and the phase harnesses **name** the legacy RPCs in order
to assert schema parity or absence. They never call them and are not runtime code.

### DEAD_OR_TEST_ONLY

`deduct_vendor_credit`, `restore_vendor_credit` and `increment_vendor_credits` have **no `.rpc()`
call site anywhere in the repository**. They exist only inside legacy RPC bodies in the database
and in harness assertions.

---

## 3. What was built

### `lib/marketplace/canonicalAssignmentContract.ts` — the pure half

Dependency-free by construction: no Supabase client, no network, no `Date.now()`, no
`Math.random()`. Holds the mode/actor vocabularies, the locked caps and cost, request validation,
deterministic operation-key construction, and result normalization. This is what the offline test
suite exercises — the real production code, not a copy.

### `services/canonicalAssignmentAuthority.ts` — the single I/O seam

Re-exports the whole contract and adds exactly two runtime functions:

* `executeCanonicalAssignment()` — the **only** place in the repository that invokes the authority,
  through `adminClient()` (service role) only.
* `blockedClientSelectedAssignment()` — the deterministic zero-side-effect blocked result.

**Fail-closed on every abnormal path.** An invalid request, a blocked mode, a missing authority, a
transport error or an unrecognised payload all return a failed `Result`. There is no fallback to a
legacy RPC and no direct credit mutation anywhere in the module.

### Operation-key determinism

```
qf20r1:v1:<mode>:<lead>:<actorKind>:<actorId|->:<replacementRef|->:<reason|->:<scope>:<candidateDigest>
```

The candidate digest is FNV-1a over the **sorted** candidate set, so caller ranking order — a
preference, never authority — cannot change the key. The digest carries no authority of its own:
the database independently computes a SHA-256 `request_fingerprint` over the full normalized
request, so a digest collision can only ever produce an `idempotency_conflict` **rejection**, never
a wrong or duplicated assignment. The key embeds no clock and no random value, so an
infrastructure-level retry of the same logical operation replays instead of assigning twice.

---

## 4. Behaviour changes the founder must know

1. **Client-selected assignment no longer happens anywhere.** A client picking a vendor from its
   public profile now captures the lead, records the selection as an intent, opens the
   selection window and schedules auto-fill — but assigns nothing to that vendor and deducts no
   credit. The system fill (canonical `delayed_fill`) still connects the client with verified
   vendors. Client-facing wording is reassuring and truthful; it never claims an assignment
   happened. This is the R1 known limitation, not a regression to repair by other means.

2. **The admin recovery ceiling of 9 is no longer reachable through assignment.** The authority
   caps every lead at 3 active / 6 lifetime and accepts no caller ceiling.
   `ADMIN_MANUAL_TOTAL_VENDOR_LIMIT` survives only as the admin UI's local
   state/labelling threshold; `p_total_limit` is gone from runtime code entirely.

3. **`adminAssignLead` lost its `allowDuplicate` override** and now binds the acting superadmin as
   the attributed actor. Duplicates are settled inside the authority by the existing
   `UNIQUE (lead_id, vendor_id)` index and reported as per-vendor `duplicate_assignment` skips.

4. **Replay semantics are visible to consumers.** `LeadAssignmentDeliveryResult` and `AssignResult`
   now carry `operation_id`, `reason_code` and `already_applied`. `leadMatchingEngine` treats the
   canonical `already_applied` exactly as it treated the legacy `already_assigned`: it records a
   truthful terminal run and does **not** recreate delivery side effects.

---

## 5. Verification

### Focused tests — `assignment-authority` suite (26 cases, offline, real module)

`scripts/mvp/suites/assignmentAuthority.mjs`, registered in the MVP runner and in `test:mvp`.
Covers the mode/actor vocabularies, the locked caps and cost, the absence of any caller-controlled
ceiling, the `client_selected` block, actor-id rules, replacement XOR reference, candidate-pool
bounds, operation-key determinism and order-independence, and result normalization — including
that an unknown, empty or malformed payload degrades to **rejected**, never to success.

### Repository-wide static proofs — 61 checks

`scripts/qf-mvp-20-3r1-consumer-migration-harness.mjs` (`npm run test:mvp:r1`). Offline,
read-only, no database, no secrets. Every scan runs over a **comment-stripped** (and for negative
claims, **string-stripped**) view of each source file, so prose that merely names a legacy RPC can
never be mistaken for a call to it — the defect class that failed QF-MVP-20.3B1A.

It proves: the four applied migrations and both locked verification artifacts are byte-unchanged;
R1 added no migration; the authority's name is declared once and invoked once, through the
service-role client only; no legacy assignment RPC and no direct credit RPC is called anywhere in
the runtime; no `p_total_limit`/`p_allow_duplicate` survives; every consumer imports the seam and
declares its mode; every blocked path surfaces the block; no `"use client"` module can reach the
seam or the service-role key; and the public `assignLead` action is pinned to the blocked path.

**Load-bearing, not vacuous.** Five checks failed against my own first draft and were corrected
against the evidence. Two adversarial mutations were then injected and both were caught:
reintroducing `adminClient().rpc("assign_lead_to_vendors", …)` tripped checks 03c and 06;
introducing `mode: "client_selected"` tripped check 15. The file was restored byte-identical
afterwards.

### Gates

| Gate | Result |
|---|---|
| `npm run test:mvp:assignment-authority` | **26 passed, 0 failed** |
| `npm run test:mvp:r1` | **61 passed, 0 failed** |
| `npm run verify:mvp` (test:mvp → typecheck → lint → build) | **exit 0** — 3 suites, **66 cases passed, 0 failed**; `tsc --noEmit` clean; `next lint` clean; `next build` succeeded |
| `git diff --check` | **exit 0** |

`npm run test:supabase:lead` was **not** run: it writes to a real database and this phase is
explicitly forbidden from touching one.

---

## 6. R1_BLOCKED_PENDING_OWNER_BINDING — the exact missing prerequisite

The canonical authority must be able to **re-assert, in the database**, that a given client owns a
given lead before it will act on that client's instruction. It cannot:

* `public.leads` has no `client_account_id`, `user_id` or `created_by` column;
* there is no server-created client-selection request row binding an authenticated client, a lead
  and a requested vendor;
* the only available correlation is the lead's phone **text**, and phone equality is explicitly not
  accepted as ownership authority — `public.qf_norm_text` is `lower(trim(...))`, which cannot
  canonicalise a telephone number.

Inventing a phone canonicalisation in the runtime would be a new ownership system the schema
contract never froze, and would weaken authorization purely to make the mode operational. So the
mode fails closed, at two independent layers: the runtime refuses it before any round-trip, and the
authority refuses it before claiming an operation.

**Unblocking requires ONE of, delivered as a reviewed migration:**

1. an explicit lead → client ownership binding column, or
2. a server-created client-selection request row binding the authenticated client, the lead and the
   requested vendor.

Until then no runtime consumer may activate `client_selected`, and no legacy RPC may be used as a
fallback.

---

## 7. Explicitly not done in this phase

Migration **B2** (trigger-based universal lineage immutability), Migration **C** (RLS/policy
repair), legacy-RPC revocation, credit backfill, provider activation, QF-MVP-20.4, deployment, PR
and push. The legacy assignment RPCs still exist in the database; this phase makes them
**unreachable from the runtime**, which is the prerequisite for revoking them later.
