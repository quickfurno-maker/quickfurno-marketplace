# QF-MVP-00 — Program Lock & Clean Baseline

**Branch:** `mvp/qf-mvp-00-core-cleanup-v1` · **Base commit:** `a4d289a` · **Starting HEAD:** `b046cf76b317b43c2376495ab4bec8b0e2cde419`
**Status:** `COMPLETE` (all exit gates green — see §6–§7; `lint` closed in QF-MVP-00.5)
**Scope of edits:** QF-MVP-00 — `package.json`, `scripts/mvp/**`, this doc, `docs/QF-MVP-EXECUTION-BOARD.md`. QF-MVP-00.5 — `package.json`, `package-lock.json`, `.eslintrc.json`, this doc, the execution board, plus **two authorized one-character apostrophe-escape fixes** (`app/vendor/dashboard/_components/VendorNoProfileFallback.tsx`, `components/LeadFunnel.tsx`) to clear pre-existing `react/no-unescaped-entities` errors surfaced by the new ESLint config. No migration, Supabase, env, deployment, or legacy-harness file changed; no DB/network/provider access; no feature implementation.

This document records (1) baseline verification, (2) the full test-command inventory from **behavioral** inspection, (3) the new focused MVP runner, (4) the reorganized package commands, (5) launch-critical coverage and gaps, and (6) validation results.

---

## 1. Baseline verification (QF-MVP-00.1a)

All gates passed before any edit:

| Gate | Expected | Observed | Pass |
|---|---|---|---|
| Current branch | `mvp/qf-mvp-00-core-cleanup-v1` | same | ✅ |
| HEAD | `b046cf76b317b43c2376495ab4bec8b0e2cde419` | same | ✅ |
| Working tree | clean | clean (`git status --porcelain` empty) | ✅ |
| Roadmap commit parent | `a4d289a681f6b7aaf8deb2083386af821c072ba0` | `HEAD^` == a4d289a | ✅ |
| Governance commit `5f139b5` ancestor of HEAD | NO | `merge-base --is-ancestor` → exit 1 (not ancestor) | ✅ |
| Governance commit `ab8e603` ancestor of HEAD | NO | exit 1 (not ancestor) | ✅ |
| `.claude/` tracked | NO | `git ls-files .claude` empty | ✅ |
| `.mcp.json` tracked | NO | `git ls-files .mcp.json` empty | ✅ |
| Unexpected staged/untracked files | none | none | ✅ |

No `switch`/`reset`/`rebase`/`merge`/`cherry-pick` was performed.

---

## 2. Test-command inventory (QF-MVP-00.1)

### 2.1 Method

Behavior was determined by **inspecting executable code**, not names or comments:
`child_process` call-sites (`execFileSync("git" …)`, `spawnSync("psql" …)`), real vs. mock Supabase (`@supabase/supabase-js` import vs. injected `.from`/`.rpc`), real vs. injected transport (`fetch`), `writeFileSync` targets, `createHash`/blob-freeze markers, and representative deep reads.

**Key structural finding:** the 38 `scripts/phase*` harnesses do **not** import production runtime code — only two `.ts` harnesses import production *types* (erased at runtime). They **vendor/inline** their logic or assert via **static source-string matching**, and the family template embeds a Git working-tree/commit **attestation**. They therefore test a *copy* (or the source *text*), and their pass/fail depends on Git state — unsuitable as an MVP gate. This is why QF-MVP-00.2 builds *new* focused tests against the real modules instead of adapting a legacy harness.

### 2.2 Active MVP validation commands (added this phase)

| Script | Target | Domain | Exec prod code | Src mod | Mutation | Git hist | Blob/commit pins | DB | Provider/net | Creds | Deterministic | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `test:mvp` | `scripts/mvp/run.mjs marketplace communication` | Marketplace + Comms Core | **Yes (real modules)** | No | No | No | No | No | No | No | Yes | `MVP_SAFE_FUNCTIONAL` |
| `test:mvp:marketplace` | `scripts/mvp/run.mjs marketplace` | Marketplace Core | Yes | No | No | No | No | No | No | No | Yes | `MVP_SAFE_FUNCTIONAL` |
| `test:mvp:communication` | `scripts/mvp/run.mjs communication` | Communication & Meta | Yes | No | No | No | No | No | No | No | Yes | `MVP_SAFE_FUNCTIONAL` |
| `verify:mvp` | `test:mvp → typecheck → lint → build` | Full pre-PR gate | Yes | No | No | No | No | No | No | No | Yes¹ | `MVP_SAFE_FUNCTIONAL` |

¹ `verify:mvp` is deterministic in what it runs; it currently **fails at `lint`** due to a pre-existing config problem (see §7).

### 2.3 Standard tooling commands (unchanged)

| Script | Target | Purpose | DB/net | Deterministic | Class |
|---|---|---|---|---|---|
| `dev` | `next dev` | local dev server | — | n/a | operational |
| `build` | `next build` | production build (MVP gate) | No | Yes (passes) | `MVP_SAFE_FUNCTIONAL` |
| `start` | `next start` | serve built app | — | n/a | operational |
| `typecheck` | `tsc --noEmit` | type gate (MVP gate) | No | Yes (passes) | `MVP_SAFE_FUNCTIONAL` |
| `lint` | `next lint` | lint gate | No | **Broken config** | `UNKNOWN_REQUIRES_AUDIT` (see §7) |

### 2.4 Legacy phase-governance harnesses — shared behavioral profile

The following applies to every `test:phase*` command **unless a per-command flag in §2.4.1 overrides it**:

- **Executes production code:** **No.** Logic is vendored/inlined or asserted via static source-string regex; only `test:phase3b` and `test:phase4` (`.ts`) import production *types* (erased at runtime).
- **Modifies source files / mutation testing:** **No**, except the write-then-revert **mutation** harnesses (confirmed: `test:phase5d`, `test:phase5f:d2c`; the D-/5-series `mutation()` framework edits real files and restores them in a `finally` — dangerous if interrupted).
- **Reads Git history:** **Yes** — 21 package.json harnesses call `git` (`rev-parse`/`gitDirty`/commit-delta) as a working-tree/commit attestation.
- **Enforces commit/blob pins:** **Yes** for the D-series + account-attribution + several 5-series (`createHash` blob freeze / commit-range / successor-authority / harness-policing-harness).
- **Accesses database:** **No** (mock Supabase via injected `.from`/`.rpc`), except `psql` harnesses (see §2.5). No `test:phase*` in package.json imports `@supabase/supabase-js`.
- **Accesses provider/network:** **No** — provider adapters (Meta, Exotel) are tested with **injected/mock transports** (provider-neutral design), not real endpoints.
- **Requires credentials:** **No** (offline), except DB harnesses.
- **Deterministic:** functionally yes, but **Git-coupled** — pass/fail flips on a dirty tree, an uncommitted migration, or commit drift ("5 old harnesses fail on ANY uncommitted migration edit; artifact, not regression"). Not deterministic across repo states ⇒ not an MVP gate.
- **MVP classification:** `LEGACY_NON_BLOCKING` (kept on disk, diagnostic only; **not deleted**, **not edited**).

Behavior flags: **G** = Git attestation confirmed · **P** = blob/commit pins · **M** = real source mutation · **S** = static source-string checks · **K** = mock/injected provider transport.

#### 2.4.1 Per-command (all `LEGACY_NON_BLOCKING`)

| Script | Target harness | Domain | Flags |
|---|---|---|---|
| `test:phase1a` | `phase1a-workflow-foundation-verify.mjs` | AOS workflow foundation | S |
| `test:phase1b` | `phase1b-workflow-kernel-harness.mjs` | Workflow kernel | S |
| `test:phase2a` | `phase2a-lead-lifecycle-harness.mjs` | Lead lifecycle | S |
| `test:phase2b` | `phase2b-lead-orchestration-adapter-harness.mjs` | Lead orchestration adapter | G, S |
| `test:phase3a` | `phase3a-distribution-control-harness.mjs` | Distribution control | G, S |
| `test:phase3a:diagnostics` | `phase3a-diagnostics-harness.ts` | Distribution diagnostics | S |
| `test:phase3b` | `phase3b-recovery-harness.ts` | Lead-quality recovery (imports type) | S |
| `test:phase3b:aos` | `phase3b-assignment-execution-harness.mjs` | Assignment execution | G, S |
| `test:phase4` | `phase4-credit-wallet-harness.ts` | Credit wallet (imports type) | S |
| `test:phase4a` | `phase4a-policy-engine-harness.mjs` | Policy engine | G, S |
| `test:phase4b1` | `phase4b1-policy-inputs-contract-harness.mjs` | Policy inputs contract | G, S |
| `test:phase4b2` | `phase4b2-policy-lifecycle-integration-harness.mjs` | Policy lifecycle | G, S |
| `test:phase5a` | `phase5a-identity-security-harness.mjs` | Identity security | G |
| `test:phase5b` | `phase5b-communication-core-harness.mjs` | Communication core | K |
| `test:phase5c` | `phase5c-vendor-auth-harness.mjs` | Vendor auth | P |
| `test:phase5d` | `phase5d-client-whatsapp-otp-harness.mjs` | Client WhatsApp OTP | **M**, K |
| `test:phase5e` | `phase5e-vendor-whatsapp-reset-harness.mjs` | Vendor WhatsApp reset | P |
| `test:phase5f:a` | `phase5f-a-messaging-foundation-harness.mjs` | Messaging foundation | S |
| `test:phase5f:b` | `phase5f-b-whatsapp-cloud-api-harness.mjs` | Meta WhatsApp Cloud API | P, K |
| `test:phase5f:c` | `phase5f-c-auth-transport-resilience-harness.mjs` | Auth transport resilience | P |
| `test:phase5f:c2` | `phase5f-c2-sms-runtime-foundation-harness.mjs` | SMS runtime foundation | G, P |
| `test:phase5f:c3a` | `phase5f-c3a-exotel-adapter-harness.mjs` | Exotel adapter | G, K |
| `test:phase5f:c3b` | `phase5f-c3b-client-otp-fallback-harness.mjs` | Client OTP fallback | G |
| `test:phase5f:c3c1` | `phase5f-c3c1-client-otp-resolved-sms-harness.mjs` | Client OTP resolved SMS | G |
| `test:phase5f:c3c2` | `phase5f-c3c2-sms-canary-readiness-probe-harness.mjs` | SMS canary readiness | G |
| `test:phase5f:d1a` | `phase5f-d1a-whatsapp-inbound-foundation-harness.mjs` | Inbound foundation | G, P |
| `test:phase5f:d1b` | `phase5f-d1b-whatsapp-inbound-persistence-harness.mjs` | Inbound persistence | G, P |
| `test:phase5f:d2b` | `phase5f-d2b-consent-evidence-schema-harness.mjs` | Consent evidence schema | G |
| `test:phase5f:d2c` | `phase5f-d2c-consent-decision-authority-harness.mjs` | Consent decision authority | G, P, **M** |
| `test:phase5f:d2d` | `phase5f-d2d-consent-command-writer-harness.mjs` | Consent command writer | G, P |
| `test:phase5f:d2e` | `phase5f-d2e-inbound-consent-integration-harness.mjs` | Inbound consent integration | G |
| `test:phase5f:d3b` | `phase5f-d3b-outbound-consent-enforcement-harness.mjs` | Outbound consent enforcement | G, P |
| `test:phase5f:d4b` | `phase5f-d4b-consent-command-response-harness.mjs` | Consent command response | G |
| `test:phase5f:d4c` | `phase5f-d4c-consent-ack-async-harness.mjs` | Consent ack async | G, K |

> The flag set reflects direct signal inspection across the family plus representative deep reads (`phase5f-d2c`, `phase3a`, `phase5d`, `phase5b`). A per-harness line-by-line audit is **out of scope** for QF-MVP-00 — these are `LEGACY_NON_BLOCKING` and are not part of any MVP gate. Absence of a flag is not proof of absence of the behavior; the shared profile governs.

### 2.5 Database / provider integration & utility scripts

| Script | Target | Behavior | DB/net | Creds | Class |
|---|---|---|---|---|---|
| `test:supabase:lead` | `scripts/test-supabase-lead-insert.mjs` | Real Supabase **insert** to `leads` | **Real DB** | Yes | `DATABASE_INTEGRATION` — **excluded from MVP gate** |
| `test:phase1b:runtime` | `scripts/phase1b-workflow-runtime-db-harness.mjs` | Shells out to **`psql`** | **Real DB** | Yes | `DATABASE_INTEGRATION` (+ `LEGACY_NON_BLOCKING`) |
| `grant:superadmin` | `scripts/grant-superadmin.mjs` | Supabase admin role update (utility, not a test) | **Real DB** | Yes | `DATABASE_INTEGRATION` (utility) |

On-disk harnesses/utilities **not** wired into `package.json` (present but not runnable via npm): `phase8b1-*`, `phase8b1ba-*`, `phase8b1bb-*`, `phase8b1bc-*` (`LEGACY_NON_BLOCKING`); `phase8b1bd6w1-*`, `phase8b1bd6w2ar1-*`, `phase8b1bd6w2ar2-*` (`psql` → `DATABASE_INTEGRATION`+`LEGACY_NON_BLOCKING`); `seed-canonical-categories.mjs`, `deactivate-extra-cities.mjs` (`DATABASE_INTEGRATION` utilities).

### 2.6 Classification summary

- `MVP_SAFE_FUNCTIONAL`: `test:mvp`, `test:mvp:marketplace`, `test:mvp:communication`, `verify:mvp`, plus `build` + `typecheck` + `lint` (configured in QF-MVP-00.5).
- **`test:phase*` totals: 35 commands** — **34 `LEGACY_NON_BLOCKING`** (Git/mutation/freeze/static-source coupled; the 34 rows in §2.4.1) **+ 1 `DATABASE_INTEGRATION`** (`test:phase1b:runtime`, shells to `psql`, §2.5). All kept on disk; none deleted; none part of any MVP gate. (An earlier draft of this summary mis-stated "33" while §2.4.1 already listed 34 — corrected here.)
- `DATABASE_INTEGRATION`: `test:supabase:lead`, `test:phase1b:runtime`, `grant:superadmin` (+ off-disk psql/utility scripts).
- `lint`: **resolved in QF-MVP-00.5** — ESLint configured (`next/core-web-vitals`), runs non-interactively and passes (exit 0). No longer `UNKNOWN_REQUIRES_AUDIT`. See §7–§8.

---

## 3. Focused MVP runner (QF-MVP-00.2)

New system under `scripts/mvp/` — see `scripts/mvp/README.md`.

| File | Role |
|---|---|
| `run.mjs` | Sequential runner: selection, per-suite command + elapsed time, **stop on first failed mandatory suite**, non-zero exit on failure, passed/failed/skipped summary. |
| `lib/harness.mjs` | Dependency-free assertions (`assertEqual`, `assertDeepEqual`, `assertMatch`, `assertTrue/False`, …). |
| `suites/marketplace.mjs` | Imports **real** `lib/aos/rules/*`, `lib/vendors/*`, `lib/aos/workflows/leadLifecycle/distribution/*`. |
| `suites/communication.mjs` | Imports **real** `lib/communication/**`. |
| `loader/tsResolveHooks.mjs` + `loader/register.mjs` | Minimal Node `resolve` hook that only appends `.ts` to *extensionless relative* imports on failure. **Never maps `@/`** and refuses `supabase`/`services` paths — the guard that keeps suites DB/network-free. Node v24 strips TS types natively; no transpiler/deps. |

**Safety contract (by construction):** never modifies source, never mutates, never reads Git history / blob SHAs, never touches Supabase / a provider / the network, needs no secrets, is deterministic, and never silently ignores a failure. Verified: only the two multi-file modules (`providerOutcome`, `metaWhatsAppWebhook`) use the loader; all others import zero-config. The lone clock dependence (`metaRuntimeGate` canary) is removed by injecting `now = 0`; crypto is Node's HMAC/SHA (offline).

### 3.1 Suites included in `test:mvp:marketplace` (16 checks, real modules)

`assignmentRules` (3-vendor cap, auto-assign/paid-priority OFF) · `isAssignmentPreviewWithinLimit` · `leadDistributionTypes` (`MAX_DISTRIBUTION_VENDORS=3`, client-selected route isolated) · `vendorAutomaticEligibility` (approved/active/accepting/credits gate, `LEAD_CREDIT_COST=1`, credit-cost option, `accepting_leads` default-true) · `vendorRules.canVendorReceiveLeadPreview` · `leadRules.isLeadFoundationEligible` (name+phone+city+service) · `replacementRules.buildReplacementReason` + restoration-needs-approval · `pricingRules` (replace-not-refund) · `categoryMatching` (self-test smoke cases + synonym match + empty-set reject + normalization) · `securityRules.isBlockedSideEffect` (AI/WhatsApp/n8n/db-write blocked).

### 3.2 Suites included in `test:mvp:communication` (24 checks, real modules)

`consentCommand.normalizeConsentCommand` (STOP/START/HELP/unsupported) · `consentCommandResponse` (ack template key, disposition eligibility, **idempotency-key bucketing**, non-command/replay rejection, approved copy) · `outboundConsentScope` (registry invariants + unclassified reject) · `inboundConsentCommandInput` (provider mapping, **deterministic sha256 provider-event-id**, strict RFC3339, ISO instant, occurred-at resolution, command-token read) · `metaCallbackIdentity` (own vs **foreign WABA/phone** reject) · `metaRuntimeGate` (**fail-closed** activation, identity match, canary allowlist with injected clock) · `metaWebhookRawBody` (16 KB ceiling, buffer read) · `whatsappTemplate.selectApprovedProviderMapping` (none/ambiguous/not-approved/success) · `whatsappTemplateBinding` (**approved-template payload construction**, position ordering, missing/undeclared variable rejects) · `providerError` (accepted→unknown normalization, ambiguous vs proven pre-connect, `normalizeProviderException`) · `channelDispatchGuard` · `types` (channel/automation/destination state) · `providerOutcome` (contradiction, effective certainty, **uncertain-outcome never auto-resent — D9**, transport certainty) · `metaWhatsAppWebhook` (**HMAC signature round-trip + tamper reject**, GET challenge, classification, deterministic delivery-event-id, delivery normalization).

---

## 4. Package commands (QF-MVP-00.3)

Added (all historical commands preserved unchanged; no key collisions):

```
test:mvp                 node … ./scripts/mvp/run.mjs marketplace communication
test:mvp:marketplace     node … ./scripts/mvp/run.mjs marketplace
test:mvp:communication   node … ./scripts/mvp/run.mjs communication
verify:mvp               npm run test:mvp && npm run typecheck && npm run lint && npm run build
```

(`node …` = `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/mvp/loader/register.mjs`.)

`test:supabase:lead` is **not** included in any MVP command (real DB work). No mutation/governance command is part of `test:mvp` or `verify:mvp`.

---

## 5. Launch-critical coverage & `FOCUSED_TEST_REQUIRED` gaps

**Covered honestly through real production modules** (see §3.1–3.2): distribution/assignment limit (3), vendor eligibility fundamentals, package/credit fundamentals, replacement + restoration-approval, deterministic category matching, no-side-effect boundary; consent STOP/START/HELP + scope + ack idempotency, inbound/delivery idempotency, callback identity, fail-closed runtime/canary gate, webhook raw-body bounds + **HMAC signature validation**, approved-template payload construction, normalized provider outcomes, and **uncertain-outcome-never-auto-resent (D9)**.

**`FOCUSED_TEST_REQUIRED`** — launch-critical behaviour with **no safe pure seam** in QF-MVP-00 (the logic lives behind a DB RPC / service that imports `@/lib/supabase`; a missing seam is **not** permission to change production code here). These become planned tasks in the named later phase:

| Gap | Owning module (DB-coupled) | Planned phase |
|---|---|---|
| Assignment idempotency (no duplicate active assignment) | assignment RPC / `leadDeliveryService` | QF-MVP-20 |
| Credit **deduction** idempotency (no double debit) | credit-wallet assignment RPC / `vendorCreditWalletService` | QF-MVP-20 |
| **6-vendor lifetime** cap enforcement (only 3-active is pure) | assignment RPC / assignment ledger | QF-MVP-20 |
| Replacement concurrency-safety (no duplicate concurrent replacement) | `delayedLeadFillService` / ledger | QF-MVP-20 |
| Stateful consent **decision authority** + writer (vs. stored rows) | `communicationConsentDecisionService` / `…WriterService` | QF-MVP-40 |
| Outbound consent **enforcement** integration (end-to-end) | `outboundConsentEnforcementService` | QF-MVP-40 |
| Async **ack-worker** persistence (dedicated table, ≤1 attempt) | `consentAckWorkerService` | QF-MVP-40 |
| Full **inbound webhook → persistence** path (signature→persist→ack-intent) | `metaWhatsAppWebhookService` | QF-MVP-40 |

---

## 6. Validation results (final, post QF-MVP-00.5)

| Command | Result | Evidence |
|---|---|---|
| `npm run test:mvp:marketplace` | ✅ PASS | 16 passed, 0 failed, exit 0 |
| `npm run test:mvp:communication` | ✅ PASS | 24 passed, 0 failed, exit 0 |
| `npm run test:mvp` | ✅ PASS | 2 suites, 40 passed, 0 failed, exit 0 |
| `npm run typecheck` | ✅ PASS | `tsc --noEmit` exit 0 |
| `npm run lint` | ✅ PASS | `next lint` exit 0, **non-interactive** (uses `.eslintrc.json`); 0 errors, 5 non-blocking warnings |
| `npm run build` | ✅ PASS | `next build` exit 0, all routes generated |
| `npm run verify:mvp` | ✅ PASS | test:mvp ✅ → typecheck ✅ → lint ✅ → build ✅ — **green end-to-end** |
| `git diff --check` | ✅ PASS | no whitespace/conflict-marker errors |

Non-blocking `lint` warnings (do not affect exit 0, left as-is — out of scope): `app/page.tsx:67`, `components/home/HomeSections.tsx:227,263` (`@next/next/no-img-element`); `components/admin/ManualLeadAssignmentPanel.tsx:186` ×2 (`react-hooks/exhaustive-deps`); `components/home/TestimonialsCarousel.tsx:58` (`jsx-a11y/role-supports-aria-props`).

Post-validation checks: no migration / env / deployment / legacy-harness / `scripts/mvp/**` file changed; the only production edits are the two authorized apostrophe escapes (§7); no temporary test residue; no DB/network/provider call occurred; `.next` build output is git-ignored.

---

## 7. Lint gate resolution (QF-MVP-00.5) & final status

The pre-existing ESLint configuration gap is **resolved**. ESLint was configured for the pinned Next.js 14.2.15 toolchain — `next lint` now runs **non-interactively** with a committed config and passes (exit 0).

**Installed (exact, dev):** `eslint@8.57.0`, `eslint-config-next@14.2.15` (matched to `next@14.2.15`; `package-lock.json` updated by npm). No upgrade to Next.js / React / TypeScript or any unrelated dependency — `next 14.2.15`, `react 18.3.1`, `react-dom 18.3.1`, `typescript 5.9.3` unchanged in the lock.

**Configuration:** `.eslintrc.json` (repo root):
```json
{ "extends": ["next/core-web-vitals"] }
```
No rule suppressions, no `.eslintignore`, no excluded application directories, and **`core-web-vitals` was not weakened**. The repo stays on the classic `next lint` / `.eslintrc.json` path (not flat config), consistent with the pinned Next.js version.

**Production errors surfaced & fixed (authorized, minimal):** the correct config surfaced two pre-existing `react/no-unescaped-entities` **errors** (literal apostrophes in JSX). With explicit authorization, they were fixed by escaping `'` → `&apos;` — the only production edits in this phase, each a single character with no behavioural change:
- `app/vendor/dashboard/_components/VendorNoProfileFallback.tsx:8` ("isn't" → "isn&apos;t")
- `components/LeadFunnel.tsx:179` ("you're" → "you&apos;re")

Five `core-web-vitals` **warnings** remain (listed in §6); they do not affect exit 0 and were left untouched (out of scope).

**Final status: `QF-MVP-00` is `COMPLETE`.** All exit gates green: baseline verified; inventory recorded; focused MVP runner passing (40/40); package commands organized; governance de-blocked (no MVP gate invokes a legacy governance harness; legacy scripts remain on disk, runnable diagnostically); `typecheck` ✅, `lint` ✅, `build` ✅, `verify:mvp` ✅ end-to-end; and no production code changed to satisfy any stale governance pin. **Next active phase: QF-MVP-10 — Core Architecture and Data Truth.**
