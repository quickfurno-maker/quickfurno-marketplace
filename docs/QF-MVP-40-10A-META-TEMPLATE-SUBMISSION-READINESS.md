# QF-MVP-40.10A — Meta Template Submission Readiness

Records the provider-component compatibility correction (40.6-R2) and the exact, non-secret
submission packet and wave plan (40.10A).

**No template was submitted. No Meta API call was made. No message was sent. No mapping, account,
policy or canary was seeded. No migration.**

Artefacts: [`meta-template-submission-packet.json`](provider-manifests/meta-template-submission-packet.json) ·
[generator](../scripts/mvp/communication/generate-meta-template-submission-packet.mjs) ·
[validator](../scripts/mvp/communication/validate-meta-template-submission-packet.mjs) ·
[operator script](../scripts/mvp/communication/submit-meta-templates.mjs)

---

## 1. Why this correction was required

The renderer could express only `{ type, parameters: [{ type: "text", text }] }`. Checked against
current official Meta documentation, that shape **cannot send** two of our template families. Five
genuine defects:

| # | Defect | Consequence |
|---|---|---|
| 1 | No `sub_type` field | A button component is unsendable |
| 2 | No `index` field | Multi-button templates unsendable |
| 3 | No `payload` parameter type | Quick replies unsendable |
| 4 | All bindings of a component collapsed into ONE component | Meta needs one component **per** button |
| 5 | `DUPLICATE_SOURCE_BINDING` refused any reused source key | Auth OTP unsendable — Meta requires the code **twice** |

Had templates been submitted before this, `vendor_new_lead` and all three authentication templates
would have failed at send time.

## 2. Official Meta contract (external source of truth)

**Quick-reply send** — [template components](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components/):

```json
{ "type": "button", "sub_type": "quick_reply", "index": "0",
  "parameters": [{ "type": "payload", "payload": "PAYLOAD" }] }
```

`index` designates button order; up to 10 quick-reply buttons; quick replies must be grouped
together or the API returns an error.

**Copy-code authentication** — [copy-code authentication templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/copy-code-button-authentication-templates/):

*Creation* — note the body carries **no author text**:
```json
{ "category": "authentication",
  "components": [
    { "type": "body",   "add_security_recommendation": true },
    { "type": "footer", "code_expiration_minutes": 10 },
    { "type": "buttons", "buttons": [{ "type": "otp", "otp_type": "copy_code", "text": "..." }] }]}
```

*Send* — `sub_type` is **`url`**, and Meta states the value **"must appear twice in the payload"**:
```json
[{ "type": "body",   "parameters": [{ "type": "text", "text": "<OTP>" }] },
 { "type": "button", "sub_type": "url", "index": "0",
   "parameters": [{ "type": "text", "text": "<OTP>" }] }]
```

## 3. Compatibility matrix

| Contract | Before | Now |
|---|---|---|
| A. Standard body/header text send | COMPATIBLE_UNCHANGED | COMPATIBLE_UNCHANGED (v1 untouched) |
| B. Quick-reply creation | INCOMPATIBLE_MANIFEST | COMPATIBLE_WITH_MAPPING_DATA |
| C. Quick-reply send | **INCOMPATIBLE_PRODUCT_CODE** | COMPATIBLE_UNCHANGED |
| D. Auth OTP copy-code creation | INCOMPATIBLE_MANIFEST | COMPATIBLE_WITH_MAPPING_DATA |
| E. Auth OTP send | **INCOMPATIBLE_PRODUCT_CODE** | COMPATIBLE_UNCHANGED |
| F. Template language | EXTERNAL_CONTRACT_UNCLEAR | resolved — see §5 |
| G/H/I. Creation endpoint, status retrieval, approval webhook | not exercised | DEFERRED to 40.10B (no submission here) |

## 4. Component profiles (binding schema v2)

Closed set — a provider mapping can never inject an arbitrary component shape.

| Profile | Rules |
|---|---|
| `STANDARD_TEXT` | Exactly v1 semantics. Text only. Button metadata refused. Duplicate source refused. |
| `QUICK_REPLY` | Button bindings require `buttonSubType:"quick_reply"`, an explicit zero-based `buttonIndex` (0–9, unique) and `parameterType:"payload"`. Payload must match `^[a-z0-9_:-]{1,64}$`. One component emitted **per** button. |
| `AUTH_OTP_COPY_CODE` | Exactly two bindings sharing ONE source key: body position 1 and button index 0 with `sub_type:"url"`, both `text`. Header refused. |

**v1 remains supported and unchanged**, and a v1 schema cannot smuggle in a button profile.

**Duplicate-source protection is NOT weakened globally.** It stays in force for every profile;
`AUTH_OTP_COPY_CODE` carves out exactly one reuse — the body↔button OTP pair Meta requires — and a
post-loop check enforces that the two bindings share one key and that nothing else is present.

Verified output (probe against the live renderer):

```
QUICK_REPLY : [{"type":"body","parameters":[{"type":"text","text":"Pune"}]},
               {"type":"button","sub_type":"quick_reply","index":"0","parameters":[{"type":"payload","payload":"lead_accept"}]},
               {"type":"button","sub_type":"quick_reply","index":"1","parameters":[{"type":"payload","payload":"lead_decline"}]}]
AUTH_OTP    : [{"type":"body","parameters":[{"type":"text","text":"123456"}]},
               {"type":"button","sub_type":"url","index":"0","parameters":[{"type":"text","text":"123456"}]}]
```

Ten negative cases refuse correctly: missing index, duplicate index, arbitrary `sub_type`, text
button in a quick-reply profile, PII-shaped payload, negative index, duplicate source in
`STANDARD_TEXT`, auth with an extra source key, v1 smuggling a profile, payload parameter in
`STANDARD_TEXT`.

## 5. Language decision

**Internal language stays `en`.** Meta's current documentation shows **both** `en` and `en_US` in
official examples, so `en` is **not** proved invalid. No silent `en → en_US` conversion was
introduced. If a specific template is later rejected on language grounds, that becomes an explicit
per-template `provider_language` decision recorded in the manifest — never a hidden translation.

## 6. Manifest changes

Every entry gained `component_profile`, `provider_template_name_candidate`, `submission_wave` and
`submit_now`. The three authentication templates gained `meta_creation_contract` and
`meta_send_contract`, with an explicit note that **Meta generates the authentication body** and the
internal `body_spec` is descriptive only, never submitted as the Meta body. `vendor_new_lead` gained
`buttons_spec` with explicit indices 0/1 and opaque payloads (`lead_offer_accept`,
`lead_offer_decline`).

**A quick reply is not authority.** The payload identifies an action only; Core re-validates any
resulting action through its ordinary assignment path.

## 7. Provider template naming

Grammar `qf_<internal_template_key>_v1` — lowercase ASCII, letters/digits/underscore, deterministic,
unique, version-suffixed, and carrying no environment name, WABA id, secret or client/vendor data.
Recorded as `provider_template_name_candidate`; `provider_template_name` and `provider_template_id`
stay null until Meta assigns them. Everything remains `draft` / `DRAFT_NOT_SUBMITTED`.

## 8. Wave plan — reconciles to 25

| Wave | Count | Contents | `submit_now` |
|---|---|---|---|
| **0** | **1** | `consent_help_response` — no-variable utility API-contract canary | ✅ |
| **1** | **14** | Launch transport: consent acks + client/vendor transactional | ✅ |
| **2** | **3** | Authentication templates | ❌ **held from the Wave 0 task** — see §8.1 |
| **3** | **3** | Marketing (QF-MVP-50) — may absorb approval latency; unusable without consent, frequency policy, active mapping and orchestration | ✅ |
| **4** | **4** | QF-MVP-70 admin alerts — **deferred, not part of the MVP-40 track** | ❌ |

Total **1 + 14 + 3 + 3 + 4 = 25**. Submittable now: 18. Held: 7.

### 8.1 Wave 2 sequencing — corrected

An earlier revision of this document said Wave 2 was held "until an end-to-end real approved-template
send". **That was circular**: a template cannot be sent before it is approved, and it cannot be
approved before it is submitted. The dependency was impossible to satisfy and has been removed.

The correct order is:

1. Prove component creation/send shape **offline** — ✅ complete (40.6-R2).
2. Prove the **real WABA template-create API** with Wave 0.
3. Submit the three authentication templates under a **separate explicit authorisation**.
4. Wait for Meta approval.
5. Seed approved **inactive** mappings.
6. Perform **one controlled authentication send** — only after approval.
7. Keep authentication activation **disabled** until that send succeeds.

Wave 2 therefore remains `submit_now: false` for now simply because **this task is scoped to Wave 0**.
That is an authorisation boundary, not a technical blocker.

## 9. Operator script — dry run by default

`--wave <n>` is mandatory (no submit-everything mode) and `--execute` must be explicit. It has **no
`/messages` endpoint, no DELETE, no PUT and no PATCH** — it can only create. It lists existing
templates first, treats an exact match as idempotent-existing, fails closed on a same-name
different-category collision, stops on the first ambiguous response, and records sanitized results
(internal key, provider name, status, category, template id, UTC). Secrets come from
`QF_META_WABA_ID` / `QF_META_ACCESS_TOKEN` and are never printed.

**Dry run executed for Wave 0** — 1 selected, 1 submittable, 0 held; payload printed with fingerprint
`2a0b7a16…`; nothing submitted, sent, edited or deleted.

## 10. Is real submission safe now?

**Waves 0, 1 and 3 — YES, pending owner approval of copy.** Wave 2 stays `submit_now: false`
because it is **held from the Wave 0 execution task**, not because of a send precondition — see §8.1.
Wave 4 remains deferred to QF-MVP-70.

Remaining blockers before any activation: Meta credentials configured; provider account seeded and
independently verified; staging runtime policy created in a **disabled** state; approved provider
mappings seeded (inactive); webhook verification; canary send/callback lifecycle.

## 11. Explicit non-actions

No database access or write · no migration · no Meta API call · no template submitted, edited or
deleted · no message sent · no webhook verified · no provider account, mapping, policy or canary
seeded · no runtime gate enabled · no VPS access · no deployment · no n8n/Jarvis · no voice · no
campaign orchestration.
