# QF-MVP-50.4 — Campaign Automation

**Status:** **SOURCE READY** — the per-recipient execution vehicle only.
**NOT staging certified. NOT live-provider ready. NOT complete.**

| State | Meaning | 50.4 today |
|---|---|---|
| SOURCE READY | vehicle contract and producer exist, gates green, migration written | **yes** |
| STAGING CERTIFIED | migration applied and behaviour observed on staging | no |
| LIVE PROVIDER READY | approved template + mapping + provider account | no — QF-MVP-40 / QF-MVP-80 |

## 1. What this phase is, and deliberately is not

Campaign execution was **already** specified and largely built. This phase adds the missing orchestration vehicle and nothing else. It creates no audience, no recipient authority, no metrics authority and no second send path.

Authorities that remain exactly where they already are:

| Concern | Authority | Unchanged |
|---|---|---|
| audience | `vendor_campaign_audience_members`, frozen at prepare, immutable (dense ordinals, UPDATE/DELETE blocked for every role) | yes |
| version | `vendor_campaigns.revision` | yes |
| batching | `qf_handoff_vendor_campaign_intents_v1` — **1–500, default 100** | yes |
| per-recipient unit | `public.communication_intents` | yes |
| consent / suppression / frequency | decided at handoff, re-proven by Core at execution | yes |
| execution seam | `docs/QF-MVP-40-8-CAMPAIGN-RESULT-CONTRACT.md` §7 | yes |
| aggregation | `getCampaignResultProjection`, derived from durable truth | yes |

## 2. The vehicle

One automation action/job per already-authorized campaign intent, produced in the **same transaction** as the intent insert by a trigger scoped strictly to `aggregate_type = 'vendor_campaign'`. The other aggregate types sharing that outbox (`lead_assignment`, `replacement`, `credit_restoration`, `lead`) are untouched.

The job is keyed by the **intent id**, not the campaign and not the vendor. That is what makes it a vehicle rather than a second recipient authority. Because the handoff inserts intents with `on conflict (idempotency_key) do nothing`, a replayed handoff creates no second intent and therefore no second job.

The action request carries an **empty safe context**: recipient, template, channel, consent scope, snapshot and campaign evidence all already live on the committed intent row, and copying any of them would create a second, divergeable copy of campaign truth.

## 3. The 40.8 execution seam

`docs/QF-MVP-40-8-CAMPAIGN-RESULT-CONTRACT.md` §7 is the binding integration spec, and it assigns claiming, batching, scheduling and the per-recipient loop to QF-MVP-50 — which is exactly and only what this phase supplies:

1. `buildCampaignExecutionPlan({ intentId })` — Core validates the intent and returns the derived plan.
2. Dispatch through the **existing** CommunicationService outbound path. Consent, suppression, frequency, mapping, provider-account and runtime gates are all re-checked at the network boundary.
3. `reconcileCampaignIntent({ intentId })` after dispatch and after any later delivery callback. Safe to call repeatedly.
4. Read `getCampaignIntentResult` per intent or `getCampaignResultProjection` per campaign.

## 4. `campaign.execute_batch` — registered but not produced

**Reason: `BATCH_ADVANCE_REMAINS_CORE_OWNED_HANDOFF`.**

Advancing a campaign to its next bounded batch stays the existing Core-owned admin action over `qf_handoff_vendor_campaign_intents_v1`. Producing a batch job here would add a second fan-out layer beside the handoff's own 1–500 bound — precisely the parallel authority this phase forbids. The action stays in the frozen registry for a future governed change.

## 5. Campaign status vocabulary is unchanged

The campaign business statuses remain exactly `draft`, `ready_for_review`, `approved`, `cancelled`, `archived`.

This phase deliberately does **not expand the state machine**: no `running`, no `paused`, no `completed`, and no `paused_at` / `resumed_at` column. The campaign model intentionally does not expose execution states, and repo truth outranks a generic pause/resume expectation. The migration self-verifies both that the vocabulary is unchanged and that no pause column was added.

Stopping a campaign remains `cancelled` / `archived`, plus simply not advancing the next batch.

## 6. Consent, suppression and frequency

None of these are decided by this phase. The campaign row (`vendor_campaigns.consent_scope`) remains the consent-scope authority, and the handoff enforces the asymmetry: **marketing requires an explicit current opt-in**, while transactional treats only an explicit block as final. Marketing permission is never inferred from transactional permission.

Suppression is keyed by destination hash, and the frequency policy hard-gates the handoff — zero active policies means zero intents created. Provider absence may fail closed; no live readiness is fabricated.

## 7. n8n has no business authority

n8n claims a Core-authorized job and drives the intent identity Core gave it. It never builds an audience, chooses a recipient, picks a template or provider, evaluates consent or frequency, or reports an aggregate. The producer accepts a single `p_intent_id uuid` — there is no recipient-array parameter anywhere.

Aggregation is recomputed from durable truth by `getCampaignResultProjection`; n8n never submits totals.

## 8. Boundaries

**QF-MVP-50.5** owns retry recovery, due sweeps, stale leases and dead-letter handling. None is implemented here.

## 9. What remains before QF-MVP-50.4 can be called COMPLETE

The campaign **execution route** (`campaign_execution` family) and the inactive campaign n8n executor workflow are not part of this source slice, and neither is staging certification. Until those exist and are certified against staging, 50.4 is SOURCE READY only.
