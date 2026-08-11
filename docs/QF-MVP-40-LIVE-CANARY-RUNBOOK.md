# QF-MVP-40 — live staging canary runbook

**Status: QF_MVP_40_STATUS: IN_PROGRESS.** Offline lock only. Nothing here has been executed:
no staging connection, no Meta call, no migration, no send. Production untouched.

Branch `mvp/qf-mvp-40-final-provider-canary`. Migration `20260813000000` is
**SOURCE-PENDING / NOT_PROVEN_OFFLINE / UNAPPLIED**.

---

## 1. Why there must be TWO canary cycles, not one

`qf_arm_meta_canary_v1` activates **exactly one** ordinary-business mapping and refuses when
any unrelated mapping is already active. So this is invalid and cannot be executed:

> ~~one `--arm-canary` → vendor canary → client canary → disable~~

A mapping is never switched in place, and the vendor canary is never left armed while the
client canary is attempted. **Maximum two real outbound messages for the whole phase.**

### Vendor cycle

| # | Step | Proof |
| --- | --- | --- |
| 1 | provider fail-closed | policy `disabled`, 0 active mappings, 0 active canary rows |
| 2 | `--preflight-readonly --attest-for=readiness` | attestation stage `ARM_READINESS`, exact HEAD |
| 3 | `--arm-readiness` | readback `readiness_only` / outbound false / 0 active / 0 canary |
| 4 | `--preflight-readonly --attest-for=canary --templates=vendor_onboarding_reminder` | attestation stage `ARM_CANARY` |
| 5 | `--arm-canary --templates=vendor_onboarding_reminder` | readback `canary` / outbound true |
| 6 | prove exactly one active mapping | `= vendor_onboarding_reminder`, and exactly one active canary hash |
| 7 | **one** real vendor WhatsApp canary | one `communication_messages` row, one provider call |
| 8 | delivery callback | verified signature, canonical status advance |
| 9 | `--disable` | one RPC, no Meta credential required |
| 10 | independent fail-closed readback | frozen gate refuses for every destination |

### Client cycle — a full restart, because `--disable` closes provider readiness

| # | Step |
| --- | --- |
| 1 | fresh `--preflight-readonly --attest-for=readiness` |
| 2 | `--arm-readiness` |
| 3 | `--preflight-readonly --attest-for=canary --templates=<client template>` |
| 4 | `--arm-canary --templates=<same client template>` |
| 5 | prove exactly one active mapping = that client template |
| 6 | **one** real client WhatsApp canary |
| 7 | delivery callback |
| 8 | `--disable` |
| 9 | independent fail-closed readback |

Client template: **`client_matching_update`** or **`client_lead_status_update`** — both
approved UTILITY with a proven variable contract. Pick one; the other stays inactive.

**If a send outcome is uncertain, or the delivery callback is not proven: DO NOT RESEND.**
Disable immediately, preserve the evidence, and report the blocker.

## 2. Core and n8n are ready BEFORE any provider gate opens

Arming is the **last** thing that happens before each send, never the first.

1. migration / seed / readiness preconditions
2. `npm run verify:mvp:core-provider-env`
3. `npm run build:staging:safe`
4. post-build production-ref + privileged-key + Meta-token scan
5. start staging-bound Core **with the provider still disabled**
6. load isolated n8n, **schedules INACTIVE**
7. prove the callback route is externally reachable
8. only then arm readiness → arm canary, immediately before the send

### QF-MVP-50.5 safety is permanent

Before every non-rollbackable workflow invocation: seed a **guaranteed-oldest** exact
fixture; immediately issue an **independent** DB query proving the exact selector candidate;
only then invoke n8n **manually**; query the DB independently again afterwards. Never trust
the execution list or a poller's silence — that is precisely how nine real client jobs moved
during the 50.5 certification. Never touch or reseed the eight historical failed orphan
jobs. Never weaken a production selector.

## 3. Locked exit-criteria matrix

The roadmap's ten criteria, each with its test path and current executability.

| # | Locked criterion | Test path | Expected evidence | Owner phone action | Executable now | Blocker |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | staging webhook verified | Meta GET `/{waba}/subscribed_apps` in preflight + Meta-side subscription | `webhookSubscribed` true; account `webhook_status = verified` | no | **no** | needs credentials + a publicly reachable callback URL |
| 2 | signed inbound callback accepted | owner sends a real inbound to the canary number → `app/api/webhooks/whatsapp/meta/route.ts` | verified signature; `communication_inbound_messages` row; webhook receipt | **yes** | **no** | needs `WHATSAPP_APP_SECRET` + reachable URL |
| 3 | foreign callback → zero effects | replay a callback whose account/WABA/phone is not the configured account | zero rows written, zero status change | no | **no** | needs a live endpoint |
| 4 | template send succeeds | vendor cycle step 7, then client cycle step 6 | one `communication_messages` row per canary, provider accepted | no (owner receives) | **no** | needs credentials + armed canary |
| 5 | delivery lifecycle updates Core | real Meta status callbacks for each canary | monotonic `sent → delivered`; duplicate is a no-op; no regress to failed | no | **no** | needs criterion 4 |
| 6 | STOP blocks future promotional messages | owner sends **STOP** from the canary number | suppression rows for marketing **and** transactional; promotional eligibility denied | **yes** | **no** | needs live inbound |
| 7 | START restores only permitted communication | owner sends **START** | suppression cleared; marketing **still** default-denied — START never creates marketing consent | **yes** | **no** | needs live inbound |
| 8 | HELP responds safely | owner sends **HELP** | inbound verified, attributed, persisted; ack only via the evidence-bound one-shot enforcer, or a proven correct no-send | **yes** | **no** | needs live inbound |
| 9 | campaign canary succeeds | §4 — not currently possible | — | no | **no** | **no approved MARKETING template, no marketing consent, no active frequency policy** |
| 10 | no voice path exists | offline source guard | zero voice/call/transcription surface | no | **yes** | **none — satisfied** |

**Only criterion 10 is satisfiable offline, and it is satisfied.** Nine of ten are live claims.

### STOP / START / HELP rules

Owner-controlled canary contact **only** — never a real customer or vendor. A real
Meta-signed inbound webhook is required; a synthetic POST does not satisfy criteria 6–8.
Capture consent state before and after. Restore **only** through canonical START semantics —
never a direct database edit.

## 4. Campaign canary — OWNER DECISION PACKET

Criterion 9 is a genuine QF-MVP-40 blocker. Utility canaries do not satisfy it, and
QF-MVP-40 must **not** be marked complete after the vendor and client utility canaries alone.

Explicitly forbidden as substitutes: the quarantined `qf_consent_help_response_v2`
(APPROVED but **MARKETING** category), any evidence-bound acknowledgement template, or
re-classifying a UTILITY template as marketing. No consent may be invented. No frequency
threshold or window may be chosen for the owner. Nothing is submitted to Meta by this slice.

### 4.1 Proposed minimal template

| Field | Proposal |
| --- | --- |
| internal key | `vendor_crm_promotion` — the catalogue's **only** marketing-category entry, already reserved for exactly this |
| provider name | `qf_vendor_crm_promotion_v1` (unused; `_v1` is free) |
| Meta category | **MARKETING** — the real thing, not a re-labelled utility |
| language | `en` |
| **variables** | **ZERO — recommended.** A zero-variable body needs no binding contract, no source keys and no `variables_schema`, so it removes the entire class of "wrong value rendered into a real customer message". It is also the smallest possible approval surface. |
| body intent | a single sentence offering QuickFurno vendor-growth information, with no personalisation, no price, no offer code and no urgency language |
| buttons | none — a marketing template with no button is the smallest reviewable artefact |

**Owner decision required:** approve the zero-variable form, or state the exact required copy.

### 4.2 Consent prerequisite

Marketing sending requires a **real marketing opt-in** for the canary recipient. Facts that
constrain this:

* `resolveOutboundConsentScope` must classify the template as marketing scope;
* marketing **default-denies** — absence of consent is a refusal, not a gap to fill;
* **START does not create marketing consent** (`communicationConsentWriterService` P1), so
  the owner cannot produce it by texting START;
* therefore a genuine, recorded, auditable marketing opt-in for the owner-controlled canary
  identity must exist through the canonical consent path.

**Owner decision required:** which canonical mechanism records that opt-in, and confirmation
that using the owner's own number as a consenting marketing recipient is acceptable.

### 4.3 Frequency policy — fields still needing owner values

`communication_frequency_policies` is append-only; one active row per `(channel, scope)`, and
`window_length` is bounded by `cfp_window_length_check` at ≤ 8760 hours. Required values:

| Column | Meaning | Value |
| --- | --- | --- |
| `channel` | `whatsapp` | fixed |
| `scope` | `marketing` | fixed |
| `max_per_window` | how many marketing messages per window | **OWNER MUST DECIDE** |
| `window_length` | the window (interval, ≤ 8760h) | **OWNER MUST DECIDE** |
| `min_interval` | minimum gap between two marketing messages | **OWNER MUST DECIDE** |
| `effective_from` | activation instant | operator, at apply time |
| `is_active` | true | fixed |

No default is proposed. A frequency threshold is a business commitment about how often a real
person may be contacted, and inventing one would put a number the owner never chose in front
of customers.

### 4.4 Submission path to resume, for ONE template only

The submission pause is `PAUSED`; its resume condition is *"An ACTIVE implementation phase
must require a specific template. Only then is a new subset proposed, reviewed and separately
authorized — one exact key per operator run."* Criterion 9 is exactly such a requirement, so
resumption is legitimate **for this one key** — but it needs its own authorization, not this
document's.

1. add `vendor_crm_promotion` as a reviewed subset of exactly one key;
2. owner authorizes that subset explicitly;
3. `scripts/mvp/communication/submit-meta-templates.mjs`, one exact key per run;
4. record real remote state in `docs/provider-manifests/meta-template-remote-state.json`;
5. **Meta approval is an external dependency with the longest lead time in QF-MVP-40** and
   cannot be scheduled;
6. only on APPROVED + MARKETING does a mapping become creatable.

### 4.5 Campaign canary path once approved

Frozen audience → Core recalculates eligibility → consent + suppression + frequency checked →
audience snapshot frozen → admin approval → `campaignHandoffService` creates
`communication_intents` → QF-MVP-50.4 `campaign.execute_recipient` claims one recipient →
`execute-campaign` → CommunicationService → Meta. Bounded to the single owner-controlled
canary recipient, armed and disabled as its own third cycle.

## 5. Locked live order

**Foundation** — 1 exact branch/head/tree · 2 fresh staging credentials, no values logged ·
3 fresh staging `sb_secret_` (the exposed legacy service_role key is **not** reused) ·
4 correct `QF_STAGING_DB_URL`, process-local only · 5 production/Jarvis refs refused.

**Migration** — 6 isolated temp migration directory outside the repo · 7 fetch remote
history · 8 prove exactly one local-only target `20260813000000` · 9 dry-run names only that
target · 10 apply once · 11 independent relist 30 → 31 · 12 exact catalog diff ·
13 rollback-only behavioural certification of all three RPCs · 14 zero certification residue.

**Seeds** — 15 internal-template seed: dry-run → preflight → one execute → exactly 8 rows ·
16 fresh external index proof outside the repo · 17 40.12 mapping seed: dry-run → preflight →
one execute · 18 readback: 8 approved **inactive** mappings, one **disabled** account,
provider fail-closed.

**Core / callback** — 19 reconcile `QF_META_*` with `WHATSAPP_*` · 20
`verify:mvp:core-provider-env` · 21 `build:staging:safe` · 22 post-build ref + secret scan ·
23 start staging Core fail-closed · 24 isolated n8n, schedules inactive · 25 callback route
externally reachable · 26 webhook subscription / identity / health GET proof.

**Vendor cycle** — 27–34 per §1. **Client cycle** — 35–42 per §1.

**Inbound / consent** — 43 real HELP · 44 real STOP · 45 prove promotional eligibility
blocked · 46 real START · 47 prove only permitted communication restored · 48 signed / replay
/ foreign callback negatives · 49 final fail-closed provider readback.

**Campaign** — 50 only after an approved MARKETING template **and** real marketing consent
**and** an owner-approved active frequency policy · 51 if absent, QF-MVP-40 stays
**IN_PROGRESS**.

**Closeout** — 52 update evidence/docs/manifests · 53 all 40.x + frozen 50.x + security/build
gates · 54 COMPLETE / TESTED / FROZEN **only if every locked criterion passes** · 55 one PR,
exact-head CI, true merge commit · 56 **no production deployment**.

## 6. Credential env names for the live run

*Activation operator:* `QF_STAGING_SUPABASE_URL`, `QF_STAGING_SUPABASE_SERVICE_ROLE_KEY`,
`QF_META_ACCESS_TOKEN`, `QF_META_WABA_ID`, `QF_META_PHONE_NUMBER_ID`,
`QF_META_GRAPH_API_VERSION`, `QF_STAGING_INDEX_PROOF_PATH`,
`QF_META_CANARY_DESTINATION_E164`; optional `QF_ACTIVATION_BRANCH_HEAD` (must equal actual
HEAD), `QF_ACTIVATION_ATTESTATION_PATH`.

*Canonical Core Meta runtime:* `WHATSAPP_PROVIDER_MODE` (= `meta_cloud`),
`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`,
`WHATSAPP_GRAPH_API_VERSION`, `WHATSAPP_HTTP_TIMEOUT_MS`, `WHATSAPP_AUTH_HTTP_TIMEOUT_MS`,
optional `WHATSAPP_HEALTH_HTTP_TIMEOUT_MS`.

*Webhook:* `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`. Callback path
`app/api/webhooks/whatsapp/meta/route.ts`; subscription object **whatsapp_business_account**;
fields **messages** (inbound and delivery status) and **message_template_status_update**.

*Staging DB / migration:* `QF_STAGING_DB_URL` (session pooler, process-local only).

*n8n signed transport:* `QF_N8N_TRANSPORT_MODE`, `QF_AUTOMATION_RUNTIME_ENV`,
`QF_N8N_TRANSPORT_ENABLED`, `QF_CORE_STAGING_BASE_URL`, `QF_N8N_WORKER_ID`,
`QF_N8N_TO_CORE_HMAC_SECRET`, `QF_CORE_TO_N8N_HMAC_SECRET`.

*Emergency closure needs ONLY:* `QF_STAGING_SUPABASE_URL` +
`QF_STAGING_SUPABASE_SERVICE_ROLE_KEY`.

No value of any of these appears in this repository, in any evidence file, or in any log.
