# QF-MVP-40.10C — Wave 0 Category Recovery

Offline correction after machine reconciliation proved Meta approved the Wave 0 template as
**MARKETING** rather than the requested **UTILITY**.

**No Meta API call, no `--execute`, no live `--reconcile-only`, no submission, no message, and no
mapping, account, policy, webhook or canary activation.** The remote v2 template is **not deleted and
not appealed**.

Companions: [remote-state ledger](provider-manifests/meta-template-remote-state.json) ·
[40.10A readiness](QF-MVP-40-10A-META-TEMPLATE-SUBMISSION-READINESS.md) ·
[40.10B Wave 1 review](QF-MVP-40-10B-WAVE1-OWNER-REVIEW.md)

---

## 1. Proven evidence

From `QF-MVP-40-WAVE0-consent_help_response-META-RECONCILIATION-2026-07-30T13-31-55-439Z.json`,
verified field-by-field against the file itself:

| Field | Value |
|---|---|
| `operation_mode` | `RECONCILE_ONLY` |
| `provider_template_name` | `qf_consent_help_response_v2` |
| `identity_match` (WABA) | `true` |
| `requested_category` | `UTILITY` |
| `returned_category` | **`MARKETING`** |
| `status` | **`APPROVED`** |
| template id | present — deliberately **not** recorded in the repository |
| `readback_semantic_match` | `false` |
| `create_post_count` | **`0`** |
| `outcome` | **`RECONCILED_CATEGORY_MISMATCH`** (operator exit 6) |
| raw body / error message in evidence | none |

The reconciliation issued **zero** POSTs. No message, edit, delete or mapping activation occurred.

## 2. Why v2 cannot be treated as Utility

The internal HELP response is an **evidence-bound reply to an inbound HELP command**. It is
deliberately absent from the ordinary outbound consent registry, and it is authorised only by the
one-shot enforcer bound to a verified inbound command.

A template that Meta classifies as **MARKETING** carries marketing sending semantics on Meta's side.
Mapping it as the HELP reply would mean an evidence-bound acknowledgement is served by a
marketing-classified artefact — which risks granting marketing send behaviour to a path that must
never have it, and blurs the consent/suppression boundary that the whole D2/D3/D4 chain exists to
protect. So the category mismatch is treated as **disqualifying**, not cosmetic.

> **Explicit non-claim.** `readback_semantic_match` is `false`, and the semantic comparison
> **includes** category. This evidence therefore does **not** separately prove that the remote body
> and components were otherwise identical to the local candidate. No body-equality claim is made in
> either direction. Anyone reading this later should not infer "only the category differed".

## 3. Why quarantine rather than delete or appeal

| Option | Decision |
|---|---|
| Delete the remote template | **Not taken.** Deletion is irreversible from this side, and the v1 incident already showed how destructive an out-of-band template deletion is. `delete_authority: NOT_GRANTED`. |
| Appeal the categorisation | **Not taken.** An appeal is an external commitment and a judgement call that belongs to the owner, not to an offline repair. `appeal_authority: NOT_GRANTED`. |
| **Quarantine, unmapped** | **Taken.** The remote artefact is left exactly as it is, recorded truthfully in the ledger, with `send_authority: DENIED` and `mapping_authority: DENIED`. It cannot be used because nothing maps it. |

Quarantine is the only option that is fully reversible and costs nothing to hold.

## 4. The v3 contract

| | |
|---|---|
| internal key | `consent_help_response` |
| provider name | `qf_consent_help_response_v3` |
| language / category | `en` / `UTILITY` |
| component profile | `STANDARD_TEXT` |
| wave / `submit_now` | `0` / `true` at the time of this phase — **now `false`**, held after approval (40.10D) |
| fingerprint | `12f98c8b9504194ef9d983a606c9edd1c083dab1ba187915bdbea85fbc3e6c87` |

Exact body:

> QuickFurno received your HELP request. Reply STOP to stop messages or START to resume. Continue this chat for support.

Exact creation payload:

```json
{"name":"qf_consent_help_response_v3","language":"en","category":"UTILITY","components":[{"type":"body","text":"QuickFurno received your HELP request. Reply STOP to stop messages or START to resume. Continue this chat for support."}]}
```

**What changed and why.** v2's body described the business — "connects you with verified furniture and
interior vendors" — and pointed at a domain. That is vendor-discovery copy with an external
destination, which is plausibly what attracted the MARKETING classification. v3 removes all of it:
no product pitch, no vendor-discovery description, no offer, promotion, discount or engagement
prompt, and **no external URL**. It does exactly one thing — acknowledge a HELP request and restate
the STOP/START controls. A validator rule enforces this (`P70`), and two mutation tests prove that
restoring the old body or adding a URL is rejected.

**The registry boundary is unchanged.** v3 remains `SPECIAL_EVIDENCE_BOUND_ACK` with
`ordinary_registry_entry: false`, and stays out of `outboundConsentScope.ts`. Consent scope and
suppression rules are untouched.

## 5. v3 submission requires separate owner authorization

**As of this phase, v3 had not been submitted** — it was `draft` / `DRAFT_NOT_SUBMITTED` with a null
provider template id, and submitting it required a separate, explicit owner authorization and a fresh
`--execute` run. That authorization was subsequently given: v3 was created with exactly one POST and
reconciled read-only to **APPROVED as UTILITY**. It is now `approved` / `APPROVED_UNMAPPED` and held
from creation, still with a null provider template id. See
[QF-MVP-40.10D](QF-MVP-40-10D-WAVE0-CLOSURE-AND-WAVE1-CANARY.md).

The contingency planned here — that v3 might also come back as MARKETING, requiring an owner decision
to appeal or redesign rather than another silent name bump — **did not arise**: Meta returned UTILITY.

## 6. Status

```
QF-MVP-40.10C IMPLEMENTATION COMPLETE — OFFLINE ONLY
WAVE 0 v2 APPROVED AS MARKETING — QUARANTINED UNMAPPED
WAVE 0 v3 STRICT UTILITY CANDIDATE READY
WAVE 0 v3 SUBSEQUENTLY SUBMITTED AND APPROVED AS UTILITY — SEE QF-MVP-40.10D
WAVE 1 META SUBMISSION NOT AUTHORIZED
WAVE 2/3 NOT AUTHORIZED
NO MAPPING, SEND, CANARY OR DEPLOYMENT
```
