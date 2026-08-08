# QF-MVP-50.3 — Vendor Workflows

**Status:** **SOURCE READY** — producers and dispatch authority only.
**NOT staging certified. NOT live-provider ready. NOT complete.**

Three distinct states are tracked separately and must never be conflated:

| State | Meaning | 50.3 today |
|---|---|---|
| SOURCE READY | contracts and producers exist, gates green, migration written | **yes** |
| STAGING CERTIFIED | migration applied and behaviour observed on staging | no |
| LIVE PROVIDER READY | an approved template + mapping + provider account exists | no — owned by QF-MVP-40 / QF-MVP-80 |

## 1. The active vendor action set

Exactly five actions are producible. All five already exist in the frozen 14-action requestability registry — **no action type was added**, and the canonical names are used exactly.

| Action | Source event | Schedule | Dedupe identity | Execution-time reproof |
|---|---|---|---|---|
| `vendor.lead_offer` | `lead_assignments` INSERT | immediate | assignment id + `assigned` | assignment still valid |
| `vendor.response_reminder` | same assignment | **+2 h** and **+24 h** | assignment id + `resp2h` / `resp24h` | assignment exists **and** `vendor_status` is still exactly `'New'` |
| `vendor.onboarding_reminder` | `vendor_crm_profiles` INSERT at stage `'new'` | **+24 h**, exactly one | vendor id + `onbnew24h` | `onboarding_stage` is **still** `'new'` |
| `vendor.package_expiry_warning` | `vendors.package_expires_at` change while `package_status = 'active'` | **−7 d** and **−1 d** | vendor id + window + exact expiry instant | `package_expires_at` still equals the source expiry identity and the package is still eligible |
| `vendor.low_credit_warning` | `remaining_credits` crossing the configured threshold | immediate | vendor + old/new balance + txid | current `remaining_credits` is still `<=` the **currently configured** threshold |

A stale action is a **pre-communication non-send**: no communication row, no provider contact, no fabricated evidence.

## 2. `vendor.document_reminder` — REGISTERED_BUT_NOT_PRODUCIBLE

**Reason: `NO_CANONICAL_VENDOR_DOCUMENT_DOMAIN`.**

QuickFurno has no vendor document/KYC domain — no documents table, no document status vocabulary, no document expiry column, no required-document concept — and KYC/document storage is explicitly out of scope in the CRM foundation. There is therefore no truthful trigger.

Rather than invent document truth, the action stays in the frozen registry and is made **unproducible by construction**: the database producer raises `QF_PRODUCER_VENDOR_DOCUMENT_DOMAIN_ABSENT`, the dispatch authority records the reason, the validator asserts it positively, and the migration **aborts** if a `vendor_documents` table ever appears so the decision must be revisited rather than silently drift. A future, separately authorized phase that builds a real document domain can activate it through a governed change.

## 3. No vendor accept / reject — permanent

QuickFurno has **no** accept, reject or decline concept for an assigned lead, and must never gain one.

- `vendor.lead_offer` is a **ONE-WAY transactional assignment notification**. It never asks the vendor to accept or reject, creates no decision state, exposes no decision endpoint, and is never measured as an acceptance or rejection rate.
- `vendor.response_reminder` means **only** "an assigned lead has not progressed past `vendor_status = 'New'`". It is a contact/progress nudge. Its copy must use transactional language such as *a newly assigned lead is still pending review or contact* — never "accept", "reject" or "respond yes/no".
- `vendors.accepting_leads` is an **availability toggle** (does this vendor currently want new enquiries) and is unrelated.

The validator carries dedicated assertions and mutants for every one of these phrases, and prose may only ever *prohibit* the concept.

## 4. The low-credit threshold is config-driven

The owner-locked threshold is **3 remaining credits**, and it lives in the existing `automation_policy_configs` authority under policy key `vendor_low_credit_warning_threshold` (version `vendor_low_credit_warning_threshold_v1`).

It is deliberately **not** a constant in automation runtime code. A single reader, `qf_vendor_low_credit_threshold_v1()`, serves both produce time and execution-time reproof so the two can never disagree. An unconfigured threshold warns **nothing** — there is no literal fallback.

A warning requires a **real crossing**: `OLD > threshold` **and** `NEW <= threshold`. So `2 → 1` and `1 → 0` warn nothing. A recharge back above the threshold **re-arms** the warning, and a later genuine crossing is a new action because the crossing identity is stamped per crossing.

The pre-existing `remaining_credits <= 3` expressions in admin/UI read code are historical supporting evidence only; this package does not refactor them and they are not the send policy.

## 5. Producer atomicity

Every vendor action is produced by a DB-native, same-transaction trigger writing through the adopted QF-MVP-50.1B request → decision → job writers. There is no TypeScript fire-and-forget producer: business truth and automation intent commit together or roll back together.

Schema impact is nil — no table, column, index or type is created or altered. `uq_automation_action_requests_idempotency` and `uq_automation_jobs_action_request` remain the dedupe authorities.

## 6. Core owns everything n8n must not

Core owns vendor identity, contact resolution (`whatsapp_number` else `phone`, via the existing recipient resolver), package truth, credit truth, onboarding stage, consent and suppression, template intent, and action eligibility.

n8n may never choose a vendor, a phone number, a package, a credit mutation, a template, a provider or a consent outcome, and performs no direct business-table write. The producer signature accepts none of those inputs.

## 7. Boundaries

**QF-MVP-50.5** owns the due sweep, `retry_scheduled` recovery, stale leases and dead-letter handling. None of it is implemented here, and the fresh-claim selector's exclusion of `retry_scheduled` is untouched.

**QF-MVP-40 / QF-MVP-80** own live channel and provider readiness. Template keys in the dispatch authority are Core dispatch **intent** only — never proof that an approved provider template or an active mapping exists. Execution still fails closed at the existing runtime gates, and no provider state is changed by this package.

## 8. Family-aware claim routing (shared substrate repair)

The signed claim was **family-blind**: the workflow family was derived only *after* an irreversible claim. Because a claim commits `processing`, burns the job's single permitted `claim_v1` row, and `processing -> pending` is not a legal transition, a workflow that took another family's job would **permanently strand it**. Latent while only the client executor existed; unacceptable once vendor and campaign executors share the queue.

Migration `20260811000000_qf_mvp_50_3_50_4_family_aware_claim_routing.sql` fixes it by **prevention, never reversal**:

- a canonical SQL `action -> workflow family` map over the frozen 14-action registry, validator-pinned against the TypeScript registry; an unknown action maps to `NULL` and every caller fails closed;
- the **legacy** `qf_claim_automation_job_v1(text)` keeps its exact signature, return shape, fresh-pending semantics, `retry_scheduled` exclusion, ordering, lease and attempt behaviour — but its selector is now fenced to `client_whatsapp`, so the shipped client route and workflow are unchanged and can no longer consume vendor or campaign work;
- `qf_claim_automation_job_for_family_v1(worker, family)` takes **exactly one** family — no array, wildcard, comma list or "all", and `NULL` is not "any";
- `qf_claim_automation_job_transport_for_family_v1` keeps route identity `claim_v1`. The family travels in the request body, so it is already inside the canonical body hash: a same-`requestId` call under a different family **conflicts** rather than inheriting the claim.

The claim route accepts exactly two shapes — the byte-compatible legacy three-key body, and a four-key body adding only `workflowFamily`. No caller-supplied action allowlist is accepted anywhere.

**Deliberately absent:** no release, no unclaim, no `processing -> pending`, no claim-row deletion, no extra attempt, no due sweep, no stale-lease recovery. Those remain QF-MVP-50.5. The one-claim-per-job uniqueness and the `retry_scheduled` exclusion are unchanged.

## 9. What remains before QF-MVP-50.3 can be called COMPLETE

The vendor **execution route** (`vendor_whatsapp` family) and the inactive vendor n8n executor workflow are not part of this source slice — the family-aware claim they require is now in place, and neither is staging certification. Until those exist and are certified against staging, 50.3 is SOURCE READY only.
