# QF-MVP-40.10B — Wave 1 Owner Review

Offline preparation only. **No Meta API call was made, nothing was submitted, no message was sent,
and no provider mapping, account, runtime policy, webhook or canary was activated.**

Companions: [`meta-wave1-owner-review.json`](provider-manifests/meta-wave1-owner-review.json) ·
[generator](../scripts/mvp/communication/generate-meta-wave1-owner-review.mjs) ·
[validator](../scripts/mvp/communication/validate-meta-wave1-readiness.mjs) ·
[40.10A readiness](QF-MVP-40-10A-META-TEMPLATE-SUBMISSION-READINESS.md)

---

## 1. Wave 0 status

| Fact | State |
|---|---|
| `qf_consent_help_response_v2` submitted | **Yes** — one create POST, WABA identity matched |
| Meta response | **PENDING**, immediate semantic readback succeeded, outcome `CREATED_PENDING` |
| Owner report | **Approved** |
| Machine reconciliation | **DONE — and it contradicted the requested category** |
| Reconciled result | **`APPROVED` but `returned_category: MARKETING`** (requested `UTILITY`) |
| Reconciliation outcome | `RECONCILED_CATEGORY_MISMATCH`, `create_post_count: 0` |
| v2 disposition | **`QUARANTINED_UNMAPPED`** — send and mapping DENIED; not deleted, not appealed |
| Replacement | **`qf_consent_help_response_v3`**, strict Utility, fingerprint `12f98c8b…`, **NOT SUBMITTED** |
| Message sent / mapping / activation | **None** |

**The owner report was not machine-readable evidence — and reconciling it mattered.** The read-only
run proved the remote template is `APPROVED` but classified by Meta as **MARKETING**, not the
requested `UTILITY`. Accepting the owner report at face value would have mapped a marketing-classified
template as the evidence-bound HELP reply. v2 is now quarantined and unmapped, and the strict Utility
`v3` candidate is prepared but **not submitted** — see
[QF-MVP-40.10C](QF-MVP-40-10C-WAVE0-CATEGORY-RECOVERY.md).

**Wave 1 submission remains NOT AUTHORIZED**, and the Wave 0 Utility-category contract is still
unproven. The reconciliation command that produced this result:

```
node scripts/mvp/communication/submit-meta-templates.mjs \
  --wave 0 --template consent_help_response --reconcile-only
```

That mode performs only a WABA identity GET and one exact-name template GET, keeps
`create_post_count` at 0, and returns one closed outcome (`RECONCILED_APPROVED`,
`RECONCILED_PENDING`, `RECONCILED_NOT_FOUND`, `RECONCILED_COLLISION`, `RECONCILED_UNUSABLE_STATUS`,
`RECONCILED_UNKNOWN_STATUS`, `RECONCILED_LOOKUP_FAILED` or `RECONCILED_CATEGORY_MISMATCH`). **No
outcome can be derived from the owner report or from any local file.** It has not been run.

## 2. Why Wave 1 is not submitted as one blind batch

Wave 1 is **14 external templates**. Each one is copy that reaches real clients and vendors, and each
needs its exact body, requested category and fingerprint reviewed before it exists on the WABA.
Submitting fourteen at once would mean fourteen simultaneous unreviewed external artefacts and no
clean stopping point.

So the operator now enforces **one exact internal key per run** (`--template`), refuses a
multi-template wave without it, stops on the first non-success, and never retries. A rejection is
classified deterministically with structured Meta error fields rather than being lost.

## 3. Group A — ordinary launch workflow (11 templates)

Ordinary transactional launch copy. `category_review_decision: REVIEW_REQUIRED`.

| Internal key | Provider name | Category | Buttons | Fingerprint (first 12) | Owner decision |
|---|---|---|---|---|---|
| `clarification_reminder` | `qf_clarification_reminder_v1` | UTILITY | — | `1e7dddd0df8e` | ☐ approve ☐ change |
| `clarification_request` | `qf_clarification_request_v1` | UTILITY | — | `9c484b4d7e54` | ☐ approve ☐ change |
| `client_lead_status_update` | `qf_client_lead_status_update_v1` | UTILITY | — | `ce8982c65251` | ☐ approve ☐ change |
| `client_matching_update` | `qf_client_matching_update_v1` | UTILITY | — | `c0930db5a9be` | ☐ approve ☐ change |
| `consent_start_acknowledgement` | `qf_consent_start_acknowledgement_v1` | UTILITY | — | `70c0ce994180` | ☐ approve ☐ change |
| `consent_stop_acknowledgement` | `qf_consent_stop_acknowledgement_v1` | UTILITY | — | `850a4c01a48b` | ☐ approve ☐ change |
| `lead_assignment_alert` | `qf_lead_assignment_alert_v1` | UTILITY | — | `3f7997be7b8e` | ☐ approve ☐ change |
| `lead_received` | `qf_lead_received_v1` | UTILITY | — | `dd818e01d293` | ☐ approve ☐ change |
| `vendor_new_lead` | `qf_vendor_new_lead_v1` | UTILITY | Accept lead, Decline lead | `64e1e629d71a` | ☐ approve ☐ change |
| `vendor_onboarding_reminder` | `qf_vendor_onboarding_reminder_v1` | UTILITY | — | `c6e95a38dde8` | ☐ approve ☐ change |
| `vendor_response_reminder` | `qf_vendor_response_reminder_v1` | UTILITY | — | `a3833a69b369` | ☐ approve ☐ change |

### Exact copy

**`clarification_reminder`** → `qf_clarification_reminder_v1` · UTILITY · `1e7dddd0df8e`

> Reminder from QuickFurno: please share {{1}} so we can complete your match.

**`clarification_request`** → `qf_clarification_request_v1` · UTILITY · `9c484b4d7e54`

> Hi {{1}}, QuickFurno needs one detail to match you better: {{2}}.

**`client_lead_status_update`** → `qf_client_lead_status_update_v1` · UTILITY · `ce8982c65251`

> Hi {{1}}, the status of your QuickFurno enquiry is now: {{2}}. Reply here if you have any questions.

**`client_matching_update`** → `qf_client_matching_update_v1` · UTILITY · `c0930db5a9be`

> Hi {{1}}, QuickFurno has matched your enquiry with {{2}} verified vendors. They may contact you shortly.

**`consent_start_acknowledgement`** → `qf_consent_start_acknowledgement_v1` · UTILITY · `70c0ce994180`

> QuickFurno: you have been resubscribed to updates about your enquiries. Promotional messages need separate consent. Reply STOP to opt out, or HELP for help.

**`consent_stop_acknowledgement`** → `qf_consent_stop_acknowledgement_v1` · UTILITY · `850a4c01a48b`

> QuickFurno: you have been unsubscribed. We will not send you further updates or promotional messages. Reply START to resume, or HELP for help.

**`lead_assignment_alert`** → `qf_lead_assignment_alert_v1` · UTILITY · `3f7997be7b8e`

> QuickFurno assigned lead {{1}} to you. Please respond promptly.

**`lead_received`** → `qf_lead_received_v1` · UTILITY · `dd818e01d293`

> Hi {{1}}, QuickFurno received your enquiry. We're matching you with verified professionals.

**`vendor_new_lead`** → `qf_vendor_new_lead_v1` · UTILITY · `64e1e629d71a`

> New QuickFurno lead OFFER in {{1}} for {{2}}. This is an offer, not an assignment. Open your dashboard to accept or decline.

> **Buttons:** Accept lead, Decline lead

**`vendor_onboarding_reminder`** → `qf_vendor_onboarding_reminder_v1` · UTILITY · `c6e95a38dde8`

> QuickFurno: your vendor profile is not yet complete. Outstanding item: {{1}}. Complete it in your dashboard to start receiving leads.

**`vendor_response_reminder`** → `qf_vendor_response_reminder_v1` · UTILITY · `a3833a69b369`

> Reminder from QuickFurno: a lead in {{1}} is still awaiting your response. Open your dashboard to accept or decline.


## 4. Group B — commercial reminders (3 templates)

These carry credit / recharge / package-renewal calls to action, so they receive a **separate explicit
category review** before submission. `category_review_decision: HOLD_FOR_EXPLICIT_CATEGORY_REVIEW`.

> **This grouping is a review boundary only.** It does **not** claim these templates are Marketing,
> nor that their current `UTILITY` category is invalid. Nothing about their category has been changed
> here. The point is that a renewal or top-up prompt is the kind of copy most likely to attract a
> Meta category judgement, so the owner should decide deliberately rather than by default.

| Internal key | Provider name | Category | Buttons | Fingerprint (first 12) | Owner decision |
|---|---|---|---|---|---|
| `low_credit_warning` | `qf_low_credit_warning_v1` | UTILITY | — | `e6158d328586` | ☐ approve ☐ change |
| `recharge_reminder` | `qf_recharge_reminder_v1` | UTILITY | — | `fabc95abf66d` | ☐ approve ☐ change |
| `vendor_package_expiry_warning` | `qf_vendor_package_expiry_warning_v1` | UTILITY | — | `91767b9a3214` | ☐ approve ☐ change |

### Exact copy

**`low_credit_warning`** → `qf_low_credit_warning_v1` · UTILITY · `e6158d328586`

> QuickFurno: your credit balance is low ({{1}}). Recharge to keep receiving leads.

**`recharge_reminder`** → `qf_recharge_reminder_v1` · UTILITY · `fabc95abf66d`

> QuickFurno reminder: recharge your credits to continue receiving matched leads.

**`vendor_package_expiry_warning`** → `qf_vendor_package_expiry_warning_v1` · UTILITY · `91767b9a3214`

> QuickFurno: your vendor package expires on {{1}}. Renew in your dashboard to keep receiving leads.


## 5. Required order

1. **Merge no code yet.**
2. Owner reviews the exact Wave 1 packet above.
3. Wave 0 reconciliation has RUN and returned `RECONCILED_CATEGORY_MISMATCH` (approved, but as MARKETING). Before Wave 1, the strict Utility `v3` candidate must be separately authorized, submitted and reconciled to a Utility approval.
4. Authorize a **specific subset** — never the whole wave.
5. Submit **one exact template key at a time**.
6. **Stop on the first non-success.**
7. Reconcile each remote status read-only.
8. Wait for approvals.
9. Seed provider mappings **inactive**, only in a later separately authorized step.
10. **No send and no canary** until mappings and staging gates are ready.

## 6. Current status

```
QF-MVP-40.10B IMPLEMENTATION COMPLETE
WAVE 0 v2 RECONCILED: APPROVED AS MARKETING, NOT UTILITY — QUARANTINED UNMAPPED
WAVE 0 v3 SUBMITTED AND APPROVED AS UTILITY (QF-MVP-40.10D) — APPROVED_UNMAPPED, HELD
WAVE 0 APPROVAL GRANTS PROVIDER CONTRACT ONLY: NO CONSENT, MAPPING, ACTIVATION OR SEND
WAVE 1 OWNER REVIEW PENDING — lead_received RECOMMENDED AS CANARY, NOT AUTHORIZED
WAVE 1 META SUBMISSION NOT AUTHORIZED
WAVE 2/3 NOT AUTHORIZED
NO DEPLOYMENT
```

No Meta approval, staging verification or activation is claimed anywhere in this document.
