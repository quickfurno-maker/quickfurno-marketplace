# QF-MVP-40.12-R1 — Business template binding governance

**Status:** offline governance only. The `BINDING_SCHEMA_UNPROVEN` blocker is resolved for the five
approved ordinary business templates. **The staging seed was NOT executed.**
**Scope:** no Supabase, no Meta, no credentials, no provider account, no mapping, no runtime policy,
no message, no migration, no deployment.

---

## 1. The block that was correct

QF-MVP-40.12 Stage A committed the seed operator at `16fd16a`, then refused to proceed. That refusal
was right and is preserved.

A mapping row's `variables_schema` binds each Meta positional parameter to a **named** source key,
and `renderWhatsAppTemplateComponents` resolves those names against the intent's `variables`.
Positions alone are meaningless without an authoritative name — and the repository had none:

- a description like `"client name"` describes a value, it does not name a key;
- an example like `"1": "Asha"` is a fixture, not a contract;
- object insertion order is not a contract, and the renderer deliberately refuses to infer from it;
- a migration comment is documentation, not a runtime source-key contract.

I verified: **no `sourceKey` existed anywhere** in `lib/`, `services/`, `docs/` or `supabase/` for
these five, and no migration seeded a mapping `variables_schema`. The only source keys with genuine
live-caller proof were `otp` (three authentication services) and `{}` (the acknowledgement worker).

Fabricating names would have written the **wrong value into a real customer message** the moment a
mapping was activated — a silent, high-blast-radius defect. So the operator refused.

---

## 2. Discovery

| Template | Positions | Semantic value | Existing caller | Existing key | Gap |
| --- | --- | --- | --- | --- | --- |
| `lead_received` | 1 | client display name | *none* — key appears only in `outboundConsentScope.ts` | — | no named key |
| `client_lead_status_update` | 1, 2 | client name, status label | *none* | — | no named keys |
| `client_matching_update` | 1, 2 | client name, vendor count | *none* | — | no named keys |
| `lead_assignment_alert` | 1 | lead reference | *none* | — | no named key |
| `vendor_onboarding_reminder` | 1 | outstanding item | *none* | — | no named key |
| *(reference)* auth templates | 1 | OTP | `vendorVerificationService`, `vendorPasswordResetService`, `supabaseSendSmsHookService` | `otp` | none — live-caller proven |
| *(reference)* 3 acknowledgements | 0 | — | `consentAckWorkerService` (`variables: {}`) | — | none — zero-variable |

The five business triggers are **not operationally wired**. Per the phase brief, that absence does
not require inventing a live caller: this phase establishes the canonical **future** caller API as a
typed pure contract that is the only accepted construction path, fully pinned by tests.

---

## 3. The canonical contract

[`lib/communication/businessTemplateVariables.ts`](../lib/communication/businessTemplateVariables.ts)

| Template | Position | Source key | Type |
| --- | --- | --- | --- |
| `lead_received` | 1 | `client_name` | text |
| `client_lead_status_update` | 1 / 2 | `client_name` / `lead_status_label` | text |
| `client_matching_update` | 1 / 2 | `client_name` / `matched_vendor_count` | text |
| `lead_assignment_alert` | 1 | `lead_reference` | text |
| `vendor_onboarding_reminder` | 1 | `outstanding_item` | text |

Builders — the only accepted construction path:

```
buildLeadReceivedVariables({ clientName })
buildClientLeadStatusUpdateVariables({ clientName, leadStatusLabel })
buildClientMatchingUpdateVariables({ clientName, matchedVendorCount })
buildLeadAssignmentAlertVariables({ leadReference })
buildVendorOnboardingReminderVariables({ outstandingItem })
```

Each returns exactly the declared keys and nothing else; rejects missing, empty, blank, non-string,
object, array, over-length and control-character input; never silently defaults; and emits only
after every field validates, so a partial record cannot escape. `matched_vendor_count` accepts a
non-negative safe integer or a plain decimal string and renders a deterministic decimal — NaN,
floats, negatives, arrays and comma-separated identity lists are all refused.

The vocabulary is **closed at five keys**. `destination`, `phone`, recipient identifiers, UUIDs,
WABA/phone-number/provider ids, tokens, arbitrary metadata and payload JSON are not in it and rule
`B8` fails if one appears.

The module is pure: no env, database, network, clock or logging; it never enqueues, sends, or
chooses a recipient. **It authorizes nothing.**

### 3.1 Contract-ready is not trigger-wired

These keys were **not** found in a pre-existing live caller, and the manifest says so in every one
of the five entries and in its top-level notes (`B14`, `B15`). No automation was enabled. The
builders exist so that when a trigger is eventually wired, the caller and the mapping row cannot
disagree about variable names.

---

## 4. Manifest ↔ code ↔ renderer parity

A manifest edit alone must never unlock a seed, so the operator's fence now requires **two**
authorities to agree: the manifest must say `resolved` and carry a `source_key`, **and** the typed
code contract must match it exactly on template key, binding version, count, position, source key,
component and parameter type. A docs-only `source_key` is explicitly refused (`S49`), as is any
mismatch (`S50`), and a zero-variable template carrying a code contract (`S51`).

The operator holds **no parallel hand-maintained key list** (`B39`) — it imports the contract
through the repository's existing TS loader.

[`validate-business-template-bindings.mjs`](../scripts/mvp/communication/validate-business-template-bindings.mjs)
(`npm run test:mvp:40-12-r1`) exercises the **real** builders and the **real**
`renderWhatsAppTemplateComponents` — it does not grep for expected words. It proves, among other
things, that the renderer orders by declared position; that reversing object insertion order changes
nothing; that reversing the binding array does **not** change rendered order (position is never
inferred from index); that swapped semantic values render differently; that a renamed or duplicate
key is rejected; and that each example fixture translates only through the declared source keys.

---

## 5. What did not change

Meta-approved body copy and **every payload fingerprint** are untouched, as are the approved set of
eight, wave counts `1/14/3/3/4`, total 25, remote-state evidence and history, mapping state (none
exist, none active), all authorization flags, and `outboundConsentScope.ts` — the three
acknowledgements remain zero-variable and deliberately absent from the ordinary registry.

Only the manifest **binding metadata** changed for exactly five entries; dependent artefacts were
regenerated so their manifest-hash pins are truthful. All generators are byte-identical across two
runs.

### 5.1 A closed artefact keeps its historical pin

Regenerating the packet moved its hash, which broke two rules that required the **closed** subset-2
review to pin the *current* packet. That is the same question I settled in 40.10F for the canary
review, so the same answer applies: an **open** artefact must pin today's packet; a **closed** one
keeps its closure-time hash, because re-pinning it on every later change destroys the record it
exists to preserve. Content integrity is not waived — the closed subset must still quote the packet
verbatim. Both rules are now status-aware, with mutants covering the open (stale pin) and closed
(malformed pin) branches.

---

## 6. Validation

| Gate | Result |
| --- | --- |
| `npm run test:mvp:40-12-r1` | **69 passed, 0 failed** (44 rules, 25 mutation self-tests) |
| `npm run test:mvp:40-12` | 89 passed, 0 failed (51 rules, 38 mutants) |
| `npm run test:mvp:40-11` | 77 passed, 0 failed |
| `npm run test:mvp:40-10a` | 193 passed, 0 failed (110 rules, 83 mutants) |
| Wave 1 readiness validator | 102 passed, 0 failed |
| `40-2` / `40-3` / `40-4` / `40-6` / `40-8` | 43 / 52 / 39 / 42 / 72, 0 failed |
| `npm run test:mvp:communication` | PASS |
| `npm run test:phase5f:d3b` | 93 passed, 0 failed |
| `npm run typecheck` | PASS |
| `npm run test:mvp:build-gate` | PASS |

`npm run seed:mvp:40-12` (offline dry run) now reports all eight ready:

```
consent_help_response          EVIDENCE_BOUND_ACK  binding: OK (NO_VARIABLES)
consent_stop_acknowledgement   EVIDENCE_BOUND_ACK  binding: OK (NO_VARIABLES)
consent_start_acknowledgement  EVIDENCE_BOUND_ACK  binding: OK (NO_VARIABLES)
lead_received                  ORDINARY_BUSINESS   binding: OK (PROVEN_SOURCE_KEYS)
client_lead_status_update      ORDINARY_BUSINESS   binding: OK (PROVEN_SOURCE_KEYS)
client_matching_update         ORDINARY_BUSINESS   binding: OK (PROVEN_SOURCE_KEYS)
lead_assignment_alert          ORDINARY_BUSINESS   binding: OK (PROVEN_SOURCE_KEYS)
vendor_onboarding_reminder     ORDINARY_BUSINESS   binding: OK (PROVEN_SOURCE_KEYS)
```

Zero database connections, zero Meta calls, zero writes. `BINDING_SCHEMA_UNPROVEN` was **not**
weakened or removed — it still fires on unresolved readiness, a missing `source_key`, a missing code
contract, a manifest/code mismatch, a position or parameter-type mismatch, an unknown template, an
extra key or a duplicate key.

---

## 7. Remaining blocker and safe resume

The staging seed is still blocked on **`ENV_MISSING`**: the six phase-scoped variables
(`QF_STAGING_SUPABASE_URL`, `QF_STAGING_SUPABASE_SERVICE_ROLE_KEY`, `QF_META_ACCESS_TOKEN`,
`QF_META_WABA_ID`, `QF_META_PHONE_NUMBER_ID`, `QF_META_GRAPH_API_VERSION`) are all absent. The
earlier owner authorization does **not** remove the operator's runtime credential and identity
fences.

Safe resume, from the pushed SHA, with the six variables loaded into the process environment only
(never written to a file):

1. `npm run seed:mvp:40-12` — offline dry run
2. `npm run seed:mvp:40-12 -- --preflight-readonly` — staging reads + Meta GET only, zero writes
3. exactly one `npm run seed:mvp:40-12 -- --execute`

---

## 8. Status

```
QF-MVP-40.12-R1 COMPLETE — OFFLINE ONLY
BUSINESS TEMPLATE BINDING GOVERNANCE RESOLVED
FIVE ORDINARY TEMPLATE VARIABLE CONTRACTS CODE-PROVEN
THREE CONSENT ACKNOWLEDGEMENTS REMAIN ZERO-VARIABLE AND EVIDENCE-BOUND
META-APPROVED COPY AND PAYLOAD FINGERPRINTS UNCHANGED
QF-MVP-40.12 OPERATOR DRY RUN READY FOR ALL EIGHT
NO DATABASE OR META CALL
NO PROVIDER ACCOUNT OR MAPPING WRITTEN
NO MAPPING ACTIVATED
NO MESSAGE SENT
LIVE STAGING SEED STILL NOT EXECUTED
REMAINING BLOCKER: SIX PHASE-SCOPED LIVE ENVIRONMENT VARIABLES
```

---

## 9. Explicitly NOT done

- No Supabase connection, read, write or migration, in any environment.
- No Meta API call of any kind; no credentials requested, loaded or read.
- No provider account, mapping, runtime policy, webhook or canary.
- No message sent; no automation or business trigger enabled or wired.
- No `--preflight-readonly` and no `--execute` run.
- No change to Meta-approved copy, payload fingerprints, approval or submission state.
- No change to `outboundConsentScope.ts`, provider adapters, send paths, routes, migrations,
  generated DB types, `.env` files, the lockfile, n8n/Jarvis or deployment files.
- Template submission remains PAUSED; no subset 3 exists.
