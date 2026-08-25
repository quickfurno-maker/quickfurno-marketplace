#!/usr/bin/env node
// ============================================================================
// QF-MVP-40-R7G — validator for the ONE-SHOT staging canary recipient fixture.
//
// Fully OFFLINE: it imports the operator (whose bootstrap is fenced behind `isDirect`),
// drives its PURE functions, and asserts the intended row against the REAL committed
// eligibility authority — `evaluateVendorAutomaticLeadEligibility` — rather than
// re-describing inertness here. A fixture that some future change made assignable would
// fail that predicate, not merely differ from a hard-coded expectation.
//
// No socket, no credential, no database, no Supabase client is ever constructed.
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as OP from "./create-staging-canary-recipient-once.mjs";
import { evaluateVendorAutomaticLeadEligibility } from "../../../lib/vendors/vendorAutomaticEligibility.ts";
import { hashPhoneE164, normalizePhoneE164 } from "../../../lib/communication/phone.ts";

// NOTE on coverage: `lib/vendors/vendorEligibility.ts` is deliberately NOT imported here.
// It reaches for the `@/...` alias, and `scripts/mvp/loader/tsResolveHooks.mjs` refuses to
// resolve that alias on purpose — that refusal is what keeps this runner DB/network-free.
// Weakening the loader to gain one assertion would trade a real safety property for a
// convenience, so instead the fixture is asserted against the canonical AUTOMATIC
// assignment authority (`evaluateVendorAutomaticLeadEligibility`, the Phase 4 predicate
// the matcher actually uses) plus the explicit column-level posture checks below.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const OPERATOR_PATH = "scripts/mvp/communication/create-staging-canary-recipient-once.mjs";
const rawSource = readFileSync(path.join(ROOT, OPERATOR_PATH), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const code = strip(rawSource);

const results = [];
const record = (name, passed, detail = "") => results.push({ name, passed: passed === true, detail });
const F = OP.FixtureFailure;

/** A reserved fictional number: E.164-valid, deterministic, never dialable. */
const FIXTURE_E164 = "+15555550123";
const FIXTURE_HASH = hashPhoneE164(FIXTURE_E164);
const STAGING_URL = "https://uckafzuochmbvtiodmcl.supabase.co";
const SERVICE_KEY = `sb_secret_${"x".repeat(32)}`;
const baseEnv = (over = {}) => {
  const env = {
    QF_STAGING_SUPABASE_URL: STAGING_URL,
    QF_STAGING_SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    [OP.CANARY_DESTINATION_ENV]: FIXTURE_E164,
    ...over,
  };
  for (const [k, v] of Object.entries(over)) if (v === undefined) delete env[k];
  return env;
};

// ---------------------------------------------------------------------------
// A. THE STAGING FENCE
// ---------------------------------------------------------------------------
record("A01 the authorized staging ref is accepted",
  OP.resolveFixtureTarget(baseEnv()).ok === true);
record("A02 the PRODUCTION ref is refused",
  OP.resolveFixtureTarget(baseEnv({ QF_STAGING_SUPABASE_URL: "https://yqpgcsduqbxulrlzwzap.supabase.co" })).reason
    === F.PROJECT_REF_FORBIDDEN_PRODUCTION);
record("A03 the JARVIS ref is refused",
  OP.resolveFixtureTarget(baseEnv({ QF_STAGING_SUPABASE_URL: "https://coilipywdvxklewquqvv.supabase.co" })).reason
    === F.PROJECT_REF_FORBIDDEN_JARVIS);
record("A04 an unlisted third project is refused",
  OP.resolveFixtureTarget(baseEnv({ QF_STAGING_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" })).reason
    === F.PROJECT_REF_NOT_AUTHORIZED);
record("A05 a missing service credential is refused",
  OP.resolveFixtureTarget(baseEnv({ QF_STAGING_SUPABASE_SERVICE_ROLE_KEY: undefined })).reason === F.ENV_MISSING);
record("A06 the fence needs NO Meta credential — this operator never contacts Meta",
  OP.resolveFixtureTarget({ QF_STAGING_SUPABASE_URL: STAGING_URL, QF_STAGING_SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }).ok === true);

// ---------------------------------------------------------------------------
// B. THE DESTINATION
// ---------------------------------------------------------------------------
record("B01 a missing destination is refused",
  OP.resolveDestination(baseEnv({ [OP.CANARY_DESTINATION_ENV]: undefined })).reason === F.DESTINATION_MISSING);
record("B02 a blank destination is refused",
  OP.resolveDestination(baseEnv({ [OP.CANARY_DESTINATION_ENV]: "   " })).reason === F.DESTINATION_MISSING);
record("B03 a malformed destination is refused",
  OP.resolveDestination(baseEnv({ [OP.CANARY_DESTINATION_ENV]: "not-a-number" })).reason === F.DESTINATION_MALFORMED);
record("B04 a valid destination yields its canonical hash and never leaks the value",
  (() => {
    const r = OP.resolveDestination(baseEnv());
    return r.ok === true && r.hash === FIXTURE_HASH && !JSON.stringify(r.hash).includes(FIXTURE_E164);
  })());

// ---------------------------------------------------------------------------
// C. DRY RUN IS THE DEFAULT, AND THE ACK IS NOT OPTIONAL
// ---------------------------------------------------------------------------
record("C01 no flags at all is a DRY RUN", OP.resolveMode([]).execute === false);
record("C02 --execute WITHOUT the owner acknowledgement is refused",
  OP.resolveMode([OP.EXECUTE_FLAG]).reason === F.OWNER_ACK_MISSING);
record("C03 the acknowledgement ALONE never writes",
  OP.resolveMode([OP.OWNER_ACK_FLAG]).execute === false);
record("C04 --execute WITH the acknowledgement is the only writing mode",
  OP.resolveMode([OP.EXECUTE_FLAG, OP.OWNER_ACK_FLAG]).execute === true);
record("C05 an unknown flag is refused outright",
  OP.resolveMode(["--force"]).reason === F.UNKNOWN_FLAG);
record("C06 the acknowledgement is an exact flag, not a truthy env var",
  !/process\.env\[[^\]]*OWNER|env\.[A-Z_]*OWNER_AUTHORIZED/.test(code));

// ---------------------------------------------------------------------------
// D. THE ROW IS INERT — asserted through the REAL committed predicates
// ---------------------------------------------------------------------------
const row = OP.buildFixtureRow(FIXTURE_E164);

const auto = evaluateVendorAutomaticLeadEligibility(row);
record("D01 the committed automatic-eligibility predicate refuses the fixture",
  auto.eligible === false, JSON.stringify(auto.reasons));
record("D02 it is parked FOUR independent ways — any one alone would deny assignment",
  ["vendor_suspended", "vendor_inactive", "not_accepting_leads", "no_credits"]
    .every((r) => auto.reasons.includes(r)), JSON.stringify(auto.reasons));

record("D03 its status is not the one approved/public paths select",
  row.status !== "Approved" && row.status === "Suspended");

record("D04 it is never publicly discoverable", row.public_visibility === false);
record("D05 it holds no package or paid entitlement",
  row.package_status === "none" && row.package_name === null
  && row.package_expires_at === null && row.paid_status === "Unpaid");
record("D06 it makes no verification claim", row.verification_status === "Pending");
record("D07 it has no auth identity and can never log in", row.user_id === null);
record("D08 it has zero credits in both columns",
  row.total_credits === 0 && row.remaining_credits === 0);
record("D09 it carries no matchable taxonomy or geography",
  row.service_categories === null && row.selected_category === null
  && row.areas_covered === null && row.covers_full_city === false);
record("D10 its city is a marker that matches no real city row",
  row.city === OP.FIXTURE_CITY && /STAGING|CANARY/.test(row.city));
record("D11 status uses a LEGAL enum value (vendors_status_check)",
  ["Pending", "Approved", "Rejected", "Suspended"].includes(row.status) && row.status === "Suspended");
record("D12 package_status uses a LEGAL enum value (vendors_package_status_check)",
  ["none", "active", "expired", "cancelled", "trial"].includes(row.package_status));

// ---------------------------------------------------------------------------
// E. IT IS RESOLVABLE — the resolver prefers whatsapp_number, then phone
// ---------------------------------------------------------------------------
const resolverPick = (r) => (r.whatsapp_number && r.whatsapp_number.trim() !== "" ? r.whatsapp_number : r.phone);
record("E01 the resolver-preferred column carries the destination",
  hashPhoneE164(normalizePhoneE164(resolverPick(row)).e164) === FIXTURE_HASH);
record("E02 the fallback column carries the SAME destination, so a cleared "
  + "whatsapp_number can never redirect to a different number",
  hashPhoneE164(normalizePhoneE164(row.phone).e164) === FIXTURE_HASH);
record("E03 the row is marked with the durable machine-detectable reference",
  row.assignment_suspension_reference === OP.FIXTURE_REFERENCE);
record("E04 the fixture posture check accepts the row it builds",
  OP.fixtureIsInert(row).ok === true, JSON.stringify(OP.fixtureIsInert(row).drift));

// ---------------------------------------------------------------------------
// F. IDEMPOTENCY / DUPLICATE PROTECTION
// ---------------------------------------------------------------------------
const marked = (over = {}) => ({
  id: "fixture-1", assignment_suspension_reference: OP.FIXTURE_REFERENCE,
  __destinationMatches: true, ...row, ...over,
});
record("F01 nothing present -> ABSENT (a create is permitted)",
  OP.classifyExisting({}).state === "ABSENT");
record("F02 the correct fixture alone -> ALREADY_PRESENT",
  (() => {
    const c = OP.classifyExisting({ markerRows: [marked()] });
    return c.state === "ALREADY_PRESENT" && c.id === "fixture-1";
  })());
record("F03 two matching rows -> AMBIGUOUS, never a create",
  OP.classifyExisting({ markerRows: [marked(), marked({ id: "fixture-2" })] }).state === F.FIXTURE_AMBIGUOUS);
record("F04 an UNMARKED vendor already carrying the destination -> CONFLICTED, never overwritten",
  OP.classifyExisting({ hashRows: [{ id: "real-vendor", assignment_suspension_reference: null, __destinationMatches: true }] })
    .state === F.FIXTURE_CONFLICTED);
record("F05 a marked fixture carrying a DIFFERENT destination -> CONFLICTED",
  OP.classifyExisting({ markerRows: [marked({ __destinationMatches: false })] }).state === F.FIXTURE_CONFLICTED);
record("F06 a marked fixture whose inert posture has drifted -> CONFLICTED, never repaired",
  OP.classifyExisting({ markerRows: [marked({ accepting_leads: true })] }).state === F.FIXTURE_CONFLICTED);
record("F07 a CLIENT/LEAD/PROFILE already carrying the destination -> collision, never a create",
  OP.classifyExisting({ foreignMatches: [{ table: "leads", id: "lead-1" }] }).state
    === F.FOREIGN_RECIPIENT_COLLISION);
record("F08 a foreign collision outranks an otherwise-perfect fixture",
  OP.classifyExisting({ markerRows: [marked()], foreignMatches: [{ table: "client_accounts", id: "c1" }] }).state
    === F.FOREIGN_RECIPIENT_COLLISION);

// ---------------------------------------------------------------------------
// G. WRITE-SURFACE CONTAINMENT — proven from the source, not promised in a comment
// ---------------------------------------------------------------------------
record("G01 exactly ONE insert call exists in the whole operator",
  (code.match(/\.insert\(/g) || []).length === 1);
record("G02 no update, upsert or delete verb exists anywhere",
  !/\.update\(|\.upsert\(|\.delete\(/.test(code));
record("G03 no RPC surface exists", !/\.rpc\(/.test(code));
record("G04 no generic SQL execution surface exists",
  !/execute_sql|\bsql`|pg_query|\.query\(/.test(code));
record("G05 no Meta / Graph / fetch surface exists",
  !/fetch\(|graph\.facebook|\/messages|GRAPH_API/.test(code));
record("G06 no n8n or automation trigger surface exists",
  !/n8n|workflow_|automation_job/i.test(code));
record("G07 no consent, campaign or marketing surface exists",
  !/consent|campaign|marketing/i.test(code));
record("G08 the only table it writes is vendors",
  OP.VENDORS_TABLE === "vendors" && (code.match(/\.from\(VENDORS_TABLE\)\s*\n?\s*\.insert/g) || []).length <= 1);
record("G09 the raw destination is never printed",
  !/log\([^)]*destination\.e164|console\.log\([^)]*e164/.test(code));
record("G10 the dry run redacts both contact columns",
  /wouldInsert[\s\S]{0,160}REDACTED/.test(code));
record("G11 no phone-number-shaped literal is committed in the operator",
  !/\+\d{8,15}/.test(rawSource));
record("G12 importing the operator never writes — the bootstrap is fenced by isDirect",
  /const isDirect = Boolean\(process\.argv\[1\]\)/.test(code) && /if \(isDirect\)/.test(code));
record("G13 an uncertain write is reported, never retried",
  /WRITE_OUTCOME_UNCERTAIN/.test(code) && !/for \(|while \(|retry/i.test(code.split("THE SINGLE INSERT")[1] ?? ""));

// ---------------------------------------------------------------------------
// MUTANTS
// ---------------------------------------------------------------------------
const mutants = [
  ["a fixture that accepts leads can never pass the eligibility assertion",
    () => evaluateVendorAutomaticLeadEligibility({ ...row, status: "Approved", is_active: true, accepting_leads: true, remaining_credits: 999 }).eligible === true],
  ["removing any single park still leaves the fixture ineligible",
    () => [
      { accepting_leads: true }, { is_active: true }, { status: "Approved" }, { remaining_credits: 999 },
    ].every((patch) => evaluateVendorAutomaticLeadEligibility({ ...row, ...patch }).eligible === false)],
  ["the inert check actually detects drift in every guarded column",
    () => ["status", "is_active", "accepting_leads", "public_visibility", "package_status",
           "remaining_credits", "total_credits", "paid_status", "verification_status", "user_id"]
      .every((col) => OP.fixtureIsInert({ ...row, [col]: col === "status" ? "Approved" : true }).ok === false)],
  ["a destination that normalizes differently produces a different hash",
    () => OP.resolveDestination(baseEnv({ [OP.CANARY_DESTINATION_ENV]: "+15555550124" })).hash !== FIXTURE_HASH],
  ["the same destination in any accepted format produces the SAME hash",
    () => OP.resolveDestination(baseEnv({ [OP.CANARY_DESTINATION_ENV]: " +1 555 555 0123 " })).hash === FIXTURE_HASH],
];
for (const [name, fn] of mutants) {
  let held = false;
  try { held = (await fn()) === true; } catch { held = false; }
  record(`MUT ${name}`, held);
}

// ---------------------------------------------------------------------------
for (const [i, r] of results.entries()) {
  console.log(`${r.passed ? "PASS" : "FAIL"} ${String(i + 1).padStart(3, "0")} ${r.name}${r.detail && !r.passed ? ` (${r.detail})` : ""}`);
}
const passed = results.filter((r) => r.passed).length;
console.log(`\nQF-MVP-40-R7G CANARY RECIPIENT FIXTURE: ${passed}/${results.length} PASS`);
if (passed === results.length) console.log("QF_MVP_40_R7G_CANARY_RECIPIENT_FIXTURE_PROVEN");
process.exitCode = passed === results.length ? 0 : 1;
