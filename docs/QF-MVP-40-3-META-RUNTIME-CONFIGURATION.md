# QF-MVP-40.3 — Meta Runtime Configuration Contract

Completes the Meta WhatsApp configuration contract and readiness tooling **without real credentials,
provider calls, runtime activation or database seeding.**

Also records the QF-MVP-40.2-R staging constraint rehearsal result (§7).

Companions: [`meta-whatsapp-runtime-config-manifest.json`](provider-manifests/meta-whatsapp-runtime-config-manifest.json) ·
[`metaRuntimeReadiness.ts`](../lib/communication/providers/metaRuntimeReadiness.ts) ·
[`validate-qf-mvp-40-3.mjs`](../scripts/mvp/communication/validate-qf-mvp-40-3.mjs) ·
[activation runbook](QF-WhatsApp-Cloud-API-Activation-Runbook.md)

---

## 1. Existing architecture reused — nothing was rebuilt

The audit found the configuration layer already complete and already purpose-scoped. This phase added
a **reporter**, not a second configuration system.

| Reused unchanged | Role |
|---|---|
| `metaCloudWhatsAppConfig.ts` | Five purpose-specific loaders + validation grammar and bounds |
| `metaRuntimeGate.ts` | `evaluateRuntimeActivation`, `evaluateProviderAccountReadiness`, canary rules |
| `whatsAppProviderSelection.ts` | Lazy, production-fail-closed provider selection |
| `metaWhatsAppOutboundService.ts` | Early preflight + final network-boundary fence |

The evaluator adds **zero** new environment variables — asserted by validator rule E2.

## 2. Canonical variable matrix (names only, never values)

11 variables. Purpose-scoping is enforced by the loaders themselves, so an operation cannot read a
credential it does not need.

| Variable | Secret | Operations | Validation | Absence fails closed |
|---|---|---|---|---|
| `WHATSAPP_PROVIDER_MODE` | no | all Meta ops | `mock` \| `meta_cloud` | **yes** (production) |
| `WHATSAPP_ACCESS_TOKEN` | **yes** | outbound, health | non-empty | yes |
| `WHATSAPP_WABA_ID` | no | callback identity, outbound | callback-id grammar | yes |
| `WHATSAPP_PHONE_NUMBER_ID` | no | callback identity, outbound, health | callback-id grammar | yes |
| `WHATSAPP_GRAPH_API_VERSION` | no | outbound, health | `/^v\d{1,3}\.\d{1,3}$/` | yes |
| `WHATSAPP_APP_SECRET` | **yes** | webhook POST | non-empty | yes |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | **yes** | webhook GET | non-empty | yes |
| `WHATSAPP_AUTH_HTTP_TIMEOUT_MS` | no | outbound (auth lane) | 500–4000 | yes |
| `WHATSAPP_HTTP_TIMEOUT_MS` | no | outbound, health | 1000–30000 | yes |
| `WHATSAPP_HEALTH_HTTP_TIMEOUT_MS` | no | health | 1000–30000 | no — falls back to business timeout |
| `QF_CRON_SECRET` | **yes** | acknowledgement worker | non-empty | yes |

**Per-operation minimal sets** — webhook GET needs *only* the verify token; webhook POST *only* the
app secret; callback identity *only* WABA + phone ID; outbound the token, WABA, phone ID, version and
timeouts; health the token, phone ID, version and timeout. **A build requires no Meta credential** —
provider selection is lazy, so an absent production credential can never break a build.

## 3. Readiness state model

Six independently-evaluated operations: `webhook_get`, `webhook_post`, `callback_identity`,
`outbound`, `health`, `consent_ack_worker`.

| State | Meaning |
|---|---|
| `READY` | Not blocked by configuration. **Not permission to send.** |
| `MISSING` | A required variable is absent |
| `INVALID` | Present but malformed — outranks `MISSING`, because a bad value needs correcting, not supplying |
| `DISABLED_BY_RUNTIME_POLICY` | Mode is mock, or the runtime policy blocks it |
| `ACCOUNT_NOT_READY` | Provider account absent, not production-ready, or bound to a different WABA/phone |
| `MAPPING_NOT_READY` | No approved, active provider template mapping |
| `CANARY_NOT_READY` | Canary activation without an active, unexpired destination |

### The distinction this phase exists to enforce

```
configuration readiness    ≠  provider-account readiness
provider-account readiness ≠  runtime activation
runtime activation         ≠  BUSINESS AUTHORISATION
```

Consent, suppression, frequency, template approval and the Phase 4 policy engine remain **separate
authorities that must also pass**. The evaluator is deliberately incapable of enabling anything.

**Purity.** Evaluation performs no I/O. Runtime rows are *optional injected snapshots*; the module
never fetches them, so it cannot accidentally reach a database or a provider. With no snapshot it
reports configuration readiness only and claims nothing about runtime.

## 4. Secret handling

No secret value is read, returned, logged or stored. Results carry variable **names** and states only.
Validator rule **D1** proves this empirically: fake sentinel values are injected and every evaluator
output — including the printable summary — is searched for them.

## 5. Staging configuration packet (for QF-MVP-40.10 — not executed)

Recorded in the manifest under `staging_configuration_packet`. Starting posture is **fully closed**:

- **Runtime policy** — `activation_status=disabled`, all three gates `false`. Staging currently has
  **no policy row at all**, so the canary must create one; it opens one gate at a time.
- **Provider account** — references supplied at configuration time; `readiness_status` not
  `provider_ready`, `configuration_status` incomplete, `webhook_status` unverified, `health_status`
  unknown until each is independently verified.
- **Canary destination** — **destination hash only, never a plaintext number**; inactive; expiry
  required or explicitly reviewed.
- **Provider mappings** — **no row until Meta approves the template**; exact name/language/category;
  fingerprint compared with exact equality at the network boundary; inactive until the canary.

## 6. Activation sequence (later phases)

1. Supply configuration → `test:mvp:40-3` reports `READY` per operation (40.3 ✅ tooling done)
2. Register template keys in `outboundConsentScope.ts` (40.6)
3. Submit templates to Meta and obtain approval (40.4 external)
4. Seed the provider account; verify each readiness field independently (40.10)
5. Verify the webhook subscription (GET) — independent of sending
6. Seed approved mappings, still inactive (40.10)
7. Canary: allowlist one hashed destination, `activation_status=canary`, enable one gate (40.10)
8. Only then consider wider activation

## 7. QF-MVP-40.2-R — staging constraint rehearsal result

Migration `20260721000100` (`communication_consent_ack_intents_provider_account_req_check`,
predicate `provider_account_id IS NOT NULL`) was executed against **staging** inside one explicit
transaction and **rolled back**. It was **not applied and not recorded**.

- Preconditions measured: 0 ack-intent rows, 0 NULL `provider_account_id`, constraint absent, version
  not recorded, table owner `postgres`.
- In-transaction: constraint created, definition exactly `CHECK ((provider_account_id IS NOT NULL))`,
  `convalidated = true`, exactly one such constraint on the target table, rows unchanged, history
  unchanged at 17 rows. Marker `QF_MVP_40_2R_STAGING_ACK_CONSTRAINT_REHEARSAL_REACHED` reached once.
- After `ROLLBACK`: **11/11 baseline items identical**, including the constraint-name digest, column
  digest and grant digest. Constraint absent again; history still 17 rows; version still unrecorded.

**Conclusion:** the exact pending DDL executes cleanly against the real staging schema. D1 is
downgraded from *unvalidated* to *rehearsed and proven* — it remains marker 01/17 of the cumulative
cutover and is still not applied anywhere.

## 8. Explicit non-actions

No migration applied, edited or created · no migration-history write · no production DDL or DML · no
persistent staging change · no provider account, runtime policy, mapping or canary seeded · no Meta
Graph API call · no webhook verified · no template submitted · no message sent · no gate enabled · no
VPS access · no deployment · no n8n/Jarvis · no voice · no campaign dispatcher.

## 9. Remaining blockers

| Blocker | Owner |
|---|---|
| Meta template approval (external, longest lead) | 40.4 external |
| Template keys unregistered in `outboundConsentScope.ts` | 40.6 |
| No provider account in either environment | 40.10 |
| Staging has no runtime policy row | 40.10 |
| Owner sign-off on STOP/START policy (A and B) | owner |
| `ACK_TEMPLATE_CATEGORY` is dead code — must **not** become the Meta submission category | 40.6 |
