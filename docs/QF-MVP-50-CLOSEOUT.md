# QF-MVP-50 — Automation orchestration closeout

**Status: SOURCE COMPLETE. ALL TEN POST-ANCHOR MIGRATIONS APPLIED TO STAGING.
50.5 CERTIFIED AT BOTH LAYERS — DATABASE 65/65 AND SIGNED HTTP THROUGH REAL n8n.**

This document records what QF-MVP-50 actually delivers and, just as precisely, what it
does not. It authorizes no production change.

---

## 1. Phase ledger

| Phase | Scope | Source | Staging DB | Runtime certification |
| --- | --- | --- | --- | --- |
| 50.1A | pure action contract | complete | n/a | n/a |
| 50.1B | durable job / attempt persistence | complete | applied | n/a |
| 50.1C | signed n8n transport ledger (`claim_v1`) | complete | applied | certified |
| 50.2A–2C | dispatcher candidate, recipient lane | complete | applied | certified |
| 50.2D | signed attempt completion (`complete_v1`) | complete | applied (history 21) | certified |
| 50.2E | signed client execution (`execute_v1`) | complete | applied (history 22) | certified |
| 50.2 FINAL | atomic client producer + two repairs | complete | applied (histories 23–25) | certified |
| 50.3 | vendor workflows | complete | applied (histories 26–27) | certified |
| 50.4 | campaign recipient automation | complete | applied (history 28) | certified |
| 50.3/50.4 | family-aware claim routing repair | complete | applied (history 29) | certified |
| **50.5** | **recovery + reconciliation** | **complete** | **applied (history 30)** | **certified: database 65/65 + real n8n signed HTTP, fence 10/10** |

Staging remote history is **30**. Local migration count is **97**. Every post-anchor
migration is now APPLIED and the manifest's pending set is present and empty.

`20260812000000` was applied under its own deployment gate: an exact-one dry run naming
that file alone with `seeds: []` and `roles: []`, one push, then an **independently
issued** re-list confirming 30 remote versions, zero local-only and zero divergence. A
before/after catalog diff confirmed the change is exactly the designed surface — four new
`SECURITY DEFINER` functions, two guards replaced, route vocabulary 3 → 5, state
vocabulary 5 → 7, and the recover-generation unique index — with no table, column or type
added and no data row modified. Full evidence:
`docs/QF-MVP-50-5-STAGING-CERTIFICATION.md`.

## 2. What the automation lane can now do end to end

1. A business event creates an **authorized action request** and, atomically, a **job**.
2. A family-aware executor **claims** exactly one fresh `pending` job of its own family
   through the signed `claim_v1` route, which increments `attempt_count` once and opens an
   attempt.
3. It asks Core to **execute** that exact attempt through `execute_v1`. Core rebuilds
   every business fact from its own ledgers — action, family, entity, recipient, template,
   variables, consent, provider mapping, idempotency key — and executes through its own
   communication subsystem. n8n chooses nothing.
4. It **completes** the attempt through `complete_v1`, where Core derives the
   classification and safe code from its own communication ledger.
5. A retryable outcome parks the job in `retry_scheduled`; QF-MVP-50.5 **recovers** it
   when due, and **reconciles** an attempt whose executor died, from durable evidence
   only.

The three workflow families — `client_whatsapp`, `vendor_whatsapp`, `campaign_execution`
— share one queue safely: the claim is fenced by family against durable action truth, so
no executor can irreversibly strand another family's work.

## 3. Invariants that hold across the whole phase

- **n8n holds no business authority.** Every signed request carries identity fields only
  (three, five or six keys depending on the route). No recipient, destination, template,
  variable, provider, account, consent, classification, safe code, retry timestamp or
  staleness threshold appears in any request schema — an extra field is refused outright
  rather than accepted and ignored.
- **One claim per job, forever.** `uq_automation_transport_requests_claim_job` was never
  relaxed, including by the recovery phase, which uses its own route and its own
  retry-generation uniqueness instead.
- **Replays never re-execute.** A duplicate request UUID is answered from durable truth
  and is never handed an executable envelope.
- **No stored verdicts.** The transport ledger carries identity only and has no outcome
  column; every replay re-reads the job, attempt and communication rows.
- **One dead-letter rule.** `attempt_count >= max_attempts → dead_letter` lives only in
  `qf_complete_automation_attempt_v1`; recovery calls that function rather than
  reimplementing it.
- **`uncertain` is terminal.** An unknown provider outcome is never converted into a
  retry, in either direction.
- **Append-only history.** No automation action, job, attempt or transport row is ever
  deleted or truncated, and finalized transport history is immutable.

## 4. What QF-MVP-50 does NOT deliver

These are real gaps, recorded so no later phase inherits an assumption.

- **There is no live provider communication due-sweep.** `dispatchPersistedMessage` has
  no production caller, and the only internal worker route in the repository is
  `app/api/internal/process-consent-ack-intents`. A communication row sitting in
  `queued`, `dispatching` or `retry_scheduled` is therefore **not** advanced by anything
  in QF-MVP-50. QF-MVP-50.5 deliberately **defers** on exactly those states rather than
  inventing a sweep, because a second automation attempt would mint a new idempotency key
  and deliver the recipient a duplicate message. Wiring a governed communication
  due-sweep, and provider/channel operational readiness generally, belongs to the
  applicable QF-MVP-40 and QF-MVP-80 work — **not** to QF-MVP-50.
- **The 50.5 signed-HTTP certification left irreversible staging state, including 9 real
  client jobs it was not meant to touch.** Recovery selects the globally-oldest due job, and
  two runs proceeded without a guaranteed-oldest fixture in place because the harness
  misreported them as not having executed. Eight orphaned client jobs whose leads do not
  exist advanced to terminal `failed / QF_EXEC_LEAD_NOT_FOUND`, and one abandoned attempt
  was reconciled back to `retry_scheduled`. Every explicitly protected row survived and was
  verified individually: the four PASS-B delayed vendor jobs, both frozen mid-flight
  processing locks, the parked 50.2 evidence, and every vendor and campaign job. No business
  row changed and `communication_messages` is still 0. Full account in
  `docs/QF-MVP-50-5-STAGING-CERTIFICATION.md` §8.
- **Provider sending is structurally impossible on staging as configured, and that is a
  gap as much as a safety property.** `communication_provider_runtime_policies` holds zero
  rows and all eight provider template mappings are `is_active = false`, so any execution
  reaching the communication lane fails closed before a provider call. No end-to-end
  delivery has therefore been demonstrated by QF-MVP-50 at all.
- **Every n8n workflow candidate is inactive.** All six source workflows carry
  `active: false`, and the transport itself is fail-closed: `QF_N8N_TRANSPORT_ENABLED`
  must equal `true` and the runtime environment must match the transport mode.
- **No production migration, deployment or provider activation is authorized by this
  phase.** Production has received none of the QF-MVP-50 migrations.

## 5. Quality gates

`.github/workflows/qf-mvp-50-quality-gate.yml` runs, at the exact reviewed head, on
Node 24, with no secrets and no Supabase, database or deployment command:

`40.4` · `40.10A` · `40.10B` · `40.11` · `40.12-R1` · `50.1A` · `50.1B` · `50.1C` ·
`50.2A` · `50.2B` · `50.2C` · `50.2C-S2-G1` · `50.2D` · `50.2E` · `50.2-FINAL` · `50.3` ·
`50.4` · **`50.5`** · bridge · forensic · certification · typecheck · build.

## 6. Next steps, in order

1. ~~Apply `20260812000000` to QuickFurno Staging under its own deployment gate.~~
   **Done — staging history 29 → 30, applied exactly once.**
2. ~~Promote the manifest entry from PENDING to APPLIED and re-pin G1 and its dependents
   to the new exact truth.~~ **Done — it is the tenth applied post-anchor record, the only
   one carrying first-party evidence and `appliedByThisPhase: true`, with ten coupled
   harnesses re-pinned to exact values rather than loosened.**
3. ~~Certify recovery behaviour against the real staging database.~~ **Done — 65/65,
   inside an always-rolled-back transaction leaving zero residue.**
4. ~~Certify the signed-HTTP layer against a real n8n runtime.~~ **Done — real n8n 1.108.2
   drove both routes end to end against staging-bound Core over real HTTPS, with Core's
   response signature verified in both directions, plus a 10/10 transport fence covering
   replay suppression, signature tampering, the absence of a signing oracle, and
   cross-route signature binding. Provider effects: zero.**
5. Owner decision outstanding on the staging side effect in §8 of the certification
   evidence: 9 real client jobs advanced state, 8 of them irreversibly to terminal
   `failed`. Nothing protected was lost, but if any of those 8 were wanted as future
   fixtures they must be re-seeded rather than recovered.
6. Only then consider production, as a separately governed decision. Production has
   received none of the QF-MVP-50 migrations.
