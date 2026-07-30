# QF-MVP-40.10D — Wave 0 Utility contract closed; Wave 1 canary prepared

**Status:** Wave 0 CLOSED (approved, unmapped, held). Wave 1 canary RECOMMENDED, **not authorized**.
**Scope of this task:** offline only. No Meta API call, no submission, no message, no mapping,
no activation, no migration, no deployment.

---

## 1. What actually happened to Wave 0

Wave 0 was a single no-variable utility template — the smallest thing that proves the Meta
template *contract* (token, WABA, endpoint, name, language, category, response handling) without
proving, or granting, anything about sending.

It took three attempts. All three are recorded permanently in
[meta-template-remote-state.json](provider-manifests/meta-template-remote-state.json).

| Name | Requested | Meta returned | Disposition |
| --- | --- | --- | --- |
| `qf_consent_help_response_v1` | UTILITY | created PENDING, then **deleted by the former partner** | `RETIRED_DELETED_BY_FORMER_PARTNER` |
| `qf_consent_help_response_v2` | UTILITY | **APPROVED as MARKETING** | `QUARANTINED_UNMAPPED` |
| `qf_consent_help_response_v3` | UTILITY | **APPROVED as UTILITY** | `APPROVED_UNMAPPED` |

v1 was created PENDING and then deleted from the WhatsApp Manager by the former AiSensy partner
integration (Meta Activity Log). AiSensy access was removed; v1 is retired and is not reused.

v2 was created PENDING and Meta approved it — but recategorised it to **MARKETING**, not the
requested UTILITY. A consent/HELP acknowledgement delivered under a marketing category is the
wrong contract, so v2 was quarantined rather than used: send and mapping DENIED, and it is
**neither deleted nor appealed** (QF-MVP-40.10C). Deleting or appealing it remains a separate,
explicitly authorized decision.

v3 was submitted under QF-MVP-40.10C with exactly one `POST`, returned `CREATED_PENDING`, and was
then reconciled **read-only** (zero create calls) to `APPROVED` with `returned_category: UTILITY`
and `readback_semantic_match: true`.

### 1.1 The two evidence files

Both live outside the repository and are **not committed** (they are operator run records, and
the reconciliation record quotes remote identifiers):

- `QF-MVP-40-WAVE0-META-SUBMISSION-2026-07-30T17-24-12-392Z.json`
- `QF-MVP-40-WAVE0-consent_help_response-META-RECONCILIATION-2026-07-30T17-48-51-026Z.json`

Both were read directly and cross-checked before the ledger was written. Rule **P84** pins their
exact filenames, so the ledger cannot later cite an evidence file that was never produced.

### 1.2 What approval does and does not grant

Meta approving `qf_consent_help_response_v3` as UTILITY proves the **provider contract only**.

It does **not** grant:

- ordinary consent authority — the consent acknowledgement keys remain deliberately absent from
  `lib/communication/outboundConsentScope.ts`, and that absence *is* the mechanism;
- mapping authority — no provider mapping row exists or is authorized;
- runtime activation — the account, policy, webhook and canary gates are untouched;
- send authority — no WhatsApp message is authorized by this phase.

The ledger states this in `notes`, and rules **P83** and **P85** fail if a later phase quietly
rewrites the entry to imply otherwise.

---

## 2. Local state closed to match

The manifest and packet previously asserted that *every* entry was draft. That is no longer true,
and leaving it in place would have been a false claim in the audited record.

`consent_help_response` in
[whatsapp-template-submission-manifest.json](provider-manifests/whatsapp-template-submission-manifest.json)
now reads:

| Field | Before | After |
| --- | --- | --- |
| `approval_status` | `draft` | `approved` |
| `submission_state` | `DRAFT_NOT_SUBMITTED` | `APPROVED_UNMAPPED` |
| `submit_now` | `true` | `false` |
| `provider_template_id` | `null` | `null` *(unchanged — no remote id is ever committed)* |

`submit_now` flipping to `false` is the important half: the template is **held from creation**, so
the operator can never re-create an already-approved template.

Everything else about the entry — candidate name, language, category, body, registry expectation,
consent scope, suppression, authority path, component profile and wave — is byte-identical.
The other 24 templates remain `draft` / `DRAFT_NOT_SUBMITTED`.

### 2.1 Closed state model, not a relaxation

The packet validator's old `nothingApproved` rule would now fail, and the tempting fix — deleting
it — would have silently removed the guard that stops an unexpected approval appearing anywhere.
It was replaced with a **closed state model** (`P15`):

- Wave 0 must be exactly `approved` + `APPROVED_UNMAPPED` + `submit_now: false`;
- every other template must be exactly `draft` + `DRAFT_NOT_SUBMITTED`;
- **no** entry may ever carry a non-null `provider_template_id`.

So an approval that shows up somewhere unplanned still fails the gate. `P80` additionally scans
the packet *and* the ledger for any committed remote template id.

`P72` was likewise restated rather than deleted: it asserted "exactly two ledger entries", which
the third entry made obsolete. Its real invariant — the v1/v2 history must survive untouched with
its dispositions intact — is now asserted directly, while `P81` pins the exact three-entry set.

---

## 3. Two operator defects fixed

Both were found by reading the live run output against the source.

**`--reconcile-only` printed `DRY RUN (no network call)`.** It performs read-only `GET`s, so the
label was false — and it is exactly the line an operator reads when deciding whether a command is
safe to run. Mode labelling is now a pure exported `modeLabel()` with a distinct
`RECONCILE ONLY (read-only network)` string. `P86` fails if `DRY RUN` ever reappears in the
reconcile label.

**A held template still printed `WOULD CREATE`.** After Wave 0 closed, a dry run against it would
have advertised a create that is deliberately forbidden. The dry-run path now short-circuits for
any `submit_now: false` target and prints `HELD / CREATE NOT AUTHORIZED` with the state, no
payload preview, and an explicit "NO NETWORK CALL WAS MADE". `P87` requires the held branch to
precede the create loop and to exit; `P88` requires `--execute` to reject a held target *before*
any network call.

---

## 4. Wave 1 canary recommendation (not an authorization)

[meta-wave1-canary-review.json](provider-manifests/meta-wave1-canary-review.json) recommends
**one** template as the first Wave 1 submission:

- key `lead_received`, name `qf_lead_received_v1`, language `en`, category `UTILITY`,
  profile `STANDARD_TEXT`
- fingerprint `dd818e01d293a683b3685f1f246f8cba6b1e4f8e6e106bcab72c4739af640e16`

Why this one: it acknowledges an enquiry the client themselves just submitted, carries no
promotion, discount, renewal or URL, has exactly one bounded name variable, and has no buttons.
It is also the first **variable-bearing** Utility template — something the no-variable Wave 0
proof could not cover, and the dimension on which v2 was miscategorised.

The artefact quotes the packet verbatim; it does not restate or soften the copy. Rules **W40–W48**
pin the single entry, its fingerprint, its verbatim match against the source packet, the current
source-packet fingerprint, and the fact that it authorizes nothing — including that the other 13
Wave 1 templates stay `NOT_AUTHORIZED` / `NOT_SUBMITTED`.

**Submitting even this one template requires separate, explicit owner authorization.** This
document does not provide it.

---

## 5. Verification

| Gate | Result |
| --- | --- |
| `npm run test:mvp:40-10a` | 120 passed, 0 failed (89 rules, 31 mutation self-tests) |
| Wave 1 readiness validator | 73 passed, 0 failed (48 rules, 25 mutation self-tests) |
| `npm run test:mvp:communication` | pass |
| `npm run typecheck` | pass |
| `npm run test:mvp:build-gate` | pass |

Dry-run proofs executed (no network in any of them):

- `--wave 0` → reports the wave is fully held, no `WOULD CREATE`
- `--wave 0 --template consent_help_response` → `HELD / CREATE NOT AUTHORIZED`
- `--wave 1 --template lead_received` → `WOULD CREATE` preview only

`QF_META_ACCESS_TOKEN`, `QF_META_WABA_ID` and `QF_META_GRAPH_API_VERSION` were verified **absent by
presence check only** — no value was printed, read or cleared.

Wave 1 owner review was regenerated and is semantically identical to its previous version; the
only field that changed is `source_packet_fingerprint`, which necessarily tracks the packet.

---

## 6. Explicitly NOT done

- No Meta API call, no `--execute`, no live `--reconcile-only`.
- No template created, edited, deleted or appealed — v2 remains quarantined, intact.
- No WhatsApp message sent.
- No mapping, account, policy, webhook or canary activation.
- No Supabase access, no migration, no n8n/Jarvis work, no VPS or deployment change.
- No PR, merge, tag, rebase, amend, squash or force-push; no `.env` change.
- No Wave 1, 2 or 3 submission authorized.
- No remote template id committed; no evidence JSON modified, staged or committed.
