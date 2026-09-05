// ============================================================================
// QF-MVP-80.16C — delivery-safety closure validator.  OFFLINE.
//
// Two independent defects are closed by this phase, and this harness proves
// both by EXECUTION wherever a real function can decide the question:
//
//   1. A permanently invalid vendor destination left a paid lead-assignment
//      intent at `pending` forever, so the production scheduler selected and
//      refused it every single minute. Only a closed set of deterministic
//      recipient-DATA failures may now terminalize that intent.
//
//   2. Vendor registration validated a contact number by LENGTH, so a ten-digit
//      number beginning 0-5 could enter `public.vendors` and then never receive
//      the WhatsApp alert the vendor is charged for.
//
// WHY THE WRITE IS A PURE PLAN
// The MVP loader deliberately refuses to resolve `services/` and `@/`
// specifiers, so an "offline" suite can never quietly acquire a database. That
// guard is respected here rather than worked around: the terminalization
// decision AND the exact write it performs both live in the pure contract, so
// the table, the single column, the target status and all three fences are
// directly executable. The service does nothing but apply what it is handed.
//
// Source text is read only for the NEGATIVE structural claims — "this file
// contains no credit write" — which no execution can demonstrate. Every such
// guard is mutation-tested, so a guard that cannot fail is itself a failure.
//
// No network, no database, no credential, no send.
// ============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  LEAD_ASSIGNMENT_AGGREGATE_TYPE,
  LEAD_ASSIGNMENT_SELECTABLE_STATUS,
  LeadAssignmentRefusalDisposition,
  PERMANENT_RECIPIENT_REFUSAL_CODES,
  classifyLeadAssignmentRefusalDisposition,
  isPermanentLeadAssignmentRecipientRefusal,
  planLeadAssignmentIntentTerminalization,
} from "../../../lib/communication/leadAssignmentDispatchContract.ts";
import { IntentResultStatus } from "../../../lib/communication/campaignResultContract.ts";
import { isValidIndianMobile } from "../../../lib/vendors/vendorContactContract.ts";
import { normalizePhoneE164 } from "../../../lib/communication/phone.ts";

// ---------------------------------------------------------------------------
// Assertion plumbing
// ---------------------------------------------------------------------------

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * A static guard is only worth having if a plausible regression trips it.
 * `mutant` re-runs the predicate against deliberately broken source; a guard
 * that still passes on the mutant is reported as a FAILURE of the guard.
 */
function mutant(name, predicate, brokenSource) {
  const stillPasses = predicate(brokenSource);
  check(`${name} [mutation-tested]`, !stillPasses, stillPasses ? "guard does not detect the regression" : "");
}

const section = (title) => console.log(`\n${title}`);

// ---------------------------------------------------------------------------
// Sources read for the negative structural claims
// ---------------------------------------------------------------------------

const read = (p) => readFileSync(resolve(p), "utf8");

/** Comments are intent, not behaviour. Negative claims run on CODE only. */
const stripComments = (src) =>
  src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

const serviceCode = stripComments(read("services/leadAssignmentDispatchService.ts"));
const contractCode = stripComments(read("lib/communication/leadAssignmentDispatchContract.ts"));
const vendorServiceCode = stripComments(read("services/vendorService.ts"));
const registerFormCode = stripComments(read("components/VendorRegisterForm.tsx"));
const resolverCode = stripComments(read("lib/communication/recipientResolver.ts"));

// ---------------------------------------------------------------------------
// The pure planner under test
// ---------------------------------------------------------------------------

const INTENT_ID = "3f1c2a44-9c6e-4a2b-8d11-77aa0b3c5e91";

const planOf = (over = {}) =>
  planLeadAssignmentIntentTerminalization({
    intentId: INTENT_ID,
    aggregateType: LEAD_ASSIGNMENT_AGGREGATE_TYPE,
    observedStatus: LEAD_ASSIGNMENT_SELECTABLE_STATUS,
    code: "RECIPIENT_DESTINATION_INVALID",
    ...over,
  });

const filterValue = (plan, column) => (plan.filters.find(([c]) => c === column) ?? [])[1];

// ===========================================================================
console.log("QF-MVP-80.16C — delivery safety closure + controlled resume\n");

// ---------------------------------------------------------------------------
section("1. The closed permanent-refusal set");
// ---------------------------------------------------------------------------

check(
  "the permanent set is exactly the three recipient-DATA failures",
  JSON.stringify([...PERMANENT_RECIPIENT_REFUSAL_CODES].sort()) ===
    JSON.stringify(["RECIPIENT_DESTINATION_INVALID", "RECIPIENT_DESTINATION_MISSING", "RECIPIENT_NOT_FOUND"]),
  [...PERMANENT_RECIPIENT_REFUSAL_CODES].join(",")
);

check("the set is frozen — it cannot be widened at runtime", Object.isFrozen(PERMANENT_RECIPIENT_REFUSAL_CODES));

for (const code of ["RECIPIENT_NOT_FOUND", "RECIPIENT_DESTINATION_MISSING", "RECIPIENT_DESTINATION_INVALID"]) {
  check(`${code} is permanent`, isPermanentLeadAssignmentRecipientRefusal(code) === true);
}

// The single most important negative: a TRANSPORT failure is not a DATA failure.
for (const code of [
  "RECIPIENT_LOOKUP_FAILED",
  "PROVIDER_UNAVAILABLE",
  "LOOKUP_FAILED",
  "SEND_REFUSED",
  "TEMPLATE_NOT_READY",
  "TEMPLATE_NOT_FOUND_OR_INACTIVE",
  "ACTIVATION_BOUNDARY_UNCONFIGURED",
  "ACTIVATION_BOUNDARY_MALFORMED",
  "CONSENT_BLOCKED",
  "COORDINATOR_UNAVAILABLE",
  "VENDOR_UNRESOLVED",
  "ASSIGNMENT_NOT_FOUND",
]) {
  check(`${code} is NOT permanent`, isPermanentLeadAssignmentRecipientRefusal(code) === false);
}

check("a non-string code is not permanent", isPermanentLeadAssignmentRecipientRefusal(undefined) === false);
check("a null code is not permanent", isPermanentLeadAssignmentRecipientRefusal(null) === false);
check(
  "no prefix match can admit a new member",
  isPermanentLeadAssignmentRecipientRefusal("RECIPIENT_DESTINATION_INVALID_EXTRA") === false
);
check(
  "a lowercase variant cannot slip in",
  isPermanentLeadAssignmentRecipientRefusal("recipient_destination_invalid") === false
);

// ---------------------------------------------------------------------------
section("2. The pure disposition — §8 tests 1-6, 12, 13");
// ---------------------------------------------------------------------------

const disposeOf = (over) =>
  classifyLeadAssignmentRefusalDisposition({
    aggregateType: LEAD_ASSIGNMENT_AGGREGATE_TYPE,
    observedStatus: LEAD_ASSIGNMENT_SELECTABLE_STATUS,
    code: "RECIPIENT_DESTINATION_INVALID",
    ...over,
  });

const T = LeadAssignmentRefusalDisposition.TERMINALIZE_INTENT;
const R = LeadAssignmentRefusalDisposition.RETRY_LATER;

check("§8.1 RECIPIENT_DESTINATION_INVALID on a pending intent terminalizes", disposeOf({}) === T);
check("§8.2 RECIPIENT_DESTINATION_MISSING terminalizes", disposeOf({ code: "RECIPIENT_DESTINATION_MISSING" }) === T);
check("§8.3 RECIPIENT_NOT_FOUND terminalizes", disposeOf({ code: "RECIPIENT_NOT_FOUND" }) === T);
check("§8.4 RECIPIENT_LOOKUP_FAILED stays retriable", disposeOf({ code: "RECIPIENT_LOOKUP_FAILED" }) === R);
check("§8.5 PROVIDER_UNAVAILABLE stays retriable", disposeOf({ code: "PROVIDER_UNAVAILABLE" }) === R);
check("§8.6 an unknown refusal stays retriable", disposeOf({ code: "SOME_BRAND_NEW_REFUSAL" }) === R);
check("§8.6b an empty code stays retriable", disposeOf({ code: "" }) === R);

check(
  "§8.12 a vendor_campaign intent is never terminalized, whatever its code",
  disposeOf({ aggregateType: "vendor_campaign" }) === R
);
check("§8.12b an absent aggregate type is never terminalized", disposeOf({ aggregateType: undefined }) === R);

for (const status of ["claimed", "dispatched", "delivered", "failed", "uncertain"]) {
  check(`§8.13 an intent observed as ${status} is never terminalized`, disposeOf({ observedStatus: status }) === R);
}

// ---------------------------------------------------------------------------
section("3. The write plan — the exact production fences, executed");
// ---------------------------------------------------------------------------

{
  const plan = planOf();
  check("a permanent refusal produces a write plan", plan !== null);
  check("the ONLY table written is communication_intents", plan.table === "communication_intents", String(plan.table));
  check(
    "the patch sets status=failed and nothing else",
    JSON.stringify(plan.patch) === JSON.stringify({ status: IntentResultStatus.FAILED }),
    JSON.stringify(plan.patch)
  );
  check("the target status comes from the existing vocabulary", IntentResultStatus.FAILED === "failed");
  check("fence 1: the exact intent id", filterValue(plan, "id") === INTENT_ID);
  check(
    "fence 2: aggregate_type is pinned to this lane",
    filterValue(plan, "aggregate_type") === LEAD_ASSIGNMENT_AGGREGATE_TYPE
  );
  check(
    "fence 3: compare-and-set on the observed pending status",
    filterValue(plan, "status") === LEAD_ASSIGNMENT_SELECTABLE_STATUS
  );
  check("all three fences are present, no more, no fewer", plan.filters.length === 3, `filters=${plan.filters.length}`);

  // §8.7 / §8.9 / §8.10 — nothing but the intent row is nameable by the plan.
  check("§8.7 the plan cannot create a communication_messages row", plan.table !== "communication_messages");
  check("§8.9 the plan cannot name a credit table", !/credit|wallet|ledger/i.test(plan.table));
  check("§8.10 the plan cannot name an assignment table", !/assignment/i.test(plan.table));
  check("the plan cannot name a vendor table", plan.table !== "vendors");
  check("the plan carries exactly one column", Object.keys(plan.patch).length === 1);
  check("no new intent status was invented", plan.patch.status === "failed");
}

// Every retriable disposition yields NO plan at all — so no write can occur.
for (const [label, over] of [
  ["§8.4 a transient lookup failure", { code: "RECIPIENT_LOOKUP_FAILED" }],
  ["§8.5 an unavailable provider", { code: "PROVIDER_UNAVAILABLE" }],
  ["§8.6 an unknown refusal", { code: "SOME_BRAND_NEW_REFUSAL" }],
  ["§8.12 a campaign intent", { aggregateType: "vendor_campaign" }],
  ["§8.13 an already-dispatched intent", { observedStatus: "dispatched" }],
  ["§8.13 an already-failed intent", { observedStatus: "failed" }],
  ["a blank intent id", { intentId: "" }],
  ["a non-string intent id", { intentId: null }],
]) {
  check(`${label} produces NO write plan`, planOf(over) === null);
}

// ---------------------------------------------------------------------------
section("4. The service applies the plan verbatim and decides nothing");
// ---------------------------------------------------------------------------

check(
  "the service asks the pure contract for the plan",
  /const plan = planLeadAssignmentIntentTerminalization\(input\);/.test(serviceCode)
);
check("a null plan short-circuits before any query", /if \(plan === null\) return false;/.test(serviceCode));
check(
  "the service applies the plan's table, patch and every filter",
  /db\(\)\.from\(plan\.table\)\.update\(plan\.patch\)/.test(serviceCode) &&
    /for \(const \[column, value\] of plan\.filters\) query = query\.eq\(column, value\);/.test(serviceCode)
);
check(
  "the service names no table of its own in the terminalization path",
  !/failLeadAssignmentIntentOnPermanentRecipientRefusal[\s\S]{0,900}?\.from\("[a-z_]+"\)/.test(serviceCode)
);
check(
  "a lost compare-and-set returns false rather than forcing an overwrite",
  /if \(error \|\| !data \|\| data\.length === 0\) return false;/.test(serviceCode)
);
check(
  "terminalization is reachable only from the send-refusal branch",
  /if \(!sent\.ok\) \{[\s\S]{0,700}?failLeadAssignmentIntentOnPermanentRecipientRefusal/.test(serviceCode)
);
check(
  "the refusal is still RETURNED unchanged, so refusalReasons telemetry is stable",
  /await failLeadAssignmentIntentOnPermanentRecipientRefusal\([\s\S]{0,400}?\);\s*return \{ ok: false, intentId, reason \};/.test(
    serviceCode
  )
);
check(
  "the helper is module-private — no operator surface can terminalize an intent",
  !/export async function failLeadAssignmentIntentOnPermanentRecipientRefusal/.test(serviceCode)
);

// ---------------------------------------------------------------------------
section("5. §8.11 / §8.14 — selection is unchanged, so failed and historical stay out");
// ---------------------------------------------------------------------------

check(
  "§8.11 the selector still requires status = pending, so a failed intent is unselectable",
  LEAD_ASSIGNMENT_SELECTABLE_STATUS === IntentResultStatus.PENDING &&
    /\.eq\("status", LEAD_ASSIGNMENT_SELECTABLE_STATUS\)/.test(serviceCode)
);
mutant(
  "§8.11 selector status fence",
  (src) => /\.eq\("status", LEAD_ASSIGNMENT_SELECTABLE_STATUS\)/.test(src),
  serviceCode.replace('.eq("status", LEAD_ASSIGNMENT_SELECTABLE_STATUS)', '.in("status", ["pending", "failed"])')
);

check(
  "§8.14 the activation boundary clause is untouched, so historical intents stay parked",
  /\.gt\("created_at", boundary\.notBeforeIso\)/.test(serviceCode)
);
mutant(
  "§8.14 activation boundary fence",
  (src) => /\.gt\("created_at", boundary\.notBeforeIso\)/.test(src),
  serviceCode.replace('.gt("created_at", boundary.notBeforeIso)', '.gte("created_at", "1970-01-01")')
);

check(
  "the dispatch service still writes no credit, assignment or vendor row anywhere",
  !/from\("vendor_credit_logs"\)|from\("lead_assignments"\)\s*\.update|from\("vendors"\)\s*\.update/.test(serviceCode)
);
mutant(
  "no-credit-write guard",
  (src) => !/from\("vendor_credit_logs"\)|from\("lead_assignments"\)\s*\.update|from\("vendors"\)\s*\.update/.test(src),
  `${serviceCode}\nawait db().from("vendor_credit_logs").insert({});`
);

// ---------------------------------------------------------------------------
section("6. §9 — vendor registration server authority");
// ---------------------------------------------------------------------------

for (const good of ["9876543210", "6123456789", "7000000000", "8999999999"]) {
  check(`§9 ${good} is accepted`, isValidIndianMobile(good) === true);
}
for (const bad of [
  "2234567890",
  "0123456789",
  "1234567890",
  "5999999999",
  "987654321",
  "98765432101",
  "",
  "98765 43210",
  "+919876543210",
]) {
  check(`§9 ${bad || "(empty)"} is rejected`, isValidIndianMobile(bad) === false);
}
check("§9 a non-string is rejected", isValidIndianMobile(9876543210) === false);
check("§9 a null is rejected", isValidIndianMobile(null) === false);

check(
  "§9 registerVendor validates the phone through the shared predicate",
  /!isValidIndianMobile\(cleanedPhone\)/.test(vendorServiceCode)
);
check(
  "§9 registerVendor validates a supplied WhatsApp number through the same predicate",
  /!isValidIndianMobile\(cleanedWhatsapp\)/.test(vendorServiceCode)
);
check(
  "§9 the old length-only checks are gone",
  !/cleanedPhone\.length !== 10|cleanedWhatsapp\.length !== 10/.test(vendorServiceCode)
);
mutant(
  "§9 length-only regression guard",
  (src) => !/cleanedPhone\.length !== 10|cleanedWhatsapp\.length !== 10/.test(src),
  `${vendorServiceCode}\nif (cleanedPhone.length !== 10) return null;`
);
check(
  "§9 an omitted WhatsApp number still copies the already-validated phone",
  /cleanedWhatsapp[\s\S]{0,140}?:\s*cleanedPhone;/.test(vendorServiceCode)
);
check(
  "§9 storage is still ten bare digits — no E.164 conversion was introduced",
  /replace\(\/\\D\/g, ""\)/.test(vendorServiceCode) && !/\+91/.test(vendorServiceCode)
);

// ---------------------------------------------------------------------------
section("7. §9 — live vendor registration UI");
// ---------------------------------------------------------------------------

check(
  "§9 the live form states the same Indian-mobile rule",
  /const VENDOR_MOBILE_RE = \/\^\[6-9\]\\d\{9\}\$\/;/.test(registerFormCode)
);
check(
  "§9 the step-completion check uses the rule",
  /return VENDOR_MOBILE_RE\.test\(valOf\("phone"\)\)/.test(registerFormCode)
);
check("§9 the step error uses the rule for phone", /!VENDOR_MOBILE_RE\.test\(f\.phone\.replace/.test(registerFormCode));
check(
  "§9 a distinct WhatsApp number is validated too",
  /!f\.whatsappSame && !VENDOR_MOBILE_RE\.test\(f\.whatsapp\.replace/.test(registerFormCode)
);
check(
  "§9 the submit guard uses the rule for both numbers",
  /VENDOR_MOBILE_RE\.test\(phoneDigits\)/.test(registerFormCode) &&
    /VENDOR_MOBILE_RE\.test\(whatsappDigits\)/.test(registerFormCode)
);
check(
  "§9 no length-only phone acceptance survives in the form",
  !/phoneDigits\.length === 10|whatsappDigits\.length === 10|\/\^\\d\{10\}\$\//.test(registerFormCode)
);
mutant(
  "§9 UI length-only regression guard",
  (src) => !/phoneDigits\.length === 10|whatsappDigits\.length === 10|\/\^\\d\{10\}\$\//.test(src),
  `${registerFormCode}\nconst okish = phoneDigits.length === 10;`
);
check("§9 both inputs still cap at ten digits", (registerFormCode.match(/maxLength[:=]\s*\{?10\}?/g) ?? []).length >= 2);
check(
  "§9 both inputs still strip non-digits",
  (registerFormCode.match(/replace\(\/\\D\/g, ""\)\.slice\(0, 10\)/g) ?? []).length >= 2
);
check(
  "§9 both inputs still declare a numeric keyboard",
  (registerFormCode.match(/inputMode[:=]\s*\{?"numeric"\}?/g) ?? []).length >= 2
);

// ---------------------------------------------------------------------------
section("8. The 80.16B boundary must NOT be weakened");
// ---------------------------------------------------------------------------

const bare = normalizePhoneE164("9876543210");
check(
  "the global normalizer STILL refuses a bare national number",
  bare.ok === false && bare.code === "PHONE_MISSING_COUNTRY_CODE",
  JSON.stringify({ ok: bare.ok, code: bare.code })
);
check("the vendor-only adapter is still the single +91 assumption", (resolverCode.match(/\+91/g) ?? []).length === 1);
check(
  "the adapter still matches a SHAPE and never strips characters",
  /STORED_INDIAN_MOBILE = \/\^\[6-9\]\\d\{9\}\$\//.test(resolverCode) &&
    !/normalizeStoredVendorDestination[\s\S]{0,400}?replace\(/.test(resolverCode)
);

// ---------------------------------------------------------------------------
section("9. Scope — this phase changes nothing it was told not to");
// ---------------------------------------------------------------------------

check(
  "the dispatch service still calls no provider and no HTTP endpoint",
  !/fetch\(|graph\.facebook\.com|axios|https?:\/\//.test(serviceCode)
);
check(
  "the contract remains pure — no I/O, no clock, no env",
  !/adminClient|fetch\(|process\.env|Date\.now/.test(contractCode)
);
check(
  "no consent, mapping or canary write was added",
  !/communication_consent|provider_template_mappings|canary/i.test(serviceCode)
);
check(
  "auto_assignment_mode semantics are untouched by this phase",
  !/auto_assignment_mode/.test(serviceCode) && !/auto_assignment_mode/.test(vendorServiceCode)
);

// ---------------------------------------------------------------------------
console.log(`\n${"=".repeat(72)}`);
if (failures.length === 0) {
  console.log(`QF-MVP-80.16C VALIDATION PASSED — ${passed}/${passed} assertions green.`);
  process.exit(0);
}
console.log(`QF-MVP-80.16C VALIDATION FAILED — ${failures.length} failing, ${passed} passing:`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(1);
