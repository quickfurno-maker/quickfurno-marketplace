#!/usr/bin/env node
// ============================================================================
// QF-MVP-40-R7G — ONE-SHOT creation of the single DEDICATED STAGING CANARY RECIPIENT.
// DRY RUN BY DEFAULT.
//
//   node scripts/mvp/communication/create-staging-canary-recipient-once.mjs
//     -> DRY RUN. Proves the fence, the destination, and the absence of any existing
//        recipient carrying that number. Writes nothing.
//
//   … --execute --owner-authorized-once-canary-recipient
//     -> Performs AT MOST ONE INSERT of exactly one `public.vendors` row.
//
// WHY THIS EXISTS
//   `CommunicationService.send` resolves a BUSINESS destination only from a durable
//   `recipient_type` + `recipient_id` pair (`communicationRecipientResolver`), and
//   correctly refuses a bare number: `ephemeral_auth_destination` is authentication-lane
//   only, and `send()` rejects a lane/category mismatch. The QF-MVP-40 canary therefore
//   needs a REAL recipient row, and staging had none carrying the owner canary number.
//
//   The alternative — mutating or "borrowing" an existing vendor/client/lead — would
//   corrupt real business data and silently repoint a real subject's communications.
//   This operator instead creates ONE inert, permanently-parked fixture and nothing else.
//
// WHAT IT CANNOT DO — enforced below and asserted by the validator
//   * no UPDATE, no DELETE, no RPC, no generic SQL surface;
//   * no second INSERT, ever, including after an ambiguous result;
//   * it never touches an existing vendor/client/lead/profile row;
//   * no Meta / Graph call of any kind, no fetch, no provider or canary activation;
//   * no consent row, no campaign or marketing authority, no package entitlement;
//   * no n8n invocation;
//   * the raw destination is never printed, logged or written to the repository.
//
// WHY ONE INSERT TRIGGERS NO AUTOMATION — measured on staging, not assumed:
//   `public.vendors` carries exactly two triggers, and BOTH are
//   `AFTER UPDATE OF <column>` (`remaining_credits`, `package_expires_at`). Neither fires
//   on INSERT. The fixture is created with 0 credits and a NULL package expiry, and this
//   operator can never UPDATE, so neither producer can ever be reached through it.
//
// THE FIXTURE IS PERMANENT AND INERT
//   It is parked in four independent ways, each of which alone denies automatic lead
//   assignment through the committed `evaluateVendorAutomaticLeadEligibility`:
//   status `Suspended`, `is_active` false, `accepting_leads` false, 0 credits. It is also
//   non-public (`public_visibility` false), unverified, unpaid, package `none`, and has
//   no `user_id`, so it can never log in. Its `city` is a staging marker that matches no
//   real city row, so the matcher cannot reach it on geography either.
// ============================================================================

import { pathToFileURL } from "node:url";

import { createClient } from "@supabase/supabase-js";

import {
  AUTHORIZED_STAGING_REF,
  FORBIDDEN_PROJECT_REFS,
  parseProjectRef,
} from "./seed-meta-staging-inactive-mappings.mjs";
import { hashPhoneE164, normalizePhoneE164 } from "../../../lib/communication/phone.ts";

/** The ONE table this operator may ever write, and the ONE verb it may use. */
export const VENDORS_TABLE = "vendors";

/** The exact acknowledgement flag. A truthy env var is deliberately NOT accepted. */
export const OWNER_ACK_FLAG = "--owner-authorized-once-canary-recipient";
export const EXECUTE_FLAG = "--execute";
export const KNOWN_FLAGS = Object.freeze([EXECUTE_FLAG, OWNER_ACK_FLAG]);

/** The env var carrying the owner-controlled canary destination. Process-local only. */
export const CANARY_DESTINATION_ENV = "QF_META_CANARY_DESTINATION_E164";

/**
 * The durable, machine-detectable markers. `assignment_suspension_reference` is the
 * primary key of identification: a free-text business_name could plausibly be typed by a
 * human, whereas this reference is meaningless outside this operator.
 */
export const FIXTURE_REFERENCE = "QF-MVP-40-R7G-CANARY-RECIPIENT";
export const FIXTURE_BUSINESS_NAME = "QF STAGING CANARY RECIPIENT — DO NOT ASSIGN";
export const FIXTURE_CITY = "QF-STAGING-CANARY";

export const FixtureFailure = Object.freeze({
  UNKNOWN_FLAG: "UNKNOWN_FLAG",
  ENV_MISSING: "ENV_MISSING",
  STAGING_URL_MALFORMED: "STAGING_URL_MALFORMED",
  PROJECT_REF_FORBIDDEN_PRODUCTION: "PROJECT_REF_FORBIDDEN_PRODUCTION",
  PROJECT_REF_FORBIDDEN_JARVIS: "PROJECT_REF_FORBIDDEN_JARVIS",
  PROJECT_REF_NOT_AUTHORIZED: "PROJECT_REF_NOT_AUTHORIZED",
  DESTINATION_MISSING: "DESTINATION_MISSING",
  DESTINATION_MALFORMED: "DESTINATION_MALFORMED",
  OWNER_ACK_MISSING: "OWNER_ACK_MISSING",
  FOREIGN_RECIPIENT_COLLISION: "FOREIGN_RECIPIENT_COLLISION",
  FIXTURE_AMBIGUOUS: "FIXTURE_AMBIGUOUS",
  FIXTURE_CONFLICTED: "FIXTURE_CONFLICTED",
  WRITE_OUTCOME_UNCERTAIN: "WRITE_OUTCOME_UNCERTAIN",
  READBACK_MISMATCH: "READBACK_MISMATCH",
});

export const Outcome = Object.freeze({
  DRY_RUN_WOULD_CREATE: "DRY_RUN_WOULD_CREATE",
  ALREADY_PRESENT: "ALREADY_PRESENT",
  CREATED: "CREATED",
  REFUSED: "REFUSED",
});

// ---------------------------------------------------------------------------
// Pure logic — every branch below is reachable from the validator without a database.
// ---------------------------------------------------------------------------

/**
 * The staging fence. Deliberately NARROWER than `resolveStagingTarget`: this operator
 * never contacts Meta, so requiring a Meta credential would be a false dependency and
 * would let a Meta-less run look "misconfigured" rather than simply out of scope.
 */
export function resolveFixtureTarget(env = {}) {
  const url = env.QF_STAGING_SUPABASE_URL;
  if (!url) return { ok: false, reason: FixtureFailure.ENV_MISSING, missing: "QF_STAGING_SUPABASE_URL" };
  const ref = parseProjectRef(url);
  if (!ref) return { ok: false, reason: FixtureFailure.STAGING_URL_MALFORMED };
  if (ref === FORBIDDEN_PROJECT_REFS.production) {
    return { ok: false, reason: FixtureFailure.PROJECT_REF_FORBIDDEN_PRODUCTION };
  }
  if (ref === FORBIDDEN_PROJECT_REFS.jarvis) {
    return { ok: false, reason: FixtureFailure.PROJECT_REF_FORBIDDEN_JARVIS };
  }
  if (ref !== AUTHORIZED_STAGING_REF) {
    return { ok: false, reason: FixtureFailure.PROJECT_REF_NOT_AUTHORIZED };
  }
  if (!env.QF_STAGING_SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, reason: FixtureFailure.ENV_MISSING, missing: "QF_STAGING_SUPABASE_SERVICE_ROLE_KEY" };
  }
  return { ok: true, projectRef: ref, environment: "STAGING" };
}

/** The owner destination, normalized once. Returns the hash for logging; never the value. */
export function resolveDestination(env = {}) {
  const raw = env[CANARY_DESTINATION_ENV];
  if (!raw || String(raw).trim() === "") {
    return { ok: false, reason: FixtureFailure.DESTINATION_MISSING };
  }
  const normalized = normalizePhoneE164(raw);
  if (!normalized.ok) return { ok: false, reason: FixtureFailure.DESTINATION_MALFORMED };
  const e164 = normalized.e164;
  return { ok: true, e164, hash: hashPhoneE164(e164) };
}

export function resolveMode(argv = []) {
  for (const a of argv) {
    if (!KNOWN_FLAGS.includes(a)) return { ok: false, reason: FixtureFailure.UNKNOWN_FLAG, detail: a };
  }
  const execute = argv.includes(EXECUTE_FLAG);
  const acked = argv.includes(OWNER_ACK_FLAG);
  if (execute && !acked) return { ok: false, reason: FixtureFailure.OWNER_ACK_MISSING };
  // The acknowledgement alone never writes: --execute is still required.
  return { ok: true, execute };
}

/**
 * The exact row this operator may insert. PURE, so the validator asserts the posture of
 * the very object the writer sends — not a re-description of it.
 */
export function buildFixtureRow(e164) {
  return {
    business_name: FIXTURE_BUSINESS_NAME,
    owner_name: "QuickFurno Staging Canary",
    // Both contact columns carry the same destination: `phone` is NOT NULL, and letting
    // the two disagree would mean a cleared `whatsapp_number` silently falls back to a
    // DIFFERENT number. The resolver prefers `whatsapp_number`.
    phone: e164,
    whatsapp_number: e164,
    email: null,
    // A marker city matches no row in `public.cities`, so the matcher cannot reach this
    // fixture on geography even if every other guard were somehow lifted.
    city: FIXTURE_CITY,
    // Four INDEPENDENT parks. Each one alone denies automatic lead assignment.
    status: "Suspended",
    is_active: false,
    accepting_leads: false,
    total_credits: 0,
    remaining_credits: 0,
    // Never publicly discoverable, never verified, never entitled.
    public_visibility: false,
    verification_status: "Pending",
    paid_status: "Unpaid",
    package_status: "none",
    package_name: null,
    package_expires_at: null,
    // No auth identity: this fixture can never log in.
    user_id: null,
    // No matchable taxonomy or geography.
    service_categories: null,
    selected_category: null,
    areas_covered: null,
    covers_full_city: false,
    // The durable machine-detectable marker.
    assignment_suspension_reason: "Permanent QF-MVP-40 staging canary recipient. Never assign.",
    assignment_suspension_reference: FIXTURE_REFERENCE,
    message: "QF-MVP-40 staging canary recipient fixture. Inert by design.",
  };
}

/**
 * Classify what already exists. `rows` is every vendor row carrying the marker OR the
 * destination hash; `foreign` is any NON-vendor recipient carrying that hash.
 *
 * The safe outcomes are exactly two — nothing at all, or the correct fixture alone.
 * Everything else refuses rather than repairing an arbitrary row.
 */
export function classifyExisting({ markerRows = [], hashRows = [], foreignMatches = [] } = {}) {
  if (foreignMatches.length > 0) {
    return { state: FixtureFailure.FOREIGN_RECIPIENT_COLLISION, detail: foreignMatches.map((m) => m.table).join(",") };
  }
  const byId = new Map();
  for (const r of [...markerRows, ...hashRows]) byId.set(r.id, r);
  const all = [...byId.values()];
  if (all.length === 0) return { state: "ABSENT" };
  if (all.length > 1) return { state: FixtureFailure.FIXTURE_AMBIGUOUS, detail: `${all.length} rows` };

  const row = all[0];
  const isMarked = row.assignment_suspension_reference === FIXTURE_REFERENCE;
  const carriesHash = row.__destinationMatches === true;
  // A marked row that does NOT carry the current destination, or an unmarked row that
  // does, is a conflict: repairing either automatically would rewrite a row this
  // operator never created.
  if (!isMarked || !carriesHash) {
    return {
      state: FixtureFailure.FIXTURE_CONFLICTED,
      detail: !isMarked ? "an unmarked recipient already carries the destination" : "the marked fixture carries a different destination",
      id: row.id,
    };
  }
  const inert = fixtureIsInert(row);
  if (!inert.ok) return { state: FixtureFailure.FIXTURE_CONFLICTED, detail: `inert posture drift: ${inert.drift.join(",")}`, id: row.id };
  return { state: "ALREADY_PRESENT", id: row.id };
}

/** The inert posture, asserted field by field so drift is named rather than summarised. */
export function fixtureIsInert(row = {}) {
  const drift = [];
  if (row.status !== "Suspended") drift.push("status");
  if (row.is_active !== false) drift.push("is_active");
  if (row.accepting_leads !== false) drift.push("accepting_leads");
  if (row.public_visibility !== false) drift.push("public_visibility");
  if (row.package_status !== "none") drift.push("package_status");
  if (row.package_expires_at !== null && row.package_expires_at !== undefined) drift.push("package_expires_at");
  if (Number(row.remaining_credits ?? 0) !== 0) drift.push("remaining_credits");
  if (Number(row.total_credits ?? 0) !== 0) drift.push("total_credits");
  if (row.paid_status !== "Unpaid") drift.push("paid_status");
  if (row.verification_status !== "Pending") drift.push("verification_status");
  if (row.user_id !== null && row.user_id !== undefined) drift.push("user_id");
  return { ok: drift.length === 0, drift };
}

// ---------------------------------------------------------------------------
// The live operator.
// ---------------------------------------------------------------------------

/**
 * True only when this file IS the process entry. Importing it from the validator must
 * never write anything, so the bootstrap below is fenced by exactly this check.
 * `pathToFileURL` is the only comparison that survives Windows drive letters, spaces in
 * the path and backslashes — hand-built `file://` strings do not.
 */
const isDirect = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

export async function run({ env = process.env, argv = [], log = console.log } = {}) {
  const mode = resolveMode(argv);
  if (!mode.ok) return { ok: false, outcome: Outcome.REFUSED, ...mode };

  const target = resolveFixtureTarget(env);
  if (!target.ok) return { ok: false, outcome: Outcome.REFUSED, ...target };

  const destination = resolveDestination(env);
  if (!destination.ok) return { ok: false, outcome: Outcome.REFUSED, ...destination };

  log(`Target ref      : ${target.projectRef} (${target.environment})`);
  log(`Mode            : ${mode.execute ? "EXECUTE (one INSERT)" : "DRY RUN (no write)"}`);
  log(`Destination hash: ${destination.hash}`);

  const client = createClient(env.QF_STAGING_SUPABASE_URL, env.QF_STAGING_SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // --- Discovery. Hash comparison only; no phone value is ever compared in the clear
  //     against anything but the freshly normalized owner destination.
  const vendorScan = await client
    .from(VENDORS_TABLE)
    .select("id, assignment_suspension_reference, whatsapp_number, phone, status, is_active, accepting_leads, public_visibility, package_status, package_expires_at, total_credits, remaining_credits, paid_status, verification_status, user_id");
  if (vendorScan.error) return { ok: false, outcome: Outcome.REFUSED, reason: "VENDOR_SCAN_FAILED", detail: vendorScan.error.code };

  const matchesDestination = (row) => [row.whatsapp_number, row.phone]
    .some((v) => {
      if (!v || String(v).trim() === "") return false;
      const n = normalizePhoneE164(v);
      return n.ok && hashPhoneE164(n.e164) === destination.hash;
    });

  const markerRows = [];
  const hashRows = [];
  for (const row of vendorScan.data ?? []) {
    const tagged = { ...row, __destinationMatches: matchesDestination(row) };
    if (row.assignment_suspension_reference === FIXTURE_REFERENCE) markerRows.push(tagged);
    else if (tagged.__destinationMatches) hashRows.push(tagged);
  }

  const foreignMatches = [];
  for (const [table, column] of [["client_accounts", "phone_e164"], ["leads", "phone"], ["profiles", "phone"]]) {
    const res = await client.from(table).select(`id, ${column}`);
    if (res.error) continue; // a missing table is not a collision
    for (const row of res.data ?? []) {
      const v = row[column];
      if (!v || String(v).trim() === "") continue;
      const n = normalizePhoneE164(v);
      if (n.ok && hashPhoneE164(n.e164) === destination.hash) foreignMatches.push({ table, id: row.id });
    }
  }

  const existing = classifyExisting({ markerRows, hashRows, foreignMatches });
  log(`Pre-state       : ${existing.state}${existing.detail ? ` (${existing.detail})` : ""}`);

  if (existing.state === "ALREADY_PRESENT") {
    return { ok: true, outcome: Outcome.ALREADY_PRESENT, vendorId: existing.id, writes: 0, destinationHash: destination.hash };
  }
  if (existing.state !== "ABSENT") {
    return { ok: false, outcome: Outcome.REFUSED, reason: existing.state, detail: existing.detail, vendorId: existing.id ?? null };
  }

  const row = buildFixtureRow(destination.e164);

  if (!mode.execute) {
    return {
      ok: true, outcome: Outcome.DRY_RUN_WOULD_CREATE, writes: 0, destinationHash: destination.hash,
      wouldInsert: { ...row, phone: "[REDACTED]", whatsapp_number: "[REDACTED]" },
    };
  }

  // --- THE SINGLE INSERT. There is no retry: an uncertain outcome is reported as
  //     uncertain and left for a human to inspect, exactly as the R7C authority does.
  let inserted;
  try {
    inserted = await client.from(VENDORS_TABLE).insert(row).select("id").maybeSingle();
  } catch {
    return { ok: false, outcome: Outcome.REFUSED, reason: FixtureFailure.WRITE_OUTCOME_UNCERTAIN };
  }
  if (inserted.error || !inserted.data?.id) {
    return { ok: false, outcome: Outcome.REFUSED, reason: FixtureFailure.WRITE_OUTCOME_UNCERTAIN, detail: inserted.error?.code ?? "no id returned" };
  }
  const vendorId = inserted.data.id;

  // --- Mandatory readback, from an independent select.
  const back = await client
    .from(VENDORS_TABLE)
    .select("id, assignment_suspension_reference, whatsapp_number, phone, status, is_active, accepting_leads, public_visibility, package_status, package_expires_at, total_credits, remaining_credits, paid_status, verification_status, user_id")
    .eq("id", vendorId)
    .maybeSingle();
  if (back.error || !back.data) {
    return { ok: false, outcome: Outcome.REFUSED, reason: FixtureFailure.READBACK_MISMATCH, vendorId };
  }
  const inert = fixtureIsInert(back.data);
  const resolves = matchesDestination(back.data);
  if (!inert.ok || !resolves || back.data.assignment_suspension_reference !== FIXTURE_REFERENCE) {
    return {
      ok: false, outcome: Outcome.REFUSED, reason: FixtureFailure.READBACK_MISMATCH,
      vendorId, detail: !resolves ? "destination" : inert.drift.join(",") || "marker",
    };
  }

  return { ok: true, outcome: Outcome.CREATED, vendorId, writes: 1, destinationHash: destination.hash };
}

if (isDirect) {
  const result = await run({ env: process.env, argv: process.argv.slice(2) });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) console.error(`REFUSED: ${result.reason}${result.detail ? ` (${result.detail})` : ""}`);
  process.exitCode = result.ok ? 0 : 3;
}
