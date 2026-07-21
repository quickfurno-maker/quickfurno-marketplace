# `scripts/mvp/` — Focused MVP validation runner (QF-MVP-00)

A small, honest, **offline** test runner that exercises the launch-critical
QuickFurno Core logic through the **real production modules** — never a copy,
never source-string matching. It is the day-to-day development gate that replaces
the legacy phase-governance harnesses (which stay on disk, `LEGACY_NON_BLOCKING`).

## Commands

| npm script | Runs |
|---|---|
| `npm run test:mvp:marketplace` | Marketplace Core suite only |
| `npm run test:mvp:communication` | Communication & Meta suite only |
| `npm run test:mvp` | Both suites, sequentially |
| `npm run verify:mvp` | `test:mvp` → `typecheck` → `lint` → `build` |

Direct invocation:
`node --import ./scripts/mvp/loader/register.mjs ./scripts/mvp/run.mjs [marketplace|communication]`

## Safety contract (guaranteed by construction)

The runner and both suites **never**:

- modify a production source file, or run any mutation/blob replacement;
- read Git history or enforce a commit-range / blob-SHA freeze;
- access Supabase, PostgreSQL, or any provider/network endpoint;
- require an environment secret or credential.

It **always**: runs sequentially, is deterministic, **stops on the first failed
mandatory suite**, exits non-zero on failure, never silently ignores a failure,
and prints the command + elapsed time per suite plus a passed/failed/skipped
summary.

These properties hold because every imported module is pure and dependency-free.
The only clock dependence (`metaRuntimeGate` canary window) is removed by injecting
`now = 0`. Crypto is Node's built-in HMAC/SHA (offline, deterministic).

## Files

- `run.mjs` — sequential runner (selection, timing, stop-on-fail, exit codes).
- `lib/harness.mjs` — tiny dependency-free assertion helpers.
- `suites/marketplace.mjs` — imports real `lib/aos/rules/*`, `lib/vendors/*`,
  `lib/aos/workflows/leadLifecycle/distribution/*`.
- `suites/communication.mjs` — imports real `lib/communication/**`.
- `loader/tsResolveHooks.mjs` + `loader/register.mjs` — a minimal Node module
  `resolve` hook. Node v24 strips TypeScript types natively but does not add a
  `.ts` extension to *extensionless* relative imports; the hook does only that,
  for relative specifiers, on resolution failure. **It never maps the `@/`
  alias**, so Supabase/service modules can never be pulled into an "offline"
  suite by accident — that is the primary DB/network guard.

## Why these modules (and not the old harnesses)

The legacy `scripts/phase*` harnesses **inline/vendor** their logic (they do not
import production runtime code) and most wrap themselves in a Git working-tree /
blob-freeze attestation. Running them therefore depends on Git state and tests a
copy, not the shipped code. This runner instead imports the deliberately
dependency-free production modules (many carry a *"kept inline so this module has
no imports"* contract) and asserts on their actual behaviour.

## Coverage & known gaps

Covered (real modules): assignment/distribution limits (3-vendor cap), vendor
eligibility fundamentals, package/credit fundamentals, replacement +
restoration-needs-approval, deterministic category matching, no-side-effect
boundary; consent STOP/START/HELP + scope + ack idempotency, inbound/delivery
idempotency, callback identity, fail-closed runtime/canary gate, webhook raw-body
bounds + HMAC signature verification, approved-template payload construction,
normalized provider outcomes, and the **uncertain-outcome-never-auto-resent**
invariant (D9).

Launch-critical behaviour with **no safe pure seam yet** is recorded as
`FOCUSED_TEST_REQUIRED` in [`docs/QF-MVP-00-BASELINE.md`](../../docs/QF-MVP-00-BASELINE.md)
(e.g. assignment/credit-deduction idempotency at the DB layer, the 6-vendor
lifetime cap, replacement concurrency-safety, stateful consent decision/writer,
outbound consent enforcement, async ack-worker persistence). Those become focused
test tasks in the relevant later MVP phase — **not** a reason to change production
code in QF-MVP-00.
