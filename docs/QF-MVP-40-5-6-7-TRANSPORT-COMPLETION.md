# QF-MVP-40.4-R + 40.5 / 40.6 / 40.7 — Transport Completion

Reconciles the template catalogue with the founder-ratified consent registry, completes the ordinary
outbound registry, and closes inbound, outbound-implementation and delivery **by evidence**.

No database access, no migration, no seed, no Meta call, no send, no activation.

---

## 1. Catalogue corrections (QF-MVP-40.4-R)

Six real defects were found and corrected. The manifest was wrong in every case; the registry and the
committed migrations were right.

| # | Defect | Correction | Evidence |
|---|---|---|---|
| 1 | Global warning implied *every* key enters the ordinary registry | Warning rewritten; per-entry `registry_expectation` added | `consentCommandResponse.ts` header: the acks are "DELIBERATELY ABSENT" |
| 2 | `client_nurture_followup` classified transactional | → **marketing** group, category, scope | `outboundConsentScope.ts` FOUNDER-RATIFIED block |
| 3 | `dormant_requirement_reactivation` classified transactional | → **marketing** group, category, scope | same |
| 4 | HELP copy pointed at `quickfurno.com/contact` | → `quickfurno.in`, domain-level only | no `app/contact` or `app/support` route exists; every real repo reference is `quickfurno.in` |
| 5 | `lead_assignment_alert` had contradictory semantics | Resolved **vendor-facing** | migration `20260708000170` seeds it as *"Assignment alert sent to vendor"* / *"Vendor final lead assignment confirmation"* |
| 6 | Risk of wiring `ACK_TEMPLATE_CATEGORY` to Meta | Documented as storage terminology; Meta candidate stays `utility` | live DB constraint `chk_comm_message_ephemeral_is_authentication` forces the lane |

Catalogue is now **25 templates**: authentication 3, consent_service 3, marketing 3,
transactional_business 16. Every entry remains `approval_status: draft`,
`submission_state: DRAFT_NOT_SUBMITTED`, `provider_template_id: null`.

## 2. Special acknowledgement authority boundary

`consent_stop_acknowledgement`, `consent_start_acknowledgement` and `consent_help_response` are
**not** in `outboundConsentScope.ts` and must never be.

Proved by test, not by assertion: `resolveOutboundConsentScope` returns `UNCLASSIFIED_MESSAGE_TYPE`
→ **DENY** for all three (rule G2). They are authorised only by the evidence-bound, one-shot enforcer
in `services/consentCommandResponseService.ts`, which requires a validated binding to the exact
inbound command. The registry contains no wildcard, prefix, regex or bypass path (G5).
**Mapping existence never creates ordinary consent authority.**

The lane they persist on (`authentication`) is **storage compatibility only** — the live `lane` enum
and the ephemeral-destination constraint force it, and it is also the only scope D2-C evaluates
against global suppression alone, which is exactly what a command response needs. It does not make
them authentication messages semantically; their internal classification is
`consent_command_response`.

## 3. Ordinary registry additions (QF-MVP-40.6)

Six entries added, each listed explicitly by exact key — no prefix, no pattern:

| Key | Lane | Scope |
|---|---|---|
| `client_lead_status_update` | business | transactional |
| `client_matching_update` | business | transactional |
| `vendor_response_reminder` | business | transactional |
| `vendor_onboarding_reminder` | business | transactional |
| `vendor_package_expiry_warning` | business | transactional |
| `vendor_crm_promotion` | business | **marketing** |

Registry rules unchanged: exact key only; `templateKey` must equal the message type; unknown type,
wrong template and wrong lane all fail closed; marketing never falls back to transactional.

## 4. `lead_assignment_alert` — evidence and final meaning

**Outcome (a): vendor-facing.** Migration `20260708000170` — whose objects are present in production
— seeds this key as *"Assignment alert sent to vendor"* and *"Vendor final lead assignment
confirmation"*. Its body (`"QuickFurno assigned lead {{1}} to you"`) and its lead-reference variable
were already correct; only the manifest metadata was wrong (it claimed `recipient_type: client`, a
purpose about matching vendors, and a bare count fixture of `"3"`).

Corrected to `recipient_type: vendor` with the confirmation purpose and a lead-reference fixture.
**Offer-vs-assignment truth is preserved:** `vendor_new_lead` is the offer and says so explicitly;
`lead_assignment_alert` fires only once assignment is final.

**Consequence.** The roadmap's *client* "matching update" family was then unhoused — the stray `"3"`
fixture was a vestige of that intent. The smallest correctly named template,
`client_matching_update`, was added to close it. It deliberately says vendors *may* contact the
client, never claiming an assignment or a guaranteed response.

## 5. Mapping and network-boundary proof (QF-MVP-40.6) — closed, no product edits

Already fully implemented and covered; nothing was rebuilt.

- Only an **approved + active** mapping resolves, matched on provider/channel/template/language
  (`providerTemplateMappingService`).
- The initial send **pins** `mappingId` + `mappingVersion` + content fingerprint.
- `prepareFinalOutbound` re-resolves the pinned mapping **by id**, re-validates it through the same
  strict selector, re-checks the pinned version, re-evaluates the **full runtime gate against freshly
  read rows**, then recomputes the fingerprint and compares with **exact equality**.
- A superseded version, an in-place edit under the same id+version, an unresolvable mapping, a paused
  provider, an un-readied account or an expired canary row all fail closed **with zero provider
  calls**.
- Unknown outcomes are terminal (`outcome_unknown` / `unknown_outcome`) and never auto-retried; the
  adapter contains no retry loop.

Harness evidence: `phase5f-b` 123/123, `phase8b1bb` 51/51, `phase5f-d3b` 93/93 — collectively
asserting *zero provider call* on every block path, pinned-mapping re-resolution, fingerprint
mismatch, superseded mapping and terminal unknown outcomes.

## 6. QF-MVP-40.5 inbound — **CLOSED by evidence, no product edits**

Exact raw bytes retained and signature verified **before** any decode or parse; WABA and phone-number
callback identity checked before any database effect; foreign / mixed / unprovable callbacks produce
**zero DB effects** and a generic 200; inbound persisted with provider-account lineage; replay and
idempotency enforced per account; STOP/START/HELP processed; the acknowledgement provider call is
**asynchronous via ack intents, never inside the webhook**; malformed UTF-8/JSON handled safely;
unsupported input classified and persisted safely; webhook results are bounded and generic.

Harness evidence: `phase8b1bc` 86/86, `phase5f-d1a` 47/47, `phase5f-d1b` 43/43, `phase8b1` 33/33,
`phase5f-d4c` 132/132.

## 7. QF-MVP-40.7 delivery — **CLOSED by evidence, no product edits**

The lifecycle is an explicit `ALLOWED_TRANSITIONS` table in `communicationService.ts`:

- **`accepted` comes from the outbound send response, not from Meta.** `META_STATUS_MAP` maps only
  `sent`/`delivered`/`read`/`failed` and is commented *"never accepted"*.
- Forward-only, with out-of-order jumps tolerated: `accepted → {sent, delivered, read, failed}`,
  `sent → {delivered, read, failed}`, `delivered → {read}`, `read → {}`.
- **`delivered → failed` is deliberately absent** — a confirmed delivery never regresses on a late or
  duplicated event.
- A same-state transition is valid **but treated as a no-op**, so a duplicate callback never rewrites
  timestamps.
- `outcome_unknown → {sent, delivered, read, failed}` only — never back to `retry_scheduled`,
  `dispatching` or `dead_letter`.
- Unknown callbacks are acknowledged safely; foreign-account callbacks have zero effect; receipt and
  event idempotency are enforced per provider account; provider failure metadata is sanitized.

## 8. Remaining blockers

| Blocker | Owner |
|---|---|
| Meta template approval (external, longest lead) | 40.4 external |
| No provider account in either environment | 40.10 |
| Staging has no runtime policy row | 40.10 |
| Owner sign-off on generic-STOP scope (A/B) | owner |
| Result-ingestion contract | 40.8 |
| Ack-worker / campaign pause switches | 40.9 |

## 9. Explicit non-actions

No database access or write · no migration created, edited or applied · no provider account, runtime
policy, mapping or canary seeded · no Meta call, template submission, message send or webhook
verification · no runtime gate enabled · no VPS access · no deployment · no n8n/Jarvis · no voice · no
campaign dispatcher or scheduler · campaign orchestration remains QF-MVP-50.
