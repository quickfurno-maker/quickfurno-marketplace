# QF-MVP-70 — Operations & Launch Control closeout

**Status: CLOSED / FROZEN. Four slices merged, certified offline at exact head, and
built clean against staging.**

This document records what QF-MVP-70 delivers and, just as precisely, what it does
not. It authorizes no production change, no provider activation and no migration.

---

## 1. Phase objective

Give the founder ONE Superadmin-only cockpit that answers "what is failing, overdue
or stuck right now, and is Core ready to operate?" — derived entirely from rows the
marketplace already owns.

The phase was scoped as an OBSERVATION plane. Every control it reports already had
exactly one canonical home before Phase 70 began, and it still does: Operations
reports state and routes the founder there. It adds no second place to change
anything.

---

## 2. Phase ledger

| Slice | Scope | Commit | Validator | Checks |
| --- | --- | --- | --- | --- |
| 70.01 | Operations Control Center — incident taxonomy, fail-closed overview, paged incidents | `2d164bc` | `npm run test:mvp:70-01` | 100 |
| 70.02 | Founder Attention Queue + canonical incident detail | `e6004cb` | `npm run test:mvp:70-02` | 118 |
| 70.03 | Launch Control consolidation — control state + Core readiness verdict | `335b3db` | `npm run test:mvp:70-03` | 108 |
| 70.04 | Final certification, CI coverage, phase freeze | this slice | `npm run test:mvp:70-04` | 170 |

Merged baseline for this closeout: `988aec1c9d32f2be4c7b45b01bf618c0b965beeb`.

---

## 3. Ownership boundaries

Operations is a COCKPIT, not a control plane. Each surfaced control keeps its
pre-existing owner:

| Control | State source | Canonical UI | Writer |
| --- | --- | --- | --- |
| Automatic lead assignment | `marketplace_runtime_settings` | `/admin/settings` | `adminUpdateMarketplaceRuntimeSetting` |
| Agent event forwarding (AOS → n8n) | `aos_runtime_settings` + env lock | `/admin/automations` | `POST /api/admin/aos-runtime-settings` |
| WhatsApp sending | `communication_provider_runtime_policies` | `/admin/whatsapp?tab=provider` (read-only) | none in the product — governed one-shot operators only |
| Queued lead recheck | none (an action, not a switch) | `/admin/lead-distribution` | `adminRecheckLeadAssignmentQueue` |

Operations READS these four sources and NAMES the canonical surface. It imports no
writer, declares no server action, and exposes no route handler. The four control
hrefs are proved against the registered admin section list, not an allowlist private
to the harness.

Incident classes read four canonical tables and nothing else: `automation_jobs`,
`communication_messages`, `communication_webhook_receipts`, `lead_assignment_queue`.

---

## 4. Fail-closed semantics

This is the central contract of the phase.

- `services/adminService.ts::safeCount()` answers `0` on error. It is **never**
  imported by either Operations service — rendering "we could not read the failure
  table" as "there are no failures" is the one thing an operations console must not do.
- Every read answers either a proven number, or `null` plus a fault. `null` is never
  coerced to `0`, never sorted as `0` and never rendered as `0`.
- Reads are **bounded real selects carrying `count: "exact"`**, never head-counts:
  PostgREST answers `head: true` against a MISSING relation with
  `{ count: null, error: null }`, which is exactly the silent false zero this design
  exists to prevent.
- `NOT_PROVISIONED` (the relation does not exist here) and `UNAVAILABLE` (the read
  failed) stay distinct, and neither becomes a zero.
- Control state distinguishes three facts that are never collapsed: `READ`,
  `DEFAULT` (readable, no row, built-in default in force) and `UNAVAILABLE` (unknown).
  The canonical readers deliberately fail OPEN for the runtime; Operations proves the
  source is readable with its own bounded read first and reports UNAVAILABLE when that
  fails, whatever default the reader returned.
- `HEALTHY` and `READY` are both unreachable from partial data.

**Launch verdict precedence is strict and source-ordered:**

```
BLOCKED  >  ATTENTION  >  UNAVAILABLE  >  READY
```

`READY` is the final fallthrough — nothing can promote to it later. The verdict is
derived per request and persisted nowhere: there is no readiness table, column or cache.

---

## 5. Read-only authority vs existing control authority

QF-MVP-70 introduces **no** operational write authority.

- No `insert` / `update` / `upsert` / `delete` and no `.rpc(` in any Phase 70 source.
- The browser layer holds no database client at all — every client import of a service
  is type-only, so no server module is bundled.
- Incidents are structurally non-actionable: no retry, cancel, pause, resume,
  acknowledge, resolve, send or arm control exists to be wired to.
- Incident detail is a **lookup, not a query**. `findIncidentInPool()` searches the
  bounded payload this request already loaded; there is no by-id read anywhere, so a
  hostile URL cannot address an arbitrary row. An id outside the pool resolves to
  `not_in_view` and the panel says so.
- WhatsApp/Meta is observation only: `actionable: false`, `impact: "advisory"`, labelled
  "Observation only", linking to the read-only evidence surface. No select list anywhere
  names a token, destination or free-form `metadata` column.
- Authorization is server-side and Superadmin-only, proved BEFORE any loader runs, in
  the same request. The pre-existing weaker `Operations Admin` role is **not** accepted
  by this route.

---

## 6. Core Operations readiness scope

`READY` is labelled **"Core operations ready"**, never a bare "Ready", and a scope
disclosure is rendered beside the verdict:

> This covers Core operational health and the launch-critical controls listed below.
> WhatsApp and Meta readiness are tracked separately and do not gate this verdict.

It means: every required source read cleanly, no launch-critical control is switched
off, and no subsystem holds an open incident. It does **not** mean QuickFurno is ready
to launch. Advisory controls — WhatsApp included — are reported truthfully but do not
gate the verdict, so it cannot speak for them.

Founder-facing copy stays inside its evidence. Each incident class carries its own
"Listed because …" sentence stating only what that class's canonical predicate proves.
No sentence claims permanent failure, absence of automatic recovery, an external
outage, or fault on the part of a vendor or client. Recovery liveness is an
**inference** from durable Core rows — "overdue retry work exists … no external system
was contacted" — never a probe, and never a claim that n8n, a worker or a provider is down.

---

## 7. Data and performance contract

- No unbounded read: the incident layer holds exactly two query sites (`.limit(1)` for
  the oldest row, `.range(from, to)` for the page via the canonical `lib/adminPaging`),
  and each of the three control reads is `.limit(1)`.
- No N+1: the overview fans out concurrently over the CLOSED class vocabulary, not over
  rows, and opening incident detail issues no read at all.
- The attention queue is PROJECTED from the summaries the overview already loaded —
  zero additional attention reads. Launch health is arithmetic over the same overview;
  the snapshot is handed the overview rather than re-reading it.
- Lead-queue overlap de-duplicates by underlying row with the class prefix stripped.
  Ranking runs BEFORE de-duplication, so `queue_overdue` (critical) always survives over
  `queue_unresolved` (info) — the required rule falls out by construction, not by a
  special case. The subsystem total separately excludes the superset class.
- The stale processing threshold is imported from the canonical
  `lib/automation/recoveryContract` (`AUTOMATION_STALE_ATTEMPT_THRESHOLD_SECONDS`). No
  Phase 70 source declares a threshold, target or service level of its own.

---

## 8. CI coverage

All four validators run in the existing exact-head gate,
`.github/workflows/qf-mvp-50-quality-gate.yml`:

```
npm run test:mvp:70-01
npm run test:mvp:70-02
npm run test:mvp:70-03
npm run test:mvp:70-04
```

The gate remains repository-only: it pins the PR head SHA and asserts it, grants
`contents: read`, declares no secret, and executes no Supabase, Meta, n8n, deployment
or one-shot operator command. `build:staging:safe` is deliberately **not** in CI — it
needs operator-held staging state — so CI runs the ordinary repository build instead.

The workflow file and display name were left unchanged. Renaming would touch a branch
protection reference for no contract gain; the gate is a whole-repository quality gate
whose historical name is `QF MVP 50 Quality Gate`.

---

## 9. Certification result

Run at head on this branch, all green:

| Gate | Result |
| --- | --- |
| `test:mvp:70-01` | 100 passed, 0 failed |
| `test:mvp:70-02` | 118 passed, 0 failed |
| `test:mvp:70-03` | 108 passed, 0 failed |
| `test:mvp:70-04` | 170 passed, 0 failed |
| `test:admin:cperf1` | 55 passed, 0 failed |
| `test:admin:cperf2` | 41 passed, 0 failed |
| `test:admin:c4` | 56 passed, 0 failed |
| `test:admin:c5` | 83 passed, 0 failed |
| `test:admin:cwa1` | 137 passed, 0 failed |
| `test:admin:cwa1b` | 52 passed, 0 failed |
| `test:admin:c6` | 66 passed, 0 failed |
| `typecheck` | clean |
| `build:staging:safe` | **RESULT: PASS** — staging ref only, 0 prohibited refs, 0 client secrets |

**Migration count: 99. QF-MVP-70 added none.** The 99th file,
`20260814000000_qf_mvp_40_marketing_consent_writer.sql`, belongs to QF-MVP-40.

Five historical admin harnesses (C4, C5, C-WA1, C-WA1B, C6) carried a stale migration
anchor of 98 and were re-pinned to 99 — the same re-pin QF-MVP-40.13B previously made
from 97 to 98. Their semantic contract is unchanged and still enforced: *this admin
phase adds no migration of its own.* No other assertion in those files was touched.

---

## 10. What QF-MVP-70 does NOT deliver

Stated plainly so no reader infers more than was built:

- **Not** full launch certification, and **not** Pune-launch certification.
- **Not** Meta readiness activation, template approval, or WhatsApp canary/send
  authority. QF-MVP-40 remains fail-closed and outside this phase.
- **No** mutation plane: no retry, cancel, pause, resume, acknowledge, resolve or
  recovery execution from Operations.
- **No** acknowledgement or ownership state, and no second incident state machine
  beside the ones automation, communication and lead assignment already own.
- **No** history, trend, sparkline or service-level target — there is no metric-history
  table in the product, so none is asserted.
- **No** QF Vision orchestration, **no** GeoFair matching, **no** QF-MVP-75 or
  QF-MVP-80 work, and **no** production rollout.
- **No** migration, RPC, env var, RBAC change, or QF-MVP-50 runtime contract change.

---

## 11. Freeze

**QF-MVP-70 is CLOSED / FROZEN.**

Future feature work belongs in the next authorized phase. Reopen Phase 70 only for a
confirmed defect in its locked contracts — the fail-closed read rules, the verdict
precedence, the read-only authority boundary, or the Superadmin gate.

The four validators are the lock. Any change to the Operations surface must keep
`test:mvp:70-01` through `test:mvp:70-04` green at exact head.
