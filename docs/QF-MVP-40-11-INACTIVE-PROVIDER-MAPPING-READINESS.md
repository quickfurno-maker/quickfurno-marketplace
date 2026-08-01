# QF-MVP-40.11 — Inactive Meta provider mapping readiness

**Status:** offline readiness only. Eight approved templates are pinned for a **later**,
separately authorized staging seed as **INACTIVE** mappings.
**Scope of this task:** no Meta call, no database read or write, no mapping created or activated,
no provider account touched, no runtime policy enabled, no message sent, no deployment.

---

## 1. Architecture discovered — and reused, not replaced

The existing communication stack already expresses everything this phase needs. **No new mapping
system, provider-account abstraction, schema or migration was introduced.**

| Concern | Authoritative file(s) | Existing contract | Gap |
| --- | --- | --- | --- |
| Mapping table | [20260709000100_messaging_channel_provider_foundation.sql](../supabase/migrations/20260709000100_messaging_channel_provider_foundation.sql) | `public.communication_provider_template_mappings` — `template_key`, `channel`, `provider_key`, `language`, `version`, `provider_template_name`, `provider_template_id` (nullable), `approval_status`, **`is_active boolean NOT NULL DEFAULT false`** | none |
| Row uniqueness | same | `uq_comm_provider_template_mapping (template_key, channel, provider_key, language, version)` | none — gives the seed a deterministic conflict target |
| Active uniqueness | same | `uq_comm_provider_template_active` — **partial** unique index `WHERE is_active` | none — two competing active mappings are structurally impossible |
| Mapping selection | [whatsappTemplate.ts](../lib/communication/whatsappTemplate.ts) `selectApprovedProviderMapping` | pure, exact-equality selector; fails closed on none / not-active / not-approved / ambiguous / missing name | none |
| Mapping service | [providerTemplateMappingService.ts](../services/providerTemplateMappingService.ts) | thin DB wrapper; delegates to the pure selector; **no legacy fallback** to `communication_templates.provider_template_name` | none |
| Final outbound gate | [approvedTemplateOutbound.ts](../lib/communication/approvedTemplateOutbound.ts) | pins mapping **id + version + fingerprint**; rejects supersede and in-place edit at the network boundary | none |
| Runtime gate | [metaRuntimeGate.ts](../lib/communication/providers/metaRuntimeGate.ts) | `runtime_policy_missing`, `outbound_disabled`, `activation_not_sendable`, `provider_account_missing/not_ready`, canary allowlist | none |
| Provider account | [20260716000100_communication_provider_account_binding.sql](../supabase/migrations/20260716000100_communication_provider_account_binding.sql) | `public.communication_provider_accounts`; nullable `provider_account_id` on five message tables | none |
| Consent authority | [outboundConsentScope.ts](../lib/communication/outboundConsentScope.ts) | ordinary registry; the three acknowledgements are **absent by design** | none |
| Meta adapter | [metaCloudWhatsAppProvider.ts](../lib/communication/providers/metaCloudWhatsAppProvider.ts) | send payload keyed on `template.name` + `language.code` | none |

**Two findings shaped this phase.**

**The mapping table is keyed by a symbolic `provider_key` (text), not by a provider-account row.**
The account-binding migration added `provider_account_id` to messages, delivery events, webhook
receipts, inbound messages and ack intents — but deliberately *not* to the mapping table. So the
readiness artefact records `provider_key_symbolic: "meta_whatsapp_cloud"` (read from the adapter
constant) and `provider_account_reference: null`. No database identifier appears anywhere.

**The Meta send payload is keyed on template name + language — never the remote template id.**
That is why `provider_template_id` can stay `null` permanently: it is not merely a policy choice to
keep remote ids out of Git, it is architecturally unnecessary at dispatch. Rule `I29` proves a
mapping with a null `provider_template_id` still resolves correctly.

**Gaps filled:** none in the runtime. The only things missing were the *offline* planner, validator
and readiness artefacts, which this phase adds. No runtime service, repository, adapter, route,
migration or generated type was modified.

---

## 2. The eight mapping candidates

All eight are APPROVED by Meta, proven category **UTILITY**, semantic readback true, currently
unmapped, and planned **INACTIVE**.

| # | Internal key | Provider template | Classification |
| --- | --- | --- | --- |
| 1 | `consent_help_response` | `qf_consent_help_response_v3` | **EVIDENCE_BOUND_ACK** |
| 2 | `consent_stop_acknowledgement` | `qf_consent_stop_acknowledgement_v1` | **EVIDENCE_BOUND_ACK** |
| 3 | `consent_start_acknowledgement` | `qf_consent_start_acknowledgement_v1` | **EVIDENCE_BOUND_ACK** |
| 4 | `lead_received` | `qf_lead_received_v1` | ORDINARY_BUSINESS |
| 5 | `client_lead_status_update` | `qf_client_lead_status_update_v1` | ORDINARY_BUSINESS |
| 6 | `client_matching_update` | `qf_client_matching_update_v1` | ORDINARY_BUSINESS |
| 7 | `lead_assignment_alert` | `qf_lead_assignment_alert_v1` | ORDINARY_BUSINESS |
| 8 | `vendor_onboarding_reminder` | `qf_vendor_onboarding_reminder_v1` | ORDINARY_BUSINESS |

### 2.1 Evidence-bound acknowledgements

The three acknowledgements remain **absent from `outboundConsentScope.ts`** — verified, not
assumed (`I10`). That absence *is* the mechanism. Neither a Meta approval nor a future mapping row
grants them ordinary transactional authority; they stay reachable only through their exact inbound
HELP / STOP / START evidence flow. The artefact records `ordinary_registry_entry: false` and null
consent lane/scope for each, and mutants `M16`–`M18` reject any attempt to reclassify them.

### 2.2 Ordinary business templates

The five ordinary templates keep their existing lane exactly — `business` / `transactional`,
verified against the registry source (`I11`). A mapping row changes nothing about consent: consent
and suppression evaluation, runtime policy, an enabled provider account and an **active** exact
mapping are all still required before any send.

Nothing was added to marketing. Authentication (Wave 2), marketing (Wave 3) and admin alerts
(Wave 4) are untouched and unapproved (`I34`).

---

## 3. Why approval grants no mapping or send authority

A Meta approval proves the **provider contract** — that the template exists remotely with the
requested name, language and category. It is not an authorization. Between approval and a delivered
message stand five independent gates, every one of which this phase leaves closed:

1. a mapping row must exist — none does;
2. that row must be **active** — every planned row is inactive;
3. the provider account must be enabled — it stays disabled;
4. runtime policy must be enabled — it stays disabled;
5. consent and suppression must permit the specific send — unchanged, and STOP remains globally
   suppressive.

---

## 4. Existing gate proofs

Proven against the **real production selector** (`selectApprovedProviderMapping`), using fixtures in
the exact row shape — no mapping was activated to test anything:

| # | Condition | Result | Rule |
| --- | --- | --- | --- |
| 1 | No mapping | blocked | `I22` |
| 2 | Mapping exists but **inactive** | blocked, `not_active` | `I23` |
| 3 | Mapping not approved | blocked, `not_approved` | `I24` |
| 4 | Duplicate active mappings | blocked, `ambiguous_active_mapping` | `I25` |
| 5 | Missing provider template name | blocked | `I26` |
| 6 | Key / language / provider / channel mismatch | blocked | `I27` |
| 7 | Prefix, wildcard or default-provider selection | impossible — exact equality only | `I28` |
| 8 | Null `provider_template_id` | still resolves (send keys on name) | `I29` |
| 9 | Inactive row alongside another candidate | never falls back | `I30` |

Provider-account-disabled and runtime-policy-disabled blocking (conditions 3 and 4 of the phase
brief) are already covered by the existing communication suite's runtime-activation-gate case and by
D3-B, which this phase leaves untouched at **93/93**. STOP suppression, START not creating marketing
consent, and the no-blind-resend posture on an unknown outcome are all D3-B contracts and are
unchanged — this phase adds no path that could bypass them, and rule `I10` proves the acknowledgement
registry absence still holds.

---

## 5. Staging seed plan — plan only

[meta-staging-inactive-mapping-seed-plan.json](provider-manifests/meta-staging-inactive-mapping-seed-plan.json)
is `PLAN_ONLY_NOT_AUTHORIZED`: 17 ordered steps, 9 abort conditions, 9 invariants. It contains **no
SQL statement, no credential, no project URL, no database identifier and no remote provider id**
(`I19`).

Sequence: prove staging identity → verify schema and both unique indexes → verify the provider
account exists and is **disabled** → read-only remote reconciliation → hold any remote id in memory
only → collision check → single transaction → write eight rows `is_active false` → **abort rather
than replace an active row** → read back → prove all inactive → prove the account still disabled →
prove runtime policy disabled → commit only if every check passed → **roll back on any uncertainty**
→ archive sanitized evidence outside the repo → assert zero sends.

The existing schema permits a safe deterministic upsert — `uq_comm_provider_template_mapping` gives
the conflict target and `uq_comm_provider_template_active` makes competing active rows impossible —
so there is **no blocker** to a later staging seed.

---

## 6. Validation

| Gate | Result |
| --- | --- |
| `npm run test:mvp:40-11` | 77 passed, 0 failed (35 rules, 42 mutation self-tests) |
| `npm run test:mvp:40-10a` | 192 passed, 0 failed |
| Wave 1 readiness validator | 102 passed, 0 failed |
| `npm run test:mvp:40-2` / `40-3` / `40-4` / `40-6` / `40-8` | 43 / 52 / 39 / 42 / 72, 0 failed |
| `npm run test:mvp:communication` | PASS |
| `npm run test:phase5f:d3b` | 93 passed, 0 failed |
| `npm run typecheck` | PASS |
| `npm run test:mvp:build-gate` | PASS |
| Generator determinism | byte-identical across two runs |

One rule I wrote in this phase was too blunt and was corrected before commit: `I31` originally scanned
the generator's source for the word "supabase", which matched a *prerequisite string* rather than any
I/O. It now pins the generator's **entire import list** to three pure node builtins — a capability
guarantee rather than a word search — plus dynamic-import, fetch, client-call and credential-read
checks. Four synthetic mutants (`M39`–`M42`) prove a generator that could reach a client, the
network, a dynamic import or a credential fails.

---

## 7. Status

```
QF-MVP-40.11 IMPLEMENTATION COMPLETE — OFFLINE ONLY
EIGHT APPROVED META TEMPLATES PINNED FOR INACTIVE MAPPING
THREE CONSENT ACKNOWLEDGEMENTS REMAIN EVIDENCE-BOUND
FIVE ORDINARY BUSINESS TEMPLATES RETAIN EXISTING CONSENT LANES
NO PROVIDER TEMPLATE ID COMMITTED
NO PROVIDER ACCOUNT OR MAPPING CREATED
NO MAPPING ACTIVATED
NO RUNTIME POLICY ENABLED
NO MESSAGE SENT
NO DATABASE OR META CALL
TEMPLATE SUBMISSION REMAINS PAUSED
READY FOR SEPARATELY AUTHORIZED STAGING INACTIVE-MAPPING SEED
```

---

## 8. Explicitly NOT done

- No Meta API call; no template create, edit, delete, appeal or resubmission.
- No Supabase access of any kind — no read, no write, no migration, in any environment.
- No provider template mapping created, upserted or activated.
- No provider account created, configured or activated.
- No runtime policy enabled, no webhook configured, no canary run.
- No WhatsApp message sent.
- No change to `outboundConsentScope.ts`, any provider adapter, route, runtime service, repository,
  applied migration, generated DB type, `.env` file or lockfile.
- No n8n/Jarvis work, no VPS change, no deployment.
- No PR, merge, tag, rebase, amend or force-push.
- Template submission remains PAUSED; no subset-3 artefact exists.

**Next phase: QF-MVP-40.12 — CONTROLLED STAGING PROVIDER ACCOUNT + INACTIVE MAPPING SEED.** It must
not run without separate owner authorization.

> **Update — [QF-MVP-40.12-R1](QF-MVP-40-12-R1-BUSINESS-TEMPLATE-BINDING-GOVERNANCE.md).** The 40.12
> seed refused safely on `BINDING_SCHEMA_UNPROVEN`: five of the eight templates declared Meta
> positional variables with no proven source key. Binding governance is now **code-proven** for those
> five via the canonical typed contract in `lib/communication/businessTemplateVariables.ts`, and the
> operator requires both the manifest and that contract to agree. The **actual staging seed remains
> NOT EXECUTED** — it is still blocked on the six phase-scoped live environment variables.
