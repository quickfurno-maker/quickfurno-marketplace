# QF-MVP-50.2C-P0 — `clarification_reminder` Draft Contract Correction

**Status:** IMPLEMENTATION CANDIDATE
**Base:** `main` @ `ba76fc9c6c4dc3c6a9743a0da6d8600d7019503f`
**Scope:** local draft provider-contract candidate only
**Meta calls:** NONE
**Provider submission:** NONE
**Remote state changed:** NONE

## 1. Why this correction exists

QF-MVP-50.2C stopped before creating a branch because the reviewed local candidate for
`clarification_reminder` contradicted the business binding 50.2C needs.

Old candidate body:

```text
Reminder from QuickFurno: please share {{1}} so we can complete your match.
```

Old payload fingerprint: `1e7dddd0df8ea054c19e048bf0892eca2078473a46449a4b0b516a91dc145789`

Two problems, not one:

1. **Arity.** The candidate declared **one** positional parameter. The 50.2C client dispatch
   contract requires two (`client_name`, `outstanding_item`), matching `clarification_request`.
2. **Internally contradictory binding.** The sentence "please share `{{1}}`" reads as the
   *outstanding item*, but the declared example value was `"Asha"` — a client *name*. The single
   existing parameter therefore had no determinable meaning, and guessing would have produced
   messages such as "please share Asha".

## 2. Owner decision

Two explicit parameters. New body:

```text
Hi {{1}}, just a reminder from QuickFurno: please share {{2}} so we can complete your match.
```

| position | source key | example fixture |
|---|---|---|
| 1 | `client_name` | `Asha` |
| 2 | `outstanding_item` | `preferred budget range` |

New payload fingerprint: `87c5420a8d97ab4de45e6c34eb0312cf957a9c53b28435cfeb3ffe3ce92f1474`

This mirrors `clarification_request`, which already binds `client_name` + `outstanding_item` at the
same positions. `client_nurture_followup` is untouched and remains MARKETING-scoped; it is never
reused for a transactional action.

The correction was safe to make now precisely because the template had never been submitted — no
approved remote contract was rewritten and no resubmission is required.

## 3. What changed

Canonical source of truth: `docs/provider-manifests/whatsapp-template-submission-manifest.json`.
Exactly three fields on the single `clarification_reminder` entry: `body_spec`, `variables_schema`,
and `qf_mvp_40.example_fixture`. Every derived artifact was then produced by its own existing
deterministic generator, never hand-edited:

| artifact | generator |
|---|---|
| `meta-template-submission-packet.json` | `generate-meta-template-submission-packet.mjs` |
| `meta-wave1-owner-review.json` | `generate-meta-wave1-owner-review.mjs` |
| `meta-template-inactive-mapping-readiness.json` | `generate-meta-inactive-mapping-readiness.mjs` |

The readiness artifact regenerated only because it stores source-file fingerprints; exactly two leaf
fields changed (`source_manifest_fingerprint`, `source_packet_fingerprint`) and it contains no
`clarification_reminder` entry at all.

## 4. What deliberately did NOT change

- `approval_status` stays `draft`; `submission_state` stays `DRAFT_NOT_SUBMITTED`;
  `provider_template_id` stays `null`.
- `owner_copy_decision` stays `PENDING_OWNER_REVIEW`; `category_review_decision` stays
  `REVIEW_REQUIRED`; `submission_authorization` stays `NOT_AUTHORIZED`;
  `remote_submission_state` stays `NOT_SUBMITTED`.
- `provider_template_name_candidate`, `category`, `component_profile`, `submission_wave` and
  `submit_now` are all preserved.
- `binding_contract.binding_readiness` remains `unresolved`. This correction fixes the **provider
  payload arity and semantics**; it does not make the source-key binding code-authoritative. That
  happens in QF-MVP-50.2C when the business variable builder is added.
- `meta-template-remote-state.json` is untouched — `clarification_reminder` has no remote record and
  none was fabricated.
- No approved or consumed template drifted: of 25 packet entries, only `clarification_reminder`
  changed, and all 8 approved/held entries are byte-identical.

## 5. Authority granted by this correction

None. Explicitly: zero Meta calls, zero submission authorization, zero provider mapping authority,
zero send authority, zero activation authority. Wave 1 remains blocked pending owner decision.

## 6. Relationship to QF-MVP-50.2C

This unblocks the 50.2C client dispatch authority contract by removing the arity/semantic conflict
for `client.missing_information_reminder → clarification_reminder`. The actual source-key code
binding, the client dispatch registry, the lead recipient type and the `workflowFamily` envelope
addition all remain part of 50.2C and are **not** begun here.
