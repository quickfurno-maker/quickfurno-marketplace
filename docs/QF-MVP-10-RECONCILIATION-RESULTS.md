# QF-MVP-10.8 — Production Reconciliation Results (CLOSEOUT)

**Branch:** `mvp/qf-mvp-10-core-data-truth-v1` · **Reconciliation date:** 22 July 2026 · **Status:** ✅ EXECUTED — production SELECT-only reconciliation complete

## Access mode (read this first)

The production database was inspected on 22 July 2026 through the connected Supabase integration. Every database operation used during reconciliation was **SELECT-only**.

- **The connection itself was NOT technically read-only.** The integration connected as PostgreSQL role `postgres`, and the database reported `transaction_read_only = off`. A write was technically possible over this connection.
- **Read-only behaviour was process-enforced**, not connection-enforced. The founder explicitly approved an operating mode restricting every query to a **SELECT-only allowlist**:

  > APPROVE SELECT-ONLY PRODUCTION RECONCILIATION.
  > STAGING_NOT_PROVISIONED.
  > NO DATABASE CHANGES.

- No `INSERT`, `UPDATE`, `DELETE`, `UPSERT`, `CREATE`, `ALTER`, `DROP`, `TRUNCATE`, `GRANT`, `REVOKE`, migration application, provider operation or deployment was performed.
- **Staging was not provisioned** (`STAGING_NOT_PROVISIONED`). Production was reconciled directly under the SELECT-only allowlist. This is accepted as the QF-MVP-10 staging disposition; it does **not** waive staging for launch (see §J).

Do not restate this as "the connection was read-only." State it accurately: read-only behaviour was **process-enforced through an explicit SELECT-only allowlist** over a connection that was technically writable.

---

## A. Environment

| Fact | Value |
|---|---|
| Project name | QuickFurno |
| Project reference | `yqpgcsduqbxulrlzwzap` |
| Region | `ap-southeast-1` |
| Project status | `ACTIVE_HEALTHY` |
| Database | `postgres` |
| PostgreSQL version | `17.6` |
| Connected integration role | `postgres` |
| `transaction_read_only` | `off` |
| Staging | `STAGING_NOT_PROVISIONED` |

---

## B. Production inventory

| Metric | Value |
|---|---|
| Public base tables | 62 |
| Public functions | 39 |
| SECURITY DEFINER functions | 33 |
| Repository migration count (QF-MVP-10 inventory) | 68 |
| Production migration-history rows | 4 |

Production migration history therefore **materially diverges** from the repository migration ledger. Classification: **`HISTORY_DRIFT`** (see the Migration Ledger doc for the full record).

> **Critical interpretation rule:** an unrecorded migration version is **not** proof that its objects are absent. Several unrecorded migration features are visibly present in the live database — `qf_apply_vendor_credit_delta`, `uq_vendor_credit_logs_reference`, ledger-backed assignment RPC bodies, `apply_communication_consent_command`, consent receipt-validation functions, consent-ack worker functions, and provider-account objects all exist despite the version list holding only 4 rows.

---

## C. Recorded production migrations (4 rows)

| # | Version | Name | Statements | Statements MD5 |
|---|---|---|---|---|
| 1 | `20260624095535` | `sync_vendor_onboarding_fields` | 1 | `cce0116365cc624ca829e081ec9a9ee0` |
| 2 | `20260713000100` | `communication_consent_ack_intents` | 42 | `17104f28552e13292444941a689bf3ab` |
| 3 | `20260716000100` | `communication_provider_account_binding` | 24 | `34340a9f2061088494fa760aa266809f` |
| 4 | `20260720000100` | `communication_delivery_event_provider_account_required` | 1 | `5ad09e6fca9df163f919fcb1ea417d31` |

**No automatic migration command may be run against production** until an approved reconciliation/baseline strategy exists.

---

## D. Active assignment RPC findings

Six assignment RPCs were read (SELECT-only, `pg_get_functiondef` bodies hashed). The material defect is **public/anonymous execution of SECURITY DEFINER assignment functions with no in-body caller authorization.**

### D1. `admin_smart_assign_lead_to_vendors` — BLOCKER
- Signature: `admin_smart_assign_lead_to_vendors(uuid,uuid[],boolean,integer)`
- Definition MD5: `8b64ca6203b9faa1189ddac3521b2a42`
- SECURITY DEFINER; executable by **PUBLIC, anon, authenticated, service_role**
- **No caller admin-authorization check in the function body**
- Caller-provided limit clamped to 1–9
- Uses `deduct_vendor_credit`; uses `restore_vendor_credit` on duplicate compensation
- **Does not write mandatory assignment-linked credit ledger evidence**

### D2. `assign_client_selected_vendor_to_group` — BLOCKER
- Signature: `assign_client_selected_vendor_to_group(uuid,uuid,uuid,integer)`
- Definition MD5: `3bbe5417b13293ca72a4b8526740be21`
- SECURITY DEFINER; executable by **PUBLIC, anon, authenticated, service_role**
- **No lead-ownership or caller-authorization proof**
- Caller-provided limit clamped to 1–9
- Uses legacy debit and restore functions
- **Does not write assignment-linked credit ledger evidence**

### D3. `assign_vendor_to_requirement_group` — BLOCKER
- Signature: `assign_vendor_to_requirement_group(uuid,uuid,uuid,text,integer,text)`
- Definition MD5: `b63b7656ef95832e2fed8fc37a796d6a`
- SECURITY DEFINER; executable by **PUBLIC, anon, authenticated, service_role**
- **No caller authorization check**
- Caller-provided limit clamped to 1–9
- Uses legacy debit and restore functions
- **Does not write assignment-linked credit ledger evidence**

### D4. `assign_lead_to_preferred_vendor` — BLOCKER
- Signature: `assign_lead_to_preferred_vendor(uuid,uuid)`
- Definition MD5: `0138b0ff9dd89a320b73af57e60fe524`
- SECURITY DEFINER; executable by **PUBLIC, anon, authenticated, service_role**
- **No caller authorization or lead-ownership check**
- **Does not check the lead's existing total assignment count**
- **Does not enforce the lifetime-six rule**
- The live body **does not enforce complete city/category compatibility**
- **Writes** assignment-linked credit ledger evidence after success

### D5. `assign_lead_to_paid_vendors_phase26a` — STRONG_CANONICAL_BASE_REQUIRES_CONSOLIDATION
- Signature: `assign_lead_to_paid_vendors_phase26a(uuid,uuid[])`
- Definition MD5: `3ab9c1a04b44ec130f032188d2a7f51f`
- SECURITY DEFINER; **service_role execution only**
- Maximum three successful assignments; duplicate-lead protection; existing-assignment idempotency
- Normalized operational eligibility
- **Mandatory** assignment-linked credit ledger row
- **Lifetime-six rule absent**

### D6. `assign_lead_to_vendors` — REQUIRES_CONSOLIDATION
- Signature: `assign_lead_to_vendors(uuid,uuid[],boolean,text)`
- Definition MD5: `9a9eff43766542aa68d71e0d6860be9b`
- SECURITY DEFINER; **service_role execution only**
- Active maximum capped at three; **mandatory** assignment-linked ledger entry
- **Lifetime-six rule absent**
- **Directly inserts communication records into `whatsapp_logs`** — this side effect must eventually move behind the communication authority rather than remain embedded in assignment authority.

**Summary:** the two `service_role`-only RPCs (D5, D6) are the canonical, ledger-writing base and must be consolidated into a single authority. The four PUBLIC/anon-executable RPCs (D1–D4) are the active authority-bypass **BLOCKERS**.

---

## E. Assignment limits & current data

- `app_settings.max_vendors_per_lead` currently = **4** — configuration drift. Canonical RPCs clamp to three; the setting must be corrected later through an approved change.

Production assignment counts:

| Metric | Value |
|---|---|
| Total assignments | 46 |
| Auto assignments | 34 |
| Client-selected assignments | 7 |
| Admin assignments | 5 |
| Assignments marked `credit_deducted` | 46 |
| Leads above 3 assignments | 0 |
| Leads above 6 unique vendors | 0 |
| Max assignments on one lead | 3 |
| Max unique vendors on one lead | 3 |

Database constraints:
- `UNIQUE (lead_id, vendor_id)` exists
- `lead_assignment_approvals` limits `selected_vendor_count` to 3
- **No** canonical authority enforces 6 lifetime unique vendors
- **No** trigger enforces 3 active vendors
- **No** trigger enforces 6 lifetime unique vendors

Locked founder rules remain: max active vendor assignments per qualified lead = **3**; max lifetime unique vendors per lead = **6**; **one** controlled replacement at a time.

> Current production rows do not violate the intended limit, but several live authority paths are **capable** of violating it.

---

## F. Credit & ledger truth

`qf_apply_vendor_credit_delta` exists.
- Signature: `qf_apply_vendor_credit_delta(uuid, integer, text, text, text, text, text, boolean)`
- Definition MD5: `45ad58beb9cb1dd8ea4f77466909cc0e`
- SECURITY DEFINER; **service_role only**; locks the vendor row; duplicate-reference check after lock; writes `vendor_credit_logs`; returns `already_applied` for duplicate references.

Unique index `uq_vendor_credit_logs_reference` exists: `UNIQUE (reference_type, reference_id) WHERE reference_id IS NOT NULL`.

Production credit evidence:

| Metric | Value |
|---|---|
| Credit log rows | 47 |
| Arithmetic-inconsistent credit log rows | 0 |
| Logs without `reference_id` | 28 |
| Assignment-debit log rows | 19 |
| Invalid-lead refund rows | 0 |
| Vendors with negative remaining credits | 0 |
| Duplicate reference groups | 0 |

**Assignment-ledger gap:** of 46 credit-deducted assignments, **27** lack a matching `reference_type = lead_assignment` / `reference_id = assignment UUID` / `change_type = lead_assignment_debit` row.

| Assignment source | Missing ledger evidence |
|---|---|
| Admin | 5 |
| Automatic | 16 |
| Client-selected | 6 |
| **Total** | **27** |

> **Do not recommend blind backfill.** QF-MVP-20 must design a reviewed historical reconciliation procedure that proves whether a debit actually occurred **before** inserting any historical or compensating ledger evidence.

Legacy credit functions (all violate "every credit mutation requires ledger evidence"):
- `deduct_vendor_credit` — directly decrements credits; burns package remaining leads; **writes no ledger evidence**.
- `restore_vendor_credit` — increments credits and package leads; **no approval input**; **writes no ledger evidence**.
- `increment_vendor_credits` — directly increments balances; **writes no ledger evidence**.

Bad-lead restoration requires authorized approval per the locked rule; the legacy restore path has none.

---

## G. Public monetization exposure — HIGH

The `vendors` table contains `total_credits`, `remaining_credits`, `public_visibility`, `paid_status`, `package_name`, `package_status`, `package_expires_at`.

The **anon** role has `SELECT` privilege on these columns. The public vendor listing RLS policy limits **rows** but does not limit **columns**. Therefore the database currently permits **anonymous reads of monetization fields** on otherwise publicly visible vendor rows.

Locked rule: public vendor pages and payloads must **never** expose package, plan, credits or monetization information.

Required QF-MVP-20 direction:
- Use a public-safe projection/view or a server-owned DTO
- Prevent direct anonymous exposure of monetization columns
- Add automated no-leak regression coverage
- Preserve full data only for authorized vendor/admin/CRM paths

---

## H. Meta & communication state

| Fact | Value |
|---|---|
| Communication provider accounts | 0 |
| Provider runtime policy rows | 1 (`meta_whatsapp_cloud`, channel `whatsapp`, activation `disabled`) |
| Internal communication template catalog | 16 |
| Active internal WhatsApp template definitions | 16 |
| Provider template mappings | 0 |
| Approved active provider mappings | 0 |
| Communication messages | 0 |
| Webhook receipts | 0 |
| Inbound messages | 0 |
| Delivery events | 0 |
| Consent acknowledgement intents | 0 |
| Consent events | 0 |
| Suppressions | 0 |

Meta is **correctly inactive**. The foundation exists, but production is **not** configured for canary or sending.

Consent writer `apply_communication_consent_command` — Definition MD5 `195e3437ddf2b56f60cd3bb446bc70a4`: SECURITY DEFINER, `service_role` only, fixed consent policy version, input validation, deterministic lock ordering, receipt-based replay/conflict handling, marketing + transactional suppression handling, immutable consent evidence.

Consent-ack functions present: `qf_claim_consent_ack_intents`, `qf_reserve_consent_ack_provider_attempt`, `qf_terminalize_consent_ack_intent`, `qf_expire_consent_ack_intents`, `qf_recover_stale_dispatching_consent_ack_intents`.

Provider-account hardening:
- **Present:** provider-account tables; provider-account foreign keys; account-scoped webhook / inbound / delivery indexes; `communication_delivery_events_provider_account_required_check`.
- **Missing:** `communication_consent_ack_intents.provider_account_id` remains **nullable**; the expected acknowledgement provider-account-required check is **absent**.

Classification: **`QF-MVP-40_BLOCKER`**.

---

## I. RLS, grants & triggers

- Communication authority tables: RLS enabled; no anon/authenticated policies; service-role access; fail-closed for normal client roles.
- Core tables carry older broad table grants, with RLS acting as the row-level boundary.
- **Primary authority defect:** public/anonymous execution of SECURITY DEFINER assignment functions (§D1–D4).
- **No reviewed trigger** enforces assignment-max-3, lifetime-unique-max-6, or mandatory credit-ledger evidence.

---

## J. Staging decision

**`STAGING_NOT_PROVISIONED`** — accepted as the staging disposition for QF-MVP-10 closure. It does **not** waive staging for launch. A separate Supabase staging project or an approved development branch is **mandatory** before: applying database remediation migrations, migration rehearsal, Meta canary, n8n canary, QF-MVP-80 launch rehearsal, and the Pune production launch.

---

## Completion decision

The read-only, process-enforced SELECT-only production reconciliation is **complete**. Every founder-locked reconciliation question is now answered against live production evidence. **QF-MVP-10 is COMPLETE.** The remediation these findings require is the opening scope of **QF-MVP-20** (see `QF-MVP-10-CLEANUP-PLAN.md` §20.A–20.E) — no remediation was performed in this documentation task.
