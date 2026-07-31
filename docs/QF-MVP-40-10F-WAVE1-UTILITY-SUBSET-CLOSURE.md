# QF-MVP-40.10F — Wave 1 Utility subset closed; next review set prepared

**Status:** three more Wave 1 templates CLOSED (approved, unmapped, held). Second three-template
Utility subset PROPOSED, **not authorized** — *since superseded: that subset was approved and closed
in [QF-MVP-40.10G](QF-MVP-40-10G-WAVE1-SUBSET2-CLOSURE.md), which also PAUSED further submission.*
**Scope of this task:** offline only. No Meta API call, no submission, no message, no mapping,
no activation, no staging canary, no migration, no deployment.

---

## 1. What was proven

Three templates were each submitted **exactly once** and approved by Meta as **UTILITY**.

| Template | Submission | Reconciliation |
| --- | --- | --- |
| `client_lead_status_update` → `qf_client_lead_status_update_v1` | `EXECUTE_CREATE` → `CREATED_PENDING`, 1 POST | `RECONCILE_ONLY` → `APPROVED` / UTILITY, 0 POST |
| `client_matching_update` → `qf_client_matching_update_v1` | `EXECUTE_CREATE` → `CREATED_PENDING`, 1 POST | `RECONCILE_ONLY` → `APPROVED` / UTILITY, 0 POST |
| `lead_assignment_alert` → `qf_lead_assignment_alert_v1` | `EXECUTE_CREATE` → `CREATED_PENDING`, 1 POST | `RECONCILE_ONLY` → `APPROVED` / UTILITY, 0 POST |

Every record carries `identity_match: true` and `readback_semantic_match: true`, and none contains
a message, edit, delete or mapping field. Each payload fingerprint matches the entry in the
generated submission packet, so what Meta approved is provably what this repository describes.

### 1.1 The six evidence files

Read directly from the operator evidence archive and checked field by field — **0 failures across
all six**, fail-closed on any mismatch. None is copied into the repository.

| SHA-256 | File |
| --- | --- |
| `f1e549e1be2b12ed3e7cf5d166c2015382753cced1faa65d17b48f552d9bb546` | `QF-MVP-40-WAVE1-META-SUBMISSION-2026-07-31T03-44-23-042Z.json` |
| `c890552857845e252091dfca5522279d4bce782a787323c59ccd093e88b54129` | `QF-MVP-40-WAVE1-client_lead_status_update-META-RECONCILIATION-2026-07-31T03-50-23-839Z.json` |
| `8995bee48d82d819c5f18c64f0c87d91571bc1e759ff279a63ef02800ffd9e69` | `QF-MVP-40-WAVE1-META-SUBMISSION-2026-07-31T04-02-38-833Z.json` |
| `5ae97e6d79476be94fda19740da3e36757f3b04747a462f4909345397cac0c9f` | `QF-MVP-40-WAVE1-client_matching_update-META-RECONCILIATION-2026-07-31T04-22-20-119Z.json` |
| `2df66d09e38a0e23c62cfeaffefc3f4539d3b3d871f500cb9c22c57d1f3e250d` | `QF-MVP-40-WAVE1-META-SUBMISSION-2026-07-31T05-55-04-970Z.json` |
| `fc27c0f838f681159ded573017079736264c64f29dd1844eb9480158981ba723` | `QF-MVP-40-WAVE1-lead_assignment_alert-META-RECONCILIATION-2026-07-31T06-13-53-155Z.json` |

The `lead_assignment_alert` **submission filename was not supplied** — it was discovered from the
archive by parsing every `QF-MVP-40-WAVE1-META-SUBMISSION-*.json` and selecting the one whose
`internal_template_key` / `provider_template_name` matched exactly. Four submission records were
scanned and exactly **one** matched (`…2026-07-31T05-55-04-970Z.json`); zero or multiple matches
would have failed closed.

### 1.2 What approval does not grant

Each approval proves the **provider contract only**. None creates consent authority, mapping
authority, runtime activation or send authority. Every template is `APPROVED_UNMAPPED` and
unsendable, creation is **held**, and **no provider template id is committed anywhere in this
repository**. No further submission is authorized.

---

## 2. Closed state

The approved / unmapped / held set is now exactly **five**:

1. `consent_help_response` (wave 0)
2. `lead_received` (wave 1)
3. `client_lead_status_update` (wave 1)
4. `client_matching_update` (wave 1)
5. `lead_assignment_alert` (wave 1)

The remaining **20** templates are unchanged: `draft` / `DRAFT_NOT_SUBMITTED`, with every
`provider_template_id` null. Exactly three manifest entries changed. Wave counts remain
**1/14/3/3/4**, total 25. The ledger now holds seven entries — two Wave 0 history records plus the
five closed ones — and the four pre-existing entries are byte-identical.

Wave 1 owner review is **`PARTIALLY_REVIEWED`**: total 14, approved_unmapped **4**,
pending_owner_review **10**, ordinary launch 11, commercial category review 3. Each closed entry is
`APPROVED_BY_OWNER` / `UTILITY_MACHINE_PROVEN` / **`CONSUMED`** / `APPROVED_UNMAPPED`.

The first three-template subset review is now `CLOSED_APPROVED_UNMAPPED`, recording each template's
proven remote truth and its own two evidence filenames, and explicitly denying resubmission,
mapping, activation, send and deployment.

### 2.1 Closed records are not re-pinned to a moving packet

A review artefact pins the source-packet fingerprint so an owner reviews it against *today's*
packet. Once the artefact is **closed** that pin becomes a historical record, and rewriting it on
every later packet change would destroy exactly what it documents — the same reason ledger history
is never rewritten. So the rule now distinguishes the two: an **open** artefact must pin the current
packet exactly; a **closed** one must carry a well-formed historical hash. Content integrity is not
waived — a closed artefact must still quote the current packet **verbatim**, so drifted copy is
still rejected (proven by mutation `M18`).

---

## 3. Next Utility subset — proposed, not authorized

[meta-wave1-next-utility-subset-2-review.json](provider-manifests/meta-wave1-next-utility-subset-2-review.json)
proposes exactly three templates, in this order:

| # | Key | Name | Fingerprint |
| --- | --- | --- | --- |
| 1 | `consent_stop_acknowledgement` | `qf_consent_stop_acknowledgement_v1` | `850a4c01a48b78e237a85e186a448d8395abfb1e5049aaf6d8176b8628747268` |
| 2 | `consent_start_acknowledgement` | `qf_consent_start_acknowledgement_v1` | `70c0ce994180c2ea62ff3413d12d460734f5c004c40eb4d056925feec7e7251a` |
| 3 | `vendor_onboarding_reminder` | `qf_vendor_onboarding_reminder_v1` | `c6e95a38dde899f717999520082feddf4c91f2a33c84650c72538ef2c111199a` |

All three are UTILITY / `STANDARD_TEXT`, copied verbatim from the packet.

Sequence rationale: the STOP acknowledgement is the direct reply to a user STOP action; the START
acknowledgement is the direct reply to a user START action and **states explicitly that promotional
messages need separate consent** (pinned by rule `P104`); the vendor onboarding reminder is tied to
an existing vendor profile and an outstanding required item. None carries discount, recharge or
renewal language, an external URL, or marketing campaign copy.

Excluded this round — **sequencing, not rejection**: `clarification_request`,
`clarification_reminder`, `vendor_new_lead`, `vendor_response_reminder`. The three commercial
templates — `low_credit_warning`, `recharge_reminder`, `vendor_package_expiry_warning` — remain
**separately held for explicit category review**.

**Submitting any of these three requires separate, explicit owner authorization.** Neither this
document nor the artefact provides it.

> **Superseded by [QF-MVP-40.10G](QF-MVP-40-10G-WAVE1-SUBSET2-CLOSURE.md).** That authorization was
> subsequently given: all three were submitted once and reconciled read-only to **APPROVED as
> UTILITY**. They are now `APPROVED_UNMAPPED` and HELD, their authorizations are CONSUMED, and the
> subset-2 artefact is `CLOSED_APPROVED_UNMAPPED`. Further template submission is now **PAUSED**:
> no subset 3 exists, and the remaining 7 Wave 1 templates are deferred until required.

---

## 4. Operator behaviour

`submit-meta-templates.mjs` is **unchanged** — no defect was found. Invariants re-verified against
the comment-stripped source: exactly **one** POST call site, zero `DELETE`/`PUT`/`PATCH`, zero
`/messages` references, no retry path, exact-key selection with ambiguity rejection, reconcile
branch ahead of create, and the `create_post_count` invariants.

| Command | Result |
| --- | --- |
| `--wave 0` | 1 selected, 0 submittable, 1 held |
| `--wave 1` | **14 selected, 10 submittable, 4 held** |
| `--template lead_received` | `HELD / CREATE NOT AUTHORIZED`, `approval=approved submission=APPROVED_UNMAPPED` |
| `--template client_lead_status_update` | `HELD / CREATE NOT AUTHORIZED`, same state line |
| `--template client_matching_update` | `HELD / CREATE NOT AUTHORIZED`, same state line |
| `--template lead_assignment_alert` | `HELD / CREATE NOT AUTHORIZED`, same state line |
| `--template consent_stop_acknowledgement` | `WOULD CREATE` |
| `--template consent_start_acknowledgement` | `WOULD CREATE` |
| `--template vendor_onboarding_reminder` | `WOULD CREATE` |

No held template printed `WOULD CREATE` or a payload preview. No network call in any run.

---

## 5. Validation

| Gate | Result |
| --- | --- |
| `npm run test:mvp:40-10a` | 169 passed, 0 failed (104 rules, 65 mutation self-tests) |
| Wave 1 readiness validator | 97 passed, 0 failed (55 rules, 42 mutation self-tests) |
| `npm run test:mvp:40-2` | 43 passed, 0 failed |
| `npm run test:mvp:40-3` | 52 passed, 0 failed |
| `npm run test:mvp:40-4` | 39 passed, 0 failed |
| `npm run test:mvp:40-6` | 42 passed, 0 failed |
| `npm run test:mvp:40-8` | 72 passed, 0 failed |
| `npm run test:mvp:communication` | PASS |
| `npm run test:phase5f:d3b` | 93 passed, 0 failed |
| `npm run typecheck` | PASS |
| `npm run test:mvp:build-gate` | PASS |
| `git diff --check` | clean |

Ledger rules are now **table-driven** over the closed set, so closing another template is one row
rather than a copied block — and a dropped row changes the pinned count and fails.

Mutation coverage rejects: any approved key reverted to draft or re-armed for creation; a provider
id added; the approved set gaining **or losing** a key; a returned category of MARKETING; a semantic
mismatch; a zero-POST submission claim or a second reconciliation POST; a granted send or mapping
authority; a changed evidence filename; two closed entries sharing one evidence file; an added or
dropped ledger entry; subset 1 reverted to pending or re-authorized; a fourth subset-2 key;
reordering; an edited payload or stale fingerprint; a commercial, already-closed or explicitly
excluded template leaking in; a URL in subset copy; a subset claiming it authorizes calls; dropping
the commercial-hold statement; and a START acknowledgement that drops the promotional-consent
carve-out.

`QF_META_ACCESS_TOKEN`, `QF_META_WABA_ID` and `QF_META_GRAPH_API_VERSION` were verified **absent by
presence check only** — no value was printed, read or cleared.

---

## 6. Status

```
QF-MVP-40.10F IMPLEMENTATION COMPLETE — OFFLINE ONLY
WAVE 0 UTILITY CONTRACT CLOSED
FOUR WAVE 1 UTILITY TEMPLATES APPROVED — MACHINE PROVEN
FIVE TOTAL MANIFEST TEMPLATES APPROVED UNMAPPED — CREATE HELD
WAVE 1 NEXT UTILITY SUBSET 2 REVIEW READY
FURTHER META SUBMISSION NOT AUTHORIZED
WAVE 2/3 NOT AUTHORIZED
NO MAPPING, SEND, STAGING CANARY OR DEPLOYMENT
```

---

## 7. Explicitly NOT done

- No Meta API call, no `--execute`, no live `--reconcile-only`.
- No template created, edited, deleted or appealed — Wave 0 `v2` remains quarantined, intact.
- No WhatsApp message sent.
- No provider mapping, provider account activation, runtime activation, staging canary or deployment.
- No Supabase access, no migration, no n8n/Jarvis work, no VPS change, no `.env` change.
- No PR, merge, tag, rebase, amend, squash or force-push.
- No Wave 1, 2 or 3 submission authorized.
- No remote template id committed; no evidence file copied, staged or committed.
