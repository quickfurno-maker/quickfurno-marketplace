// ============================================================================
// QF-MVP-40.14 — Meta transactional mapping seed + activation authority validator.
// OFFLINE.
//
// Proves that the repository-side route which turns four further Meta templates
// into live send surface is exactly as narrow as it was reviewed:
//
//   * a CLOSED activation vocabulary of exactly four keys,
//   * every provider/category/language/version/schema value a hard-coded constant,
//   * a seed that lands APPROVED but INACTIVE and refuses drift rather than
//     overwriting it,
//   * readiness / posture / canary / anchor / automation-queue gates present,
//   * exactly one writable surface, and
//   * the existing lead_assignment_alert lane and the emergency shutdown untouched.
//
// It reads the ACTUAL migration source and evaluates every rule as a pure
// function of that text, so each rule can be re-run against a MUTATED copy. That
// is what the mutation self-tests do: they add a fifth key, change a provider id,
// hand the caller authority, default the seed to active, delete a gate or widen
// the writable scope, and require the matching rule to flip to false. A rule that
// cannot fail proves nothing.
//
// The four variables_schema contracts are not grepped for expected words — they
// are JSON-parsed out of the migration and compared against the REAL
// bindingSchemaFor() output, so a fabricated position or source key cannot pass.
//
// No secrets, no Meta, no Supabase, no network, no database, no live change.
// ============================================================================

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  BUSINESS_TEMPLATE_CONTRACTS,
  bindingSchemaFor,
} from "../../../lib/communication/businessTemplateVariables.ts";

const ROOT = process.cwd();

const MIGRATION_PATH =
  "supabase/migrations/20260912000000_qf_mvp_40_14_meta_transactional_mapping_authority.sql";
const HISTORICAL_80_14A_PATH =
  "supabase/migrations/20260903040000_qf_mvp_80_14a_meta_lead_assignment_production_activation.sql";
const HISTORICAL_40_13B_PATH =
  "supabase/migrations/20260813000000_qf_mvp_40_13b_canary_activation_authority.sql";
const CI_PATH = ".github/workflows/qf-mvp-50-quality-gate.yml";
const PKG_PATH = "package.json";

const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonicalBytes = (text) =>
  Buffer.from(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8");

const SRC = read(MIGRATION_PATH);
const H_80_14A = read(HISTORICAL_80_14A_PATH);
const H_40_13B = read(HISTORICAL_40_13B_PATH);
const CI = read(CI_PATH);
const PKG = JSON.parse(read(PKG_PATH));

/**
 * Both predecessors are HISTORICAL and must never be edited by a successor.
 * Pinned by canonical (line-ending independent) hash, exactly the way the G1
 * staging-history governance pins every migration.
 */
const SHA_80_14A = "b3bd351c61c81b02aced5257507412d45ad2d77075265f644633c699384d42e2";
const SHA_40_13B = "517b6ce01e27df8bb32cc473a1fb3d80775ad96190cff71175725ac3053e3a59";

/** The exact RPC identity under review. */
const RPC = "qf_activate_meta_transactional_mapping_v1";
const PARAMS = ["p_template_key", "p_activation_evidence_digest"];

/** THE CLOSED ACTIVATION SET. Exactly these four keys, and never a fifth. */
const CLOSED_SET = [
  "lead_received",
  "client_lead_status_update",
  "client_matching_update",
  "vendor_onboarding_reminder",
];

/** The already-live lane this phase must leave completely alone. */
const ANCHOR_KEY = "lead_assignment_alert";
const ANCHOR_NAME = "quickfurno_vendor_lead_assignment_alert_v1";

/** The exact provider identity each seeded key must carry. */
const EXPECTED_IDENTITY = {
  lead_received: ["qf_lead_received_v1", "1442104054406353"],
  client_lead_status_update: ["qf_client_lead_status_update_v1", "1078563638151601"],
  client_matching_update: ["qf_client_matching_update_v2", "1597441458555561"],
  vendor_onboarding_reminder: ["qf_vendor_onboarding_reminder_v1", "2564847817327366"],
};

/** Every value that must be a hard-coded constant, never a parameter. */
const HARD_CODED = [
  ["c_provider", "meta_whatsapp_cloud"],
  ["c_channel", "whatsapp"],
  ["c_language", "en"],
  ["c_category", "utility"],
  ["c_version", "1.0"],
  ["c_approval", "approved"],
];

/** Names that must NEVER appear as a caller-supplied parameter. */
const FORBIDDEN_PARAMS = [
  "p_provider", "p_provider_key", "p_channel", "p_language", "p_category",
  "p_provider_category", "p_version", "p_approval", "p_approval_status",
  "p_provider_template_name", "p_provider_template_id", "p_variables_schema",
  "p_schema", "p_is_active", "p_active", "p_activation_status", "p_outbound",
  "p_outbound_enabled", "p_mapping_id", "p_mapping", "p_account",
  "p_account_id", "p_phone_number_reference", "p_business_account_reference",
  "p_destination", "p_destination_hash", "p_webhook", "p_health", "p_quality",
];

/** The six durable readiness fields, with the exact value each must hold. */
const READINESS = [
  ["readiness_status", "provider_ready"],
  ["configuration_status", "complete"],
  ["business_verification_status", "verified"],
  ["phone_number_status", "connected"],
  ["webhook_status", "verified"],
  ["health_status", "healthy"],
];

/** Every named gate the authority must carry. */
const GUARDS = [
  "QF_TXN_TEMPLATE_NOT_ELIGIBLE",
  "QF_TXN_EVIDENCE_DIGEST_INVALID",
  "QF_TXN_CONTRACT_INTEGRITY",
  "QF_TXN_ACCOUNT_NOT_EXACTLY_ONE",
  "QF_TXN_ACCOUNT_NOT_FOUND",
  "QF_TXN_ACCOUNT_NOT_READY",
  "QF_TXN_POLICY_MISSING",
  "QF_TXN_POLICY_NOT_ACTIVE",
  "QF_TXN_POLICY_OUTBOUND_OFF",
  "QF_TXN_POLICY_OBSERVABILITY_OFF",
  "QF_TXN_ACTIVE_CANARY_PRESENT",
  "QF_TXN_ANCHOR_MAPPING_NOT_EXACTLY_ONE",
  "QF_TXN_ANCHOR_MAPPING_IDENTITY_CONFLICT",
  "QF_TXN_NONTERMINAL_JOBS_PRESENT",
  "QF_TXN_NONTERMINAL_ATTEMPTS_PRESENT",
  "QF_TXN_MAPPING_NOT_EXACTLY_ONE",
  "QF_TXN_MAPPING_NOT_APPROVED",
  "QF_TXN_MAPPING_ALREADY_ACTIVE",
  "QF_TXN_MAPPING_NAME_CONFLICT",
  "QF_TXN_MAPPING_PROVIDER_ID_CONFLICT",
  "QF_TXN_MAPPING_CATEGORY_CONFLICT",
  "QF_TXN_MAPPING_LANGUAGE_CONFLICT",
  "QF_TXN_MAPPING_VERSION_CONFLICT",
  "QF_TXN_MAPPING_SCHEMA_CONFLICT",
  "QF_TXN_POSTURE_INVARIANT",
  "QF_TXN_CANARY_INVARIANT",
  "QF_TXN_ANCHOR_INVARIANT",
  "QF_TXN_TARGET_INVARIANT",
  "QF_TXN_ACTIVE_SET_INVARIANT",
  "QF_TXN_DUPLICATE_ACTIVE_INVARIANT",
  "QF_TXN_ACCOUNT_READINESS_INVARIANT",
];

/**
 * The Client/Vendor keys that were explicitly EXCLUDED from this phase, each for
 * a stated reason. None of them may be activatable through this authority.
 */
const EXCLUDED_BUSINESS_KEYS = [
  "clarification_request",            // positional binding order unproven
  "clarification_reminder",           // Meta category MARKETING
  "client_transactional_followup",    // placeholder mismatch
  "vendor_new_lead",                  // obsolete accept/decline semantics
  "vendor_response_reminder",         // Meta category MARKETING
  "vendor_package_expiry_warning",    // Meta category MARKETING
  "low_credit_warning",               // Meta category MARKETING
];

/** Consent command responses are authorised ONLY by the evidence-bound enforcer. */
const EXCLUDED_CONSENT_KEYS = [
  "consent_stop_acknowledgement",
  "consent_start_acknowledgement",
  "consent_help_response",
];

/** Campaign / marketing surface that must stay unreachable. */
const EXCLUDED_CAMPAIGN_TOKENS = [
  "campaign",
  "vendor_campaigns",
  "campaign_recipients",
  "marketing",
  "recharge_reminder",
  "client_nurture_followup",
  "dormant_requirement_reactivation",
];

/** The duplicate provider template that must never displace the live mapping. */
const EXCLUDED_DUPLICATE_PROVIDER_TEMPLATE = "qf_lead_assignment_alert_v1";

/** Tables the authority may READ but must never write. */
const READ_ONLY_TABLES = [
  "communication_provider_runtime_policies",
  "communication_provider_canary_destinations",
  "communication_provider_accounts",
  "communication_templates",
  "communication_messages",
  "communication_intents",
  "communication_delivery_events",
  "communication_webhook_receipts",
  "automation_jobs",
  "automation_action_requests",
  "automation_execution_attempts",
  "lead_assignments",
  "leads",
  "vendors",
  "vendor_credit_wallets",
  "vendor_campaigns",
];

// ---------------------------------------------------------------------------
// REGIONS — mention is not assignment.
//
// The migration's own §6 self-verification deliberately NAMES what it forbids:
// it greps its own function definition for `p_template_key`-style switches, for
// every excluded template key and for `update public.<table>`. A whole-file
// containment check would therefore be satisfied by the very guards that exist
// to refuse those things, and would keep passing after the real clause was
// deleted. QF-MVP-40.13B hit exactly this and documented it in its §5.2.
//
// So every containment and precondition rule is evaluated against a REGION:
//
//   fn(s)        the authority's body only — no header, no seed, no §6
//   pre(s)       fn up to the write, i.e. every precondition
//   post(s)      fn from the write onward, i.e. every postcondition
//   seed(s)      the $seed$ DO block only
//   catalogue(s) the $catalogue$ DO block only
//
// A missing marker yields "", so a rule fails closed rather than throwing.
// ---------------------------------------------------------------------------

const WRITE_MARKER = "==== THE ONLY WRITE ====";

function between(source, startNeedle, endNeedle, fromIndex = 0) {
  const start = source.indexOf(startNeedle, fromIndex);
  if (start === -1) return "";
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  if (end === -1) return "";
  return source.slice(start, end);
}

const fn = (s) => between(s, `create or replace function public.${RPC}(`, "\n$$;");
const pre = (s) => {
  const body = fn(s);
  const cut = body.indexOf(WRITE_MARKER);
  return cut === -1 ? body : body.slice(0, cut);
};
const post = (s) => {
  const body = fn(s);
  const cut = body.indexOf(WRITE_MARKER);
  return cut === -1 ? "" : body.slice(cut);
};
const seed = (s) => between(s, "do $seed$", "$seed$;");
const catalogue = (s) => between(s, "do $catalogue$", "$catalogue$;");

/** Strip SQL line comments so a rule cannot be satisfied by prose. */
const codeOnly = (text) => text.replace(/^\s*--.*$/gm, "");

/**
 * Pull one of the two hard-coded JSON contracts out of the migration and parse
 * it. Returns null on any structural surprise, so a rule fails closed.
 */
function extractContract(source, beginMarker, endMarker) {
  const block = between(source, beginMarker, endMarker);
  if (!block) return null;
  const start = block.indexOf("'[");
  const end = block.lastIndexOf("]'::jsonb;");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(block.slice(start + 1, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const contractOf = (s) => extractContract(s, "-- QF_TXN_CONTRACT_BEGIN", "-- QF_TXN_CONTRACT_END");
const seedContractOf = (s) => extractContract(s, "-- QF_TXN_SEED_BEGIN", "-- QF_TXN_SEED_END");

/** Order-independent deep equality, so key order in JSON is never a contract. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
const sameJson = (a, b) => canonical(a) === canonical(b);

/** The closed key array as the migration literally declares it inside the RPC. */
function declaredKeys(source) {
  const m = /c_keys constant text\[\] := array\[([\s\S]*?)\];/.exec(fn(source));
  if (!m) return null;
  return [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
}

/** The keys the migration allows to be ACTIVE after a successful call. */
function declaredAllowedActive(source) {
  const m = /c_allowed_active constant text\[\] := array\[([\s\S]*?)\];/.exec(fn(source));
  if (!m) return null;
  return [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
}

// ---------------------------------------------------------------------------
// RULES — each is a pure function of the migration source.
// ---------------------------------------------------------------------------

const RULES = {
  // ---- A. exact RPC identity, signature and grants -------------------------
  "A01 the RPC name and two-parameter signature are exact": (s) =>
    new RegExp(
      `create or replace function public\\.${RPC}\\(\\s*${PARAMS[0]} text,\\s*${PARAMS[1]} text\\s*\\)`
    ).test(s),
  "A02 the grant and comment name the same two-text signature": (s) =>
    new RegExp(`grant execute on function public\\.${RPC}\\(text, text\\)\\s*\\n?\\s*to service_role;`).test(s) &&
    new RegExp(`comment on function public\\.${RPC}\\(text, text\\) is`).test(s),
  "A03 the authority declares plpgsql / SECURITY DEFINER / pinned search_path": (s) =>
    /language plpgsql\s*\nsecurity definer\s*\nset search_path = pg_catalog, public, pg_temp/.test(s),
  "A04 the parameter list is exactly the two reviewed text values": (s) => {
    const m = new RegExp(`create or replace function public\\.${RPC}\\(([^)]*)\\)`).exec(s);
    if (!m) return false;
    // Name AND type are captured, so a parameter of another type — a boolean
    // switch, a jsonb schema, a uuid mapping id — cannot slip past a name-only probe.
    const declared = [...m[1].matchAll(/(p_[a-z_]+)\s+([a-z_]+(?:\s*\[\])?)/g)].map((x) => [x[1], x[2]]);
    return JSON.stringify(declared) === JSON.stringify(PARAMS.map((p) => [p, "text"]));
  },
  "A05 this migration creates exactly ONE function, and it is this authority": (s) => {
    const created = [...s.matchAll(/create or replace function public\.([a-z0-9_]+)\(/g)].map((m) => m[1]);
    return created.length === 1 && created[0] === RPC;
  },

  // ---- B. the closed four-key activation vocabulary -------------------------
  "B01 the activation vocabulary is a closed set of exactly the four keys": (s) =>
    JSON.stringify(declaredKeys(s)) === JSON.stringify(CLOSED_SET),
  "B02 admission against the closed set is the FIRST gate in the authority": (s) => {
    const body = pre(s);
    const admit = body.indexOf("not (p_template_key = any (c_keys))");
    const firstRead = body.indexOf("from public.");
    return admit !== -1 && firstRead !== -1 && admit < firstRead &&
      /QF_TXN_TEMPLATE_NOT_ELIGIBLE/.test(body);
  },
  "B03 the contract table describes exactly the same four keys": (s) => {
    const c = contractOf(s);
    return Array.isArray(c) && c.length === CLOSED_SET.length &&
      JSON.stringify(c.map((e) => e.template_key).sort()) ===
        JSON.stringify([...CLOSED_SET].sort());
  },
  "B04 the authority re-checks its own contract integrity at runtime": (s) =>
    /jsonb_array_length\(c_contract\) <> array_length\(c_keys, 1\)/.test(pre(s)) &&
    /count\(distinct e ->> 'template_key'\)/.test(pre(s)) &&
    /QF_TXN_CONTRACT_INTEGRITY/.test(pre(s)),
  "B05 the ACTIVE-set allowlist is exactly the anchor plus the closed four": (s) =>
    JSON.stringify(declaredAllowedActive(s)) === JSON.stringify([ANCHOR_KEY, ...CLOSED_SET]),

  // ---- C. hard-coded production scope ---------------------------------------
  "C01 provider, channel, language, category, version and approval are constants": (s) =>
    HARD_CODED.every(([name, value]) =>
      new RegExp(`${name}\\s+constant text := '${value.replace(/\./g, "\\.")}';`).test(fn(s))
    ),
  "C02 the provider template NAME and ID are constants, never caller input": (s) => {
    const c = contractOf(s);
    if (!Array.isArray(c)) return false;
    return CLOSED_SET.every((key) => {
      const e = c.find((x) => x.template_key === key);
      const [name, id] = EXPECTED_IDENTITY[key];
      return e?.provider_template_name === name && e?.provider_template_id === id;
    });
  },
  "C03 no provider/category/language/version/schema/active parameter exists": (s) =>
    FORBIDDEN_PARAMS.every((p) => !new RegExp(`\\b${p}\\b`).test(fn(s))),
  "C04 the evidence digest is format-checked and grants no authority": (s) =>
    /p_activation_evidence_digest !~ '\^\[0-9a-f\]\{64\}\$'/.test(pre(s)) &&
    /QF_TXN_EVIDENCE_DIGEST_INVALID/.test(pre(s)) &&
    /AUDIT-ONLY EVIDENCE DIGEST/.test(fn(s)) &&
    // it is never used as a lookup key, a comparison against stored state, or a write
    !/p_activation_evidence_digest\s*(=|<>|is distinct from)\s*[a-z_]/.test(codeOnly(fn(s))),

  // ---- D. the seed lands APPROVED but INACTIVE -------------------------------
  "D01 the seed inserts is_active = false and never true": (s) => {
    const insert = between(seed(s), "insert into public.communication_provider_template_mappings", ");");
    return insert.includes("'approved', 'unknown'") && /\n\s*false\n/.test(insert) &&
      !/is_active\s*=\s*true/.test(seed(s)) && !/,\s*true\s*\n\s*\);/.test(insert);
  },
  "D02 the seed writes the hard-coded category, language, version and approval": (s) => {
    const block = codeOnly(seed(s));
    return /c_category constant text := 'utility';/.test(block) &&
      /c_language constant text := 'en';/.test(block) &&
      /c_version  constant text := '1\.0';/.test(block) &&
      /c_provider constant text := 'meta_whatsapp_cloud';/.test(block) &&
      /c_channel  constant text := 'whatsapp';/.test(block) &&
      /'approved', 'unknown',/.test(block);
  },
  "D03 the seed proves it armed nothing: 4 rows, 0 of them active": (s) =>
    /expected exactly 4 seeded mappings, found %/.test(seed(s)) &&
    /a seeded mapping is ACTIVE/.test(seed(s)) &&
    /applying this migration must create zero send authority/.test(seed(s)),
  "D04 the seed proves the live ACTIVE mapping count did not move": (s) =>
    /v_active_before/.test(seed(s)) && /v_active_after/.test(seed(s)) &&
    /if v_active_after <> v_active_before then/.test(seed(s)) &&
    /the ACTIVE mapping count moved from % to %/.test(seed(s)),
  "D05 the migration self-verification re-proves 4 approved INACTIVE rows": (s) =>
    /approval_status = 'approved' and is_active = false/.test(s) &&
    /expected 4 approved INACTIVE seeded mappings, found %/.test(s),

  // ---- E. drift is refused, never overwritten ---------------------------------
  "E01 an existing row is compared on every identity field": (s) => {
    const block = seed(s);
    return [
      "provider_template_name", "provider_template_id", "provider_category",
      "language", "version", "approval_status", "variables_schema",
    ].every((field) => new RegExp(`v_row\\.${field} is distinct from`).test(block));
  },
  "E02 every mismatch raises instead of updating": (s) => {
    const block = seed(s);
    // the seed contains INSERT only — no UPDATE, no upsert, no ON CONFLICT.
    return !/update public\./.test(block) && !/on conflict/i.test(block) &&
      !/delete from public\./.test(block) &&
      (block.match(/raise exception/g) ?? []).length >= 8;
  },
  "E03 a duplicate or already-ACTIVE target row aborts the migration": (s) =>
    /already has % mappings for/.test(seed(s)) &&
    /is already ACTIVE; this migration never activates and never deactivates/.test(seed(s)),
  "E04 an exactly-equal row is treated as idempotent, not as an error": (s) => {
    const block = seed(s);
    // the equality branch has no unconditional raise: it only raises per-field.
    return /EQUALITY OR ABORT/.test(block) &&
      /if v_count = 0 then/.test(block) && /else/.test(block);
  },

  // ---- F. variables_schema parity with the proven code contract ---------------
  "F01 all four schemas equal bindingSchemaFor() exactly": (s) => {
    const c = contractOf(s);
    if (!Array.isArray(c)) return false;
    return CLOSED_SET.every((key) => {
      const e = c.find((x) => x.template_key === key);
      const expected = bindingSchemaFor(key);
      return expected !== null && e !== undefined && sameJson(e.variables_schema, expected);
    });
  },
  "F02 the seed contract and the authority contract are identical": (s) =>
    sameJson(contractOf(s), seedContractOf(s)) && Array.isArray(contractOf(s)),
  "F03 every binding declares component/position/sourceKey/parameterType": (s) => {
    const c = contractOf(s);
    if (!Array.isArray(c)) return false;
    return c.every((e) =>
      e.variables_schema?.bindingVersion === 1 &&
      Array.isArray(e.variables_schema?.bindings) &&
      e.variables_schema.bindings.length > 0 &&
      e.variables_schema.bindings.every((b) =>
        b.component === "body" && Number.isInteger(b.position) && b.position >= 1 &&
        typeof b.sourceKey === "string" && b.parameterType === "text"));
  },
  "F04 positions are contiguous from 1 and never duplicated": (s) => {
    const c = contractOf(s);
    if (!Array.isArray(c)) return false;
    return c.every((e) => {
      const positions = e.variables_schema.bindings.map((b) => b.position).sort((a, b) => a - b);
      return positions.every((p, i) => p === i + 1);
    });
  },
  "F05 every source key exists in the proven BUSINESS_TEMPLATE_CONTRACTS": (s) => {
    const c = contractOf(s);
    if (!Array.isArray(c)) return false;
    return c.every((e) => {
      const proven = BUSINESS_TEMPLATE_CONTRACTS[e.template_key];
      if (!proven) return false;
      const provenKeys = proven.bindings.slice().sort((a, b) => a.position - b.position)
        .map((b) => b.sourceKey);
      const declared = e.variables_schema.bindings.slice().sort((a, b) => a.position - b.position)
        .map((b) => b.sourceKey);
      return JSON.stringify(provenKeys) === JSON.stringify(declared);
    });
  },
  "F06 the four keys are exactly the business contracts minus the live anchor": () => {
    const contracts = Object.keys(BUSINESS_TEMPLATE_CONTRACTS).filter((k) => k !== ANCHOR_KEY).sort();
    return JSON.stringify(contracts) === JSON.stringify([...CLOSED_SET].sort());
  },

  // ---- G. excluded keys are structurally unreachable ---------------------------
  "G01 no excluded Client/Vendor key appears in the authority": (s) =>
    EXCLUDED_BUSINESS_KEYS.every((k) => !fn(s).includes(k)),
  "G02 no excluded Client/Vendor key appears in the seed or catalogue": (s) =>
    EXCLUDED_BUSINESS_KEYS.every((k) => !seed(s).includes(k) && !catalogue(s).includes(k)),
  "G03 no excluded Client/Vendor key is in the closed set or the contract": (s) => {
    const keys = declaredKeys(s) ?? [];
    const contractKeys = (contractOf(s) ?? []).map((e) => e.template_key);
    const active = declaredAllowedActive(s) ?? [];
    return EXCLUDED_BUSINESS_KEYS.every((k) =>
      !keys.includes(k) && !contractKeys.includes(k) && !active.includes(k));
  },
  "G04 no consent command response key is reachable anywhere in this phase": (s) =>
    EXCLUDED_CONSENT_KEYS.every((k) =>
      !fn(s).includes(k) && !seed(s).includes(k) && !catalogue(s).includes(k) &&
      !(declaredKeys(s) ?? []).includes(k) && !(declaredAllowedActive(s) ?? []).includes(k)),
  // Evaluated on EXECUTABLE text only: the authority's own prose legitimately
  // says which surfaces it refuses to touch, and a prose mention is not a reach.
  "G05 no campaign or marketing surface is reachable from this phase": (s) =>
    EXCLUDED_CAMPAIGN_TOKENS.every((t) =>
      !codeOnly(fn(s)).toLowerCase().includes(t) &&
      !codeOnly(seed(s)).toLowerCase().includes(t) &&
      !codeOnly(catalogue(s)).toLowerCase().includes(t)),
  "G06 the duplicate qf_lead_assignment_alert_v1 template is never referenced": (s) =>
    !fn(s).includes(EXCLUDED_DUPLICATE_PROVIDER_TEMPLATE) &&
    !seed(s).includes(EXCLUDED_DUPLICATE_PROVIDER_TEMPLATE) &&
    (contractOf(s) ?? []).every((e) => e.provider_template_name !== EXCLUDED_DUPLICATE_PROVIDER_TEMPLATE),
  "G07 the migration itself re-asserts every exclusion at apply time": (s) =>
    [...EXCLUDED_BUSINESS_KEYS, ...EXCLUDED_CONSENT_KEYS].every((k) =>
      new RegExp(`'${k}'`).test(between(s, "do $verify$", "$verify$;"))) &&
    /excluded key % is reachable from this authority/.test(s),

  // ---- H. readiness, posture and queue gates -----------------------------------
  "H01 exactly one fully ready provider account is required": (s) =>
    /QF_TXN_ACCOUNT_NOT_EXACTLY_ONE/.test(pre(s)) &&
    READINESS.every(([field, value]) => new RegExp(`${field} <> '${value}'`).test(pre(s))) &&
    /QF_TXN_ACCOUNT_NOT_READY/.test(pre(s)),
  "H02 the account is resolved from constants and locked, never supplied": (s) =>
    /from public\.communication_provider_accounts\s*\n\s*where provider_key = c_provider and channel = c_channel\s*\n\s*for update;/.test(pre(s)),
  "H03 the runtime policy must already be active with outbound/webhook/health on": (s) =>
    /v_policy\.activation_status <> 'active'/.test(pre(s)) &&
    /QF_TXN_POLICY_NOT_ACTIVE/.test(pre(s)) &&
    /v_policy\.outbound_enabled is not true/.test(pre(s)) &&
    /QF_TXN_POLICY_OUTBOUND_OFF/.test(pre(s)) &&
    /v_policy\.webhook_processing_enabled is not true/.test(pre(s)) &&
    /v_policy\.health_check_enabled is not true/.test(pre(s)) &&
    /QF_TXN_POLICY_OBSERVABILITY_OFF/.test(pre(s)),
  "H04 zero ACTIVE canary destinations are required": (s) =>
    /from public\.communication_provider_canary_destinations\s*\n\s*where provider_key = c_provider and channel = c_channel and is_active;[\s\S]{0,160}QF_TXN_ACTIVE_CANARY_PRESENT/.test(pre(s)),
  "H05 the live lead_assignment_alert mapping must still be exactly one and exact": (s) =>
    /c_anchor_key  constant text := 'lead_assignment_alert';/.test(fn(s)) &&
    new RegExp(`c_anchor_name constant text := '${ANCHOR_NAME}';`).test(fn(s)) &&
    /QF_TXN_ANCHOR_MAPPING_NOT_EXACTLY_ONE/.test(pre(s)) &&
    /v_anchor\.provider_template_name is distinct from c_anchor_name/.test(pre(s)) &&
    /QF_TXN_ANCHOR_MAPPING_IDENTITY_CONFLICT/.test(pre(s)),
  "H06 zero nonterminal automation jobs and attempts are required": (s) =>
    /c_open_job_status\s+constant text\[\] := array\['pending', 'processing', 'retry_scheduled', 'uncertain'\];/.test(fn(s)) &&
    /c_open_attempt_status constant text\[\] := array\['started'\];/.test(fn(s)) &&
    /from public\.automation_jobs where status = any \(c_open_job_status\);/.test(pre(s)) &&
    /QF_TXN_NONTERMINAL_JOBS_PRESENT/.test(pre(s)) &&
    /from public\.automation_execution_attempts where status = any \(c_open_attempt_status\);/.test(pre(s)) &&
    /QF_TXN_NONTERMINAL_ATTEMPTS_PRESENT/.test(pre(s)),
  "H07 the target row must be exact, approved and inactive before the write": (s) =>
    /QF_TXN_MAPPING_NOT_EXACTLY_ONE/.test(pre(s)) &&
    /v_mapping\.approval_status is distinct from c_approval/.test(pre(s)) &&
    /v_mapping\.is_active is true/.test(pre(s)) &&
    /v_mapping\.provider_template_name is distinct from \(v_spec ->> 'provider_template_name'\)/.test(pre(s)) &&
    /v_mapping\.provider_template_id is distinct from \(v_spec ->> 'provider_template_id'\)/.test(pre(s)) &&
    /v_mapping\.provider_category is distinct from c_category/.test(pre(s)) &&
    /v_mapping\.language is distinct from c_language/.test(pre(s)) &&
    /v_mapping\.version is distinct from c_version/.test(pre(s)) &&
    /v_mapping\.variables_schema is distinct from \(v_spec -> 'variables_schema'\)/.test(pre(s)),
  "H08 every mapping row read for mutation is locked FOR UPDATE": (s) =>
    (pre(s).match(/for update;/g) ?? []).length >= 4,

  // ---- I. exactly one writable surface -----------------------------------------
  "I01 the ONLY write is the single-column mapping activation by id": (s) =>
    /update public\.communication_provider_template_mappings\s*\n\s*set is_active = true, updated_at = now\(\)\s*\n\s*where id = v_mapping\.id;/.test(fn(s)),
  "I02 exactly one write statement exists in the whole authority": (s) => {
    const writes = [...fn(s).matchAll(/^\s*(insert into|update|delete from) public\.([a-z_]+)/gm)]
      .map((m) => m[2]);
    return writes.length === 1 && writes[0] === "communication_provider_template_mappings";
  },
  "I03 no read-only table is ever written by the authority": (s) =>
    READ_ONLY_TABLES.every((t) =>
      !new RegExp(`update public\\.${t}\\b`).test(fn(s)) &&
      !new RegExp(`insert into public\\.${t}\\b`).test(fn(s)) &&
      !new RegExp(`delete from public\\.${t}\\b`).test(fn(s))),
  "I04 the authority writes no communication, automation, credit or lead row": (s) =>
    !/insert into public\./.test(fn(s)) &&
    !/vendor_credit|remaining_credits|credit_ledger/.test(fn(s)) &&
    !/lead_assignment_approvals|lead_delivery_logs/.test(fn(s)),
  "I05 the migration re-proves the single-write scope at apply time": (s) =>
    /the authority writes public\.%, a surface it must only read/.test(s) &&
    /the authority performs more than one update/.test(s) &&
    /the single permitted write is not exact/.test(s),

  // ---- J. postconditions ---------------------------------------------------------
  "J01 the policy posture is re-read and must be unchanged": (s) =>
    /QF_TXN_POSTURE_INVARIANT/.test(post(s)) &&
    /v_policy\.activation_status <> 'active'/.test(post(s)),
  "J02 zero active canary destinations is re-proved after the write": (s) =>
    /QF_TXN_CANARY_INVARIANT/.test(post(s)),
  "J03 the anchor row is re-read and compared field by field, updated_at included": (s) =>
    /QF_TXN_ANCHOR_INVARIANT/.test(post(s)) &&
    /v_after\.updated_at is distinct from v_anchor\.updated_at/.test(post(s)) &&
    /v_after\.is_active is not true/.test(post(s)) &&
    /v_after\.provider_template_name is distinct from v_anchor\.provider_template_name/.test(post(s)),
  "J04 the target row is re-read and must be active AND exact": (s) =>
    /QF_TXN_TARGET_INVARIANT/.test(post(s)) &&
    /v_after\.provider_template_id is distinct from \(v_spec ->> 'provider_template_id'\)/.test(post(s)) &&
    /v_after\.variables_schema is distinct from \(v_spec -> 'variables_schema'\)/.test(post(s)),
  "J05 every ACTIVE mapping must belong to the reviewed five-key set": (s) =>
    /not \(template_key = any \(c_allowed_active\)\)/.test(post(s)) &&
    /QF_TXN_ACTIVE_SET_INVARIANT/.test(post(s)),
  "J06 no template/language may hold two active mappings": (s) =>
    /group by template_key, language\s*\n\s*having count\(\*\) > 1/.test(post(s)) &&
    /QF_TXN_DUPLICATE_ACTIVE_INVARIANT/.test(post(s)),
  "J07 account readiness is re-proved untouched": (s) =>
    /QF_TXN_ACCOUNT_READINESS_INVARIANT/.test(post(s)) &&
    READINESS.every(([field, value]) => new RegExp(`${field} <> '${value}'`).test(post(s))),
  "J08 every named gate is present in the authority": (s) => GUARDS.every((g) => fn(s).includes(g)),

  // ---- K. privileges ---------------------------------------------------------------
  "K01 execute is revoked from public/anon/authenticated/service_role first": (s) =>
    new RegExp(
      `revoke all on function public\\.${RPC}\\(text, text\\)\\s*\\n\\s*from public, anon, authenticated, service_role;`
    ).test(s),
  "K02 execute is granted ONLY to service_role": (s) => {
    const grants = [...s.matchAll(/grant execute on function[\s\S]*?to ([a-z_, ]+);/g)].map((m) => m[1].trim());
    return grants.length === 1 && grants[0] === "service_role";
  },
  "K03 no browser role gains any capability, and no table grant is added": (s) =>
    !/to anon/.test(s) && !/to authenticated/.test(s) && !/to public;/.test(s) &&
    !/grant (insert|update|delete|all) on/.test(s),
  "K04 the migration re-proves the service_role-only privilege at apply time": (s) =>
    /granted beyond service_role/.test(s) && /service_role lost execute on %/.test(s) &&
    /is not SECURITY DEFINER/.test(s) && /lacks the pinned search_path/.test(s),

  // ---- L. predecessors untouched -----------------------------------------------------
  "L01 the QF-MVP-80.14A migration is byte-identical to its pinned hash": () =>
    sha256(canonicalBytes(H_80_14A)) === SHA_80_14A,
  "L02 the QF-MVP-40.13B migration is byte-identical to its pinned hash": () =>
    sha256(canonicalBytes(H_40_13B)) === SHA_40_13B,
  "L03 this phase redefines neither predecessor authority nor the kill switch": (s) => {
    const created = [...s.matchAll(/create or replace function public\.([a-z0-9_]+)\(/g)].map((m) => m[1]);
    return !created.includes("qf_activate_meta_lead_assignment_v1") &&
      !created.includes("qf_disable_meta_canary_v1") &&
      !created.includes("qf_quiesce_meta_canary_v1") &&
      !created.includes("qf_arm_meta_provider_readiness_v1") &&
      !created.includes("qf_arm_meta_canary_v1") &&
      !/drop function/i.test(s) && !/alter function/i.test(s);
  },
  "L04 the migration verifies the 80.14A authority is still intact": (s) =>
    /the 80\.14A activation authority was altered/.test(s) &&
    /c_template_key\\s\+constant\\s\+text\\s\*:=\\s\*''lead_assignment_alert''/.test(s),
  "L05 the kill switch is verified intact AND still deactivates every mapping": (s) =>
    /the emergency shutdown was weakened/.test(s) &&
    /the emergency shutdown no longer deactivates every mapping/.test(s) &&
    /on conflict \\\(provider_key, channel\\\) do update/.test(s),
  "L06 the kill switch really does close every mapping this phase can open": () => {
    const body = H_40_13B.slice(
      H_40_13B.indexOf("create or replace function public.qf_disable_meta_canary_v1"),
      H_40_13B.indexOf("comment on function public.qf_disable_meta_canary_v1")
    );
    return body.length > 0 &&
      /update public\.communication_provider_template_mappings\s*\n\s*set is_active = false/.test(body) &&
      /activation_status = 'disabled'/.test(body) &&
      /outbound_enabled = false/.test(body) &&
      // unconditional: it takes no argument and carries no prior-state precondition
      /create or replace function public\.qf_disable_meta_canary_v1\(\)/.test(body) &&
      !/QF_CANARY_POLICY_NOT_IN_READINESS/.test(body);
  },
  "L07 the live lead_assignment_alert mapping is only ever read here": (s) =>
    // the anchor is selected and compared, never updated or deleted
    !new RegExp(`update public\\.[a-z_]+[\\s\\S]{0,200}${ANCHOR_KEY}`).test(codeOnly(fn(s))) &&
    !new RegExp(`${ANCHOR_KEY}[\\s\\S]{0,120}set is_active`).test(codeOnly(fn(s))) &&
    !codeOnly(seed(s)).includes(ANCHOR_KEY) && !codeOnly(catalogue(s)).includes(ANCHOR_KEY),

  // ---- M. no provider call, no credential ---------------------------------------------
  "M01 no network extension, HTTP call, Meta endpoint or credential appears": (s) =>
    !/create extension/i.test(s) &&
    !/pg_net\s*\(|http_post|http_get|dblink\s*\(/i.test(s) &&
    !/graph\.facebook/.test(s) &&
    !/https?:\/\//.test(s) &&
    !/access_token|bearer|app_secret|verify_token/i.test(s) &&
    /pg_extension where extname in \('pg_net', 'http', 'dblink'\)/.test(s),
  "M02 the migration refuses to apply if a network extension is present": (s) =>
    /database network extension present; provider calls must remain application-layer only/.test(s),

  // ---- N. governance -------------------------------------------------------------------
  "N01 the migration is forward-only and creates no table, type or trigger": (s) =>
    !/drop table/i.test(s) && !/drop trigger/i.test(s) && !/create table/i.test(s) &&
    !/create type/i.test(s) && !/create trigger/i.test(s) && !/alter table/i.test(s),
  "N02 the migration is wrapped in one explicit transaction": (s) =>
    /^begin;$/m.test(s) && /^commit;$/m.test(s),
  "N03 the catalogue prerequisite creates only on proven absence": (s) => {
    const block = catalogue(s);
    return /if v_row\.template_key is null then/.test(block) &&
      /insert into public\.communication_templates/.test(block) &&
      !/update public\.communication_templates/.test(block) &&
      !/delete from public\.communication_templates/.test(block) &&
      /expected whatsapp/.test(block) && /expected business/.test(block);
  },
  "N04 exactly one migration is added by this phase, and it is 40.14's own": () => {
    const files = readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    const mine = files.filter((f) => f.includes("40_14_meta_transactional_mapping_authority"));
    return mine.length === 1 && mine[0] === path.basename(MIGRATION_PATH);
  },
  "N05 the npm gate exists and runs this validator": () =>
    PKG.scripts?.["test:mvp:40-14"]?.includes(
      "scripts/mvp/communication/validate-qf-mvp-40-14-transactional-mapping-authority.mjs") === true,
  "N06 CI runs this validator at the exact head": () =>
    /QF-MVP-40\.14 Meta transactional mapping authority/.test(CI) &&
    /npm run test:mvp:40-14/.test(CI),
  "N07 no existing CI step was removed": () => {
    const required = [
      "npm run test:mvp:40-4", "npm run test:mvp:40-10a", "npm run test:mvp:40-11",
      "npm run test:mvp:40-12-r1", "npm run test:mvp:50-1a", "npm run test:mvp:50-1b",
      "npm run test:mvp:50-1c", "npm run test:mvp:50-2a", "npm run test:mvp:50-2b",
      "npm run test:mvp:50-2c", "npm run test:mvp:50-2c-s2-g1", "npm run test:mvp:50-2d",
      "npm run test:mvp:50-2e", "npm run test:mvp:50-2-final", "npm run test:mvp:50-3",
      "npm run test:mvp:50-4", "npm run test:mvp:50-5", "npm run test:mvp:50-6",
      "npm run test:mvp:50-7", "npm run test:security:launch-closeout",
      "npm run test:mvp:50-3-50-4-bridge", "npm run test:mvp:50-3-50-4-forensic",
      "npm run test:mvp:50-3-50-4-cert", "npm run test:mvp:70-01", "npm run test:mvp:70-02",
      "npm run test:mvp:70-03", "npm run test:mvp:70-04", "npm run test:mvp:75-01",
      "npm run test:mvp:75-02", "npm run test:mvp:75-03", "npm run test:mvp:80-02-gate06",
      "npm run test:mvp:80-03-audit", "npm run test:mvp:80-04", "npm run test:mvp:80-14a",
      "npm run test:mvp:80-14c", "npm run test:mvp:marketplace",
      "npm run test:mvp:assignment-authority", "npm run test:phase4",
      "npm run test:mvp:82a-r0", "npm run test:mvp:82a-r0-s1",
      "npm run typecheck", "npm run build",
    ];
    return required.every((step) => CI.includes(step));
  },
};

// ---------------------------------------------------------------------------
// MUTATION SELF-TESTS — each widens or deletes a critical clause and requires
// the named rule to FLIP TO FALSE. A rule that survives its mutation is a rule
// that proves nothing.
// ---------------------------------------------------------------------------

const MUTANTS = [
  // A FIFTH KEY IS ADDED — the single most important thing this phase forbids.
  ["B01", "a fifth key is added to the closed activation set",
    (s) => s.replace("    'vendor_onboarding_reminder'\n  ];", "    'vendor_onboarding_reminder',\n    'clarification_request'\n  ];")],
  ["B03", "a fifth entry is added to the authority contract",
    (s) => s.replace(
      `      "template_key": "lead_received",\n      "provider_template_name": "qf_lead_received_v1",`,
      `      "template_key": "vendor_new_lead",\n      "provider_template_name": "qf_vendor_new_lead_v1",`)],
  ["B02", "the closed-set admission gate is deleted",
    (s) => s.replace(/  if p_template_key is null or not \(p_template_key = any \(c_keys\)\) then[\s\S]*?end if;\n/, "")],
  ["B05", "the ACTIVE-set allowlist is widened to another template",
    (s) => s.replace("    'vendor_onboarding_reminder'\n  ];\n\n  -- An automation job",
      "    'vendor_onboarding_reminder',\n    'low_credit_warning'\n  ];\n\n  -- An automation job")],

  // PROVIDER IDENTITY IS CHANGED.
  ["C02", "a provider template id is silently changed",
    (s) => s.replace('"provider_template_id": "1442104054406353"', '"provider_template_id": "9999999999999999"')],
  ["C02", "a provider template name is silently changed",
    (s) => s.replace('"provider_template_name": "qf_client_matching_update_v2"',
      '"provider_template_name": "qf_client_matching_update_v1"')],
  ["C01", "the provider category is widened from utility",
    (s) => s.replace("c_category   constant text := 'utility';", "c_category   constant text := 'marketing';")],
  ["C01", "the provider becomes caller-controlled",
    (s) => s.replace("c_provider   constant text := 'meta_whatsapp_cloud';", "c_provider   text := p_provider_key;")],
  ["C03", "a caller-supplied provider template id parameter is added",
    (s) => s.replace("  p_activation_evidence_digest text\n)",
      "  p_activation_evidence_digest text,\n  p_provider_template_id text\n)")],
  ["A04", "the signature gains a third parameter",
    (s) => s.replace("  p_activation_evidence_digest text\n)",
      "  p_activation_evidence_digest text,\n  p_is_active boolean\n)")],
  ["C04", "the audit digest is turned into an authority by comparing it to stored state",
    (s) => s.replace("  -- ==== 3. CONTRACT INTEGRITY ====",
      "  if p_activation_evidence_digest = v_account.id then null; end if;\n\n  -- ==== 3. CONTRACT INTEGRITY ====")],

  // THE SEED DEFAULTS TO ACTIVE.
  ["D01", "the seed inserts is_active = true",
    (s) => s.replace("        v_spec -> 'variables_schema',\n        false\n      );",
      "        v_spec -> 'variables_schema',\n        true\n      );")],
  ["D03", "the seed stops proving that nothing was armed",
    (s) => s.replace("applying this migration must create zero send authority", "seeded")],
  ["D04", "the seed stops proving the ACTIVE mapping count did not move",
    (s) => s.replace(/  if v_active_after <> v_active_before then[\s\S]*?end if;\n/, "")],

  // DRIFT IS SILENTLY OVERWRITTEN INSTEAD OF REFUSED.
  ["E01", "the provider id equality check is dropped from the seed",
    (s) => s.replace(/      if v_row\.provider_template_id is distinct from \(v_spec ->> 'provider_template_id'\) then[\s\S]*?end if;\n/, "")],
  ["E02", "the seed starts overwriting a conflicting row",
    (s) => s.replace("      if v_row.is_active is true then",
      "      update public.communication_provider_template_mappings set provider_template_id = v_spec ->> 'provider_template_id' where id = v_row.id;\n      if v_row.is_active is true then")],
  ["E03", "an already-ACTIVE target row stops aborting the migration",
    (s) => s.replace("is already ACTIVE; this migration never activates and never deactivates", "noted")],

  // THE BINDING CONTRACT IS FABRICATED.
  ["F01", "a source key is fabricated",
    (s) => s.replace('"sourceKey": "outstanding_item"', '"sourceKey": "vendor_name"')],
  ["F01", "two positions are swapped",
    (s) => s.replace(
      `          {"component": "body", "position": 1, "sourceKey": "client_name", "parameterType": "text"},\n          {"component": "body", "position": 2, "sourceKey": "lead_status_label", "parameterType": "text"}`,
      `          {"component": "body", "position": 2, "sourceKey": "client_name", "parameterType": "text"},\n          {"component": "body", "position": 1, "sourceKey": "lead_status_label", "parameterType": "text"}`)],
  ["F02", "the seed contract drifts from the authority contract",
    (s) => s.replace('"provider_template_id": "2564847817327366",\n      "variables_schema": {\n        "bindingVersion": 1,\n        "bindings": [\n          {"component": "body", "position": 1, "sourceKey": "outstanding_item", "parameterType": "text"}\n        ]\n      }\n    }\n  ]\'::jsonb;\n  -- QF_TXN_SEED_END',
      '"provider_template_id": "2564847817327366",\n      "variables_schema": {\n        "bindingVersion": 1,\n        "bindings": [\n          {"component": "body", "position": 1, "sourceKey": "client_name", "parameterType": "text"}\n        ]\n      }\n    }\n  ]\'::jsonb;\n  -- QF_TXN_SEED_END')],
  ["F03", "a binding loses its declared parameter type",
    (s) => s.replace('"sourceKey": "client_name", "parameterType": "text"}\n        ]\n      }\n    },\n    {\n      "template_key": "client_lead_status_update"',
      '"sourceKey": "client_name"}\n        ]\n      }\n    },\n    {\n      "template_key": "client_lead_status_update"')],

  // EXCLUDED KEYS BECOME REACHABLE.
  ["G03", "an excluded MARKETING key joins the closed set",
    (s) => s.replace("    'client_matching_update',\n    'vendor_onboarding_reminder'\n  ];",
      "    'client_matching_update',\n    'vendor_onboarding_reminder',\n    'vendor_response_reminder'\n  ];")],
  ["G04", "a consent acknowledgement key joins the ACTIVE-set allowlist",
    (s) => s.replace("    'vendor_onboarding_reminder'\n  ];\n\n  -- An automation job",
      "    'vendor_onboarding_reminder',\n    'consent_stop_acknowledgement'\n  ];\n\n  -- An automation job")],
  ["G05", "a campaign surface is referenced from the authority",
    (s) => s.replace("  v_count   integer;", "  v_count   integer;\n  v_campaign uuid;")],
  ["G06", "the duplicate lead-assignment provider template is seeded",
    (s) => s.replace('"provider_template_name": "qf_lead_received_v1"',
      '"provider_template_name": "qf_lead_assignment_alert_v1"')],

  // GATES ARE REMOVED.
  ["H01", "one readiness field (health) is dropped",
    (s) => s.replace("     or v_account.health_status <> 'healthy' then\n    raise exception 'QF_TXN_ACCOUNT_NOT_READY'",
      "     then\n    raise exception 'QF_TXN_ACCOUNT_NOT_READY'")],
  ["H03", "the runtime policy is no longer required to be active",
    (s) => s.replace(/  if v_policy\.activation_status <> 'active' then[\s\S]*?end if;\n/, "")],
  ["H04", "the zero-active-canary precondition is removed",
    (s) => s.replace(/  select count\(\*\)::integer into v_count\n    from public\.communication_provider_canary_destinations\n   where provider_key = c_provider and channel = c_channel and is_active;\n  if v_count <> 0 then\n    raise exception 'QF_TXN_ACTIVE_CANARY_PRESENT'[\s\S]*?end if;\n/, "")],
  ["H05", "the live lead_assignment_alert CAS is removed",
    (s) => s.replace(/  if v_anchor\.provider_template_name is distinct from c_anchor_name then[\s\S]*?end if;\n/, "")],
  ["H06", "the nonterminal automation-queue gate is removed",
    (s) => s.replace(/  select count\(\*\)::integer into v_count\n    from public\.automation_jobs where status = any \(c_open_job_status\);\n  if v_count <> 0 then\n    raise exception 'QF_TXN_NONTERMINAL_JOBS_PRESENT'[\s\S]*?end if;\n/, "")],
  ["H07", "the target schema equality check is dropped",
    (s) => s.replace(/  if v_mapping\.variables_schema is distinct from \(v_spec -> 'variables_schema'\) then[\s\S]*?end if;\n/, "")],
  ["H07", "the target no longer has to be inactive",
    (s) => s.replace("  if v_mapping.is_active is true then", "  if false then")],

  // THE WRITABLE SCOPE IS WIDENED.
  ["I02", "the authority also writes the runtime policy",
    (s) => s.replace("  -- ==== POSTCONDITIONS",
      "  update public.communication_provider_runtime_policies set outbound_enabled = true where id = v_policy.id;\n\n  -- ==== POSTCONDITIONS")],
  ["I03", "the authority starts writing the provider account",
    (s) => s.replace("  -- ==== POSTCONDITIONS",
      "  update public.communication_provider_accounts set health_status = 'healthy' where id = v_account.id;\n\n  -- ==== POSTCONDITIONS")],
  ["I04", "the authority starts inserting a communication message",
    (s) => s.replace("  -- ==== POSTCONDITIONS",
      "  insert into public.communication_messages (id) values (gen_random_uuid());\n\n  -- ==== POSTCONDITIONS")],
  ["I01", "the write is widened from one row to every inactive row",
    (s) => s.replace("   where id = v_mapping.id;", "   where is_active = false;")],

  // POSTCONDITIONS ARE REMOVED.
  ["J03", "the anchor-unchanged postcondition is removed",
    (s) => s.replace("QF_TXN_ANCHOR_INVARIANT", "QF_REMOVED")],
  ["J05", "the active-set postcondition is removed",
    (s) => s.replace("QF_TXN_ACTIVE_SET_INVARIANT", "QF_REMOVED")],
  ["J06", "the duplicate-active postcondition is removed",
    (s) => s.replace("QF_TXN_DUPLICATE_ACTIVE_INVARIANT", "QF_REMOVED")],
  ["J07", "the account-readiness postcondition is removed",
    (s) => s.replace("QF_TXN_ACCOUNT_READINESS_INVARIANT", "QF_REMOVED")],

  // PRIVILEGES ARE WIDENED.
  ["K02", "execute is also granted to authenticated",
    (s) => s.replace("  to service_role;", "  to service_role, authenticated;")],
  ["K03", "anon is granted the activation capability",
    (s) => s + `\ngrant execute on function public.${RPC}(text, text) to anon;\n`],
  ["K03", "a direct table write grant is restored",
    (s) => s.replace("grant execute on function",
      "grant update on public.communication_provider_template_mappings to service_role;\ngrant execute on function")],

  // PREDECESSORS / KILL SWITCH.
  ["L03", "the kill switch is redefined by this migration",
    (s) => s.replace(`create or replace function public.${RPC}(`,
      "create or replace function public.qf_disable_meta_canary_v1(")],
  ["L07", "the live lead_assignment_alert mapping is deactivated by the seed",
    (s) => s.replace("  for v_spec in select e from jsonb_array_elements(c_seed) e loop",
      "  update public.communication_provider_template_mappings set is_active = false where template_key = 'lead_assignment_alert';\n  for v_spec in select e from jsonb_array_elements(c_seed) e loop")],

  // NETWORK / GOVERNANCE.
  ["M01", "a network extension is introduced",
    (s) => s.replace("begin;", "begin;\ncreate extension if not exists pg_net;")],
  ["N01", "the migration alters a table instead of adding a function",
    (s) => s.replace("begin;", "begin;\nalter table public.communication_provider_template_mappings add column x text;")],
  ["N03", "the catalogue prerequisite starts modifying existing rows",
    (s) => s.replace("      if v_row.channel is distinct from 'whatsapp' then",
      "      update public.communication_templates set is_active = true where template_key = v_key;\n      if v_row.channel is distinct from 'whatsapp' then")],
];

// ---------------------------------------------------------------------------

const results = [];
const add = (name, ok, detail) => results.push({ name, ok: ok === true, detail: detail ?? "" });

for (const [name, rule] of Object.entries(RULES)) {
  let ok = false;
  let detail = "";
  try {
    ok = rule(SRC) === true;
  } catch (e) {
    detail = e instanceof Error ? e.message : String(e);
  }
  add(name, ok, detail);
}

let mutantsRejected = 0;
for (const [ruleKey, label, mutate] of MUTANTS) {
  const rule = Object.entries(RULES).find(([n]) => n.startsWith(ruleKey));
  if (!rule) {
    add(`MUT ${ruleKey} ${label}`, false, "no such rule");
    continue;
  }
  let rejected = false;
  let detail = "";
  try {
    const mutated = mutate(SRC);
    if (mutated === SRC) {
      detail = "mutation was a no-op (source drifted from the mutant)";
    } else {
      rejected = rule[1](mutated) === false;
      if (!rejected) detail = `${ruleKey} still passed after mutation`;
    }
  } catch (e) {
    detail = e instanceof Error ? e.message : String(e);
  }
  if (rejected) mutantsRejected += 1;
  add(`MUT ${ruleKey} reject: ${label}`, rejected, detail);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  [${r.detail}]` : ""}`);
}
console.log(
  `\nAuthority: public.${RPC}(text, text) · closed set ${CLOSED_SET.join(", ")}`
);
console.log(
  `Seeded INACTIVE: ${CLOSED_SET.map((k) => `${k}->${EXPECTED_IDENTITY[k][0]}#${EXPECTED_IDENTITY[k][1]}`).join(" · ")}`
);
console.log(
  `Excluded: ${EXCLUDED_BUSINESS_KEYS.length} business · ${EXCLUDED_CONSENT_KEYS.length} consent · ` +
    `campaign/marketing surface · ${EXCLUDED_DUPLICATE_PROVIDER_TEMPLATE}`
);
console.log(
  `Predecessors pinned: 80.14A ${SHA_80_14A.slice(0, 12)}… · 40.13B ${SHA_40_13B.slice(0, 12)}…`
);
console.log(
  `SUMMARY assertions=${results.length} passed=${results.length - failed.length} ` +
    `failed=${failed.length} rules=${Object.keys(RULES).length} ` +
    `mutants=${MUTANTS.length} mutants_rejected=${mutantsRejected}`
);
console.log("offline: no database, no network, no provider, no credential, no send");
process.exit(failed.length === 0 ? 0 : 1);
