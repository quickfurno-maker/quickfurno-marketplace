# QF-MVP-40.10E — Wave 1 canary closed; next Utility subset prepared

**Status:** Wave 1 `lead_received` CLOSED (approved, unmapped, held). Next three-template Utility
subset PROPOSED, **not authorized**.
**Scope of this task:** offline only. No Meta API call, no submission, no message, no mapping,
no activation, no staging canary, no migration, no deployment.

---

## 1. What was proven

The Wave 1 canary `lead_received` was submitted once and approved by Meta as **UTILITY**.

| Step | Evidence | Result |
| --- | --- | --- |
| Submission | `…WAVE1-META-SUBMISSION-2026-07-30T18-46-18-281Z.json` | `EXECUTE_CREATE` → `CREATED_PENDING`, `create_post_count` **1**, `identity_match` true, semantic readback true |
| Reconciliation | `…WAVE1-lead_received-META-RECONCILIATION-2026-07-31T02-01-53-804Z.json` | `RECONCILE_ONLY` → `APPROVED`, `returned_category` **UTILITY**, `readback_semantic_match` true, `create_post_count` **0**, outcome `RECONCILED_APPROVED` |

Both files were read directly from the operator evidence archive and checked field by field
(26/26) before anything was written; the run fails closed on any mismatch. Neither file records a
message, edit, delete or mapping. Both carry the same `payload_fingerprint`
`dd818e01d293a683b3685f1f246f8cba6b1e4f8e6e106bcab72c4739af640e16`, which also matches the entry
in the generated submission packet — so the thing Meta approved is provably the thing this
repository describes.

Archived-file SHA-256 (recorded for audit; the files themselves are never copied into the repo):

- submission — `099fd0a073bd469da9967d9271d4c4ac326dcb69037fec281128163106090b2f`
- reconciliation — `72091d7191827c887e0b35a536e2b28a8d4f10f05583507e571eb0bc23ad9efb`

### 1.1 What this adds over Wave 0

Wave 0 (`qf_consent_help_response_v3`) proved the Utility contract for a template with **no
variables**. `lead_received` carries one bounded variable, so the approval extends the proven
contract to a **variable-bearing** Utility template — the dimension the Wave 0 proof could not
cover, and the dimension on which the earlier `v2` attempt was recategorised to MARKETING.

### 1.2 What approval does not grant

It proves the **provider contract only**. It creates no consent authority, no mapping authority,
no runtime activation and no send authority. The template is `APPROVED_UNMAPPED` and unsendable,
its creation is **held**, and **no provider template id is committed anywhere in this repository**.
It also authorizes no further Wave 1 submission.

---

## 2. Repository state closed to match

| Artefact | Change |
| --- | --- |
| [remote-state ledger](provider-manifests/meta-template-remote-state.json) | new `qf_lead_received_v1` entry: APPROVED / UTILITY / `APPROVED_UNMAPPED`; send + mapping DENIED; activation + delete NOT_GRANTED; appeal NOT_APPLICABLE; both evidence filenames. All three Wave 0 entries byte-identical. |
| [manifest](provider-manifests/whatsapp-template-submission-manifest.json) | `lead_received` only: `draft → approved`, `DRAFT_NOT_SUBMITTED → APPROVED_UNMAPPED`, `submit_now true → false`, `provider_template_id` stays null. |
| [submission packet](provider-manifests/meta-template-submission-packet.json) | regenerated; wave counts unchanged at 1/14/3/3/4. |
| [Wave 1 owner review](provider-manifests/meta-wave1-owner-review.json) | `PARTIALLY_REVIEWED`; `lead_received` is APPROVED_BY_OWNER / UTILITY_MACHINE_PROVEN / **CONSUMED** / APPROVED_UNMAPPED. Other 13 unchanged. |
| [canary review](provider-manifests/meta-wave1-canary-review.json) | `CLOSED_APPROVED_UNMAPPED`, with the proven remote truth and an explicit denial of resubmission. |
| [next Utility subset](provider-manifests/meta-wave1-next-utility-subset-review.json) | **new** — three proposed templates, all `NOT_AUTHORIZED`. |

Exactly one manifest entry changed. The catalogue now holds **two** approved/unmapped/held
templates — `consent_help_response` and `lead_received` — and 23 still `draft` /
`DRAFT_NOT_SUBMITTED`. Every `provider_template_id` in the catalogue is null.

### 2.1 `CONSUMED`, not `AUTHORIZED`

The owner-review artefact marks a closed entry's `submission_authorization` as **`CONSUMED`**.
That word is deliberate: the one-shot authorization has been *spent*, and the state must not read
as standing permission to submit again. `submit_now: false` enforces the same thing mechanically.

### 2.2 Derived state, not hard-coded state

The packet-generator note and the owner-review generator now **derive** the approved set from the
data instead of naming Wave 0. A note that named one template silently became false the moment a
second was approved; a note that counted entries would go stale on the next approval. Both now name
whatever is actually approved, and rule `P89` fails if the note omits any approved key.

---

## 3. Next exact Utility subset — proposed, not authorized

[meta-wave1-next-utility-subset-review.json](provider-manifests/meta-wave1-next-utility-subset-review.json)
proposes exactly three templates, in this order:

| # | Key | Name | Fingerprint |
| --- | --- | --- | --- |
| A | `client_lead_status_update` | `qf_client_lead_status_update_v1` | `ce8982c652515e2434abb2159a4024a199de54cede0bd1f95552eb8d6270e7ac` |
| B | `client_matching_update` | `qf_client_matching_update_v1` | `c0930db5a9beee61de0076caf234b36f950554bc21c60b697845028a8d057e1c` |
| C | `lead_assignment_alert` | `qf_lead_assignment_alert_v1` | `3f7997be7b8e1b019ba306a058b96f2d68aa84b7a014ea96407510030bb02453` |

All three are UTILITY / `STANDARD_TEXT`, with copy and payloads copied verbatim from the packet.

Why these three: each reports a **specific existing enquiry or assignment event** the recipient is
already party to; none carries a promotion, discount, recharge, renewal or URL; none has a button
or action payload. The selection deliberately avoids the higher-risk families — the evidence-bound
consent acknowledgements, the clarification templates, the quick-reply template, and the three
commercial credit/recharge/expiry templates held for explicit category review.

The operator protocol stays unchanged: one exact key per run, stop on the first non-success, no
retry, reconcile each read-only, and no mapping, activation, canary, send or deployment.

**Submitting any of these three requires separate, explicit owner authorization.** This document
does not provide it, and neither does the artefact.

---

## 4. Operator behaviour

`submit-meta-templates.mjs` is **unchanged** — no defect was found. Its invariants were re-verified
against the comment-stripped source: exactly **one** POST call site, zero `DELETE`/`PUT`/`PATCH`,
zero `/messages` references, no retry path, exact-key selection with ambiguity rejection, and the
reconcile branch ahead of the create.

Dry-run proofs (no network in any of them):

| Command | Result |
| --- | --- |
| `--wave 0` | 1 selected, 0 submittable, 1 held — no `WOULD CREATE` |
| `--wave 1` | 14 selected, **13 submittable, 1 held** (`lead_received`) |
| `--wave 1 --template lead_received` | `HELD / CREATE NOT AUTHORIZED`, no payload preview |
| `--wave 1 --template client_lead_status_update` | `WOULD CREATE` |
| `--wave 1 --template client_matching_update` | `WOULD CREATE` |
| `--wave 1 --template lead_assignment_alert` | `WOULD CREATE` |

---

## 5. Validation

| Gate | Result |
| --- | --- |
| `npm run test:mvp:40-10a` | 153 passed, 0 failed (100 rules, 53 mutation self-tests) |
| Wave 1 readiness validator | 90 passed, 0 failed (52 rules, 38 mutation self-tests) |
| `npm run test:mvp:40-2` | 43 passed, 0 failed |
| `npm run test:mvp:40-3` | 52 passed, 0 failed |
| `npm run test:mvp:40-4` | 37 passed, 0 failed |
| `npm run test:mvp:40-6` | 40 passed, 0 failed |
| `npm run test:mvp:40-8` | 72 passed, 0 failed |
| `npm run test:mvp:communication` | PASS |
| `npm run test:phase5f:d3b` | 93 passed, 0 failed |
| `npm run typecheck` | PASS |
| `npm run test:mvp:build-gate` | PASS |
| `git diff --check` | clean |

New mutation coverage rejects: the canary reverted to draft; `submit_now` set true; a MARKETING
category; `readback_semantic_match` false; a send authority enabled; a provider id added; a changed
evidence filename; a third approved template; a fourth subset template; a reordered subset; a
changed subset payload or fingerprint; a pre-authorized subset entry; a commercial or already-closed
template proposed as "next".

`QF_META_ACCESS_TOKEN`, `QF_META_WABA_ID` and `QF_META_GRAPH_API_VERSION` were verified **absent by
presence check only** — no value was printed, read or cleared.

---

## 6. Status

```
QF-MVP-40.10E IMPLEMENTATION COMPLETE — OFFLINE ONLY
WAVE 0 UTILITY CONTRACT CLOSED
WAVE 1 lead_received APPROVED AS UTILITY — MACHINE PROVEN
WAVE 1 lead_received APPROVED UNMAPPED — CREATE HELD
WAVE 1 NEXT UTILITY SUBSET REVIEW READY
FURTHER WAVE 1 META SUBMISSION NOT AUTHORIZED
WAVE 2/3 NOT AUTHORIZED
NO MAPPING, SEND, STAGING CANARY OR DEPLOYMENT
```

---

## 7. Explicitly NOT done

- No Meta API call, no `--execute`, no live `--reconcile-only`.
- No template created, edited, deleted or appealed — Wave 0 `v2` remains quarantined, intact.
- No WhatsApp message sent.
- No provider mapping, runtime activation, staging canary or deployment.
- No Supabase access, no migration, no n8n work, no VPS change, no `.env` change.
- No PR, merge, tag, rebase, amend or force-push.
- No Wave 1, 2 or 3 submission authorized.
- No remote template id committed; no evidence file copied, staged or committed.
