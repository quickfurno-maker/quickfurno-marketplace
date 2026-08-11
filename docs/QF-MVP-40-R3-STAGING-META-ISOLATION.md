# QF-MVP-40-R3 — Dedicated Meta staging isolation lock

**Status: `QF_MVP_40_STATUS: IN_PROGRESS`.** Offline/source slice. No Meta app, WABA, phone,
webhook subscription or template was created or modified. No send. No provider activation.
No production action. No staging database write.

This document is **binding governance**. It does not alter the locked ten exit criteria and
marks no criterion complete.

---

## 1. THE LOCK — staging Meta isolation

QF-MVP-40 live certification, and every future pre-production WhatsApp certification, MUST
run against a **dedicated staging Meta control plane**:

1. a dedicated Meta **app** for QuickFurno staging;
2. a dedicated staging **WABA**;
3. a dedicated staging **sender phone number**;
4. a staging-only **App Secret**;
5. a staging-only **system-user / access token**;
6. a staging-only **WABA ID**;
7. a staging-only **Phone Number ID**;
8. a staging-only **webhook subscription / callback**;
9. an **owner-controlled canary recipient**, distinct from the staging sender;
10. **no callback or provider mutation on the production QuickFurno Meta app / WABA / phone.**

Binding consequences:

* The production QuickFurno business number **must not** be used as a staging sender, and its
  webhook **must not** be repointed for certification.
* An asset classified **`SHARED_OR_UNKNOWN` is a hard STOP** before any webhook mutation,
  provider activation or send. Absence of a classification *is* `SHARED_OR_UNKNOWN`.
* No staging callback may replace or repoint the production callback.
* **WABA subscription mutation is permitted only after the target WABA is independently
  proven staging-dedicated**, and only with separate owner authorization.
* The production business phone's health/verification remediation is a **separate
  operational task** (§6) and is explicitly not part of staging certification.
* The provider stays **fail-closed** until callback + identity + template + health readiness
  are all proven.

### 1.1 Why WABA-level isolation, not phone-level

Webhook subscription is made at **WABA level**: once an app is subscribed to a WABA, webhook
events for the phone numbers under that WABA are delivered to that app's configured endpoint.
A staging subscription on a WABA that also carries the production sender would therefore
redirect **production** callbacks. That is the specific failure this lock exists to prevent,
and it is why a dedicated WABA — not merely a dedicated phone — is required.

---

## 2. The machine-checkable guard

### 2.1 What did NOT already exist

There was **no** staging-dedicated identity concept anywhere in the repository before this
slice. The activation attestation already bound the project ref, branch HEAD, template keys,
account identity, canary destination hash, remote template state, readiness evidence, health
verdict, index-proof hash and plan digest — but nothing classified the Meta **asset**. The
`meta_whatsapp_cloud` provider key is the DB provider vocabulary; `meta_cloud` is the Core
`WHATSAPP_PROVIDER_MODE` value. Neither carries any notion of dedication.

So the guard is new. It is deliberately built **into the existing operator and attestation**
rather than as a second abstraction.

### 2.2 The limitation, stated truthfully

**Meta's Graph API exposes no field that proves an asset is a staging asset.** A WABA name, a
phone's `verified_name` and a subscribed-app list are free text or configuration. Deriving
"dedicated" from any of them would be exactly the fabricated evidence QF-MVP-40.12-R3 removed.

Therefore dedication is **attested by the owner**, out of band, in a short-lived external
artifact — and that attestation is **NECESSARY BUT NOT SUFFICIENT**.

### 2.3 The artifact

Produced by the owner, stored **outside the repository**, pointed at by
`QF_META_STAGING_ASSET_PROOF_PATH`. It contains **no secret**: only identifiers, a
classification, a commit and timestamps.

| Field | Meaning |
| --- | --- |
| `artifact` | exactly `qf-mvp-40-staging-meta-asset-proof` |
| `environment` | exactly `STAGING` |
| `project_ref` | the authorized staging Supabase ref |
| `branch_head` | the exact 40-hex commit the classification was made against |
| `intended_stage` | one of `PREFLIGHT_READONLY`, `ARM_READINESS`, `ARM_CANARY`, `WEBHOOK_SUBSCRIPTION` |
| `meta_app_id` / `waba_id` / `phone_number_id` | the dedicated staging asset identifiers |
| `asset_scope` | **only** `STAGING_DEDICATED` — "shared" is not an attestable value |
| `prohibited_asset_ids` / `prohibited_asset_digests` | the owner's production deny-list, by id or by SHA-256 digest; at least one entry required |
| `issued_at_ms` / `expires_at_ms` | TTL of **at most 15 minutes** |
| `nonce`, `proof_sha256` | replay identity and tamper detection |

`verifyStagingAssetProof()` refuses a missing, malformed, tampered, future-dated, long-lived,
expired, wrong-project, wrong-artifact, wrong-stage or self-contradictory proof — including
one that attests an asset the owner's own deny-list prohibits.

### 2.4 Why an attestation alone cannot authorize anything

`classifyMetaAssetScope()` returns `STAGING_DEDICATED` **only** when all of the following
hold, and `SHARED_OR_UNKNOWN` in every other case:

* the proof verifies;
* `branch_head` equals the commit actually running;
* the attested WABA and phone equal the **configured** identity;
* the attested WABA and phone equal the **live Meta GET readback**;
* every live subscribed app id equals the attested staging app;
* no live identifier appears on the owner's prohibited list.

So a proof that says "dedicated" while the live WABA differs is refused, and a proof minted
for another commit is refused. **The classification never arms and never sends** — it only
decides whether a scope-guarded stage may proceed at all.

### 2.5 Where it bites

`MODE_REQUIREMENTS` gains `assetScope`:

| Mode | `assetScope` |
| --- | --- |
| `DRY_RUN` | `false` |
| `PREFLIGHT_READONLY` | **`true`** |
| `ARM_READINESS` | **`true`** |
| `ARM_CANARY` | **`true`** |
| `DISABLE` | `false` — **emergency closure stays independent** |

`--disable` deliberately requires no staging-asset proof, for the same reason it requires no
Meta token, no index proof and no git HEAD: closing a gate must never be harder than opening
one.

The classification, the proof hash and a digest of the live asset identity are written into
the activation attestation and are part of its **drift fence**, so an attestation minted while
the asset was `STAGING_DEDICATED` cannot be spent after the classification, the proof or the
live WABA/phone/subscribed-app identity changes. `preflightForWrite` additionally hard-refuses
any attestation whose `asset_scope` is not `STAGING_DEDICATED`.

**Ordering note.** When the live identity already disagrees with the configured identity, the
existing, more specific `READINESS_EVIDENCE_INSUFFICIENT` remains the reported refusal — a
scope verdict must not mask an identity fault. Nothing can arm in that case either.

### 2.6 What contains no secrets

No real Meta identifier, phone number, token or App Secret appears anywhere in this
repository. The deny-list may be given as SHA-256 digests so the owner need not place
production identifiers in a shared file; the digest is a *no-identifier-in-git* device, **not**
a secrecy device — Meta identifiers are low entropy and a digest of one is not a secret.

---

## 3. Staging build path — no `.env.local` contamination

### 3.1 The refusal is correct and is not weakened

The §7 live attempt refused because `@next/env` resolved a **production-attributed**
`.env.local`: the effective `NEXT_PUBLIC_SUPABASE_URL` carried the production project ref, a
production service-role key was present, and `N8N_ENABLED` / `N8N_OUTBOUND_WEBHOOK_ENABLED`
were truthy. The gate refused **before** Next was spawned and nothing was built.

**No new mechanism was added.** `npm run build:staging:safe` already is the audited wrapper:
it resolves `.env*` exactly as `next build` does, evaluates the pre-build gates, spawns the
real build only on success, and rescans the produced output afterwards.

### 3.2 The supported operator sequence

`@next/env` only assigns keys that are **undefined** in `process.env`. Process-local variables
therefore win over any dotenv file — which is precisely why a wrapper-mediated build is
trustworthy and a bare `npm run build` is not. So the fix is to **supply staging values
process-locally**; `.env.local` is never edited, renamed or deleted.

Set process-locally, then run `npm run build:staging:safe`:

| Variable | Value |
| --- | --- |
| `QF_STAGING_SAFE_SESSION` | a truthy marker |
| `QF_STAGING_COMMAND_WRAPPER` | a truthy marker |
| `QF_AUTHORIZED_SUPABASE_PROJECT_REF` | the staging ref |
| `QF_PROHIBITED_SUPABASE_PROJECT_REFS` | **both** prohibited refs, comma separated |
| `NEXT_PUBLIC_SUPABASE_URL` | the **staging** project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | a staging **anon/publishable** key — browser-safe only |
| `SUPABASE_SERVICE_ROLE_KEY` | the staging **secret** key — server only |
| every `OUTBOUND_FLAG_VARS` entry | off/absent (this includes both n8n flags) |

The gate then proves: the effective ref is the staging ref; no prohibited ref appears anywhere
in the effective environment; both markers are present; the deny-list is complete; no outbound
flag is enabled; and after the build, that no prohibited ref and no privileged-key shape
(`service_role` JWT, `sb_secret_`, `sbp_`) reached a browser chunk. A contaminated output is
refused and removed.

**Do not** edit, rename or delete `.env.local` as a convenience. The wrapper does not need it
and no audited temporary-isolation mechanism exists for doing so.

---

## 4. Public callback preparation

**No tunnel was installed or invoked in this slice**, and no repository tooling provides an
HTTPS terminator — QF-MVP-50 uses signed HMAC transport between Core and n8n, which is a
different mechanism and is **not** a public inbound webhook terminator. There is nothing safe
to reuse, and nothing was created.

The future live callback must satisfy, all of them:

* a **public HTTPS** endpoint, valid certificate;
* forwarding to the **staging-bound** Core (built per §3, provider still disabled);
* exact route **`/api/webhooks/whatsapp/meta`**;
* **stable for the whole certification window** — a URL that rotates mid-run invalidates the
  subscription;
* subscribed **only** on the dedicated staging WABA (§1);
* `GET` verification succeeds — requires `WHATSAPP_WEBHOOK_VERIFY_TOKEN`; without it the route
  returns 403 to every request, by design;
* `POST` signature verification stays **exact-byte** HMAC-SHA256 over the raw bytes with
  `WHATSAPP_APP_SECRET`, header `x-hub-signature-256`;
* a **synthetic** callback does **not** satisfy the real inbound criteria (2, 6–8). Only a
  genuine Meta-signed inbound does.

---

## 5. n8n in this pre-send gate

The runbook's locked live order lists "isolated n8n, schedules inactive" in the Core/callback
block. It is **not executable now**: all seven `QF_N8N_*` / `QF_CORE_STAGING_BASE_URL`
variables are absent, and no Core staging endpoint exists. The frozen QF-MVP-50 contract owns
their vocabulary; **no value was chosen, no secret was invented and no schedule was enabled**
by this slice. A WhatsApp vendor canary is a direct Core→Meta send and does not require the
n8n leg.

---

## 6. SEPARATE WORK ITEM — production QuickFurno phone health

Observed by GET-only reads during the §7 measurement. **Recorded, not diagnosed, not fixed.**

| Fact | Observed value |
| --- | --- |
| `code_verification_status` | `EXPIRED` |
| `quality_rating` | `RED` |
| phone numbers on the WABA | exactly one real business phone |
| `subscribed_apps` at time of measurement | `0` |

No inference is made about *why* the quality rating is RED. Nothing in source attempts to
change these values. **This number is not a canary candidate.**

Owner operations checklist, to be done independently of staging certification:

1. verify the phone's registration and verification state in WhatsApp Manager;
2. inspect quality rating, messaging limits and any restrictions in WhatsApp Manager;
3. remediate through Meta's supported UI/API process;
4. re-check `subscribed_apps` — a business phone with no subscribed app delivers no inbound;
5. **do not couple this repair to QF-MVP-40 staging certification** in either direction.

---

## 7. OWNER SETUP PACKET — creating the dedicated staging Meta assets

Non-secret checklist. **No value below belongs in this repository, any document, any log or
any workflow JSON.** Everything is supplied **process-locally** at run time.

1. Create a **dedicated Meta app** for QuickFurno staging (separate from the production app).
2. Create a **dedicated staging WABA**.
3. Add a **dedicated staging phone number** that you control and that can receive SMS or voice
   verification. It must **not** be the production business number.
4. Complete **ownership verification** for that number.
5. **Register** the number for Cloud API and set its **two-step verification PIN**. An
   unregistered number cannot send.
6. Create a **staging system user / access token** with the minimum WhatsApp permissions the
   existing operator needs — it reads `whatsapp_business_management` and
   `whatsapp_business_messaging` scopes today.
7. Capture **process-locally only**: `QF_META_ACCESS_TOKEN`, `QF_META_WABA_ID`,
   `QF_META_PHONE_NUMBER_ID`, `QF_META_GRAPH_API_VERSION`, `WHATSAPP_APP_SECRET`.
8. Generate a **new unpredictable** `WHATSAPP_WEBHOOK_VERIFY_TOKEN` process-locally.
9. Keep the **owner-controlled canary recipient** separate from the staging sender:
   `QF_META_CANARY_DESTINATION_E164`. It is stored only as a hash; the plaintext never enters
   the database, git, a document or a log.
10. **Do not subscribe the WABA until the staging callback URL is proven** (§4).
11. After callback proof, subscribe **only** the dedicated staging WABA.
12. Verify `subscribed_apps` shows **exactly** the staging app and nothing else.
13. Verify the staging phone's registration and health are acceptable **before any send**.
14. Produce the §2.3 staging-asset proof and point `QF_META_STAGING_ASSET_PROOF_PATH` at it —
    outside the repository, regenerated immediately before each run because it expires in 15
    minutes.

Also reconcile the canonical Core runtime variables per the runbook §6, and remember
`verify:mvp:core-provider-env` requires **both** `WHATSAPP_APP_SECRET` and
`WHATSAPP_WEBHOOK_VERIFY_TOKEN` before a staging Core may start.

---

## 8. Status

```
QF_MVP_40_STATUS: IN_PROGRESS
DEDICATED_STAGING_META_ISOLATION: LOCKED (governance + machine-checkable guard)
STAGING_ASSET_SCOPE (current production assets): SHARED_OR_UNKNOWN
META_WRITES: 0   META_SENDS: 0   STAGING_DB_WRITES: 0   PRODUCTION_EFFECTS: 0
LOCKED_TEN_EXIT_CRITERIA: UNCHANGED — none newly marked complete
```
