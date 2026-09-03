// ============================================================================
// QF-MVP-80.14A — Meta production activation authority validator.  OFFLINE.
//
// Proves the governed route from `readiness_only` to normal production `active`
// is exactly as narrow as it was reviewed: one hard-coded lane, every switch a
// constant, every precondition present, durable canary proof required, and
// postconditions that roll the call back on any drift.
//
// It reads the ACTUAL migration source and evaluates every rule as a function of
// that text, so each rule can be re-run against a MUTATED copy. That is what the
// self-tests do: they delete or widen a critical clause and require the matching
// rule to flip to false. A rule that cannot fail proves nothing.
//
// No secrets, no Meta, no Supabase, no network, no database, no live change.
// ============================================================================

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const MIGRATION_PATH =
  "supabase/migrations/20260903040000_qf_mvp_80_14a_meta_lead_assignment_production_activation.sql";
const HISTORICAL_40_13B_PATH =
  "supabase/migrations/20260813000000_qf_mvp_40_13b_canary_activation_authority.sql";
const CONTRACT_PATH = "lib/communication/leadAssignmentDispatchContract.ts";
const SERVICE_PATH = "services/leadAssignmentDispatchService.ts";
const CI_PATH = ".github/workflows/qf-mvp-50-quality-gate.yml";

const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const SRC = read(MIGRATION_PATH);
const HISTORICAL = read(HISTORICAL_40_13B_PATH);
const CONTRACT = read(CONTRACT_PATH);
const SERVICE = read(SERVICE_PATH);
const CI = read(CI_PATH);

/**
 * The QF-MVP-40.13B migration is HISTORICAL and must never be edited by a
 * successor. Pinned by canonical (line-ending independent) hash, exactly the way
 * the G1 staging-history governance pins every migration.
 */
const HISTORICAL_40_13B_SHA =
  "517b6ce01e27df8bb32cc473a1fb3d80775ad96190cff71175725ac3053e3a59";

const canonicalBytes = (text) => Buffer.from(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8");

/** The exact RPC identity under review. */
const RPC = "qf_activate_meta_lead_assignment_v1";
const PARAMS = ["p_phone_number_reference", "p_business_account_reference", "p_canary_evidence_digest"];

/** Every value that must be a hard-coded constant, never a parameter. */
const HARD_CODED = [
  ["c_provider", "meta_whatsapp_cloud"],
  ["c_channel", "whatsapp"],
  ["c_template_key", "lead_assignment_alert"],
  ["c_language", "en"],
];

/** Names that must NEVER appear as a caller-supplied parameter. */
const FORBIDDEN_PARAMS = [
  "p_provider", "p_provider_key", "p_channel", "p_template", "p_template_key",
  "p_language", "p_activation_status", "p_activation", "p_outbound",
  "p_outbound_enabled", "p_mapping_id", "p_mapping", "p_destination",
  "p_destination_hash", "p_is_active", "p_status", "p_webhook", "p_health",
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

/** Every named guard the authority must carry. */
const GUARDS = [
  "QF_ACTIVATION_IDENTITY_MALFORMED",
  "QF_ACTIVATION_EVIDENCE_DIGEST_INVALID",
  "QF_ACTIVATION_ACCOUNT_NOT_EXACTLY_ONE",
  "QF_ACTIVATION_ACCOUNT_NOT_FOUND",
  "QF_ACTIVATION_ACCOUNT_IDENTITY_CONFLICT",
  "QF_ACTIVATION_READINESS_NOT_PROVEN",
  "QF_ACTIVATION_POLICY_MISSING",
  "QF_ACTIVATION_POLICY_NOT_IN_READINESS",
  "QF_ACTIVATION_POLICY_ALREADY_SENDING",
  "QF_ACTIVATION_POLICY_OBSERVABILITY_OFF",
  "QF_ACTIVATION_ACTIVE_CANARY_PRESENT",
  "QF_ACTIVATION_ACTIVE_MAPPING_PRESENT",
  "QF_ACTIVATION_MAPPING_NOT_EXACTLY_ONE",
  "QF_ACTIVATION_MAPPING_NOT_APPROVED",
  "QF_ACTIVATION_MAPPING_ALREADY_ACTIVE",
  "QF_ACTIVATION_MAPPING_TEMPLATE_NAME_MISSING",
  "QF_ACTIVATION_NO_RECENT_DELIVERED_MESSAGE",
  "QF_ACTIVATION_PROOF_NOT_CANARY_BOUND",
  "QF_ACTIVATION_DELIVERY_EVENT_MISSING",
  "QF_ACTIVATION_SIGNED_WEBHOOK_PROOF_MISSING",
  "QF_ACTIVATION_POSTURE_INVARIANT",
  "QF_ACTIVATION_ACTIVE_MAPPING_COUNT_INVARIANT",
  "QF_ACTIVATION_ACTIVE_MAPPING_IDENTITY_INVARIANT",
  "QF_ACTIVATION_CANARY_INVARIANT",
  "QF_ACTIVATION_ACCOUNT_READINESS_INVARIANT",
];

/** Templates that must remain unreachable from this authority. */
const OTHER_TEMPLATES = [
  "lead_received", "client_lead_status_update", "client_matching_update",
  "vendor_onboarding_reminder", "consent_stop_acknowledgement",
  "consent_start_acknowledgement", "consent_help_response",
];

// ---------------------------------------------------------------------------
// REGIONS — mention is not assignment.
//
// The migration's own self-verification block deliberately NAMES the things it
// forbids: it greps its own function definition for `p_template_key`, for
// `lead_received`, for `communication_intents`, for `activation_status in
// ('canary','active')`. A whole-file containment check would therefore be
// satisfied by the very guards that exist to refuse those things — and, worse,
// would keep passing after the real clause was deleted, because the guard's
// mention survives. QF-MVP-40.13B hit exactly this and documented it in its §5.2.
//
// So every containment and precondition rule is evaluated against a REGION:
//
//   fn(s)     the authority's body only — no preflight, no self-verification
//   pre(s)    fn up to the writes, i.e. every precondition
//   sel(s)    the ONE proof selection that must satisfy clauses 12+13+14 together
//   post(s)   fn from the writes onward, i.e. every postcondition
//
// A missing marker yields "", so a rule fails closed rather than throwing.
// ---------------------------------------------------------------------------

const WRITES_MARKER = "==== THE ONLY WRITES ====";

function between(source, startNeedle, endNeedle, fromIndex = 0) {
  const start = source.indexOf(startNeedle, fromIndex);
  if (start === -1) return "";
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  if (end === -1) return "";
  return source.slice(start, end);
}

/** The authority's body: signature through the closing dollar-quote. */
const fn = (s) => between(s, `create or replace function public.${RPC}(`, "\n$$;");
/** Preconditions: everything before the first write. */
const pre = (s) => {
  const body = fn(s);
  const cut = body.indexOf(WRITES_MARKER);
  return cut === -1 ? body : body.slice(0, cut);
};
/** The single proof selection. Clauses 12, 13 and 14 must live here together. */
const sel = (s) => between(fn(s), "select m.* into v_proof", "limit 1;");
/** Postconditions: everything from the writes onward. */
const post = (s) => {
  const body = fn(s);
  const cut = body.indexOf(WRITES_MARKER);
  return cut === -1 ? "" : body.slice(cut);
};

// ---------------------------------------------------------------------------
// RULES — each is a pure function of the migration source, so each can be
// re-evaluated against a mutated copy.
// ---------------------------------------------------------------------------

const RULES = {
  // ---- A. exact RPC name and signature ------------------------------------
  "A01 the RPC name and three-parameter signature are exact": (s) =>
    new RegExp(
      `create or replace function public\\.${RPC}\\(\\s*` +
        `${PARAMS[0]} text,\\s*${PARAMS[1]} text,\\s*${PARAMS[2]} text\\s*\\)`
    ).test(s),
  "A02 the grant and comment name the same three-text signature": (s) =>
    new RegExp(`grant execute on function public\\.${RPC}\\(text, text, text\\)\\s*\\n?\\s*to service_role;`).test(s) &&
    new RegExp(`comment on function public\\.${RPC}\\(text, text, text\\) is`).test(s),
  "A03 the authority declares plpgsql / SECURITY DEFINER / pinned search_path": (s) =>
    /language plpgsql\s*\nsecurity definer\s*\nset search_path = pg_catalog, public, pg_temp/.test(s),

  // ---- B. hard-coded production scope --------------------------------------
  "B01 provider, channel, template key and language are hard-coded constants": (s) =>
    HARD_CODED.every(([name, value]) =>
      new RegExp(`${name}\\s+constant text := '${value}';`).test(s)
    ),
  "B02 the proof window is a hard-coded bounded interval": (s) =>
    /c_proof_window\s+constant interval := interval '24 hours';/.test(s),

  // ---- C. nothing dangerous is caller-controlled ---------------------------
  "C01 no provider/channel/template/language/status/outbound/mapping/destination parameter exists": (s) =>
    FORBIDDEN_PARAMS.every((p) => !new RegExp(`\\b${p}\\b`).test(fn(s))),
  "C02 the parameter list is exactly the three reviewed values": (s) => {
    const m = new RegExp(
      `create or replace function public\\.${RPC}\\(([^)]*)\\)`
    ).exec(s);
    if (!m) return false;
    const names = [...m[1].matchAll(/(p_[a-z_]+)\s+text/g)].map((x) => x[1]);
    return JSON.stringify(names) === JSON.stringify(PARAMS);
  },
  "C03 the evidence digest is format-checked and never treated as proof": (s) =>
    /p_canary_evidence_digest !~ '\^\[0-9a-f\]\{64\}\$'/.test(s) &&
    /AUDIT ONLY/i.test(s),

  // ---- D. prior state must be readiness_only + outbound false ---------------
  "D01 activation requires the readiness_only posture with outbound off": (s) =>
    /v_policy\.activation_status <> 'readiness_only'/.test(pre(s)) &&
    /QF_ACTIVATION_POLICY_NOT_IN_READINESS/.test(pre(s)) &&
    /v_policy\.outbound_enabled is true/.test(pre(s)) &&
    /QF_ACTIVATION_POLICY_ALREADY_SENDING/.test(pre(s)),
  "D02 activation additionally requires webhook + health observability already on": (s) =>
    /v_policy\.webhook_processing_enabled is not true/.test(pre(s)) &&
    /v_policy\.health_check_enabled is not true/.test(pre(s)) &&
    /QF_ACTIVATION_POLICY_OBSERVABILITY_OFF/.test(pre(s)),
  "D03 `canary` is NOT a permitted prior state": (s) =>
    // the only accepted prior status is the readiness_only equality above; there
    // is no branch admitting 'canary' as a starting posture.
    !/activation_status\s*(=|in)\s*\(?'canary'/.test(fn(s).replace(/^\s*--.*$/gm, "")),

  // ---- E. the six readiness checks -----------------------------------------
  "E01 all six durable provider-readiness values are required": (s) =>
    READINESS.every(([field, value]) => new RegExp(`${field} <> '${value}'`).test(pre(s))) &&
    /QF_ACTIVATION_READINESS_NOT_PROVEN/.test(pre(s)),
  "E02 readiness is never written by this authority": (s) =>
    !/update public\.communication_provider_accounts/.test(fn(s)),

  // ---- F/G. clean base ------------------------------------------------------
  "F01 zero ACTIVE canary destinations are required before activation": (s) =>
    /from public\.communication_provider_canary_destinations\s*\n\s*where provider_key = c_provider and channel = c_channel and is_active;[\s\S]{0,120}QF_ACTIVATION_ACTIVE_CANARY_PRESENT/.test(pre(s)),
  "G01 zero pre-existing ACTIVE mappings are required before activation": (s) =>
    /from public\.communication_provider_template_mappings\s*\n\s*where provider_key = c_provider and channel = c_channel and is_active;[\s\S]{0,120}QF_ACTIVATION_ACTIVE_MAPPING_PRESENT/.test(pre(s)),

  // ---- H. only lead_assignment_alert can be activated ----------------------
  "H01 exactly one approved, inactive lead_assignment_alert mapping is required": (s) =>
    /language = c_language and template_key = c_template_key/.test(pre(s)) &&
    /QF_ACTIVATION_MAPPING_NOT_EXACTLY_ONE/.test(pre(s)) &&
    /v_mapping\.approval_status <> 'approved'/.test(pre(s)) &&
    /v_mapping\.is_active is true/.test(pre(s)) &&
    /v_mapping\.provider_template_name is null/.test(pre(s)),
  "H02 the mapping activation is addressed by the resolved id only": (s) =>
    /update public\.communication_provider_template_mappings\s*\n\s*set is_active = true, updated_at = now\(\)\s*\n\s*where id = v_mapping\.id;/.test(s),
  "T01 no other template key appears anywhere in the authority": (s) =>
    OTHER_TEMPLATES.every((t) => !fn(s).includes(t)),

  // ---- I/J/K/L. durable canary proof ---------------------------------------
  // Clauses 12/13/14 are asserted on the ONE proof selection (`sel`), never on
  // the whole file: the diagnostic block below the selection legitimately
  // repeats these predicates to tell an operator WHICH proof is missing, and a
  // whole-file check would keep passing after the real selection was gutted.
  "I01 a recent delivered/read message on the exact account is required": (s) =>
    /m\.provider_account_id = v_account\.id/.test(sel(s)) &&
    /m\.template_key = c_template_key/.test(sel(s)) &&
    /m\.status in \('delivered', 'read'\)/.test(sel(s)) &&
    /m\.delivered_at is not null/.test(sel(s)) &&
    /m\.provider_message_id is not null/.test(sel(s)) &&
    /m\.created_at >= now\(\) - c_proof_window/.test(sel(s)),
  "J01 the proof message destination must bind to a historical canary destination": (s) =>
    /d\.destination_hash = m\.destination_hash/.test(sel(s)) &&
    /d\.created_at <= m\.created_at/.test(sel(s)) &&
    /d\.expires_at >= m\.created_at/.test(sel(s)) &&
    /QF_ACTIVATION_PROOF_NOT_CANARY_BOUND/.test(pre(s)),
  "J02 the canary binding does NOT require the row to still be active": (s) =>
    // shutdown deactivates it; requiring is_active would only pass with the
    // canary still open, which is the opposite of a safe rollout.
    !/d\.is_active/.test(fn(s)),
  "K01 an exact delivery event for that message and provider message id is required": (s) =>
    /e\.communication_message_id = m\.id/.test(sel(s)) &&
    /e\.provider_message_id = m\.provider_message_id/.test(sel(s)) &&
    /e\.normalized_event_type in \('delivered', 'read'\)/.test(sel(s)) &&
    /QF_ACTIVATION_DELIVERY_EVENT_MISSING/.test(pre(s)),
  "L01 a signed, successfully processed webhook receipt is required": (s) =>
    /w\.provider_account_id = v_account\.id/.test(pre(s)) &&
    /w\.signature_valid is true/.test(pre(s)) &&
    /w\.processing_status = 'processed'/.test(pre(s)) &&
    /w\.normalized_event_type in \('delivered', 'read'\)/.test(pre(s)) &&
    /w\.received_at >= now\(\) - c_proof_window/.test(pre(s)) &&
    /QF_ACTIVATION_SIGNED_WEBHOOK_PROOF_MISSING/.test(pre(s)),
  "L02 all three proof clauses are satisfied by ONE message, not split": (s) =>
    // clause 13 and 14 are EXISTS predicates inside the same selection that
    // establishes clause 12, so a message passing one and failing another can
    // never be combined with a different candidate.
    /select m\.\* into v_proof[\s\S]*?and exists \([\s\S]*?communication_provider_canary_destinations[\s\S]*?\)[\s\S]*?and exists \([\s\S]*?communication_delivery_events[\s\S]*?\)[\s\S]*?limit 1;/.test(s),

  // ---- M. the target posture ------------------------------------------------
  "M01 the written posture is exactly active + outbound + webhook + health": (s) =>
    /set activation_status = 'active',\s*\n\s*outbound_enabled = true,\s*\n\s*webhook_processing_enabled = true,\s*\n\s*health_check_enabled = true,/.test(s),
  "M02 only the resolved policy row is written": (s) =>
    /update public\.communication_provider_runtime_policies[\s\S]{0,240}?where id = v_policy\.id/.test(s),

  // ---- N/O. postconditions --------------------------------------------------
  // Postconditions are asserted on `post` — after the writes — so deleting a
  // real invariant cannot be masked by the guard's name surviving in the
  // migration's own self-verification list.
  "N01 a postcondition asserts exactly one active mapping, and its identity": (s) =>
    /QF_ACTIVATION_ACTIVE_MAPPING_COUNT_INVARIANT/.test(post(s)) &&
    /QF_ACTIVATION_ACTIVE_MAPPING_IDENTITY_INVARIANT/.test(post(s)) &&
    /and template_key = c_template_key and language = c_language/.test(post(s)),
  "O01 a postcondition asserts zero active canary destinations": (s) =>
    /QF_ACTIVATION_CANARY_INVARIANT/.test(post(s)),
  "O02 a postcondition asserts the posture and the untouched account readiness": (s) =>
    /QF_ACTIVATION_POSTURE_INVARIANT/.test(post(s)) &&
    /QF_ACTIVATION_ACCOUNT_READINESS_INVARIANT/.test(post(s)),
  "O03 every named guard is present": (s) => GUARDS.every((g) => fn(s).includes(g)),

  // ---- P. grants -------------------------------------------------------------
  "P01 execute is revoked from public/anon/authenticated/service_role first": (s) =>
    new RegExp(
      `revoke all on function public\\.${RPC}\\(text, text, text\\)\\s*\\n\\s*from public, anon, authenticated, service_role;`
    ).test(s),
  "P02 execute is granted ONLY to service_role": (s) => {
    const grants = [...s.matchAll(/grant execute on function[\s\S]*?to ([a-z_, ]+);/g)].map((m) => m[1].trim());
    return grants.length === 1 && grants[0] === "service_role";
  },
  "P03 no browser role gains any capability": (s) =>
    !/to anon/.test(s) && !/to authenticated/.test(s) && !/to public;/.test(s),

  // ---- Q. no network / no send ----------------------------------------------
  "Q01 no network extension or HTTP/Meta call is introduced": (s) =>
    !/create extension/i.test(s) &&
    !/pg_net\s*\(|http_post|http_get|dblink\s*\(/i.test(s) &&
    !/graph\.facebook/.test(s) &&
    !/https?:\/\//.test(s) &&
    // the migration REFUSES to run if a network extension is present
    /pg_extension where extname in \('pg_net', 'http', 'dblink'\)/.test(s),
  "Q02 the authority writes NO communication row and no assignment/credit row": (s) =>
    !/insert into public\.communication_messages/.test(fn(s)) &&
    !/update public\.communication_messages/.test(fn(s)) &&
    !/insert into public\.communication_intents/.test(fn(s)) &&
    !/update public\.communication_intents/.test(fn(s)) &&
    !/insert into public\.communication_delivery_events/.test(fn(s)) &&
    !/update public\.lead_assignments/.test(fn(s)) &&
    !/update public\.vendors/.test(fn(s)) &&
    !/vendor_credit|remaining_credits|credit_ledger/.test(fn(s)),
  "Q03 the authority writes NO canary destination": (s) =>
    !/insert into public\.communication_provider_canary_destinations/.test(fn(s)) &&
    !/update public\.communication_provider_canary_destinations/.test(fn(s)),
  "Q04 exactly two write statements exist, on the two intended tables": (s) => {
    const body = s.slice(s.indexOf(`create or replace function public.${RPC}`), s.indexOf("$$;"));
    const writes = [...body.matchAll(/^\s*(insert into|update) public\.([a-z_]+)/gm)].map((m) => m[2]);
    return (
      writes.length === 2 &&
      writes.includes("communication_provider_template_mappings") &&
      writes.includes("communication_provider_runtime_policies")
    );
  },

  // ---- R. historical migration untouched -------------------------------------
  "R01 the historical 40.13B migration is byte-identical to its pinned hash": () =>
    sha256(canonicalBytes(HISTORICAL)) === HISTORICAL_40_13B_SHA,
  // Not "the literal never appears": 40.13B's own §5.2 self-verification names
  // that assignment in order to REFUSE it. What must hold is that the guard is
  // still there and no arm function actually performs the assignment.
  "R02 the 40.13B arm/disable functions still cannot assign active": () =>
    /aborted: % assigns activation_status=active/.test(HISTORICAL) &&
    ["qf_arm_meta_provider_readiness_v1", "qf_arm_meta_canary_v1", "qf_disable_meta_canary_v1"].every(
      (name) => {
        const body = HISTORICAL.slice(
          HISTORICAL.indexOf(`create or replace function public.${name}`),
          HISTORICAL.indexOf(`comment on function public.${name}`)
        );
        return body.length > 0 && !/activation_status = 'active'/.test(body);
      }
    ),
  "R03 this migration creates a NEW function and redefines none of 40.13B's": (s) => {
    const created = [...s.matchAll(/create or replace function public\.([a-z0-9_]+)\(/g)].map((m) => m[1]);
    return (
      created.length === 1 &&
      created[0] === RPC &&
      !created.includes("qf_arm_meta_provider_readiness_v1") &&
      !created.includes("qf_arm_meta_canary_v1") &&
      !created.includes("qf_disable_meta_canary_v1")
    );
  },

  // ---- Emergency shutdown ------------------------------------------------------
  "X01 qf_disable_meta_canary_v1 closes an ACTIVE posture unconditionally": () => {
    const fn = HISTORICAL.slice(
      HISTORICAL.indexOf("create or replace function public.qf_disable_meta_canary_v1"),
      HISTORICAL.indexOf("comment on function public.qf_disable_meta_canary_v1")
    );
    return (
      // it takes NO argument and NO attestation
      /create or replace function public\.qf_disable_meta_canary_v1\(\)/.test(fn) &&
      // the policy write is an UNCONDITIONAL upsert: no prior-state branch gates it,
      // so `active` closes exactly as `canary` does
      /on conflict \(provider_key, channel\) do update\s*\n\s*set activation_status = 'disabled',\s*\n\s*outbound_enabled = false,/.test(fn) &&
      !/activation_status <> 'readiness_only'/.test(fn) &&
      !/QF_CANARY_POLICY_NOT_IN_READINESS/.test(fn) &&
      !/QF_CANARY_READINESS_NOT_PROVEN/.test(fn)
    );
  },
  "X02 shutdown closes mappings, destinations and account send-capability": () => {
    const fn = HISTORICAL.slice(
      HISTORICAL.indexOf("create or replace function public.qf_disable_meta_canary_v1"),
      HISTORICAL.indexOf("comment on function public.qf_disable_meta_canary_v1")
    );
    return (
      /update public\.communication_provider_canary_destinations\s*\n\s*set is_active = false/.test(fn) &&
      /update public\.communication_provider_template_mappings\s*\n\s*set is_active = false/.test(fn) &&
      /update public\.communication_provider_accounts\s*\n\s*set readiness_status = 'disabled'/.test(fn) &&
      /QF_CANARY_DISABLE_INCOMPLETE/.test(fn)
    );
  },
  "X03 this phase adds NO second shutdown framework": (s) =>
    !/disable|shutdown|rollback/i.test(
      [...s.matchAll(/create or replace function public\.([a-z0-9_]+)\(/g)].map((m) => m[1]).join(" ")
    ),
  "X04 the migration re-verifies the shutdown is intact before committing": (s) =>
    /qf_disable_meta_canary_v1/.test(s) &&
    /the emergency shutdown was weakened/.test(s) &&
    /the emergency shutdown is no longer an unconditional upsert/.test(s),

  // ---- S. the lead-assignment activation boundary is untouched ------------------
  "S01 the QF-MVP-80.13A activation boundary is not widened by this phase": (s) =>
    !/lead_assignment_dispatch_activation/.test(s) &&
    !/activationNotBefore/.test(s) &&
    !/automation_policy_configs/.test(s) &&
    !/automation_policy_active_configs/.test(s) &&
    // and the boundary contract itself still holds its strict identity
    /LEAD_ASSIGNMENT_ACTIVATION_POLICY_KEY =\s*\n?\s*"lead_assignment_dispatch_activation"/.test(CONTRACT) &&
    /\.gt\("created_at", boundary\.notBeforeIso\)/.test(SERVICE),
  "S02 the six historical lead_assignment intents are unreachable from this phase": (s) =>
    !/communication_intents/.test(fn(s)) &&
    !/vendor_lead_assigned/.test(fn(s)) &&
    // the whole migration never selects, updates or deletes an intent row
    !/from public\.communication_intents|into public\.communication_intents/.test(s),

  // ---- Governance --------------------------------------------------------------
  "Z01 the migration is forward-only and edits no historical file": (s) =>
    !/drop function/i.test(s) &&
    !/drop table/i.test(s) &&
    !/alter table/i.test(s) &&
    !/drop trigger/i.test(s) &&
    !/create table/i.test(s),
  "Z02 the migration is wrapped in one explicit transaction": (s) =>
    /^begin;$/m.test(s) && /^commit;$/m.test(s),
  "Z03 applying the migration arms nothing": (s) =>
    /a sendable runtime policy exists/.test(s) &&
    /an active canary destination exists/.test(s) &&
    /an active template mapping exists/.test(s),
  "Z04 the switch tables stay RPC-only for writes": (s) =>
    /became directly writable by service_role/.test(s) &&
    !/grant insert|grant update/.test(s),
  "Z05 CI runs this validator at the exact head": () =>
    /QF-MVP-80\.14A Meta production activation authority/.test(CI) &&
    /npm run test:mvp:80-14a/.test(CI),
  "Z06 no existing CI step was removed": () => {
    const required = [
      "npm run test:mvp:40-4", "npm run test:mvp:40-10a", "npm run test:mvp:40-11",
      "npm run test:mvp:40-12-r1", "npm run test:mvp:50-1a", "npm run test:mvp:50-1b",
      "npm run test:mvp:50-1c", "npm run test:mvp:50-2a", "npm run test:mvp:50-2b",
      "npm run test:mvp:50-2c", "npm run test:mvp:50-2c-s2-g1", "npm run test:mvp:50-2d",
      "npm run test:mvp:50-2e", "npm run test:mvp:50-2-final", "npm run test:mvp:50-3",
      "npm run test:mvp:50-4", "npm run test:mvp:50-5", "npm run test:mvp:50-3-50-4-bridge",
      "npm run test:mvp:50-3-50-4-forensic", "npm run test:mvp:50-3-50-4-cert",
      "npm run test:mvp:70-01", "npm run test:mvp:70-02", "npm run test:mvp:70-03",
      "npm run test:mvp:70-04", "npm run test:mvp:75-01", "npm run test:mvp:75-02",
      "npm run test:mvp:75-03", "npm run test:mvp:80-02-gate06",
      "npm run test:mvp:80-03-audit", "npm run test:mvp:80-04",
      "npm run test:mvp:marketplace", "npm run test:mvp:assignment-authority",
      "npm run test:phase4", "npm run typecheck", "npm run build",
    ];
    return required.every((step) => CI.includes(step));
  },
  "Z07 exactly one migration is added by this phase and it is the newest": () => {
    const files = readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    return (
      files.length === 103 &&
      files[files.length - 1] === path.basename(MIGRATION_PATH) &&
      files.filter((f) => f.includes("80_14a")).length === 1
    );
  },
};

// ---------------------------------------------------------------------------
// MUTATION SELF-TESTS — each removes or widens a critical clause and requires
// the named rule to FLIP TO FALSE. A rule that survives its mutation is a rule
// that proves nothing.
// ---------------------------------------------------------------------------

const MUTANTS = [
  ["B01", "provider is made caller-controlled",
    (s) => s.replace("c_provider     constant text := 'meta_whatsapp_cloud';", "c_provider     text := p_provider_key;")],
  ["B01", "the template key is widened to another template",
    (s) => s.replace("c_template_key constant text := 'lead_assignment_alert';", "c_template_key constant text := 'lead_received';")],
  ["C01", "a caller-supplied template key parameter is added",
    (s) => s.replace("p_canary_evidence_digest text", "p_canary_evidence_digest text, p_template_key text")],
  ["C02", "the signature gains a fourth parameter",
    (s) => s.replace(
      "p_canary_evidence_digest text\n)",
      "p_canary_evidence_digest text,\n  p_outbound_enabled text\n)")],
  ["B02", "the proof window is widened to a year",
    (s) => s.replace("interval '24 hours'", "interval '365 days'")],
  ["D01", "the readiness_only prior-state CAS is removed",
    (s) => s.replace(/if v_policy\.activation_status <> 'readiness_only' then[\s\S]*?end if;\n/, "")],
  ["D02", "the observability precondition is removed",
    (s) => s.replace(/if v_policy\.webhook_processing_enabled is not true[\s\S]*?end if;\n/, "")],
  ["E01", "one readiness field (health) is dropped",
    (s) => s.replace(" or v_account.health_status <> 'healthy' then", " then")],
  ["E02", "the authority starts writing provider readiness",
    (s) => s.replace(
      "  update public.communication_provider_template_mappings\n     set is_active = true",
      "  update public.communication_provider_accounts set health_status = 'healthy' where id = v_account.id;\n  update public.communication_provider_template_mappings\n     set is_active = true")],
  ["F01", "the zero-active-canary precondition is removed",
    (s) => s.replace(/  select count\(\*\)::integer into v_count\n    from public\.communication_provider_canary_destinations\n   where provider_key = c_provider and channel = c_channel and is_active;\n  if v_count <> 0 then\n    raise exception 'QF_ACTIVATION_ACTIVE_CANARY_PRESENT'[\s\S]*?end if;\n/, "")],
  ["G01", "the zero-pre-existing-active-mapping precondition is removed",
    (s) => s.replace(/  select count\(\*\)::integer into v_count\n    from public\.communication_provider_template_mappings\n   where provider_key = c_provider and channel = c_channel and is_active;\n  if v_count <> 0 then\n    raise exception 'QF_ACTIVATION_ACTIVE_MAPPING_PRESENT'[\s\S]*?end if;\n/, "")],
  ["H01", "the mapping approval requirement is dropped",
    (s) => s.replace("if v_mapping.approval_status <> 'approved' then", "if false then")],
  ["I01", "the delivered/read status requirement is widened to any status",
    (s) => s.replace("and m.status in ('delivered', 'read')\n     and m.delivered_at is not null", "and m.delivered_at is not null")],
  ["I01", "the recency window is dropped from the proof selection",
    (s) => s.replace("     and m.created_at >= now() - c_proof_window\n", "")],
  ["J01", "the canary-destination binding is dropped",
    (s) => s.replace(/     and exists \(\n       select 1 from public\.communication_provider_canary_destinations d[\s\S]*?\n     \)\n/, "")],
  ["J02", "the canary binding is made to require a still-ACTIVE destination",
    (s) => s.replace("          and d.created_at <= m.created_at", "          and d.is_active\n          and d.created_at <= m.created_at")],
  ["K01", "the delivery-event proof is dropped",
    (s) => s.replace(/     and exists \(\n       select 1 from public\.communication_delivery_events e[\s\S]*?\n     \)\n/, "")],
  ["L01", "the webhook signature requirement is dropped",
    (s) => s.replace("       and w.signature_valid is true\n", "")],
  ["L01", "the webhook processing-status requirement is dropped",
    (s) => s.replace("       and w.processing_status = 'processed'\n", "")],
  ["M01", "the target posture is silently left non-sending",
    (s) => s.replace("set activation_status = 'active',\n         outbound_enabled = true,", "set activation_status = 'readiness_only',\n         outbound_enabled = false,")],
  ["N01", "the exactly-one-active-mapping postcondition is removed",
    (s) => s.replace("QF_ACTIVATION_ACTIVE_MAPPING_COUNT_INVARIANT", "QF_REMOVED")],
  ["O01", "the zero-active-canary postcondition is removed",
    (s) => s.replace("QF_ACTIVATION_CANARY_INVARIANT", "QF_REMOVED")],
  ["P02", "execute is also granted to authenticated",
    (s) => s.replace("  to service_role;", "  to service_role, authenticated;")],
  ["P03", "anon is granted the activation capability",
    (s) => s + "\ngrant execute on function public.qf_activate_meta_lead_assignment_v1(text, text, text) to anon;\n"],
  ["Q01", "a network extension is introduced",
    (s) => s.replace("begin;", "begin;\ncreate extension if not exists pg_net;")],
  ["Q03", "the authority arms a canary destination",
    (s) => s.replace(
      "  update public.communication_provider_runtime_policies\n     set activation_status = 'active',",
      "  insert into public.communication_provider_canary_destinations (provider_key, channel, destination_hash) values (c_provider, c_channel, 'x');\n  update public.communication_provider_runtime_policies\n     set activation_status = 'active',")],
  ["Q04", "a third write statement is added",
    (s) => s.replace(
      "  update public.communication_provider_runtime_policies\n     set activation_status = 'active',",
      "  update public.communication_messages set status = 'read' where id = v_proof.id;\n  update public.communication_provider_runtime_policies\n     set activation_status = 'active',")],
  ["T01", "another template becomes reachable",
    (s) => s.replace("template_key = c_template_key;", "template_key in (c_template_key, 'client_matching_update');")],
  ["S01", "the lead-assignment activation boundary is touched",
    (s) => s.replace("begin;", "begin;\n-- lead_assignment_dispatch_activation widened here")],
  ["S02", "the authority starts reading communication intents",
    (s) => s.replace(
      "  -- ==== THE ONLY WRITES ====",
      "  select count(*)::integer into v_count from public.communication_intents\n   where aggregate_type = 'lead_assignment';\n\n  -- ==== THE ONLY WRITES ====")],
  ["Z01", "the migration edits schema instead of adding a function",
    (s) => s.replace("begin;", "begin;\nalter table public.communication_provider_runtime_policies add column x text;")],
  ["Z04", "a direct write grant is restored on a switch table",
    (s) => s.replace("grant execute on function", "grant insert on public.communication_provider_runtime_policies to service_role;\ngrant execute on function")],
  ["R03", "the historical 40.13B disable function is redefined here",
    (s) => s.replace("create or replace function public.qf_activate_meta_lead_assignment_v1(", "create or replace function public.qf_disable_meta_canary_v1(")],
];

// ---------------------------------------------------------------------------

const results = [];
const add = (name, ok, detail) => results.push({ name, ok: ok === true, detail: detail ?? "" });

for (const [name, fn] of Object.entries(RULES)) {
  let ok = false;
  let detail = "";
  try {
    ok = fn(SRC) === true;
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
      // The rule MUST flip to false on the mutated source.
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
  `\nAuthority: public.${RPC}(text, text, text) · scope hard-coded to ` +
    `${HARD_CODED.map(([, v]) => v).join(" / ")} · proof window 24h`
);
console.log(
  `Guards: ${GUARDS.length} · other templates held unreachable: ${OTHER_TEMPLATES.length} · ` +
    `40.13B pinned sha ${HISTORICAL_40_13B_SHA.slice(0, 12)}…`
);
console.log(
  `SUMMARY assertions=${results.length} passed=${results.length - failed.length} ` +
    `failed=${failed.length} rules=${Object.keys(RULES).length} ` +
    `mutants=${MUTANTS.length} mutants_rejected=${mutantsRejected}`
);
process.exit(failed.length === 0 ? 0 : 1);
