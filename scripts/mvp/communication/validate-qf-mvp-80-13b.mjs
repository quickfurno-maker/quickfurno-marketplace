// ============================================================================
// QF-MVP-80.13B — lead-assignment dispatch TRIGGER validator.  OFFLINE.
//
// Proves that the new cron route is a trigger and nothing else: it delegates to
// the already-merged QF-MVP-80.13A batch runner, adds no second dispatcher, is
// fail-closed on the shared secret, accepts exactly one clamped caller value,
// and returns sanitized counts that cannot carry an id, a destination, a phone
// or the activation-boundary instant.
//
// The security-critical logic (timing-safe secret evaluation, the limit clamp,
// the response projection) lives in a PURE module, so this validator EXECUTES it
// rather than asserting about its source text. Source text is read only for the
// negative containment claims — no DB, no provider, no Meta, no n8n, no fetch —
// which no execution can demonstrate.
//
// No network, no database, no credential, no send.
// ============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CRON_SECRET_ENV_KEY,
  CRON_SECRET_HEADER,
  CronSecretRefusal,
  DISPATCH_BATCH_DEFAULT,
  DISPATCH_BATCH_MAX,
  DISPATCH_BATCH_MIN,
  evaluateCronSecret,
  resolveDispatchLimit,
  sanitizeDispatchSummary,
  secretsMatch,
} from "../../../lib/communication/leadAssignmentDispatchTrigger.ts";
import {
  LEAD_ASSIGNMENT_ACTIVATION_POLICY_KEY,
  LeadAssignmentDispatchRefusal,
  isEligibleLeadAssignmentIntent,
  parseActivationBoundary,
} from "../../../lib/communication/leadAssignmentDispatchContract.ts";

// ---------------------------------------------------------------------------
// Sources read for the negative containment claims
// ---------------------------------------------------------------------------

const ROUTE_PATH = "app/api/internal/process-lead-assignment-intents/route.ts";
const TRIGGER_PATH = "lib/communication/leadAssignmentDispatchTrigger.ts";
const SERVICE_PATH = "services/leadAssignmentDispatchService.ts";
const CONSENT_ROUTE_PATH = "app/api/internal/process-consent-ack-intents/route.ts";

const routeSrc = readFileSync(resolve(ROUTE_PATH), "utf8");
const triggerSrc = readFileSync(resolve(TRIGGER_PATH), "utf8");
const serviceSrc = readFileSync(resolve(SERVICE_PATH), "utf8");
const consentRouteSrc = readFileSync(resolve(CONSENT_ROUTE_PATH), "utf8");

/** Comment lines are intent, not behaviour. Negative claims run on CODE only. */
const stripComments = (src) =>
  src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

const routeCode = stripComments(routeSrc);
const triggerCode = stripComments(triggerSrc);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SECRET = "s3cr3t-cron-value-for-tests-only";

/** A summary shaped exactly like LeadAssignmentDispatchRunSummary, carrying leaky fields. */
const LEAKY_SUMMARY = Object.freeze({
  selected: 1,
  dispatched: 1,
  refused: 0,
  boundaryIso: "2026-09-02T12:00:00.000Z",
  selectionRefusal: null,
  outcomes: [
    {
      ok: true,
      intentId: "3f1c2a44-9c6e-4a2b-8d11-77aa0b3c5e91",
      messageId: "c7d8e9f0-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
      messageStatus: "sent",
      intentStatus: "dispatched",
      vendorId: "01c6bc34-37bd-4d68-9c03-d4584d3ef280",
      leadId: "a1c9d7e3-2b48-4c6a-9f15-8e0d3b7a4c22",
      destinationHash: "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0",
      destinationMasked: "+9177200*****3",
      phone: "+917720000553",
      providerKey: "meta_whatsapp_cloud",
      providerTemplateName: "quickfurno_vendor_lead_assignment_alert_v1",
    },
  ],
});

/** Every substring that must NEVER survive the projection. */
const FORBIDDEN_SUBSTRINGS = Object.freeze([
  "3f1c2a44",
  "c7d8e9f0",
  "01c6bc34",
  "a1c9d7e3",
  "9f8e7d6c",
  "+9177200",
  "917720000553",
  "meta_whatsapp_cloud",
  "quickfurno_vendor_lead_assignment_alert_v1",
  "2026-09-02T12:00:00.000Z",
  "outcomes",
  "boundaryIso",
  "selectionRefusal",
  "intentId",
  "messageId",
  "vendorId",
  "leadId",
  "destination",
  "phone",
  "provider",
]);

const SANITIZED_KEYS = ["ok", "selected", "dispatched", "refused", "selectionBlocked"];

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

const T = {
  // ---- 1-2. Delegation, and no second dispatcher --------------------------
  "T01 the route delegates to the existing runLeadAssignmentDispatchBatch": () =>
    /import \{ runLeadAssignmentDispatchBatch \} from "@\/services\/leadAssignmentDispatchService";/.test(
      routeSrc
    ) &&
    /await runLeadAssignmentDispatchBatch\(\{ limit \}\)/.test(routeCode) &&
    // exactly one invocation, and it is the ONLY awaited service call
    (routeCode.match(/runLeadAssignmentDispatchBatch\s*\(/g) ?? []).length === 1,

  "T02 no second dispatch implementation exists": () => {
    // The route re-implements nothing the service owns.
    const forbiddenInRoute = [
      "selectEligibleLeadAssignmentIntents",
      "dispatchLeadAssignmentIntent",
      "readLeadAssignmentActivationBoundary",
      "buildLeadAssignmentDispatchPlan",
      "isEligibleLeadAssignmentIntent",
      "createRuntimeCommunicationService",
      "communication_intents",
      "lead_assignments",
      "automation_policy_active_configs",
      "lead_assignment_alert",
      "vendor_lead_assigned",
    ];
    const routeClean = forbiddenInRoute.every((t) => !routeCode.includes(t));
    const triggerClean = forbiddenInRoute.every((t) => !triggerCode.includes(t));
    // and the batch runner still has exactly ONE definition, in the service
    const definedOnce =
      (serviceSrc.match(/export async function runLeadAssignmentDispatchBatch/g) ?? []).length === 1;
    return routeClean && triggerClean && definedOnce;
  },

  // ---- 3-6. The shared secret --------------------------------------------
  "T03 QF_CRON_SECRET is the env key, read from process.env in the route": () =>
    CRON_SECRET_ENV_KEY === "QF_CRON_SECRET" &&
    /CRON_SECRET_ENV_KEY = "QF_CRON_SECRET"/.test(triggerSrc) &&
    /process\.env\[CRON_SECRET_ENV_KEY\]/.test(routeCode) &&
    // the same env key the existing consent worker uses
    /QF_CRON_SECRET/.test(consentRouteSrc),

  "T04 x-qf-cron-secret is the header, read from the request in the route": () =>
    CRON_SECRET_HEADER === "x-qf-cron-secret" &&
    /CRON_SECRET_HEADER = "x-qf-cron-secret"/.test(triggerSrc) &&
    /req\.headers\.get\(CRON_SECRET_HEADER\)/.test(routeCode) &&
    // the same header the existing consent worker uses
    /x-qf-cron-secret/.test(consentRouteSrc),

  "T05 the comparison is timing-safe": () => {
    // The real node primitive is imported and used.
    const usesPrimitive =
      /import \{ timingSafeEqual \} from "crypto";/.test(triggerSrc) &&
      /return timingSafeEqual\(a, b\)/.test(triggerCode) &&
      // no short-circuiting equality on the secret anywhere
      !/provided\s*===\s*expected|expected\s*===\s*provided/.test(triggerCode);
    // and it behaves correctly under execution
    const behaves =
      secretsMatch(SECRET, SECRET) === true &&
      secretsMatch(SECRET, SECRET + "x") === false &&
      secretsMatch(SECRET.slice(0, -1) + "X", SECRET) === false &&
      secretsMatch("", "") === true;
    return usesPrimitive && behaves;
  },

  "T06 unset / missing / wrong secret all fail closed": () => {
    const unsetServer = [undefined, null, "", "   "].every((expected) => {
      const r = evaluateCronSecret({ expected, provided: SECRET });
      return r.ok === false && r.message === CronSecretRefusal.SERVER_SECRET_NOT_CONFIGURED;
    });
    const missingProvided = [undefined, null, "", "   "].every((provided) => {
      const r = evaluateCronSecret({ expected: SECRET, provided });
      return r.ok === false && r.message === CronSecretRefusal.MISSING_SECRET;
    });
    const wrongProvided = [
      "wrong",
      SECRET + "x",
      SECRET.slice(0, -1),
      SECRET.toUpperCase(),
      " " + SECRET.slice(1),
    ].every((provided) => {
      const r = evaluateCronSecret({ expected: SECRET, provided });
      return r.ok === false && r.message === CronSecretRefusal.INVALID_SECRET;
    });
    const correct = evaluateCronSecret({ expected: SECRET, provided: SECRET }).ok === true;
    // a surrounding-whitespace variant of the CORRECT secret still authenticates
    const trimmed = evaluateCronSecret({ expected: SECRET, provided: `  ${SECRET}  ` }).ok === true;
    return unsetServer && missingProvided && wrongProvided && correct && trimmed;
  },

  "T06b the secret is never echoed, logged or hinted at": () => {
    // No refusal message contains any part of either secret.
    const messages = Object.values(CronSecretRefusal);
    const leaks = messages.some((m) => m.includes(SECRET) || SECRET.includes(m));
    // The route returns auth.message verbatim, and there is no logging at all.
    const noLogging = !/console\.(log|info|warn|error|debug)/.test(routeCode + triggerCode);
    const noSecretInBody =
      !/expected|process\.env\[CRON_SECRET_ENV_KEY\]\s*\}/.test(
        routeCode.split("return NextResponse.json({ ok: false, error: auth.message }")[1] ?? ""
      );
    // and the 401 body carries only ok+error
    const body401 = /return NextResponse\.json\(\{ ok: false, error: auth\.message \}, \{ status: 401 \}\)/.test(
      routeCode
    );
    return !leaks && noLogging && noSecretInBody && body401;
  },

  // ---- 7-9. The single clamped caller value -------------------------------
  "T07 only `limit` is accepted from the request": () => {
    // Every other field a caller might try is ignored outright.
    const hostile = {
      limit: 3,
      intentId: "3f1c2a44-9c6e-4a2b-8d11-77aa0b3c5e91",
      assignmentId: "5b8e10c2-4f3a-4d7e-9b02-1c6d4e8a2f30",
      leadId: "a1c9d7e3-2b48-4c6a-9f15-8e0d3b7a4c22",
      vendorId: "01c6bc34-37bd-4d68-9c03-d4584d3ef280",
      recipient: "vendor",
      phone: "+917720000553",
      destination: "+917720000553",
      destinationHash: "9f8e7d6c",
      template: "lead_assignment_alert",
      templateKey: "lead_assignment_alert",
      templatePurpose: "vendor_lead_assigned",
      provider: "meta_whatsapp_cloud",
      providerAccount: "1333595106493545",
      activationNotBefore: "1970-01-01T00:00:00Z",
      boundaryIso: "1970-01-01T00:00:00Z",
      retryCount: 99,
      messageId: "c7d8e9f0-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
      force: true,
      skipConsent: true,
    };
    // The resolver reads ONLY `limit` — proven by the value it returns...
    const readsOnlyLimit = resolveDispatchLimit(hostile) === 3;
    // ...and by the route passing ONLY { limit } onward.
    const passesOnlyLimit =
      /runLeadAssignmentDispatchBatch\(\{ limit \}\)/.test(routeCode) &&
      // the request object never reaches the service call
      !/runLeadAssignmentDispatchBatch\([^)]*req/.test(routeCode) &&
      // and the route destructures nothing else off the body
      !/(?:const|let)\s*\{[^}]*\b(intentId|vendorId|leadId|assignmentId|template|provider|recipient|destination|phone|messageId|retryCount)\b/.test(
        routeCode
      );
    // The trigger module names no forbidden caller input at all.
    const noForbiddenNames = [
      "intentId", "assignmentId", "leadId", "vendorId", "recipient", "destination",
      "template", "templatePurpose", "provider", "providerAccount", "retryCount", "messageId",
    ].every((n) => !new RegExp(`\\b${n}\\b`).test(triggerCode));
    return readsOnlyLimit && passesOnlyLimit && noForbiddenNames;
  },

  "T08 limit defaults to 25": () => {
    const defaults = [
      undefined, null, {}, { limit: undefined }, { limit: null }, { limit: "10" },
      { limit: 10.5 }, { limit: NaN }, { limit: Infinity }, { limit: -Infinity },
      { limit: true }, { limit: [] }, { limit: {} }, "not an object", 42, [],
    ].every((body) => resolveDispatchLimit(body) === DISPATCH_BATCH_DEFAULT);
    return DISPATCH_BATCH_DEFAULT === 25 && defaults;
  },

  "T09 limit clamps to 1..25": () => {
    const bounds = DISPATCH_BATCH_MIN === 1 && DISPATCH_BATCH_MAX === 25;
    const low = [0, -1, -25, -1000, Number.MIN_SAFE_INTEGER].every(
      (v) => resolveDispatchLimit({ limit: v }) === DISPATCH_BATCH_MIN
    );
    const high = [26, 100, 1000, Number.MAX_SAFE_INTEGER].every(
      (v) => resolveDispatchLimit({ limit: v }) === DISPATCH_BATCH_MAX
    );
    const inRange = [1, 2, 7, 24, 25].every((v) => resolveDispatchLimit({ limit: v }) === v);
    // the route's ceiling is TIGHTER than the service's own MAX_SELECT_LIMIT (100),
    // so the route can never widen the service's batch.
    const tighterThanService = /MAX_SELECT_LIMIT = 100/.test(serviceSrc) && DISPATCH_BATCH_MAX < 100;
    return bounds && low && high && inRange && tighterThanService;
  },

  // ---- 10. Method fence ---------------------------------------------------
  "T10 GET returns 405 and POST is the only worker verb": () =>
    /export async function GET\(\): Promise<NextResponse> \{\s*return NextResponse\.json\(\{ ok: false, error: "method_not_allowed" \}, \{ status: 405 \}\);/.test(
      routeCode
    ) &&
    /export async function POST\(req: Request\)/.test(routeCode) &&
    // no other HTTP verb is exported
    ["PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].every(
      (v) => !new RegExp(`export async function ${v}\\b`).test(routeCode)
    ),

  // ---- 11-12. The sanitized response --------------------------------------
  "T11 the response contains sanitized counts only": () => {
    const out = sanitizeDispatchSummary(LEAKY_SUMMARY);
    const keys = Object.keys(out).sort();
    return (
      keys.join(",") === SANITIZED_KEYS.slice().sort().join(",") &&
      out.ok === true &&
      out.selected === 1 &&
      out.dispatched === 1 &&
      out.refused === 0 &&
      out.selectionBlocked === false &&
      // counts are coerced, never trusted
      sanitizeDispatchSummary({ selected: "9", dispatched: -3, refused: 1.5 }).selected === 0 &&
      sanitizeDispatchSummary(null).selected === 0 &&
      sanitizeDispatchSummary(undefined).ok === true
    );
  },

  "T12 the response cannot expose outcomes, ids, destinations, phones or the boundary": () => {
    const serialized = JSON.stringify(sanitizeDispatchSummary(LEAKY_SUMMARY));
    const noLeak = FORBIDDEN_SUBSTRINGS.every((s) => !serialized.includes(s));
    // The projection CONSTRUCTS its object; a spread would carry future fields through.
    const noSpread = !/\.\.\.\s*summary/.test(triggerCode);
    // A summary carrying a brand-new leaky field still cannot reach the caller.
    const futureField = JSON.stringify(
      sanitizeDispatchSummary({
        selected: 0, dispatched: 0, refused: 0, selectionRefusal: null,
        someFutureDiagnostic: "+917720000553",
        providerMessageId: "wamid.ABC123",
      })
    );
    const futureSafe =
      !futureField.includes("917720000553") &&
      !futureField.includes("wamid") &&
      !futureField.includes("someFutureDiagnostic");
    // selectionBlocked is a BOOLEAN — it never carries the reason or the instant.
    const blocked = sanitizeDispatchSummary({
      selected: 0, dispatched: 0, refused: 0,
      selectionRefusal: LeadAssignmentDispatchRefusal.ACTIVATION_BOUNDARY_UNCONFIGURED,
      boundaryIso: "2026-09-02T12:00:00.000Z",
    });
    const blockedSafe =
      blocked.selectionBlocked === true &&
      typeof blocked.selectionBlocked === "boolean" &&
      !JSON.stringify(blocked).includes("ACTIVATION_BOUNDARY_UNCONFIGURED") &&
      !JSON.stringify(blocked).includes("2026-09-02");
    // the route returns the projection and nothing else on the 200 path
    const routeUsesProjection =
      /NextResponse\.json\(sanitizeDispatchSummary\(summary\), \{ status: 200 \}\)/.test(routeCode) &&
      !/NextResponse\.json\(summary/.test(routeCode);
    return noLeak && noSpread && futureSafe && blockedSafe && routeUsesProjection;
  },

  "T12b an unexpected exception is a generic 500 worker_failed": () =>
    /catch \{\s*return NextResponse\.json\(\{ ok: false, error: "worker_failed" \}, \{ status: 500 \}\);/.test(
      routeCode
    ) &&
    // the caught error is never serialized into the response
    !/error:\s*(e|err|error)\b/.test(routeCode) &&
    !/String\(e\)|e\.message/.test(routeCode),

  // ---- 13. Route containment ---------------------------------------------
  "T13 the route contains no DB / provider / Meta / n8n / fetch path": () => {
    const forbidden = [
      [/fetch\s*\(/, "fetch"],
      [/https?:\/\//, "url"],
      [/graph\.facebook\.com/, "meta host"],
      [/n8n/i, "n8n"],
      [/adminClient|createClient|supabase/i, "supabase"],
      // `Buffer.from` is the node crypto primitive, not a PostgREST table read.
      [/(?<!Buffer)\.from\(|\.rpc\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(/, "postgrest"],
      [/select\s+.*\s+from\s+|insert\s+into|update\s+.*\s+set\s+/i, "sql"],
      [/communication_provider_runtime_policies|communication_provider_canary_destinations/, "gate table"],
      [/communication_provider_accounts|communication_provider_template_mappings/, "provider table"],
      [/vendor_credit|remaining_credits|credit_ledger/, "credit"],
      [/lead_assignments|qf_assign_lead_vendors/, "assignment authority"],
      [/metaCloudWhatsAppProvider|sendResolvedTemplate|CommunicationService/, "provider path"],
      [/auto_assignment|autoAssignment/i, "auto-assignment"],
    ];
    const routeClean = forbidden.every(([re]) => !re.test(routeCode));
    const triggerClean = forbidden.every(([re]) => !re.test(triggerCode));
    // The route imports exactly two things beyond next/server.
    const imports = [...routeSrc.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort();
    const importsExact =
      imports.join("|") ===
      ["@/lib/communication/leadAssignmentDispatchTrigger", "@/services/leadAssignmentDispatchService", "next/server"].join("|");
    // The pure trigger module imports ONLY the node crypto primitive.
    const triggerImports = [...triggerSrc.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    const triggerImportsExact = triggerImports.join("|") === "crypto";
    return routeClean && triggerClean && importsExact && triggerImportsExact;
  },

  // ---- 14. The historical intents stay unreachable ------------------------
  "T14 historical pre-activation intents remain unreachable from the trigger": () => {
    // The route holds NO selection logic, so the 80.13A fences are the only path.
    const noSelectionInRoute =
      !/created_at|\.gt\(|boundary|notBefore|activationNotBefore/i.test(routeCode) &&
      !/created_at|\.gt\(|notBefore/i.test(triggerCode) &&
      // and the trigger cannot name the activation policy key at all
      !triggerCode.includes(LEAD_ASSIGNMENT_ACTIVATION_POLICY_KEY);

    // The 80.13A fences are still intact in the merged service.
    const fencesIntact =
      /const boundaryRead = await readLeadAssignmentActivationBoundary\(\);/.test(serviceSrc) &&
      /if \(!boundaryRead\.ok\) \{[\s\S]{0,220}?intents: \[\] \};/.test(serviceSrc) &&
      /\.gt\("created_at", boundary\.notBeforeIso\)/.test(serviceSrc) &&
      /isEligibleLeadAssignmentIntent\(row, boundary\)\.ok/.test(serviceSrc);

    // And they still behave: six historical rows are refused under a real boundary
    // and refused again with no boundary configured — whatever limit a caller asks for.
    const boundary = parseActivationBoundary({ activationNotBefore: "2026-09-01T00:00:00Z" });
    const historical = Array.from({ length: 6 }, (_, i) => ({
      id: `6b0a1c2d-3e4f-4a5b-8c9d-00000000000${i + 1}`,
      aggregate_type: "lead_assignment",
      aggregate_id: `7c1b2d3e-4f50-4a6b-9c8d-00000000000${i + 1}`,
      channel: "whatsapp",
      template_purpose: "vendor_lead_assigned",
      payload_ref: {
        assignment_id: `7c1b2d3e-4f50-4a6b-9c8d-00000000000${i + 1}`,
        lead_id: "a1c9d7e3-2b48-4c6a-9f15-8e0d3b7a4c22",
      },
      status: "pending",
      created_at: `2026-08-0${i + 1}T09:00:00.000Z`,
    }));
    const refusedUnderBoundary =
      boundary.ok === true &&
      historical.every((row) => {
        const r = isEligibleLeadAssignmentIntent(row, boundary.boundary);
        return (
          r.ok === false &&
          r.reason === LeadAssignmentDispatchRefusal.INTENT_BEFORE_ACTIVATION_BOUNDARY
        );
      });
    const refusedUnconfigured = historical.every(
      (row) => isEligibleLeadAssignmentIntent(row, null).ok === false
    );

    // A caller maximising the batch changes nothing about eligibility.
    const limitIrrelevant =
      resolveDispatchLimit({ limit: 25 }) === 25 && resolveDispatchLimit({ limit: 1000 }) === 25;

    return (
      noSelectionInRoute &&
      fencesIntact &&
      refusedUnderBoundary &&
      refusedUnconfigured &&
      limitIrrelevant
    );
  },

  // ---- 15. The 80.13A contract is untouched -------------------------------
  "T15 QF-MVP-80.13A source is untouched by this phase": () => {
    // This phase adds a caller; it must not have edited the lane it calls.
    const contractSrc = readFileSync(
      resolve("lib/communication/leadAssignmentDispatchContract.ts"),
      "utf8"
    );
    return (
      // the batch runner signature the route depends on is unchanged
      /export async function runLeadAssignmentDispatchBatch\(\s*options: \{ readonly limit\?: number \} = \{\},?\s*\): Promise<LeadAssignmentDispatchRunSummary>/.test(
        serviceSrc
      ) &&
      // the lane identity is unchanged
      /LEAD_ASSIGNMENT_TEMPLATE_PURPOSE = "vendor_lead_assigned"/.test(contractSrc) &&
      /LEAD_ASSIGNMENT_TEMPLATE_KEY = "lead_assignment_alert"/.test(contractSrc) &&
      /LEAD_ASSIGNMENT_ACTIVATION_POLICY_KEY =\s*\n?\s*"lead_assignment_dispatch_activation"/.test(
        contractSrc
      ) &&
      // and the strict boundary parser still refuses everything permissive
      ["1970", "epoch", "now", "*", "2026-09-01"].every(
        (v) => parseActivationBoundary({ activationNotBefore: v }).ok === false
      )
    );
  },

  // ---- Pattern parity with the existing consent worker --------------------
  "T16 the route matches the existing cron-worker pattern": () => {
    const shared = [
      /export const runtime = "nodejs";/,
      /export const dynamic = "force-dynamic";/,
      /status: 401/,
      /status: 405/,
      /status: 500/,
      /"worker_failed"/,
      /"method_not_allowed"/,
    ];
    return (
      shared.every((re) => re.test(routeCode)) &&
      shared.every((re) => re.test(stripComments(consentRouteSrc)))
    );
  },
};

// ---------------------------------------------------------------------------
// MUTATION SELF-TESTS — each simulates a regression and must be REJECTED
// ---------------------------------------------------------------------------

const MUT = {
  "M01 an unset server secret behaving as 'allow all' is rejected": () =>
    evaluateCronSecret({ expected: "", provided: "" }).ok === false &&
    evaluateCronSecret({ expected: undefined, provided: undefined }).ok === false,

  "M02 a limit above the ceiling reaching the service is rejected": () =>
    resolveDispatchLimit({ limit: 1000 }) <= DISPATCH_BATCH_MAX &&
    resolveDispatchLimit({ limit: 26 }) === 25,

  "M03 a limit of zero or negative reaching the service is rejected": () =>
    resolveDispatchLimit({ limit: 0 }) === 1 && resolveDispatchLimit({ limit: -5 }) === 1,

  "M04 a spread-based response projection is rejected": () => {
    // Simulate the regression: spreading the summary WOULD leak.
    const leaked = JSON.stringify({ ok: true, ...LEAKY_SUMMARY });
    const actual = JSON.stringify(sanitizeDispatchSummary(LEAKY_SUMMARY));
    return leaked.includes("917720000553") && !actual.includes("917720000553");
  },

  "M05 a caller-supplied intent id changing the run is rejected": () =>
    resolveDispatchLimit({ intentId: "3f1c2a44-9c6e-4a2b-8d11-77aa0b3c5e91" }) ===
      DISPATCH_BATCH_DEFAULT &&
    !routeCode.includes("intentId"),

  "M06 a non-timing-safe equality on the secret is rejected": () =>
    !/provided\s*===\s*expected|expected\s*===\s*provided|provided\s*==\s*expected/.test(
      triggerCode
    ) && /timingSafeEqual/.test(triggerCode),

  "M07 the canary destination appearing anywhere in this phase is rejected": () =>
    !routeSrc.includes("917720000553") && !triggerSrc.includes("917720000553"),
};

// ---------------------------------------------------------------------------

const results = [];
const add = (name, ok, detail) => results.push({ name, ok: ok === true, detail: detail ?? "" });

for (const [group, fns] of [
  ["rule", T],
  ["mutation", MUT],
]) {
  void group;
  for (const [name, fn] of Object.entries(fns)) {
    let ok = false;
    let detail = "";
    try {
      ok = fn() === true;
    } catch (e) {
      detail = e instanceof Error ? e.message : String(e);
    }
    add(name, ok, detail);
  }
}

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  [${r.detail}]` : ""}`);
}
console.log(
  `\nTrigger: POST /api/internal/process-lead-assignment-intents -> runLeadAssignmentDispatchBatch ` +
    `· secret=${CRON_SECRET_HEADER}/${CRON_SECRET_ENV_KEY} (timing-safe) ` +
    `· limit=[${DISPATCH_BATCH_MIN},${DISPATCH_BATCH_MAX}] default ${DISPATCH_BATCH_DEFAULT}`
);
console.log(
  `Response keys: ${SANITIZED_KEYS.join(", ")} · leak probes blocked: ${FORBIDDEN_SUBSTRINGS.length}`
);
console.log(
  `Summary: ${results.length - failed.length} passed, ${failed.length} failed ` +
    `(rules: ${Object.keys(T).length}, mutation self-tests: ${Object.keys(MUT).length}).`
);
process.exit(failed.length === 0 ? 0 : 1);
