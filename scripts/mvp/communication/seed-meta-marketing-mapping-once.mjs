// ============================================================================
// QF-MVP-40 — NARROW MARKETING MAPPING AUTHORITY.  DRY RUN BY DEFAULT.
//
//   node scripts/mvp/communication/seed-meta-marketing-mapping-once.mjs
//     -> OFFLINE DRY RUN. Proves the target, the committed evidence and the row it
//        WOULD write. No database write, no network call of any kind.
//
//   … --preflight-readonly
//     -> Reads the existing mapping state and reports whether a create is needed.
//
//   … --execute --owner-authorized-once
//     -> Creates AT MOST ONE INACTIVE mapping row.
//
// WHY A SEPARATE AUTHORITY
//   `seed-meta-staging-inactive-mappings.mjs` is category-specific by construction:
//   `PROVIDER_CATEGORY = "utility"`, a per-template `r.category !== "UTILITY"` refusal and a
//   `provider_category` readback check. Its SEED_SET is fingerprint-pinned and all-or-nothing.
//   Widening it to admit a MARKETING template would weaken a Utility invariant and couple a
//   marketing canary to unrelated Utility work — three of those eight keys are not even
//   creatable yet. The owner therefore chose a SEPARATE narrow authority. The Utility seeder
//   is not modified by this file in any way.
//
// EXACT TARGET — there is no selector of any kind
//   Every field below is a pinned module constant. There is no --template flag, no list, no
//   wildcard, no prefix match and no environment-derived name, so this operator can only ever
//   address `vendor_crm_promotion` / `qf_vendor_crm_promotion_v1` / en / MARKETING.
//
// WHAT IT CANNOT DO — asserted by validate-meta-marketing-mapping-authority.mjs
//   * no Meta call at all: it proves approval from COMMITTED evidence, never from the network;
//   * no /messages, no send, no template create/edit/delete/appeal;
//   * no activation — the row is written `is_active: false` and this operator has no
//     activation path; arming stays with the separately authorized canary CLI;
//   * no acceptance of the four quarantined UTILITY→MARKETING templates;
//   * no second write after an ambiguous one;
//   * no Utility SEED_SET mutation and no `provider_category` change to the Utility seeder.
// ============================================================================

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// PINNED TARGET. Not configurable, not derivable, not overridable.
// ---------------------------------------------------------------------------
export const TARGET_TEMPLATE_KEY = "vendor_crm_promotion";
export const TARGET_PROVIDER_NAME = "qf_vendor_crm_promotion_v1";
export const TARGET_LANGUAGE = "en";
/** The Meta-side category proven on the current WABA. */
export const TARGET_META_CATEGORY = "MARKETING";
/** The mapping-table category. The Utility seeder's "utility" constant is untouched. */
export const MAPPING_PROVIDER_CATEGORY = "marketing";
export const CHANNEL = "whatsapp";
export const PROVIDER_KEY = "meta_whatsapp";
export const EXPECTED_PAYLOAD_FINGERPRINT =
  "87c58dc5b2426f0c863be16ed824b6f4b69674174abfaa10b82498c20163a745";

/**
 * APPROVED by Meta but RECATEGORISED from UTILITY to MARKETING. They are catalogue defects,
 * quarantined and unmappable. Naming them here means a future edit that tried to reuse this
 * marketing authority for one of them is refused BY NAME rather than by omission.
 */
export const REFUSED_QUARANTINED_KEYS = Object.freeze([
  "clarification_reminder",
  "low_credit_warning",
  "vendor_package_expiry_warning",
  "vendor_response_reminder",
]);

const LEDGER = "docs/provider-manifests/meta-template-remote-state.json";
const PACKET = "docs/provider-manifests/meta-template-submission-packet.json";
const RECON_INDEX = "docs/provider-manifests/meta-staging-wave1-batch-reconciliation-evidence.json";

export const Outcome = Object.freeze({
  DRY_RUN: "DRY_RUN",
  ALREADY_MAPPED: "ALREADY_MAPPED",
  WOULD_CREATE: "WOULD_CREATE",
  CREATED_INACTIVE: "CREATED_INACTIVE",
  REFUSED: "REFUSED",
  WRITE_AMBIGUOUS: "WRITE_AMBIGUOUS",
});

export const Refusal = Object.freeze({
  EVIDENCE_MISSING: "evidence_missing",
  NOT_APPROVED: "not_approved",
  CATEGORY_NOT_MARKETING: "category_not_marketing",
  NAME_MISMATCH: "name_mismatch",
  LANGUAGE_MISMATCH: "language_mismatch",
  FINGERPRINT_DRIFT: "fingerprint_drift",
  QUARANTINED_TARGET: "quarantined_target",
  DISPOSITION_NOT_APPROVED_UNMAPPED: "disposition_not_approved_unmapped",
  SEMANTIC_MATCH_ABSENT: "semantic_match_absent",
  MAPPING_CONFLICT: "mapping_conflict",
  ACTIVE_MAPPING_PRESENT: "active_mapping_present",
  NOT_AUTHORIZED: "not_authorized",
});

const bad = (reason) => ({ ok: false, reason });

// ---------------------------------------------------------------------------
// PURE — prove the target from COMMITTED evidence. No network, no database.
// ---------------------------------------------------------------------------
/**
 * Establishes that the committed provider evidence says this exact template is APPROVED
 * with Meta category MARKETING on the current dedicated WABA. Every field is compared
 * against a pinned constant; nothing is read from the environment or from a caller.
 */
export function proveTargetFromEvidence({ ledger, packet, recon }) {
  if (REFUSED_QUARANTINED_KEYS.includes(TARGET_TEMPLATE_KEY)) {
    return bad(Refusal.QUARANTINED_TARGET);          // structurally impossible; fails loud if edited
  }
  if (!ledger || !packet || !recon) return bad(Refusal.EVIDENCE_MISSING);

  const row = (ledger.entries ?? []).find((e) => e.provider_template_name === TARGET_PROVIDER_NAME);
  if (!row) return bad(Refusal.EVIDENCE_MISSING);
  if (row.internal_template_key !== TARGET_TEMPLATE_KEY) return bad(Refusal.NAME_MISMATCH);
  if (row.last_proven_status !== "APPROVED") return bad(Refusal.NOT_APPROVED);
  if (row.last_proven_remote_category !== TARGET_META_CATEGORY) {
    return bad(Refusal.CATEGORY_NOT_MARKETING);
  }
  if (row.current_waba_state !== `PRESENT_APPROVED_${TARGET_META_CATEGORY}`) {
    return bad(Refusal.NOT_APPROVED);
  }
  if (row.disposition !== "APPROVED_UNMAPPED") return bad(Refusal.DISPOSITION_NOT_APPROVED_UNMAPPED);
  if (row.readback_semantic_match !== true) return bad(Refusal.SEMANTIC_MATCH_ABSENT);
  if (row.payload_fingerprint !== EXPECTED_PAYLOAD_FINGERPRINT) return bad(Refusal.FINGERPRINT_DRIFT);

  const pkt = (packet.templates ?? []).find((t) => t.internal_template_key === TARGET_TEMPLATE_KEY);
  if (!pkt) return bad(Refusal.EVIDENCE_MISSING);
  if (pkt.provider_template_name !== TARGET_PROVIDER_NAME) return bad(Refusal.NAME_MISMATCH);
  if (pkt.provider_language !== TARGET_LANGUAGE) return bad(Refusal.LANGUAGE_MISMATCH);
  if (pkt.creation_payload?.category !== TARGET_META_CATEGORY) return bad(Refusal.CATEGORY_NOT_MARKETING);
  if (pkt.payload_fingerprint !== EXPECTED_PAYLOAD_FINGERPRINT) return bad(Refusal.FINGERPRINT_DRIFT);
  const recomputed = createHash("sha256")
    .update(JSON.stringify(pkt.creation_payload)).digest("hex");
  if (recomputed !== EXPECTED_PAYLOAD_FINGERPRINT) return bad(Refusal.FINGERPRINT_DRIFT);

  const approved = (recon.approved ?? []).find((r) => r.provider_template_name === TARGET_PROVIDER_NAME);
  if (!approved) return bad(Refusal.EVIDENCE_MISSING);
  if (approved.remote_status !== "APPROVED") return bad(Refusal.NOT_APPROVED);
  if (approved.returned_category !== TARGET_META_CATEGORY) return bad(Refusal.CATEGORY_NOT_MARKETING);
  if (approved.readback_semantic_match !== true) return bad(Refusal.SEMANTIC_MATCH_ABSENT);

  return { ok: true, remoteTemplateId: row.remote_template_id ?? null };
}

/**
 * The canonical INACTIVE mapping row. `is_active` is a hard-coded false — this operator has
 * no parameter, flag or branch that can make it true.
 */
export function buildMarketingMappingRow() {
  return Object.freeze({
    template_key: TARGET_TEMPLATE_KEY,
    channel: CHANNEL,
    provider_key: PROVIDER_KEY,
    language: TARGET_LANGUAGE,
    version: "1.0",
    provider_template_name: TARGET_PROVIDER_NAME,
    // A mapping never carries the remote id: the ledger owns proven remote state.
    provider_template_id: null,
    provider_category: MAPPING_PROVIDER_CATEGORY,
    approval_status: "approved",
    // Zero-variable template: there is no positional binding and no source key to prove.
    variables_schema: {},
    is_active: false,
  });
}

/** Classify the existing mapping state. An unexpected pre-state is a refusal, never a repair. */
export function classifyExistingMapping(rows) {
  if (!Array.isArray(rows)) return bad(Refusal.EVIDENCE_MISSING);
  const mine = rows.filter((r) => r.template_key === TARGET_TEMPLATE_KEY
    && r.channel === CHANNEL && r.provider_key === PROVIDER_KEY
    && r.language === TARGET_LANGUAGE);
  if (mine.length === 0) return { ok: true, state: "ABSENT" };
  if (mine.length > 1) return bad(Refusal.MAPPING_CONFLICT);
  const r = mine[0];
  if (r.is_active === true) return bad(Refusal.ACTIVE_MAPPING_PRESENT);
  const want = buildMarketingMappingRow();
  if (r.provider_template_name !== want.provider_template_name) return bad(Refusal.NAME_MISMATCH);
  if ((r.provider_category ?? null) !== want.provider_category) return bad(Refusal.MAPPING_CONFLICT);
  return { ok: true, state: "PRESENT_INACTIVE" };
}

/** PURE decision. A write requires BOTH explicit flags; nothing else can reach it. */
export function decide({ execute = false, ownerAuthorized = false, mappingState }) {
  if (mappingState === "PRESENT_INACTIVE") return { write: false, outcome: Outcome.ALREADY_MAPPED };
  if (!execute || !ownerAuthorized) return { write: false, outcome: Outcome.WOULD_CREATE };
  return { write: true, outcome: Outcome.CREATED_INACTIVE };
}

export function parseFlags(argv) {
  const known = new Set(["--preflight-readonly", "--execute", "--owner-authorized-once"]);
  const unknown = argv.filter((a) => !known.has(a));
  return {
    preflight: argv.includes("--preflight-readonly"),
    execute: argv.includes("--execute"),
    ownerAuthorized: argv.includes("--owner-authorized-once"),
    unknown,
  };
}

// ---------------------------------------------------------------------------
// RUNTIME
// ---------------------------------------------------------------------------
const isEntry = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntry) { await main(); }

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  console.log("== QF-MVP-40 narrow MARKETING mapping authority ==");
  if (flags.unknown.length > 0) {
    console.error(`Refusing to run: unknown flag(s) ${flags.unknown.join(", ")}. `
      + "This operator takes no target selector — its target is pinned in source.");
    process.exit(2);
  }
  const mode = flags.execute && flags.ownerAuthorized ? "EXECUTE"
    : flags.preflight ? "PREFLIGHT (read-only)" : "DRY RUN (no database access)";
  console.log(`mode                    : ${mode}`);
  console.log(`target template         : ${TARGET_TEMPLATE_KEY}`);
  console.log(`target provider name    : ${TARGET_PROVIDER_NAME}`);
  console.log(`target Meta category    : ${TARGET_META_CATEGORY}`);
  console.log(`mapping category        : ${MAPPING_PROVIDER_CATEGORY}`);

  const ledger = JSON.parse(readFileSync(resolve(LEDGER), "utf8"));
  const packet = JSON.parse(readFileSync(resolve(PACKET), "utf8"));
  const recon = JSON.parse(readFileSync(resolve(RECON_INDEX), "utf8"));

  const proof = proveTargetFromEvidence({ ledger, packet, recon });
  console.log(`committed evidence proof: ${proof.ok ? "true" : `REFUSED (${proof.reason})`}`);
  if (!proof.ok) {
    console.error(`RESULT: ${Outcome.REFUSED} — ${proof.reason}`);
    process.exit(1);
  }
  console.log(`payload fingerprint     : ${EXPECTED_PAYLOAD_FINGERPRINT}`);
  console.log(`would write is_active   : false`);

  if (!flags.execute && !flags.preflight) {
    console.log("\nrow that WOULD be written:");
    console.log(JSON.stringify(buildMarketingMappingRow(), null, 2));
    console.log(`\nRESULT: ${Outcome.DRY_RUN} — no database access, no network call, nothing written.`);
    console.log("This operator never activates a mapping. Arming stays with the canary CLI.");
    process.exit(0);
  }

  // Preflight and execute both need the database. They are deliberately NOT implemented as
  // a silent fallback: the owner-authorized live path is a separate, separately reviewed
  // step, and this file refuses rather than improvising a connection here.
  console.error("Refusing to run: the read-only preflight and the execute path require an "
    + "owner-authorized staging session that this slice does not open. Source is ready; the "
    + "live step is separately authorized.");
  console.error(`RESULT: ${Outcome.REFUSED} — ${Refusal.NOT_AUTHORIZED}`);
  process.exit(2);
}
