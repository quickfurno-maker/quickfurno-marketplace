// ============================================================================
// QF-MVP-80.17A — lead-assignment terminal reconciliation validator.  OFFLINE.
//
// WHY THIS EXISTS
//   The lane projected `pending -> dispatched` on send and then never converged.
//   A signed Meta webhook moved the canonical message to delivered/read/failed
//   while the derived intent stayed `dispatched` forever. QF-MVP-80.16D-R2 proved
//   it in production: message `failed`, intent `dispatched`.
//
// HOW IT CHECKS
//   The decision rules EXECUTE the real pure contract, so they prove behaviour
//   rather than wording: every projection, every regression refusal, every
//   linkage fence and the exact shape of the write plan. Source text is read only
//   for the NEGATIVE containment claims — no send, no fetch, no message INSERT,
//   no credit/assignment/vendor write — which no execution can demonstrate.
//
//   Source checks run on CODE ONLY: comments are stripped first, so the comments
//   that deliberately NAME a forbidden pattern can never fail the build.
//
// No network, no database, no credential, no send.
// ============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  LeadAssignmentReconcileOutcome as OUT,
  LEAD_ASSIGNMENT_RECONCILE_TABLE,
  LEAD_ASSIGNMENT_RECONCILE_COLUMN,
  evaluateLeadAssignmentReconciliation as evaluate,
} from "../../../lib/communication/leadAssignmentResultContract.ts";
import {
  IntentResultStatus,
  INTENT_ENTITY_TYPE,
  isForwardTransition,
  projectIntentStatus,
} from "../../../lib/communication/campaignResultContract.ts";
import {
  LEAD_ASSIGNMENT_AGGREGATE_TYPE,
  LEAD_ASSIGNMENT_INTENT_CHANNEL,
  LEAD_ASSIGNMENT_TEMPLATE_KEY,
  LEAD_ASSIGNMENT_TEMPLATE_PURPOSE,
  leadAssignmentMessageIdempotencyKey,
} from "../../../lib/communication/leadAssignmentDispatchContract.ts";

const CONTRACT_PATH = "lib/communication/leadAssignmentResultContract.ts";
const SERVICE_PATH = "services/leadAssignmentResultService.ts";
const WEBHOOK_PATH = "services/metaWhatsAppWebhookService.ts";
const DISPATCH_PATH = "services/leadAssignmentDispatchService.ts";
const DISPATCH_CONTRACT_PATH = "lib/communication/leadAssignmentDispatchContract.ts";

const rawOf = (p) => readFileSync(resolve(p), "utf8");
const codeOf = (p) =>
  rawOf(p).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");

const CONTRACT = rawOf(CONTRACT_PATH);
const CONTRACT_CODE = codeOf(CONTRACT_PATH);
const SERVICE_CODE = codeOf(SERVICE_PATH);
const WEBHOOK_CODE = codeOf(WEBHOOK_PATH);
const DISPATCH_CODE = codeOf(DISPATCH_PATH);
const DISPATCH_CONTRACT_CODE = codeOf(DISPATCH_CONTRACT_PATH);

// ---------------------------------------------------------------------------
// Fixtures — shaped exactly like the rows the dispatcher creates
// ---------------------------------------------------------------------------

const INTENT_ID = "a6ae2406-0bb7-46e8-aeb9-e1cdd5f68b02";
const MESSAGE_ID = "9388364c-f5bc-4874-9589-1d183136c0f7";

const intentOf = (over = {}) => ({
  id: INTENT_ID,
  aggregate_type: LEAD_ASSIGNMENT_AGGREGATE_TYPE,
  channel: LEAD_ASSIGNMENT_INTENT_CHANNEL,
  template_purpose: LEAD_ASSIGNMENT_TEMPLATE_PURPOSE,
  status: IntentResultStatus.DISPATCHED,
  ...over,
});

const messageOf = (over = {}) => ({
  id: MESSAGE_ID,
  channel: LEAD_ASSIGNMENT_INTENT_CHANNEL,
  template_key: LEAD_ASSIGNMENT_TEMPLATE_KEY,
  entity_type: INTENT_ENTITY_TYPE,
  entity_id: INTENT_ID,
  idempotency_key: leadAssignmentMessageIdempotencyKey(INTENT_ID),
  status: "delivered",
  ...over,
});

const run = (i, m) => evaluate({ intent: i, message: m });

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
function assert(c, m) { if (!c) throw new Error(m); }
const eq = (a, b, m) => assert(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ---- 1-7. projections ------------------------------------------------------

check("1 dispatched + delivered -> delivered", () => {
  const d = run(intentOf(), messageOf({ status: "delivered" }));
  eq(d.outcome, OUT.APPLIED, "outcome");
  eq(d.derived, IntentResultStatus.DELIVERED, "derived");
  eq(d.plan.patch.status, IntentResultStatus.DELIVERED, "patch status");
});

check("2 dispatched + read -> delivered", () => {
  const d = run(intentOf(), messageOf({ status: "read" }));
  eq(d.outcome, OUT.APPLIED, "outcome");
  eq(d.derived, IntentResultStatus.DELIVERED, "read projects to delivered");
});

check("3 dispatched + failed -> failed", () => {
  const d = run(intentOf(), messageOf({ status: "failed" }));
  eq(d.outcome, OUT.APPLIED, "outcome");
  eq(d.derived, IntentResultStatus.FAILED, "derived");
});

check("3b dispatched + dead_letter/cancelled -> failed", () => {
  for (const s of ["dead_letter", "cancelled"]) {
    const d = run(intentOf(), messageOf({ status: s }));
    eq(d.outcome, OUT.APPLIED, `outcome for ${s}`);
    eq(d.derived, IntentResultStatus.FAILED, `derived for ${s}`);
  }
});

check("4 uncertain + delivered -> delivered", () => {
  const d = run(intentOf({ status: IntentResultStatus.UNCERTAIN }), messageOf({ status: "delivered" }));
  eq(d.outcome, OUT.APPLIED, "outcome");
  eq(d.derived, IntentResultStatus.DELIVERED, "derived");
});

check("5 uncertain + failed -> failed", () => {
  const d = run(intentOf({ status: IntentResultStatus.UNCERTAIN }), messageOf({ status: "failed" }));
  eq(d.outcome, OUT.APPLIED, "outcome");
  eq(d.derived, IntentResultStatus.FAILED, "derived");
});

check("6 dispatched + sent -> no terminal write", () => {
  const d = run(intentOf(), messageOf({ status: "sent" }));
  eq(d.outcome, OUT.NOOP_SAME_STATUS, "sent already projects to dispatched");
  eq(d.plan, null, "no write plan");
});

check("7 dispatched + accepted -> no terminal write", () => {
  const d = run(intentOf(), messageOf({ status: "accepted" }));
  eq(d.outcome, OUT.NOOP_SAME_STATUS, "accepted already projects to dispatched");
  eq(d.plan, null, "no write plan");
});

check("7b in-flight message never fabricates terminal truth", () => {
  for (const s of ["queued", "dispatching", "retry_scheduled"]) {
    const d = run(intentOf(), messageOf({ status: s }));
    assert(d.plan === null, `${s} must produce no write`);
    assert(d.outcome === OUT.NOOP_NON_TERMINAL_MESSAGE, `${s} must be a non-terminal no-op`);
  }
});

check("7c outcome_unknown never becomes terminal from dispatched", () => {
  const d = run(intentOf(), messageOf({ status: "outcome_unknown" }));
  eq(d.outcome, OUT.NOOP_NON_TERMINAL_MESSAGE, "uncertain is not terminal");
  eq(d.plan, null, "no write");
});

// ---- 8-10. regression + idempotency ---------------------------------------

check("8 delivered + failed -> regression refused", () => {
  const d = run(intentOf({ status: IntentResultStatus.DELIVERED }), messageOf({ status: "failed" }));
  eq(d.outcome, OUT.REFUSED_REGRESSION, "outcome");
  eq(d.plan, null, "no write");
});

check("9 failed + delivered -> regression refused", () => {
  const d = run(intentOf({ status: IntentResultStatus.FAILED }), messageOf({ status: "delivered" }));
  eq(d.outcome, OUT.REFUSED_REGRESSION, "outcome");
  eq(d.plan, null, "no write");
});

check("9b backward moves are refused", () => {
  const d = run(intentOf({ status: IntentResultStatus.DELIVERED }), messageOf({ status: "sent" }));
  eq(d.plan, null, "delivered must not fall back to dispatched");
});

check("10 same terminal status -> no rewrite", () => {
  for (const [intentStatus, messageStatus] of [
    [IntentResultStatus.DELIVERED, "delivered"],
    [IntentResultStatus.DELIVERED, "read"],
    [IntentResultStatus.FAILED, "failed"],
  ]) {
    const d = run(intentOf({ status: intentStatus }), messageOf({ status: messageStatus }));
    eq(d.outcome, OUT.NOOP_SAME_STATUS, `${intentStatus}/${messageStatus}`);
    eq(d.plan, null, "no write plan");
  }
});

// ---- 11-18. linkage --------------------------------------------------------

check("11 wrong aggregate type -> not this lane", () => {
  const d = run(intentOf({ aggregate_type: "vendor_campaign" }), messageOf());
  eq(d.outcome, OUT.NOT_APPLICABLE_NOT_LEAD_ASSIGNMENT, "campaign intent is not an error");
  eq(d.plan, null, "no write");
});

check("12 wrong channel -> refused", () => {
  eq(run(intentOf({ channel: "sms" }), messageOf()).outcome, OUT.REFUSED_INTENT_CHANNEL_MISMATCH, "intent channel");
  eq(run(intentOf(), messageOf({ channel: "sms" })).outcome, OUT.REFUSED_MESSAGE_CHANNEL_MISMATCH, "message channel");
});

check("13 wrong intent purpose -> refused", () => {
  const d = run(intentOf({ template_purpose: "vendor_campaign_message" }), messageOf());
  eq(d.outcome, OUT.REFUSED_INTENT_PURPOSE_MISMATCH, "outcome");
  eq(d.plan, null, "no write");
});

check("14 wrong message entity_type -> not applicable", () => {
  for (const t of ["lead", "vendor_campaign", null, ""]) {
    const d = run(intentOf(), messageOf({ entity_type: t }));
    eq(d.outcome, OUT.NOT_APPLICABLE_MESSAGE_NOT_INTENT_LINKED, `entity_type ${JSON.stringify(t)}`);
    eq(d.plan, null, "no write");
  }
});

check("15 wrong message entity_id -> refused", () => {
  const d = run(intentOf(), messageOf({ entity_id: "11111111-2222-4333-8444-555555555555" }));
  eq(d.outcome, OUT.REFUSED_MESSAGE_ENTITY_ID_MISMATCH, "outcome");
  eq(d.plan, null, "no write");
});

check("16 wrong template -> refused", () => {
  const d = run(intentOf(), messageOf({ template_key: "lead_received" }));
  eq(d.outcome, OUT.REFUSED_MESSAGE_TEMPLATE_MISMATCH, "outcome");
  eq(d.plan, null, "no write");
});

check("17 wrong deterministic idempotency key -> refused", () => {
  const wrong = leadAssignmentMessageIdempotencyKey("11111111-2222-4333-8444-555555555555");
  const d = run(intentOf(), messageOf({ idempotency_key: wrong }));
  eq(d.outcome, OUT.REFUSED_MESSAGE_IDEMPOTENCY_KEY_MISMATCH, "outcome");
  eq(d.plan, null, "no write");
  // and the real key must be exactly the dispatcher's grammar
  assert(messageOf().idempotency_key.startsWith("qf_mvp_80_13a_lead_assignment_intent_v1:"),
    "key grammar must be the dispatcher's");
});

check("18 missing message or intent -> no intent mutation", () => {
  eq(run(intentOf(), null).outcome, OUT.REFUSED_MESSAGE_NOT_FOUND, "missing message");
  eq(run(intentOf(), undefined).plan, null, "missing message: no write");
  eq(run(null, messageOf()).outcome, OUT.REFUSED_INTENT_NOT_FOUND, "missing intent");
  eq(run(null, messageOf()).plan, null, "missing intent: no write");
  eq(run(intentOf({ id: "not-a-uuid" }), messageOf({ entity_id: "not-a-uuid" })).outcome,
    OUT.REFUSED_INTENT_IDENTITY_INVALID, "bad intent id");
});

check("18b unknown status vocabulary is refused, never guessed", () => {
  eq(run(intentOf(), messageOf({ status: "teleported" })).outcome, OUT.REFUSED_MESSAGE_STATUS_UNKNOWN, "message");
  eq(run(intentOf({ status: "archived" }), messageOf()).outcome, OUT.REFUSED_INTENT_STATUS_UNKNOWN, "intent");
});

// ---- 19-23. write containment ---------------------------------------------

check("19 the caller cannot supply a desired status", () => {
  // The decision takes exactly { intent, message }; extra keys are ignored.
  const d = evaluate({
    intent: intentOf(), message: messageOf({ status: "delivered" }),
    desiredStatus: IntentResultStatus.FAILED, force: true, status: "failed",
  });
  eq(d.derived, IntentResultStatus.DELIVERED, "target comes from the message alone");
  eq(d.plan.patch.status, IntentResultStatus.DELIVERED, "injected desire ignored");
  // and the signature names no caller-supplied outcome
  for (const banned of ["desiredStatus", "targetStatus", "force", "retryable", "deliveryResult"]) {
    assert(!new RegExp(`\\b${banned}\\b`).test(CONTRACT_CODE), `contract must not accept ${banned}`);
  }
});

check("20 the write uses the exact intent id", () => {
  const f = Object.fromEntries(run(intentOf(), messageOf()).plan.filters);
  eq(f.id, INTENT_ID, "id fence");
});

check("21 the write is aggregate_type fenced", () => {
  const f = Object.fromEntries(run(intentOf(), messageOf()).plan.filters);
  eq(f.aggregate_type, LEAD_ASSIGNMENT_AGGREGATE_TYPE, "aggregate fence");
});

check("22 the write is compare-and-set on the observed status", () => {
  for (const observed of [IntentResultStatus.DISPATCHED, IntentResultStatus.UNCERTAIN]) {
    const f = Object.fromEntries(run(intentOf({ status: observed }), messageOf()).plan.filters);
    eq(f.status, observed, `CAS on observed ${observed}`);
  }
  eq(run(intentOf(), messageOf()).plan.filters.length, 3, "exactly three fences");
});

check("23 reconciliation never touches dispatched_at", () => {
  const plan = run(intentOf(), messageOf()).plan;
  eq(Object.keys(plan.patch).length, 1, "exactly one column written");
  eq(Object.keys(plan.patch)[0], LEAD_ASSIGNMENT_RECONCILE_COLUMN, "the column is status");
  eq(plan.table, LEAD_ASSIGNMENT_RECONCILE_TABLE, "the table is communication_intents");
  assert(!/dispatched_at/.test(CONTRACT_CODE), "contract must never name dispatched_at");
  assert(!/dispatched_at/.test(SERVICE_CODE), "service must never name dispatched_at");
});

// ---- 24-31. structural containment -----------------------------------------

const FORBIDDEN_IN_RECONCILER = [
  [/CommunicationService/, "CommunicationService"],
  [/\.send\s*\(/, "a send call"],
  [/sendResolvedTemplate|sendTemplate/, "a provider send method"],
  [/fetch\s*\(/, "fetch"],
  [/graph\.facebook|https?:\/\//, "an outbound URL"],
  [/n8n/i, "n8n"],
  [/\.insert\s*\(/, "an INSERT"],
  [/from\(\s*["'`]communication_messages["'`]\s*\)[\s\S]{0,80}\.update/, "a message UPDATE"],
  [/from\(\s*["'`]lead_assignments["'`]/, "a lead_assignments write"],
  [/from\(\s*["'`]vendors["'`]/, "a vendors write"],
  [/from\(\s*["'`]leads["'`]/, "a leads write"],
  [/vendor_credit|credits_delta|qf_apply_credit/, "a credit mutation"],
  [/communication_provider_runtime_policies|communication_provider_accounts/, "a runtime/provider write"],
  [/next_retry_at|retry_scheduled\s*=/, "retry scheduling"],
];

check("24-30 the reconciler cannot send, insert or mutate business state", () => {
  for (const [re, label] of FORBIDDEN_IN_RECONCILER) {
    assert(!re.test(CONTRACT_CODE), `pure contract must not contain ${label}`);
    assert(!re.test(SERVICE_CODE), `service must not contain ${label}`);
  }
});

check("24b no communication_messages INSERT and no communication_intents INSERT", () => {
  assert(!/\.insert\s*\(/.test(SERVICE_CODE), "service performs no INSERT at all");
  const updates = [...SERVICE_CODE.matchAll(/\.update\s*\(/g)];
  eq(updates.length, 1, "exactly one UPDATE statement exists");
  assert(/from\(plan\.table\)\.update\(plan\.patch\)/.test(SERVICE_CODE),
    "the one UPDATE must be the pure plan applied verbatim");
});

check("25 the pure contract is genuinely pure", () => {
  const imports = [...CONTRACT.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert(imports.every((p) => p.startsWith("./")), `contract imports must be local, got ${imports.join(", ")}`);
  assert(!/adminClient|supabase|createClient/i.test(CONTRACT_CODE), "contract must touch no database");
  assert(!/Date\.now|new Date\(/.test(CONTRACT_CODE), "contract must be clock-free");
});

check("26 the reconciler reuses the EXISTING projection authority", () => {
  assert(/projectIntentStatus/.test(CONTRACT_CODE), "must use projectIntentStatus");
  assert(/isForwardTransition/.test(CONTRACT_CODE), "must use isForwardTransition");
  assert(/from "\.\/campaignResultContract"/.test(CONTRACT), "must import them from the existing contract");
  // No second mapping may be declared here.
  assert(!/delivered:\s*IntentResultStatus|MESSAGE_TO_INTENT/.test(CONTRACT_CODE),
    "a second message->intent mapping must not exist");
});

check("27 the contract's decisions agree with the shared authority", () => {
  // Cross-check every message status against projectIntentStatus directly.
  for (const s of ["delivered", "read", "failed", "dead_letter", "cancelled"]) {
    const expected = projectIntentStatus(s);
    const d = run(intentOf(), messageOf({ status: s }));
    const legal = isForwardTransition(IntentResultStatus.DISPATCHED, expected);
    if (legal && expected !== IntentResultStatus.DISPATCHED) {
      eq(d.derived, expected, `derived for ${s} must equal projectIntentStatus`);
    }
  }
});

// ---- 31-33. neighbouring authorities unchanged -----------------------------

check("31 the dispatcher's selector and resend path are unchanged", () => {
  assert(/\.eq\("status", LEAD_ASSIGNMENT_SELECTABLE_STATUS\)/.test(DISPATCH_CODE),
    "first dispatch still selects only pending");
  assert(/\.gt\("created_at", boundary\.notBeforeIso\)/.test(DISPATCH_CODE),
    "the activation boundary fence is unchanged");
  assert(/LEAD_ASSIGNMENT_SELECTABLE_STATUS: IntentResultStatusValue =\s*\n?\s*IntentResultStatus\.PENDING/
    .test(DISPATCH_CONTRACT_CODE), "selectable status is still PENDING only");
});

check("32 historical first-dispatch activation fence remains unchanged", () => {
  assert(/LEAD_ASSIGNMENT_ACTIVATION_POLICY_KEY =\s*\n?\s*"lead_assignment_dispatch_activation"/
    .test(DISPATCH_CONTRACT_CODE), "activation policy key unchanged");
  // Reconciliation must never be able to make a parked intent dispatchable.
  const d = run(intentOf({ status: IntentResultStatus.PENDING }), messageOf({ status: "sent" }));
  assert(d.plan === null, "pending must never be advanced to dispatched by reconciliation");
  assert(!/PENDING/.test(CONTRACT_CODE.replace(/KNOWN_INTENT_STATUSES[\s\S]*?\]\);/, "")),
    "reconciliation must not target the pending state");
});

check("33 the 80.16C permanent-recipient close is intact", () => {
  assert(/planLeadAssignmentIntentTerminalization/.test(DISPATCH_CODE),
    "80.16C terminalization plan still used");
  assert(/failLeadAssignmentIntentOnPermanentRecipientRefusal/.test(DISPATCH_CODE),
    "80.16C close function still present");
});

// ---- 34-35. idempotency + concurrency --------------------------------------

check("34 repeated reconciliation is idempotent", () => {
  // First pass applies; the row is then delivered, so a redelivery is a no-op.
  const first = run(intentOf({ status: IntentResultStatus.DISPATCHED }), messageOf({ status: "delivered" }));
  eq(first.outcome, OUT.APPLIED, "first pass applies");
  const second = run(intentOf({ status: first.derived }), messageOf({ status: "delivered" }));
  eq(second.outcome, OUT.NOOP_SAME_STATUS, "second pass is a no-op");
  eq(second.plan, null, "second pass writes nothing");
  // A later `read` event after `delivered` is also a no-op.
  const third = run(intentOf({ status: IntentResultStatus.DELIVERED }), messageOf({ status: "read" }));
  eq(third.outcome, OUT.NOOP_SAME_STATUS, "read after delivered is a no-op");
});

check("35 a lost CAS cannot force an overwrite", () => {
  // The plan pins the OBSERVED status, so a row a concurrent writer already moved
  // matches zero rows and the service treats that as unchanged, never a retry.
  const f = Object.fromEntries(run(intentOf({ status: IntentResultStatus.DISPATCHED }), messageOf()).plan.filters);
  eq(f.status, IntentResultStatus.DISPATCHED, "CAS pins the observed status");
  assert(/data\.length === 0/.test(SERVICE_CODE), "zero affected rows is handled");
  assert(!/\.neq\(|force|upsert/i.test(SERVICE_CODE), "no forced write path exists");
});

// ---- webhook ordering ------------------------------------------------------

check("36 reconciliation runs only AFTER canonical delivery persistence", () => {
  const call = WEBHOOK_CODE.indexOf("deps.reconcileLeadAssignmentResults");
  const persist = WEBHOOK_CODE.indexOf("deps.processDelivery");
  const guard = WEBHOOK_CODE.indexOf('if (!res.ok) return { status: 500, code: "processing_failed" }');
  assert(persist > 0 && call > 0 && guard > 0, "both steps must exist");
  assert(persist < guard && guard < call,
    "order must be processDelivery -> success guard -> reconcile");
});

check("37 a projection failure never turns a good webhook into a 500", () => {
  const after = WEBHOOK_CODE.slice(WEBHOOK_CODE.indexOf("deps.reconcileLeadAssignmentResults"));
  const tail = after.slice(0, after.indexOf("return { status: 200"));
  assert(/catch\s*\{/.test(tail), "the reconcile call must be wrapped in try/catch");
  assert(!/status:\s*500/.test(tail), "reconciliation must not raise a 500");
});

check("38 webhook signature / identity / ownership gates are unchanged", () => {
  for (const needle of [
    "verifyMetaWebhookSignatureBytes", "decideCallbackIdentity",
    "resolveEnvelopeProviderAccount", "isWebhookProcessingEnabled",
  ]) {
    assert(WEBHOOK_CODE.includes(needle), `gate preserved: ${needle}`);
  }
  // Reconciliation must sit strictly after the ownership fence.
  assert(WEBHOOK_CODE.indexOf("resolveEnvelopeProviderAccount") <
    WEBHOOK_CODE.indexOf("deps.reconcileLeadAssignmentResults"), "ownership resolves first");
});

// ---- mutants: prove the rules can fail -------------------------------------

check("39 mutant: dropping the forward check would allow a regression", () => {
  eq(run(intentOf({ status: IntentResultStatus.DELIVERED }), messageOf({ status: "failed" })).plan, null,
    "real rule refuses");
  // The naive rule (write whatever the message projects) WOULD overwrite.
  const naive = projectIntentStatus("failed");
  assert(naive === IntentResultStatus.FAILED && naive !== IntentResultStatus.DELIVERED,
    "the mutant would overwrite delivered with failed");
});

check("40 mutant: dropping the idempotency-key fence would cross-link intents", () => {
  const foreign = messageOf({ idempotency_key: leadAssignmentMessageIdempotencyKey(
    "99999999-8888-4777-8666-555555555555") });
  eq(run(intentOf(), foreign).plan, null, "real rule refuses a foreign key");
  // Without that fence every other linkage fact still agrees — which is exactly
  // why the key is the load-bearing check.
  assert(foreign.entity_id === INTENT_ID && foreign.template_key === LEAD_ASSIGNMENT_TEMPLATE_KEY,
    "the mutant otherwise looks perfectly linked");
});

check("41 mutant: treating non-terminal as terminal would fabricate delivery", () => {
  eq(run(intentOf(), messageOf({ status: "queued" })).plan, null, "real rule writes nothing");
  assert(projectIntentStatus("queued") === IntentResultStatus.PENDING,
    "queued projects to pending, which must never be written here");
});

// ============================================================================
let passed = 0;
const failures = [];
for (const { name, fn } of checks) {
  try { fn(); passed += 1; console.log(`   ok    ${name}`); }
  catch (e) { failures.push(`   FAIL  ${name} — ${e.message}`); console.log(`   FAIL  ${name} — ${e.message}`); }
}
console.log(`\n${"=".repeat(78)}`);
console.log(`QF-MVP-80.17A lead-assignment terminal reconciliation — passed ${passed}, failed ${failures.length}`);
if (failures.length) { console.log("\nFAILURES:"); for (const l of failures) console.log(l); }
console.log("=".repeat(78));
process.exit(failures.length ? 1 : 0);
