# QF-MVP-40 — Execution Decisions

Locked decisions for QF-MVP-40 (Meta WhatsApp Production Readiness). Recorded during
**QF-MVP-40.1-R + QF-MVP-40.4**. Nothing in this phase submitted a template, called Meta,
enabled a runtime gate, touched a database, or deployed anything.

---

## 1. Campaign dispatch ownership — LOCKED

The QF-MVP-40.0/40.1 audit surfaced an ambiguity: roadmap 30.6 says *"n8n sends through Meta"* and
50.4 owns the campaign workflow, while 40.8 says campaign messages honour consent/frequency and
*"return results to CRM."* Read naively, 40.8 implies a Core-side campaign dispatcher. The owner
resolved it as follows.

**QF-MVP-40 owns** — Meta transport adapter; provider-account binding; template resolution;
dispatch-time consent / suppression / frequency **validation primitives**; provider outcome
normalization; provider message-id persistence; delivery callbacks; the **result-ingestion
contract** into Core/CRM; canary-safe Meta execution capability.

**QF-MVP-50 owns** — campaign job orchestration; n8n workflow execution; claiming and batching
campaign recipients; bounded dispatch scheduling; dead-letter workflow; pause/resume orchestration;
the per-recipient campaign execution loop; aggregation.

**Consequence, and the reason this is written down:** QF-MVP-40 must **not** build a temporary Core
campaign queue consumer. `services/campaignHandoffService.ts` already creates `communication_intents`
rows through the committed RPC `qf_handoff_vendor_campaign_intents_v1`, and today nothing consumes
them. That gap is **intentional** and stays open until QF-MVP-50. Building a stopgap consumer would
produce code with a scheduled demolition date and two competing execution paths in the interim.

A `pending` intent remains permission to **evaluate**, never permission to send. Whatever eventually
dispatches must re-check consent and suppression immediately before contacting a provider.

---

## 2. Minimum template strategy

The catalogue is the smallest set that satisfies the locked 40.4 families. Two consolidations were
made where a split would have produced two messages saying the same thing; both preserve category,
consent scope, variable meaning and auditability.

| Consolidated | Into | Why it is safe |
|---|---|---|
| Vendor accept/reject request | `vendor_new_lead` | The offer *is* the accept/reject request — one message, one moment, same recipient, same scope. Quick-reply buttons carry the decision. A separate template would double-message the vendor. |
| Vendor document reminder | `vendor_onboarding_reminder` | Same message with a different outstanding item. One **required** variable names the item, so the sentence is complete in both cases and there is no optional-variable ambiguity. |

Deliberately **kept separate**:

| Kept apart | Why |
|---|---|
| `lead_assignment_alert` vs `client_lead_status_update` | "We matched N vendors" and "your status is now X" are different facts. Merging them behind one variable would hide which event actually occurred. |
| `vendor_new_lead` vs `vendor_response_reminder` | Sending reminder traffic under the original offer copy would misrepresent a second contact as a new lead. |
| `low_credit_warning` vs `vendor_package_expiry_warning` | Balance-based vs time-based; they fire independently and a merged template could not state the correct remedy. |

Marketing and transactional purposes are **never** merged. `vendor_crm_promotion` is the only
marketing-category template in the catalogue.

### Meta category is not the internal consent scope

These are two different things that unfortunately share a word, and conflating them would get
templates rejected:

* **Meta submission category** — `authentication` is reserved by Meta for OTP-shaped templates. The
  consent acknowledgements are therefore submitted as **`utility`**. A body reading
  *"you have been unsubscribed"* would be rejected under Meta's authentication category.
* **Internal consent scope** — the acknowledgements run with scope **`authentication`**, because
  `services/consentAckWorkerService.ts` evaluates that scope against **global suppression alone**.
  That is exactly what allows a STOP acknowledgement to reach a user who has just sent STOP.

Related observation for a later subphase: `ACK_TEMPLATE_CATEGORY` in
`lib/communication/consentCommandResponse.ts` is declared but **never read** anywhere in the
repository, and Meta's send API takes no category (category is fixed at submission). It should not
be wired to the Meta submission category later — doing so would submit the acks as `authentication`
and they would be rejected. No product code was changed in this task.

### Acknowledgement copy accuracy

`services/communicationConsentWriterService.ts` P1 applies STOP/START to **both** the `marketing`
and `transactional` suppression scopes, and **START never creates marketing consent**. The copy
states exactly that:

* STOP ack does **not** claim that essential transactional updates keep flowing — in this
  implementation they do not.
* START ack does **not** promise promotional messages resume — that needs separate explicit consent.

---

## 3. No provider mapping becomes active before approval

No provider mapping row is created by this task, and no template is marked approved. Every entry
carries `approval_status: "draft"` and `submission_state: "DRAFT_NOT_SUBMITTED"`, with
`provider_template_id: null`.

Appearing in the manifest grants **no send permission**. Two further things must happen first, both
QF-MVP-40.6 work:

1. For an **ordinary** outbound type, `lib/communication/outboundConsentScope.ts` must register the
   template key — its registry blocks any unknown message type, so an unregistered template cannot
   send;
2. an approved provider mapping row must exist, which the outbound coordinator re-resolves by id and
   re-fingerprints at the network boundary.

> **Corrected in QF-MVP-40.4-R.** Point 1 previously read as though *every* catalogue key must enter
> that registry. That is false, and the exception is deliberate. The three consent acknowledgements
> — `consent_stop_acknowledgement`, `consent_start_acknowledgement`, `consent_help_response` — are
> **deliberately absent** from `outboundConsentScope.ts`, so an ordinary `resolveOutboundConsentScope`
> call for any of them returns `UNCLASSIFIED_MESSAGE_TYPE` and denies. Their absence *is* the
> mechanism that stops an arbitrary caller reusing the STOP-acknowledgement exception; they are
> authorised only by the evidence-bound, one-shot enforcer in
> `services/consentCommandResponseService.ts`, bound to a verified inbound command. A future approved
> provider mapping must never create ordinary consent authority for them. Adding one of these keys to
> the registry would be a security regression, and `npm run test:mvp:40-6` fails if anyone does.

---

## 4. No real Meta submission occurred

No Meta Graph API call, no template submission, no message send, no webhook call, no runtime gate
enabled, no database access, no VPS access, no deployment. Approval is an external dependency with
the longest lead time in QF-MVP-40 and is tracked as such.

---

## 5. Harness baseline repair (QF-MVP-40.1-R)

Four communication harnesses were failing before this task. All four were **governance drift or
harness fragility, not product defects** — product assertions were green throughout.

| Harness | Was | Repair |
|---|---|---|
| `phase5f-d4b` | B5 blob pin stale (`2ab3a76e`) | Explicit authority transfer to the current blob, with both intervening hops reviewed and documented in-file. |
| `phase8b1bd6w1` | 5.5 "no Wave 2/3 constraint migration present" rejected the approved successor | Re-expressed as an exact-identity invariant: exactly the one approved Wave 2A-R2 migration may exist; any unapproved sibling still fails. |
| `phase8b1bd6w2ar1` | SC2.x diffed `BASE..HEAD`, a moving endpoint | Range end pinned to the literal R2 implementation head; new `SC0.1` asserts that pin is a real ancestor of HEAD. |
| `phase8b1bd6w2ar2` | G6/G8 same moving-endpoint defect | Same repair; allowlist unchanged, no file added to it. `G5.1` asserts ancestry. |

**Principle applied:** a historical narrowness claim must be proved over a **fixed** commit range.
Ending such a range at a moving `HEAD` silently converts "this change was narrow" into "no later
phase may ever touch these paths", which is not what the governance record says and guarantees
failure as the project advances. No assertion was deleted, downgraded, or made conditional.

### Mutation-harness crash safety

`phase8b1bc` mutates real source files in place. Its `finally` covered exceptions but not signals,
and a SIGTERM during a synchronous `tsc` call left `services/metaWhatsAppWebhookService.ts` mutated
in the worktree. Signal handlers alone cannot fix this: Node cannot service a signal while the event
loop is blocked in `execFileSync`, which is where this harness spends most of its life — reproduced
directly (`timeout --signal=TERM`, exit 124, handler never ran).

The fix is therefore **on-disk and recovery-based**, not signal-based:

* every mutable target is snapshotted (exact bytes + file mode) **before** any mutation;
* originals are also written to a sidecar **outside the repository**, so they survive `SIGKILL`;
* each run begins by replaying any sidecar left by an interrupted predecessor, and adopts that
  predecessor's orphaned temp files;
* `finally`, signal handlers and `uncaughtException` remain as fast paths.

Verified end to end: `SIGKILL` mid-mutation leaves the worktree dirty (no code can run), and the
next run self-heals to a clean tree and passes 86/86.
