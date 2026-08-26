// ============================================================================
// QF-MVP-40-R8C — ONE-SHOT governed creation of the REMAINING SEVEN canonical seed
// templates on the ACTUAL dedicated staging WABA.  DRY RUN BY DEFAULT.
//
//   node scripts/mvp/communication/create-actual-staging-remaining-seven-once.mjs
//     -> DRY RUN. Runs the COMPLETE preflight for all seven and reports what it would
//        post. Zero Meta mutation.
//
//   … --execute --owner-authorized-once-actual-staging-seven-create
//     -> Performs AT MOST SEVEN create POSTs, at most ONE per target, sequentially,
//        stopping permanently at the first outcome that is not a proven clean success.
//
// WHY THIS EXISTS
//   QF-MVP-40-R8B created `qf_vendor_onboarding_reminder_v1` on the actual staging WABA
//   with exactly one POST, and GET-only reconciliation later proved it APPROVED / UTILITY
//   / en. A GET-only truth sweep then proved the other SEVEN canonical seed templates are
//   ABSENT from that WABA. R8B's authority is SPENT and is neither reopened nor repointed
//   here; this is a NEW authority with its OWN acknowledgement flag and its OWN manifest.
//
// THE TARGET SET IS DERIVED, NOT RE-DECLARED
//   TARGETS is computed from the committed SEED_SET by excluding the R8B anchor. Nothing
//   about a template's name, language, category or payload is restated in this file, so
//   the seven cannot drift from the canonical catalogue, and there is no place here where
//   an eighth target could be introduced by editing a local list.
//
// HISTORICAL PACKET STATE IS NOT REMOTE TRUTH
//   The packet carries `submit_now`, `local_state.approval_status` and historical
//   `provider_template_id` values that originate from the pre-R8 MIXED IDENTITY period.
//   This operator reads NONE of them. It uses the packet ONLY as the canonical payload
//   contract, and it derives every existence/status fact from fresh live GETs against the
//   actual staging WABA.
//
// WHAT IT CANNOT DO — enforced below and asserted by the validator
//   * no messaging/send endpoint;    * no DELETE / PUT / PATCH;
//   * no database or Supabase access; * no mapping / readiness / canary / webhook authority;
//   * no template selector, no --target flag, no arbitrary name input;
//   * no loop around a mutation, no retry, ever;
//   * no continuation after a rejection, an ambiguity or a failed readback.
//
// CREATION IS NOT APPROVAL. A clean create commonly reads back PENDING. This operator
// never claims APPROVED, and activates nothing.
// ============================================================================

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  classifyCreateResponse,
  safeMetaError,
  templatesAreIdentical,
  CreateClassification,
} from "./submit-meta-templates.mjs";
// The audited R7B transport. `createOnce` throws rather than posting a second time, which
// is what makes ONE-POST-PER-TARGET structural rather than merely intended.
import { makeHttp } from "./create-meta-staging-vendor-onboarding-reminder-once.mjs";
// The R8B / R8B-R1 PURE asset layer, already reviewed and merged. Imported, never copied:
// a weaker second copy of an asset-scope proof is exactly how a fence quietly diverges.
import {
  ADVISORY_PHONE_FIELDS,
  INTENDED_STAGE,
  proveAssets,
  readLiveAssets,
  validateIdentity,
} from "./create-actual-staging-vendor-onboarding-reminder-once.mjs";
import {
  STAGING_ASSET_PROOF_ENV,
  buildStagingAssetProofAdapter,
  resolveGitHead,
} from "./activate-meta-staging-canary.mjs";
import { AUTHORIZED_STAGING_REF, SEED_SET } from "./seed-meta-staging-inactive-mappings.mjs";

export { ADVISORY_PHONE_FIELDS, INTENDED_STAGE, makeHttp, proveAssets, readLiveAssets,
         validateIdentity };

const PACKET = "docs/provider-manifests/meta-template-submission-packet.json";

/**
 * The exact acknowledgement flag. Deliberately DIFFERENT from every flag already spent:
 * R7B's `--owner-authorized-once`, R7C's `--owner-authorized-once-rebind`, R8A's
 * `--owner-authorized-once-identity-repair` and R8B's
 * `--owner-authorized-once-actual-staging-create`. A consumed acknowledgement must never
 * authorise a different authority.
 */
export const OWNER_ACK_FLAG = "--owner-authorized-once-actual-staging-seven-create";
export const EXECUTE_FLAG = "--execute";
export const KNOWN_FLAGS = Object.freeze([EXECUTE_FLAG, OWNER_ACK_FLAG]);

/** The R8B result, which anchors this run to the WABA where R8B actually succeeded. */
export const ANCHOR_KEY = "vendor_onboarding_reminder";
export const ANCHOR_REQUIRED_STATUS = "APPROVED";

export const REQUIRED_LANGUAGE = "en";
export const REQUIRED_CATEGORY = "UTILITY";

/** The EXACT field set every GET must request, so Graph default-field drift fails closed. */
export const REQUIRED_TEMPLATE_FIELDS = "id,name,language,status,category,components";

/** Hard structural ceiling. Seven targets, one POST each, no exceptions. */
export const MAX_POSTS = 7;

/**
 * The seven R8C targets, DERIVED from the committed SEED_SET by excluding the anchor.
 * Frozen, and its size is asserted at module load: if SEED_SET ever changes shape this
 * file refuses to load rather than silently widening or narrowing the authority.
 */
export const TARGETS = Object.freeze(
  SEED_SET.filter((s) => s.key !== ANCHOR_KEY).map((s) => Object.freeze({
    key: s.key,
    providerName: s.name,
    language: REQUIRED_LANGUAGE,
    category: REQUIRED_CATEGORY,
    fingerprint: s.fingerprint,
  })));

export const ANCHOR = Object.freeze(
  (() => {
    const a = SEED_SET.find((s) => s.key === ANCHOR_KEY);
    return a ? Object.freeze({ key: a.key, providerName: a.name, language: REQUIRED_LANGUAGE,
                               category: REQUIRED_CATEGORY, fingerprint: a.fingerprint }) : null;
  })());

if (TARGETS.length !== MAX_POSTS || ANCHOR === null) {
  throw new Error("R8C_TARGET_SET_INVARIANT_BROKEN");
}

export const ExitCode = Object.freeze({ OK: 0, REFUSED: 1, AMBIGUOUS: 2 });

export const Outcome = Object.freeze({
  DRY_RUN_WOULD_CREATE_SEVEN: "DRY_RUN_WOULD_CREATE_SEVEN",
  CREATED_ALL_SEVEN: "CREATED_ALL_SEVEN",
  CREATED_PARTIAL: "CREATED_PARTIAL",
  REFUSED: "REFUSED",
});

/** Per-target result. Only CREATED permits the next slot to run. */
export const SlotOutcome = Object.freeze({
  CREATED: "CREATED",
  REJECTED: "REJECTED",
  AMBIGUOUS: "AMBIGUOUS",
  READBACK_ABSENT: "READBACK_ABSENT",
  READBACK_MISMATCH: "READBACK_MISMATCH",
  SKIPPED_AFTER_STOP: "SKIPPED_AFTER_STOP",
});

export const PreflightFailure = Object.freeze({
  UNKNOWN_FLAG: "UNKNOWN_FLAG",
  IDENTITY_UNAUTHORIZED: "IDENTITY_UNAUTHORIZED",
  SOURCE_HEAD_UNPROVEN: "SOURCE_HEAD_UNPROVEN",
  ASSET_PROOF_INVALID: "ASSET_PROOF_INVALID",
  ASSET_SCOPE_UNPROVEN: "ASSET_SCOPE_UNPROVEN",
  PAYLOAD_INVALID: "PAYLOAD_INVALID",
  ANCHOR_NOT_APPROVED: "ANCHOR_NOT_APPROVED",
  TARGET_NOT_ABSENT: "TARGET_NOT_ABSENT",
  PRE_STATE_UNREADABLE: "PRE_STATE_UNREADABLE",
});

export function sha256Hex(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// PURE: flags. Dry run unless BOTH flags are present, exactly. An unknown flag is
// REFUSED rather than ignored — there is deliberately no --target, no template
// selector and no alternative execution flag.
// ---------------------------------------------------------------------------
export function parseFlags(argv = []) {
  const known = new Set(KNOWN_FLAGS);
  const unknown = argv.filter((a) => !known.has(a));
  if (unknown.length > 0) {
    return { ok: false, reason: PreflightFailure.UNKNOWN_FLAG, flag: unknown[0], mayPost: false };
  }
  const execute = argv.includes(EXECUTE_FLAG);
  const ownerAck = argv.includes(OWNER_ACK_FLAG);
  return { ok: true, execute, ownerAck, mayPost: execute && ownerAck };
}

// ---------------------------------------------------------------------------
// PURE: the canonical payload for ONE target, sourced from the committed packet.
//
// Reads ONLY the payload contract. `submit_now`, `local_state` and any historical
// `provider_template_id` are never consulted: they describe the pre-R8 mixed identity
// and say nothing about the actual staging WABA.
// ---------------------------------------------------------------------------
export function loadCanonicalPayload(packet, target) {
  const bad = (reason) => ({ ok: false, reason, payload: null, fingerprint: null, target });
  if (!target || typeof target !== "object") return bad("target_missing");
  if (!packet || !Array.isArray(packet.templates)) return bad("packet_unreadable");

  const matches = packet.templates.filter((t) => t.internal_template_key === target.key);
  if (matches.length !== 1) return bad("target_entry_not_unique");
  const entry = matches[0];
  if (entry.provider_template_name !== target.providerName) return bad("name_mismatch");

  const payload = entry.creation_payload;
  if (!payload || typeof payload !== "object") return bad("payload_missing");

  // Shape is closed: no parameter_format, no header, no footer, no buttons.
  if (Object.keys(payload).sort().join(",") !== "category,components,language,name") {
    return bad("payload_shape_unexpected");
  }
  if (payload.name !== target.providerName) return bad("name_mismatch");
  if (payload.language !== REQUIRED_LANGUAGE) return bad("language_mismatch");
  if (payload.category !== REQUIRED_CATEGORY) return bad("category_mismatch");
  if (!Array.isArray(payload.components) || payload.components.length !== 1) {
    return bad("component_count_unexpected");
  }
  const body = payload.components[0];
  if (!body || body.type !== "body" || typeof body.text !== "string") return bad("body_component_invalid");
  if (Object.prototype.hasOwnProperty.call(body, "buttons")) return bad("buttons_present");

  // Placeholder arity is whatever the canonical payload says, but it must be sequential
  // from {{1}} with no gaps — a non-sequential positional set renders the wrong value.
  const placeholders = (body.text.match(/\{\{\s*\d+\s*\}\}/g) ?? []).map((p) => p.replace(/\s/g, ""));
  if (!placeholders.every((p, i) => p === `{{${i + 1}}}`)) return bad("variable_shape_unexpected");
  const bodyKeys = Object.keys(body).sort().join(",");
  const expectedBodyKeys = placeholders.length === 0 ? "text,type" : "example,text,type";
  if (bodyKeys !== expectedBodyKeys) return bad("body_shape_unexpected");

  const fingerprint = sha256Hex(JSON.stringify(payload));
  if (fingerprint !== target.fingerprint) return bad("fingerprint_drift");

  return { ok: true, reason: null, payload, fingerprint, target };
}

/** PURE: every target's canonical payload, plus the anchor's. All-or-nothing. */
export function loadAllCanonicalPayloads(packet, targets = TARGETS, anchor = ANCHOR) {
  const results = targets.map((t) => loadCanonicalPayload(packet, t));
  const anchorResult = loadCanonicalPayload(packet, anchor);
  const failed = results.concat([anchorResult]).filter((r) => !r.ok);
  return {
    ok: failed.length === 0,
    results,
    anchorResult,
    faults: failed.map((r) => `${r.target?.key ?? "?"}:${r.reason}`),
  };
}

// ---------------------------------------------------------------------------
// PURE: remote state of ONE exact name+language, from an exact-name lookup.
// ---------------------------------------------------------------------------
export const RemoteState = Object.freeze({
  ABSENT: "ABSENT",
  PRESENT: "PRESENT",
  AMBIGUOUS: "AMBIGUOUS",
  UNREADABLE: "UNREADABLE",
});

export function classifyRemoteState(lookup, target) {
  if (!lookup || lookup.ok !== true) return { state: RemoteState.UNREADABLE, row: null };
  const rows = Array.isArray(lookup.body?.data) ? lookup.body.data : [];
  const exact = rows.filter((r) => r?.name === target.providerName && r?.language === target.language);
  if (exact.length === 0) return { state: RemoteState.ABSENT, row: null };
  if (exact.length > 1) return { state: RemoteState.AMBIGUOUS, row: null };
  return { state: RemoteState.PRESENT, row: exact[0] };
}

/**
 * PURE: the anchor must be exactly APPROVED / UTILITY / en AND semantically identical to
 * its committed payload. This is what proves R8C is talking to the same actual staging
 * WABA on which R8B genuinely succeeded.
 */
export function classifyAnchor(lookup, anchorPayload, anchor = ANCHOR) {
  const bad = (reason) => ({ ok: false, reason, row: null });
  const seen = classifyRemoteState(lookup, anchor);
  if (seen.state !== RemoteState.PRESENT) return bad(`anchor_${seen.state.toLowerCase()}`);
  const row = seen.row;
  if (String(row.status ?? "").toUpperCase() !== ANCHOR_REQUIRED_STATUS) return bad("anchor_not_approved");
  if (String(row.category ?? "").toUpperCase() !== REQUIRED_CATEGORY) return bad("anchor_category_mismatch");
  if (row.language !== REQUIRED_LANGUAGE) return bad("anchor_language_mismatch");
  if (!anchorPayload) return bad("anchor_payload_missing");
  const semantic = templatesAreIdentical(
    { name: row.name, language: row.language, category: row.category,
      components: row.components ?? anchorPayload.components },
    anchorPayload);
  if (semantic !== true) return bad("anchor_semantic_mismatch");
  return { ok: true, reason: null, row };
}

/** PURE: every one of the seven must be ABSENT. Anything else refuses the WHOLE run. */
export function classifyAllPreStates(lookups, targets = TARGETS) {
  const states = targets.map((t, i) => ({ target: t, ...classifyRemoteState(lookups[i], t) }));
  const notAbsent = states.filter((s) => s.state !== RemoteState.ABSENT);
  return {
    ok: notAbsent.length === 0,
    states,
    faults: notAbsent.map((s) => `${s.target.key}:${s.state}`),
  };
}

// ---------------------------------------------------------------------------
// PURE: the COMPLETE preflight. Every condition for every target is proved here,
// before the caller is permitted to post anything at all. There is no path in which
// creation begins from a partial preflight.
// ---------------------------------------------------------------------------
export function preflight({ flags, identity, assetProof, payloads, anchorState, preStates } = {}) {
  const refuse = (reason) => ({ ok: false, mayPost: false, reason });
  if (!flags?.ok) return refuse(`${flags?.reason}:${flags?.flag ?? ""}`);
  if (!identity?.ok) return refuse(identity?.faults?.join(",") ?? PreflightFailure.IDENTITY_UNAUTHORIZED);
  if (!assetProof?.ok) return refuse(assetProof?.faults?.join(",") ?? PreflightFailure.ASSET_SCOPE_UNPROVEN);
  if (!payloads?.ok) return refuse(`${PreflightFailure.PAYLOAD_INVALID}:${payloads?.faults?.join(",") ?? ""}`);
  if (!anchorState?.ok) return refuse(`${PreflightFailure.ANCHOR_NOT_APPROVED}:${anchorState?.reason ?? ""}`);
  if (!preStates?.ok) return refuse(`${PreflightFailure.TARGET_NOT_ABSENT}:${preStates?.faults?.join(",") ?? ""}`);
  return { ok: true, mayPost: flags.mayPost === true, reason: null };
}

/** PURE: readback verdict for one created target. Only a full match is a clean success. */
export function verifyReadback(lookup, target, payload) {
  const seen = classifyRemoteState(lookup, target);
  if (seen.state === RemoteState.ABSENT) return { ok: false, outcome: SlotOutcome.READBACK_ABSENT, row: null };
  if (seen.state !== RemoteState.PRESENT) return { ok: false, outcome: SlotOutcome.READBACK_MISMATCH, row: null };
  const row = seen.row;
  if (String(row.category ?? "").toUpperCase() !== REQUIRED_CATEGORY
      || row.language !== REQUIRED_LANGUAGE) {
    return { ok: false, outcome: SlotOutcome.READBACK_MISMATCH, row };
  }
  const semantic = templatesAreIdentical(
    { name: row.name, language: row.language, category: row.category,
      components: row.components ?? payload.components },
    payload);
  if (semantic !== true) return { ok: false, outcome: SlotOutcome.READBACK_MISMATCH, row };
  return { ok: true, outcome: SlotOutcome.CREATED, row };
}

// ---------------------------------------------------------------------------
// A GET-only client. `createOnce` is not on the returned object at all, so the
// read path is structurally incapable of mutating — stronger than choosing not to call it.
// ---------------------------------------------------------------------------
export function makeReadOnlyHttp(config) {
  const http = makeHttp(config);
  return Object.freeze({ get: (path) => http.get(path) });
}

/** The exact-name lookup path for one target. Fields are pinned, never defaulted. */
export function lookupPath(target) {
  return `/message_templates?name=${encodeURIComponent(target.providerName)}`
    + `&fields=${encodeURIComponent(REQUIRED_TEMPLATE_FIELDS)}`;
}

// ---------------------------------------------------------------------------
// ONE creation slot. Called exactly seven times below, never in a loop.
//
// `prior.continue` is the stop latch: once any slot fails to prove a clean success,
// every later slot returns SKIPPED_AFTER_STOP without constructing a client, so a
// stopped run cannot resume itself. Each slot builds its OWN one-shot client, whose
// createOnce throws on a second call — so "one POST per target" holds even if this
// function were somehow invoked twice for the same target.
// ---------------------------------------------------------------------------
export async function attemptCreateSlot({ target, payloadResult, makeClient, prior, ledger }) {
  const skip = { target: target.key, providerName: target.providerName, posted: 0,
                 outcome: SlotOutcome.SKIPPED_AFTER_STOP, classification: null,
                 row: null, semantic: null, continue: false };
  if (!prior || prior.continue !== true) return skip;
  if (ledger.posts() >= MAX_POSTS) return skip;

  const http = makeClient();
  ledger.record();
  const res = await http.createOnce(payloadResult.payload);
  const { classification } = classifyCreateResponse(res);

  if (classification === CreateClassification.DETERMINISTIC_4XX_REJECTION) {
    return { target: target.key, providerName: target.providerName, posted: http.postCount(),
             outcome: SlotOutcome.REJECTED, classification,
             error: safeMetaError(res.body), row: null, semantic: null, continue: false };
  }

  // Exactly ONE readback, whether the create was clean or ambiguous.
  const back = await http.get(lookupPath(target));
  const verdict = verifyReadback(back, target, payloadResult.payload);

  if (classification !== CreateClassification.SUCCESS) {
    // Ambiguous transport outcome. Never retried, and never continued past.
    return { target: target.key, providerName: target.providerName, posted: http.postCount(),
             outcome: SlotOutcome.AMBIGUOUS, classification, row: verdict.row,
             semantic: null, continue: false };
  }
  return { target: target.key, providerName: target.providerName, posted: http.postCount(),
           outcome: verdict.ok ? SlotOutcome.CREATED : verdict.outcome, classification,
           row: verdict.row, semantic: verdict.ok, continue: verdict.ok };
}

/** A total-POST ledger, independent of any single client, capped at MAX_POSTS. */
export function makePostLedger(max = MAX_POSTS) {
  let posts = 0;
  return Object.freeze({
    posts: () => posts,
    record: () => {
      if (posts >= max) throw new Error("MAX_POSTS_EXCEEDED");
      posts += 1;
      return posts;
    },
  });
}

/** PURE: the run verdict from the seven slot records. */
export function summarize(slots) {
  const created = slots.filter((s) => s.outcome === SlotOutcome.CREATED);
  const posted = slots.reduce((n, s) => n + s.posted, 0);
  if (created.length === MAX_POSTS) return { outcome: Outcome.CREATED_ALL_SEVEN, created: created.length, posted };
  if (created.length > 0) return { outcome: Outcome.CREATED_PARTIAL, created: created.length, posted };
  return { outcome: Outcome.REFUSED, created: 0, posted };
}

// ---------------------------------------------------------------------------
// CLI. Only runs as entry point, so the validator imports the pure layer freely.
// ---------------------------------------------------------------------------
const isEntry = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntry) {
  const flags = parseFlags(process.argv.slice(2));
  const env = process.env;

  console.log("== QF-MVP-40-R8C remaining-seven ACTUAL-staging template creation ==");
  if (!flags.ok) {
    console.log(`POST_ATTEMPT_COUNT=0`);
    console.log(`RESULT: REFUSED (${flags.reason}: ${flags.flag}) — zero Meta calls`);
    process.exit(ExitCode.REFUSED);
  }
  console.log(`   mode                    : ${flags.mayPost ? "EXECUTE" : "DRY RUN"}`);
  console.log(`   attestation stage       : ${INTENDED_STAGE}`);
  console.log(`   target count            : ${TARGETS.length} (frozen, derived from SEED_SET)`);
  console.log(`   anchor                  : ${ANCHOR.providerName} must be ${ANCHOR_REQUIRED_STATUS}/${REQUIRED_CATEGORY}/${REQUIRED_LANGUAGE}`);

  const identity = validateIdentity(env);
  console.log(`   identity authorised     : ${identity.ok}${identity.ok ? "" : " -> " + identity.faults.join(", ")}`);

  let packet = null;
  try { packet = JSON.parse(readFileSync(resolve(PACKET), "utf8")); } catch { packet = null; }
  const payloads = loadAllCanonicalPayloads(packet);
  console.log(`   canonical payloads (8)  : ${payloads.ok}${payloads.ok ? "" : " -> " + payloads.faults.join(", ")}`);

  if (!identity.ok || !payloads.ok) {
    console.log("POST_ATTEMPT_COUNT=0");
    console.log("RESULT: REFUSED (preflight) — zero Meta calls");
    process.exit(ExitCode.REFUSED);
  }

  const httpConfig = {
    version: env.QF_META_GRAPH_API_VERSION,
    wabaId: env.QF_META_WABA_ID,
    token: env.QF_META_ACCESS_TOKEN,
  };
  const reader = makeReadOnlyHttp(httpConfig);
  const ledger = makePostLedger();

  const run = async () => {
    const branchHead = await resolveGitHead();
    if (!branchHead) {
      console.log("POST_ATTEMPT_COUNT=0");
      console.log(`RESULT: REFUSED (${PreflightFailure.SOURCE_HEAD_UNPROVEN}) — zero POST`);
      return ExitCode.REFUSED;
    }

    const adapter = await buildStagingAssetProofAdapter();
    const proof = await adapter.verify({
      projectRef: AUTHORIZED_STAGING_REF,
      now: Date.now(),
      branchHead,
      stage: INTENDED_STAGE,
    });
    console.log(`   owner asset proof       : ${proof.ok === true ? "VERIFIED (external)" : "REFUSED -> " + (proof.detail ?? proof.reason)}`);
    if (proof.ok !== true) {
      console.log("POST_ATTEMPT_COUNT=0");
      console.log(`RESULT: REFUSED (${STAGING_ASSET_PROOF_ENV} proof) — zero POST`);
      return ExitCode.REFUSED;
    }

    // -- GET-only live readback --------------------------------------------
    const waba = await reader.get("");
    const phones = await reader.get("/phone_numbers?fields=id,verified_name,quality_rating,code_verification_status");
    const subs = await reader.get("/subscribed_apps");
    const assets = readLiveAssets({ waba, phones, subs });
    const assetProof = proveAssets({
      proof, assets,
      expected: { wabaId: String(env.QF_META_WABA_ID), phoneNumberId: String(env.QF_META_PHONE_NUMBER_ID) },
      branchHead,
    });
    console.log(`   live asset scope        : ${assetProof.scope}${assetProof.ok ? "" : " -> " + assetProof.faults.join(", ")}`);
    console.log(`   phone quality rating    : ${assets.qualityRating ?? "(unproven)"} (advisory)`);
    console.log(`   phone code verification : ${assets.codeVerificationStatus ?? "(unproven)"} (advisory — not a gate for template creation)`);
    console.log(`   subscriber count        : ${assets.subscriberCount ?? "(unreadable)"} (exact attested set required)`);

    // -- anchor + all seven pre-states, ALL before any mutation ------------
    const anchorLookup = await reader.get(lookupPath(ANCHOR));
    const anchorState = classifyAnchor(anchorLookup, payloads.anchorResult.payload);
    console.log(`   R8B anchor state        : ${anchorState.ok ? `${ANCHOR_REQUIRED_STATUS}/${REQUIRED_CATEGORY}/${REQUIRED_LANGUAGE} (semantic match)` : "REFUSED -> " + anchorState.reason}`);

    const lookups = await Promise.all(TARGETS.map((t) => reader.get(lookupPath(t))));
    const preStates = classifyAllPreStates(lookups);
    console.log(`   seven pre-states ABSENT : ${preStates.ok}${preStates.ok ? "" : " -> " + preStates.faults.join(", ")}`);
    preStates.states.forEach((s) => console.log(`     - ${s.target.providerName.padEnd(38)} ${s.state}`));

    const gate = preflight({ flags, identity, assetProof, payloads, anchorState, preStates });
    if (!gate.ok) {
      console.log(`POST_ATTEMPT_COUNT=${ledger.posts()}`);
      console.log(`RESULT: REFUSED (${gate.reason}) — zero POST, complete preflight required`);
      return ExitCode.REFUSED;
    }

    if (!gate.mayPost) {
      console.log(`POST_ATTEMPT_COUNT=${ledger.posts()}`);
      console.log(`   would POST              : ${TARGETS.length} templates, one each, sequentially`);
      TARGETS.forEach((t) => console.log(`     - ${t.providerName.padEnd(38)} ${t.language}/${t.category}`));
      console.log("WOULD_POST=YES");
      console.log(`RESULT: ${Outcome.DRY_RUN_WOULD_CREATE_SEVEN} — zero Meta mutation.`
        + ` Re-run with ${EXECUTE_FLAG} ${OWNER_ACK_FLAG} to create.`);
      return ExitCode.OK;
    }

    // -- SEVEN explicit sequential slots. No loop, no retry, no concurrency. --
    const makeClient = () => makeHttp(httpConfig);
    const START = Object.freeze({ continue: true });
    const s1 = await attemptCreateSlot({ target: TARGETS[0], payloadResult: payloads.results[0], makeClient, prior: START, ledger });
    const s2 = await attemptCreateSlot({ target: TARGETS[1], payloadResult: payloads.results[1], makeClient, prior: s1, ledger });
    const s3 = await attemptCreateSlot({ target: TARGETS[2], payloadResult: payloads.results[2], makeClient, prior: s2, ledger });
    const s4 = await attemptCreateSlot({ target: TARGETS[3], payloadResult: payloads.results[3], makeClient, prior: s3, ledger });
    const s5 = await attemptCreateSlot({ target: TARGETS[4], payloadResult: payloads.results[4], makeClient, prior: s4, ledger });
    const s6 = await attemptCreateSlot({ target: TARGETS[5], payloadResult: payloads.results[5], makeClient, prior: s5, ledger });
    const s7 = await attemptCreateSlot({ target: TARGETS[6], payloadResult: payloads.results[6], makeClient, prior: s6, ledger });
    const slots = [s1, s2, s3, s4, s5, s6, s7];

    slots.forEach((s) => {
      console.log(`   -- ${s.providerName}`);
      console.log(`      POST count           : ${s.posted}`);
      console.log(`      classification       : ${s.classification ?? "(not attempted)"}`);
      console.log(`      outcome              : ${s.outcome}`);
      console.log(`      readback status      : ${s.row?.status ?? "(none)"}`);
      console.log(`      readback category    : ${s.row?.category ?? "(none)"}`);
      console.log(`      readback language    : ${s.row?.language ?? "(none)"}`);
      console.log(`      semantic match       : ${s.semantic === null ? "(not compared)" : s.semantic}`);
    });

    const summary = summarize(slots);
    console.log(`POST_ATTEMPT_COUNT=${ledger.posts()}`);
    console.log(`   created cleanly         : ${summary.created}/${MAX_POSTS}`);
    console.log("   NOTE                    : creation is NOT approval. A clean create commonly reads back PENDING.");

    if (summary.outcome === Outcome.CREATED_ALL_SEVEN) {
      console.log(`RESULT: ${Outcome.CREATED_ALL_SEVEN} — ${ledger.posts()} POSTs, one per target, no retry`);
      return ExitCode.OK;
    }
    console.log(`RESULT: ${summary.outcome} — stopped at the first unproven outcome, no retry.`
      + " Recovery requires fresh GET-only reconciliation and a NEW authority.");
    return ExitCode.AMBIGUOUS;
  };

  run().then((code) => process.exit(code)).catch(() => {
    console.log("RESULT: REFUSED (unexpected failure) — no retry");
    process.exit(ExitCode.REFUSED);
  });
}
