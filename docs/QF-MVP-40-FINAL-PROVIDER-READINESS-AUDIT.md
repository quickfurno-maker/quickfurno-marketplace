# QF-MVP-40 — Final provider readiness audit and canary prerequisites

**Status: QF_MVP_40_STATUS: IN_PROGRESS.** Source is green and reconciled. No live step ran:
no staging database connection, no Meta call, no send, no activation. Production untouched.

Branch `mvp/qf-mvp-40-final-provider-canary`, off main `47cdffe7ec7ba5442fc09e4f50dffb71bfce5fec`.

---

## 1. Locked exit criteria (verbatim, `docs/QF-MVP-LOCKED-ROADMAP.md`)

> staging webhook verified; signed inbound callback accepted; foreign callback causes zero
> effects; template send succeeds; delivery lifecycle updates Core; STOP blocks future
> promotional messages; START restores only permitted communication; HELP responds safely;
> campaign canary succeeds; **no voice path exists.**

Of these, **only "no voice path exists"** is satisfiable offline, and it is satisfied. Every
other criterion is a *live* claim about staging and cannot be certified from source.

## 2. Current-source matrix

| 40.x | Source status | Live staging status | Remaining work | Owner |
| --- | --- | --- | --- | --- |
| 40.1 foundation | COMPLETE — adapter, raw-body + signature verification, callback identity, WABA/phone identity, provider-account ownership, inbound persistence, approved-template outbound, delivery lifecycle, replay protection, consent enforcement, STOP/START/HELP, async acks, health + runtime gates | never exercised | live proof only | 40 |
| 40.2 migrations | COMPLETE offline — 12 communication migrations inventoried and hash-pinned, read-only SQL auditor, rollback classes | measured historically, **not re-measured this session** | fresh read-only re-measure | 40 |
| 40.3 configuration | COMPLETE — loader, readiness evaluator, composed runtime + canary gate | **no runtime policy row exists on staging** | supply env, create policy row | 40 |
| 40.4 templates | catalogue COMPLETE; **8 approved UTILITY at Meta**; submission PAUSED | 8 approved remotely; `send_authority` and `mapping_authority` both DENIED pending mappings | mapping seed, then activation | 40 |
| 40.5 inbound | COMPLETE — `app/api/webhooks/whatsapp/meta/route.ts` + inbound persistence + consent commands + async ack intents | never exercised | live proof | 40 |
| 40.6 outbound | COMPLETE — approved-template-only, consent, suppression, provider account, provider message id, duplicate prevention | **structurally impossible**: no policy row, all mappings inactive | activation + canary | 40 |
| 40.7 delivery callbacks | COMPLETE — forward-only reconciliation; duplicate, unknown and foreign-account callbacks all zero-effect | never exercised | live proof | 40 |
| 40.8 campaign | COMPLETE — provider-neutral result-ingestion contract, deliberately no dispatcher | intents created; consumer is QF-MVP-50, which is complete | campaign canary needs an approved MARKETING template + marketing consent + active frequency policy — none exists | 40 criterion, marketing surface governed by 80 |
| 40.9 no voice | COMPLETE | n/a | none | 40 |
| 40.10A–G submission | COMPLETE, **PAUSED** | 8 approved | resume only if a required template proves missing | 40 |
| 40.11 inactive mapping readiness | COMPLETE offline — `OFFLINE_READY_FOR_CONTROLLED_STAGING_SEED` | **not seeded** | run the seed | 40 |
| 40.12 + PREREQ + R1/R2/R3 | COMPLETE offline | **neither seed executed** | run both, in order | 40 |
| **canary activation authority** | **ABSENT — see §4** | n/a | **must be built** | **40 (40.3 "runtime enablement; canary control")** |

## 3. Template truth (recorded remote state, re-read this session)

> **SUPERSEDED IN PART — 2026-08-25 current-WABA reconciliation.** The table below records
> what was true of the PREVIOUS WABA context and is preserved unamended as history. Against
> the CURRENT dedicated staging WABA it is stale in four ways:
>
> * `lead_received` and `lead_assignment_alert` are **ABSENT** — they do not exist on this
>   WABA at all, despite the historical APPROVED record below.
> * `client_matching_update` v1 is **APPROVED but MARKETING**, quarantined and unmappable;
>   its successor `qf_client_matching_update_v2` has never been created.
> * `consent_start_acknowledgement` is now v2 (v1 quarantined MARKETING); `consent_help_response`
>   is v3.
> * Four newly created Utility templates were **recategorised to MARKETING** by Meta on
>   2026-08-25 and are quarantined: `clarification_reminder`, `vendor_response_reminder`,
>   `vendor_package_expiry_warning`, `low_credit_warning`.
>
> **The canary conclusion below still holds.** `vendor_onboarding_reminder` and
> `client_lead_status_update` are both current-WABA APPROVED/UTILITY, both mappable, and both
> carry a proven binding contract in `lib/communication/businessTemplateVariables.ts`. The
> vendor canary and the client canary are therefore both satisfiable without
> `client_matching_update`. Authority: `docs/provider-manifests/meta-template-remote-state.json`.


Eight APPROVED UTILITY templates. Five are ordinary business, three are evidence-bound
consent acknowledgements that are deliberately absent from `outboundConsentScope.ts` and are
authorised only by the one-shot enforcer bound to a verified inbound command.

| Internal key | Provider name | Class |
| --- | --- | --- |
| `lead_received` | `qf_lead_received_v1` | ordinary |
| `client_lead_status_update` | `qf_client_lead_status_update_v1` | ordinary |
| `client_matching_update` | `qf_client_matching_update_v1` | ordinary |
| `lead_assignment_alert` | `qf_lead_assignment_alert_v1` | ordinary |
| `vendor_onboarding_reminder` | `qf_vendor_onboarding_reminder_v1` | ordinary |
| `consent_stop_acknowledgement` | `qf_consent_stop_acknowledgement_v1` | evidence-bound |
| `consent_start_acknowledgement` | `qf_consent_start_acknowledgement_v1` | evidence-bound |
| `consent_help_response` | `qf_consent_help_response_v3` | evidence-bound |

Both intended canary candidates therefore exist and are approved UTILITY:
**vendor** → `vendor_onboarding_reminder`; **client** → `client_matching_update` or
`client_lead_status_update`.

> **2026-08-25:** of the two client options only **`client_lead_status_update`** remains
> valid — `client_matching_update` v1 is quarantined MARKETING and v2 was never created.
> One valid client Utility canary template is sufficient, so the absent v2 successor is
> **not** a closeout blocker.

Do not use `qf_consent_help_response_v2`: it is APPROVED but **MARKETING**-category, and
`qf_consent_help_response_v1` is DELETED and retired — its name must never be reused.

**Submission pause is unchanged: `PAUSED`.** Resume condition: *"An ACTIVE implementation
phase must require a specific template. Only then is a new subset proposed, reviewed and
separately authorized — one exact key per operator run."* No required canary template is
missing, so **this phase does not resume submissions**.

## 4. The one structural gap: no canary activation authority exists

A canary send requires all of:

1. a `communication_provider_runtime_policies` row with `activation_status = 'canary'` and
   `outbound_enabled = true`;
2. a `communication_provider_accounts` row at **every** production-ready value —
   `readiness_status = provider_ready`, `configuration_status = complete`,
   `business_verification_status = verified`, `phone_number_status = connected`,
   `webhook_status = verified`, `health_status = healthy` (all six, per
   `evaluateProviderAccountReadiness`);
3. a `communication_provider_canary_destinations` row holding the destination **hash**,
   active and unexpired;
4. the mapping for the canary template flipped `is_active = true`.

**None of the four has a mutation authority in the repository.** Verified exhaustively:

* `communicationProviderRuntimeService.ts` is read-only (`fetch*` / `evaluate*`).
* `adminWhatsAppService.ts` is read-only — no `insert`/`update`/`upsert` anywhere.
* `providerTemplateMappingService.ts` only resolves.
* The only write to any provider table in application code is
  `communicationProviderHealthService.ts` updating `health_status` after a real health check.
* The seed operator states it explicitly: *"It never activates a mapping, a provider account
  or a runtime policy."*
* No migration RPC does it. Migration `20260709000200` seeds exactly one **fully disabled**
  policy row with `on conflict do nothing`, and staging has no such row today.

So building the activation authority is genuine, unavoidable QF-MVP-40 work — it is
40.3's own "runtime enablement; canary control". Building the *first* one is not the
"second admin/operator path" the phase lock forbids; that lock protects against duplicating
an authority that exists, and this one does not.

It must be a single narrow, auditable, reversible operator on the existing tables, with the
same fences the 40.12 seed already establishes: exact staging ref, production and Jarvis
refused by name, read-only preflight, single-use short-TTL attestation, one-shot execute, no
retry after an uncertain write, hash-only canary destination, and an explicit disable path
for §17's return to fail-closed.

## 5. Exact live ordering when prerequisites arrive

1. Internal template seed — dry run → `--preflight-readonly` → exactly one `--execute`
   (`scripts/mvp/communication/seed-internal-staging-templates.mjs`); read back 8 rows.
2. Clear staging credentials from the process.
3. Generate a **fresh** external index proof by direct read-only SQL (15-minute TTL, stored
   **outside** the repository) and point `QF_STAGING_INDEX_PROOF_PATH` at it.
4. QF-MVP-40.12 mapping seed — dry run → `--preflight-readonly` → exactly one `--execute`.
   Expected result: 8 approved **inactive** mappings, one **disabled** provider account, no
   runtime policy, no canary, zero Meta writes.
5. Build and review the activation authority of §4.
6. Advance the provider account to ready — requires a real webhook subscription check and a
   real health check, not an assertion.
7. Create the runtime policy row, then open gates one at a time.
8. Insert the canary destination hash for the owner-controlled number.
9. Activate exactly the one mapping needed.
10. Vendor canary, then client canary — each under §11's non-rollbackable safety rules.
11. Delivery-callback proof.
12. Return staging to fail-closed per §17, and prove it independently.

## 6. Exact external prerequisites (all currently ABSENT)

Every variable below was checked in Process, User and Machine scope and is **absent**. The
previously-malformed `QF_STAGING_DB_URL` does **not** persist anywhere, so §5.1 is resolved
by absence rather than repair.

| Variable | Used by | Notes |
| --- | --- | --- |
| `QF_STAGING_SUPABASE_URL` | both seeds | must resolve to ref `uckafzuochmbvtiodmcl` |
| `QF_STAGING_SUPABASE_SERVICE_ROLE_KEY` | both seeds | **fresh** staging secret; a modern `sb_secret_…` works unchanged |
| `QF_META_ACCESS_TOKEN` | seed GET-only verification, canary send | secret |
| `QF_META_WABA_ID` | identity fence | digits, ≥6 |
| `QF_META_PHONE_NUMBER_ID` | identity fence | digits, ≥6 |
| `QF_META_GRAPH_API_VERSION` | Graph calls | exact `vNN.N` |
| `QF_STAGING_INDEX_PROOF_PATH` | 40.12 preflight | external path, 15-minute TTL, regenerate immediately before the run |
| owner-controlled canary destination | canary | E.164; stored as a **hash** only, never plaintext in Git, docs, migration or workflow JSON |

The Core runtime additionally needs `WHATSAPP_*` (see
`docs/provider-manifests/meta-whatsapp-runtime-config-manifest.json`) and, for the n8n leg,
the five `QF_N8N_*` / `QF_CORE_STAGING_BASE_URL` variables QF-MVP-50 already defines. 50.5
introduced no new variable and neither does this phase.

## 7. Staging credential hygiene — what was done this session

The previously-exposed staging service_role key must be **replaced**, not reused. The
acceptance path already tolerates a modern secret key: `lib/supabase.ts` and both staging
operators check presence only and assume no shape.

The **detection** path did not. `scanBuildOutput` recognised a leaked service credential in a
browser chunk either as a JWT whose payload claims `service_role`, or as an exact literal the
caller happened to pass in. A modern `sb_secret_…` key is not a JWT, so the self-evident
branch could not see it, and a leak of the newer credential was caught only when the literal
was supplied — strictly weaker than the legacy key already enjoyed. Detection is now by shape
for `sb_secret_` and `sbp_`, with `sb_publishable_` deliberately excluded as public by design.
Six new self-tests, all with `secrets: []`. Build gate: **49/49** (was 43).

## 8. Gate baseline at this branch head

All green, with no assertion weakened.

| Gate | Result |
| --- | --- |
| 40.2 / 40.3 / 40.4 / 40.6 / 40.8 | 43 / 52 / 39 / 42 / 73 — all 0 failed |
| 40.10A / Wave-1 readiness / 40.11 | 194 / 103 / 77 — all 0 failed |
| 40.12 / 40.12-R1 | 172 / 69 — 0 failed |
| build gate | 49/49 |
| QF-MVP-50.1A → 50.5, G1, bridge, forensic, certification | all 0 failed |
| communication suite, phase5b, 5F-B, D2-D, D3-B, D4-B, D4-C | all 0 failed |
| typecheck / lint / build / `git diff --check` | clean |

Four assertions were **failing at clean main** before this branch and were repaired without
weakening: 40.2 V24 and 40.8 G1/G6 proved a narrowness claim over a **moving `HEAD`**, and
40.8 G2 grepped the whole current tree — so all four had come to measure QF-MVP-50's
legitimately-owned migrations and routes. Each is now pinned to its own phase implementation
head, with a new `G0` proving that pin is a real ancestor of HEAD. `lib/communication/types.ts`
received a reviewed D3-B authority transfer for exactly one intervening hop
(`48c5807`, numstat `8 0`, additive `lead` recipient type;
`CONSENT_PRINCIPAL_TYPES` untouched and in fact newly pinned by that same commit).

## 9. Not done, and why

Sections 6–17 of the execution plan are blocked on §6's prerequisites. Specifically **not**
performed: any staging read or write; any Meta call of any kind; any provider activation; any
send; any webhook exercise; any n8n invocation; any campaign send. No production database
query, no production Meta call, no deployment.

`META_CANARY_MESSAGES_SENT: 0`. `NON_CANARY_DESTINATIONS_CONTACTED: 0`.
`PRODUCTION_DB_WRITES: 0`. `PRODUCTION_META_CALLS: 0`.
`PRODUCTION_DEPLOYMENT_PERFORMED: NO`.
