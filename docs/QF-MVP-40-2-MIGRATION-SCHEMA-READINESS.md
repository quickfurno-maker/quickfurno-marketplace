# QF-MVP-40.2 — Communication Migration & Schema Readiness

Read-only measurement of the true staging and production state of every communication migration and
Meta/consent/provider-account object QF-MVP-40 depends on.

**Nothing was applied, repaired or created.** No migration was authored or edited, no migration
history was altered, no write of any kind was executed. Every database statement was a `SELECT`.

Measured 2026-07-29 against the two authorised projects only. QF-Jarvis was not accessed.

Artefacts: [`qf-mvp-40-2-readonly-schema-audit.sql`](../scripts/mvp/communication/qf-mvp-40-2-readonly-schema-audit.sql) ·
[`validate-qf-mvp-40-2.mjs`](../scripts/mvp/communication/validate-qf-mvp-40-2.mjs) ·
[`qf-mvp-40-2-schema-matrix.json`](generated/qf-mvp-40-2-schema-matrix.json)

---

## 1. The headline: history and objects disagree everywhere

The single most important result is that **migration history is not evidence of object state in
either environment**, and neither may be inferred from the other.

| | Staging `uckafzuochmbvtiodmcl` | Production `yqpgcsduqbxulrlzwzap` |
|---|---|---|
| History rows | 17 | 4 |
| Latest recorded | `20260728001600` | `20260720000100` |
| Of the 12 communication versions, recorded | **0** | **3** |
| Of the 12, objects present | **11** | **11** |

Staging records **none** of the 12 communication migrations yet carries **all** their objects — its
history is a squash baseline (`20260722000100_qf_mvp_staging_baseline_269c9265`) plus the QF-MVP-20/30
migrations. Production records only `20260713000100`, `20260716000100` and `20260720000100`, yet
carries the objects of eight further migrations applied out of band.

---

## 2. Per-environment classification

| Classification | Staging | Production |
|---|---|---|
| `APPLIED_RECORDED_AND_MATCHING` | 0 | **3** |
| `OBJECTS_PRESENT_UNRECORDED` | **11** | **8** |
| `ABSENT_EXPECTED_PENDING` | **1** | **1** |

The single `ABSENT_EXPECTED_PENDING` in both is `20260721000100`.

---

## 3. Measured drift

### D1 — Staging never applied `20260721000100` *(highest impact)*

Staging history is the squash baseline plus **16 of the 17** cumulative QF-MVP-20/30 migrations.
`20260721000100_communication_consent_ack_intent_provider_account_required` is missing, and the
constraint it creates — `communication_consent_ack_intents_provider_account_req_check` — is
**absent from staging** (confirmed by enumerating every constraint on that table; only the
`provider_account_id` foreign key exists).

**Why it matters:** that migration is **marker 01/17 of the production cutover**, so a constraint
that has never executed against a populated staging database is scheduled to execute against
production. The QF-MVP-20/30 staging validation did not cover it.

**Owner decision required:** validate it on staging before the cutover, or accept it as a
cutover-only risk. This is not a blocker for QF-MVP-40.2 itself.

### D2 — Staging pins a `search_path` the repository does not

`communication_consent_receipt_results_valid` and `communication_consent_receipt_scope_result_valid`
carry `search_path=pg_catalog, public` on staging but are unset on production.

Checking the source settles the direction: migration `20260712000300` declares both as
`language sql` / `immutable` with **no** `set search_path`. So **production matches the repository**
and **staging** carries the extra pin. Benign — an added `search_path` on an immutable SQL function is
hardening, not weakening — but it means the staging baseline is not a faithful reproduction of the
repository schema. **Do not "fix" production to match staging.**

### D3 — `communication_templates` seed drift

Production holds **16** active rows; staging holds **13**. This is the *internal* template catalogue,
distinct from `communication_provider_template_mappings`, which is **0 in both** — so no approved Meta
mapping exists anywhere, consistent with every catalogue entry being `DRAFT_NOT_SUBMITTED`. Reconcile
during 40.4 submission.

### D4 — Runtime policy row exists only in production

Production has one Meta runtime policy row, **fully fail-closed**:

```
activation=disabled; outbound_enabled=false; webhook_processing_enabled=false; health_check_enabled=false
```

with 0 provider accounts and 0 template mappings — so even if a gate were flipped, nothing could send.
Staging has **no policy row at all**, so the 40.10 canary must create one before any gate can be
evaluated.

---

## 4. Relationship to the cumulative 17-migration cutover

**QF-MVP-40.2 creates no second production migration plan.** The existing cumulative QF-MVP-20/30
cutover remains the only production apply path. Every one of the 12 is classified against it:

| Treatment | Count | Migrations |
|---|---|---|
| `ALREADY_PRODUCTION_MATCHING` | 3 | `20260713000100`, `20260716000100`, `20260720000100` |
| `OBJECT_PRESENT_HISTORY_DRIFT_REQUIRES_CUTOVER_RECONCILIATION` | 8 | the eight applied out of band |
| `INCLUDED_IN_CUMULATIVE_17` | 1 | `20260721000100` (marker 01/17) |

For the eight drifted migrations: **do not re-apply them and do not insert history rows.** Their
objects already exist; re-application would fail or duplicate, and a manual history insert is
explicitly prohibited. They are reconciled as part of the existing cutover evidence.

---

## 5. Rollback classification

| Class | Migrations |
|---|---|
| `REVERSIBLE_DDL` | `20260708000170`, `20260708000190`, `20260708000200`, `20260709000100`, `20260709000200`, `20260711000100`, `20260712000300`, `20260713000100`, `20260716000100` |
| `CONSTRAINT_ONLY` | `20260711000200`, `20260720000100`, `20260721000100` |
| `DATA_BACKFILL_REQUIRES_FORWARD_REPAIR` | none |

**No communication migration performs a data backfill.** `20260716000100` adds every
`provider_account_id` lineage column with **zero DML** — which is exactly why those columns are still
`NULLABLE` in both environments, and why account lineage is enforced by *constraints*
(`…_provider_account_required_check` on delivery events, plus the pending one on ack intents) rather
than by column nullability. Rolling back a `CONSTRAINT_ONLY` migration is a constraint drop needing no
data repair.

Sequencing rules that must hold inside the cumulative release: `20260716000100` (lineage columns) must
precede `20260720000100` and `20260721000100` (the constraints over those columns);
`20260713000100` (ack intents) must precede `20260721000100`; `20260712000300` (writer RPC) must
precede `20260713000100`. The repository filename order already satisfies all of these, and the
dependency graph is acyclic and backward-only (validated offline).

---

## 6. What is needed before each next step

**Before 40.3 (Meta configuration)** — schema is **ready**. `communication_provider_accounts`,
`communication_provider_template_mappings`, `communication_provider_runtime_policies` and
`communication_provider_canary_destinations` all exist in production. What is missing is *data*, not
schema: 0 provider accounts, 0 mappings. 40.3 supplies configuration, not DDL.

**Before 40.6 (outbound dispatcher)** — schema is **ready**. The blockers are non-schema: template
keys must be registered in `lib/communication/outboundConsentScope.ts` (its registry blocks unknown
message types) and an approved mapping row must exist. Neither requires a migration.

**Before the staging canary (40.10)** — three items: (a) staging has no runtime policy row; (b)
staging lacks `20260721000100` (D1); (c) no provider account exists in either environment.

---

## 7. Is a new migration required?

**NO** — on current evidence, for QF-MVP-40's schema needs.

Every object QF-MVP-40 depends on already exists in production except `communication_intents` (which
arrives with the cumulative 17 via `20260723000100`) and the pending `20260721000100` constraint.
Nothing QF-MVP-40 requires is missing from the repository migration set, and no gap was found that a
new migration would close.

The remaining work is **configuration, data seeding and code registration**, not DDL. Should a
correction later prove necessary, this phase stops at design evidence — it authors nothing.

---

## 8. Policy checkpoints (recorded, not changed)

| | Policy | Schema-supported | Owner confirmation before Meta activation | Blocks 40.2 | Blocks canary |
|---|---|---|---|---|---|
| A | STOP suppresses **both** marketing and transactional | Yes — `communication_suppressions.scope` | **Yes** | No | No |
| B | START removes suppression but never creates marketing consent | Yes — preferences are a separate authority | **Yes** | No | No |
| C | Acks use internal scope `authentication` so a STOP ack still delivers | Yes — ack intents + 5 worker RPCs present in both | No | No | No |
| D | Meta category for ack templates is `utility` (candidate, not fact) | N/A — a submission-time attribute | **Yes** | No | No |
| E | Catalogue entries remain `DRAFT_NOT_SUBMITTED` | Yes — 0 provider mappings in both environments | No | No | **Yes** |
| F | Campaign dispatch remains QF-MVP-50 | Yes — intents exist, no consumer by design | No | No | No |

A and B are the two worth explicit owner sign-off: a user who sends STOP stops receiving
*transactional* messages too, which is a stricter posture than many operators expect.
