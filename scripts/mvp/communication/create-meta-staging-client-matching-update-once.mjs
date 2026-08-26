// ============================================================================
// QF-MVP-40-R7I — ONE-SHOT governed FIRST CREATION of the single CLIENT canary
// template on the dedicated staging WABA.  DRY RUN BY DEFAULT.
//
//   node scripts/mvp/communication/create-meta-staging-client-matching-update-once.mjs
//     -> DRY RUN. Proves identity, pre-state and payload. No POST, no mutation.
//
//   … --execute --owner-authorized-once
//     -> Performs AT MOST ONE create POST.
//
// WHY THIS EXISTS, AND WHY THE PACKET SUBMITTER STAYS HELD
//   R7B established the reasoning and it is unchanged here: the audited packet
//   operator (submit-meta-templates.mjs) is GLOBAL and NAME-SCOPED, and
//   `closedStateModel` pins `submit_now === false` for every closed key. The packet is
//   additionally forbidden by `noSecretOrPii` from ever naming a WABA, so it structurally
//   CANNOT express "approved on WABA A, absent on WABA B". Flipping `submit_now` would
//   grant a GLOBAL re-creation permission rather than the WABA-scoped, single-template
//   one the owner authorised. The ordinary submitter therefore remains held, exactly as
//   committed.
//
// WHY A SECOND FILE RATHER THAN GENERALISING R7B
//   Making the vendor operator take a template parameter would convert a pinned,
//   single-purpose authority into a generic template-creation tool — the precise
//   property that makes R7B safe. This file instead PINS a different single target and
//   IMPORTS R7B's already-audited pure safety layer (identity, live-asset proof, flag
//   parsing, decision, one-POST transport). Nothing in R7B is modified, relaxed or
//   re-exported with different meaning.
//
// SCOPE — exactly one template, on exactly one WABA
//   internal key   : client_matching_update
//   provider name  : qf_client_matching_update_v1
//   language       : en          category: UTILITY
//   payload sha256 : c0930db5a9beee61de0076caf234b36f950554bc21c60b697845028a8d057e1c
//   This operator creates NOTHING else. The other six absent templates are out of scope.
//
// WHAT IT CANNOT DO — enforced below and asserted by the validator
//   * no messaging/send endpoint;  * no DELETE / PUT / PATCH;
//   * no database access, no Supabase client, no RPC;
//   * no provider / mapping / readiness / canary authority;
//   * no template selector — name, key and payload fingerprint are PINNED;
//   * no second POST, ever, including after an ambiguous or rejected result.
//
// IDENTITY
//   The SAME pinned staging App/WABA/phone digest triple as R7B, imported rather than
//   restated, so there is exactly ONE identity authority in the repository. No raw Meta
//   id is committed here.
// ============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  classifyCreateResponse,
  safeMetaError,
  templatesAreIdentical,
  CreateClassification,
} from "./submit-meta-templates.mjs";
// The already-audited PURE safety layer. Imported, never copied, never altered.
import {
  EXPECTED_IDENTITY_DIGESTS,
  OWNER_ACK_FLAG,
  Outcome,
  PreState,
  ALREADY_CREATED_STATUSES,
  classifyLiveAssets,
  decide,
  makeHttp,
  parseFlags,
  sha256Hex,
  validateIdentity,
} from "./create-meta-staging-vendor-onboarding-reminder-once.mjs";
import { historicalRetirementBanner, retireHistoricalMutation } from "./metaStagingIdentity.mjs";

const PACKET = "docs/provider-manifests/meta-template-submission-packet.json";

/** The ONE template this operator may ever create. Not a parameter. */
export const TARGET_TEMPLATE_KEY = "client_matching_update";
export const TARGET_TEMPLATE_NAME = "qf_client_matching_update_v1";
export const TARGET_LANGUAGE = "en";
export const TARGET_CATEGORY = "UTILITY";

/** sha256 of the canonical creation payload, as produced by the packet generator. */
export const EXPECTED_PAYLOAD_FINGERPRINT =
  "c0930db5a9beee61de0076caf234b36f950554bc21c60b697845028a8d057e1c";

/**
 * The packet state this target MUST still be in. The operator never WRITES these — it
 * refuses if the committed catalogue has drifted away from "approved, held, unmapped".
 * `submit_now` is read ONLY to assert the global hold is still in place; it is never set.
 */
export const REQUIRED_PACKET_STATE = Object.freeze({
  submitNow: false,
  approvalStatus: "approved",
  submissionState: "APPROVED_UNMAPPED",
});

/**
 * The EXACT field set both the pre-state GET and the post-create readback must request.
 *
 * `classifyPreState` proves absence/presence from `name`, `language` and `status`, and the
 * semantic readback additionally needs `category` and `components`. Requesting them
 * explicitly fails closed against Graph API default-field drift: if a future default
 * response silently stopped returning `language` or `status`, an existing row would be
 * misread — and ABSENT is the ONLY pre-state that may POST, so the drift would present as
 * permission to create a duplicate.
 */
export const REQUIRED_TEMPLATE_FIELDS = "id,name,language,status,category,components";

/** Process exit codes. An ambiguous MUTATION outcome must never look like success. */
export const ExitCode = Object.freeze({
  OK: 0,
  REFUSED: 1,
  AMBIGUOUS: 2,
});

/**
 * PURE: the terminal exit code for an outcome. Extracted so the validator can prove the
 * mapping without executing the operator or issuing any network call.
 *
 * CREATE_AMBIGUOUS gets its OWN non-zero code: a shell, a CI step or an operator reading
 * `$?` must be able to distinguish "created and confirmed" from "a mutation happened and
 * we cannot prove what it did". Collapsing that into 0 is how an unconfirmed create gets
 * mistaken for a clean one.
 */
export function exitCodeForOutcome(outcome) {
  switch (outcome) {
    case Outcome.CREATED:
    case Outcome.ALREADY_CREATED:
    case Outcome.DRY_RUN_WOULD_POST:
      return ExitCode.OK;
    case Outcome.CREATE_AMBIGUOUS:
      return ExitCode.AMBIGUOUS;
    case Outcome.REFUSED:
      return ExitCode.REFUSED;
    default:
      return ExitCode.REFUSED; // an unknown outcome fails closed
  }
}

/** Re-exported for the validator so it proves the SAME objects R7B pinned. */
export { EXPECTED_IDENTITY_DIGESTS, OWNER_ACK_FLAG, Outcome, PreState, ALREADY_CREATED_STATUSES };

// ---------------------------------------------------------------------------
// PURE: the canonical payload, sourced FROM THE COMMITTED PACKET so it cannot drift
// from the audited catalogue, then proved against the pinned fingerprint.
//
// This target carries TWO positional variables ({{1}} client name, {{2}} vendor count),
// so the variable rule differs from R7B's single-placeholder rule and is pinned exactly.
// ---------------------------------------------------------------------------
export function loadCanonicalPayload(packet) {
  const bad = (reason) => ({ ok: false, reason, payload: null, fingerprint: null });
  if (!packet || !Array.isArray(packet.templates)) return bad("packet_unreadable");

  const matches = packet.templates.filter((t) => t.internal_template_key === TARGET_TEMPLATE_KEY);
  if (matches.length !== 1) return bad("target_entry_not_unique");
  const entry = matches[0];

  if (entry.provider_template_name !== TARGET_TEMPLATE_NAME) return bad("name_mismatch");

  // The global hold and the approved/unmapped posture must both still stand.
  if (entry.submit_now !== REQUIRED_PACKET_STATE.submitNow) return bad("submit_now_not_held");
  const local = entry.local_state;
  if (!local || typeof local !== "object") return bad("local_state_missing");
  if (local.approval_status !== REQUIRED_PACKET_STATE.approvalStatus) {
    return bad("approval_status_unexpected");
  }
  if (local.submission_state !== REQUIRED_PACKET_STATE.submissionState) {
    return bad("submission_state_unexpected");
  }

  const payload = entry.creation_payload;
  if (!payload || typeof payload !== "object") return bad("payload_missing");

  // Shape is closed: no parameter_format, no header, no footer, no buttons.
  const topKeys = Object.keys(payload).sort().join(",");
  if (topKeys !== "category,components,language,name") return bad("payload_shape_unexpected");
  if (payload.name !== TARGET_TEMPLATE_NAME) return bad("name_mismatch");
  if (payload.language !== TARGET_LANGUAGE) return bad("language_mismatch");
  if (payload.category !== TARGET_CATEGORY) return bad("category_mismatch");
  if (!Array.isArray(payload.components) || payload.components.length !== 1) {
    return bad("component_count_unexpected");
  }
  const body = payload.components[0];
  if (!body || body.type !== "body" || typeof body.text !== "string") return bad("body_component_invalid");
  if (Object.prototype.hasOwnProperty.call(body, "buttons")) return bad("buttons_present");
  const bodyKeys = Object.keys(body).sort().join(",");
  if (bodyKeys !== "example,text,type") return bad("body_shape_unexpected");

  // Exactly two positional variables, in order, and no other placeholder.
  const placeholders = (body.text.match(/\{\{\s*\d+\s*\}\}/g) ?? []).map((p) => p.replace(/\s/g, ""));
  if (placeholders.length !== 2 || placeholders[0] !== "{{1}}" || placeholders[1] !== "{{2}}") {
    return bad("variable_shape_unexpected");
  }

  const fingerprint = sha256Hex(JSON.stringify(payload));
  if (fingerprint !== EXPECTED_PAYLOAD_FINGERPRINT) return bad("fingerprint_drift");

  return { ok: true, reason: null, payload, fingerprint };
}

// ---------------------------------------------------------------------------
// PURE: remote pre-state from an exact-name lookup. Bound to THIS operator's pinned
// name/language, which is why it is not shared with R7B.
// ---------------------------------------------------------------------------
export function classifyPreState(lookup) {
  if (!lookup || lookup.ok !== true) return { state: PreState.UNREADABLE, row: null };
  const rows = Array.isArray(lookup.body?.data) ? lookup.body.data : [];
  const exact = rows.filter((r) => r?.name === TARGET_TEMPLATE_NAME && r?.language === TARGET_LANGUAGE);
  if (exact.length === 0) return { state: PreState.ABSENT, row: null };
  if (exact.length > 1) return { state: PreState.AMBIGUOUS, row: null };
  const status = String(exact[0].status ?? "").toUpperCase();
  if (ALREADY_CREATED_STATUSES.includes(status)) {
    return { state: PreState.ALREADY_CREATED, row: exact[0] };
  }
  return { state: PreState.PRESENT_OTHER_STATUS, row: exact[0] };
}

// ---------------------------------------------------------------------------
// CLI. Only runs as entry point, so the validator imports the pure layer freely.
// ---------------------------------------------------------------------------
const isEntry = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntry) {
  const parsedFlags = parseFlags(process.argv.slice(2));
  // QF-MVP-40-R8 — spent historical authority: the mutation bit is forced false here,
  // before any decision, network call or readback. Dry-run reading still works.
  const flags = retireHistoricalMutation(parsedFlags, { operatorId: "QF-MVP-40-R7I", mutationKey: "mayPost" });
  const env = process.env;

  console.log("== QF-MVP-40-R7I one-shot staging CLIENT template creation ==");
  console.log(`   mode                    : ${flags.mayPost ? "EXECUTE" : "DRY RUN"}`);
  console.log(historicalRetirementBanner(flags.retiredOperatorId));
  console.log(`   target template         : ${TARGET_TEMPLATE_NAME}`);

  const identity = validateIdentity(env);
  console.log(`   identity authorised     : ${identity.ok}${identity.ok ? "" : " -> " + identity.faults.join(", ")}`);

  let packet = null;
  try { packet = JSON.parse(readFileSync(resolve(PACKET), "utf8")); } catch { packet = null; }
  const payloadResult = loadCanonicalPayload(packet);
  console.log(`   canonical payload proved: ${payloadResult.ok}${payloadResult.ok ? "" : " -> " + payloadResult.reason}`);
  if (payloadResult.ok) console.log(`   payload fingerprint     : ${payloadResult.fingerprint}`);

  if (!identity.ok || !payloadResult.ok) {
    console.log("RESULT: REFUSED (preflight) — zero Meta calls");
    process.exit(ExitCode.REFUSED);
  }

  const http = makeHttp({
    version: env.QF_META_GRAPH_API_VERSION,
    wabaId: env.QF_META_WABA_ID,
    token: env.QF_META_ACCESS_TOKEN,
  });

  const run = async () => {
    // -- GET-only asset proofs -------------------------------------------------
    const waba = await http.get("");
    const phones = await http.get("/phone_numbers?fields=id,verified_name,quality_rating,code_verification_status");
    const subs = await http.get("/subscribed_apps");

    const assets = classifyLiveAssets({ waba, phones, subs });
    console.log(`   live asset proof        : ${assets.ok}${assets.ok ? "" : " -> " + assets.faults.join(", ")}`);
    console.log(`   phone quality rating    : ${assets.qualityRating ?? "(unproven)"}`);
    console.log(`   subscriber count        : ${assets.subscriberCount}`);

    if (!assets.ok) {
      console.log("RESULT: REFUSED (live asset proof) — zero POST");
      return exitCodeForOutcome(Outcome.REFUSED);
    }

    // -- exact-name pre-state --------------------------------------------------
    // The SAME explicit field set as the readback — never the API's default projection.
    const lookup = await http.get(
      `/message_templates?name=${encodeURIComponent(TARGET_TEMPLATE_NAME)}&fields=${REQUIRED_TEMPLATE_FIELDS}`);
    const pre = classifyPreState(lookup);
    console.log(`   remote pre-state        : ${pre.state}`);

    const decision = decide({ flags, identity, payloadResult, preState: pre.state });

    if (decision.outcome === Outcome.ALREADY_CREATED) {
      console.log(`   existing row            : status=${pre.row.status} category=${pre.row.category} language=${pre.row.language}`);
      console.log(`POST_ATTEMPT_COUNT=${http.postCount()}`);
      console.log("RESULT: ALREADY_CREATED — no POST. Creation authority is spent.");
      return exitCodeForOutcome(Outcome.ALREADY_CREATED);
    }
    if (!decision.post) {
      console.log(`POST_ATTEMPT_COUNT=${http.postCount()}`);
      if (decision.outcome === Outcome.DRY_RUN_WOULD_POST) {
        console.log(`   would POST to           : /${env.QF_META_GRAPH_API_VERSION}/<waba>/message_templates`);
        console.log(`   would POST body         : ${JSON.stringify(payloadResult.payload)}`);
        console.log("WOULD_POST=YES");
        console.log(`RESULT: DRY RUN — zero Meta mutation. Re-run with --execute ${OWNER_ACK_FLAG} to create.`);
        return exitCodeForOutcome(Outcome.DRY_RUN_WOULD_POST);
      }
      console.log(`RESULT: REFUSED (${decision.outcome}: ${decision.reason}) — zero POST`);
      return exitCodeForOutcome(Outcome.REFUSED);
    }

    // -- THE single POST -------------------------------------------------------
    const res = await http.createOnce(payloadResult.payload);
    // classifyCreateResponse returns { classification, error } — read the FIELD, never the
    // object, or every outcome degrades to a false "ambiguous" label.
    const { classification } = classifyCreateResponse(res);
    console.log(`POST_ATTEMPT_COUNT=${http.postCount()}`);
    console.log(`   create classification   : ${classification}`);
    if (classification === CreateClassification.DETERMINISTIC_4XX_REJECTION) {
      // safeMetaError() returns { code, subcode, type, is_transient } — `subcode`, NOT
      // `error_subcode`. Reading the wrong key silently printed "?" for every rejection.
      const e = safeMetaError(res.body);
      console.log(`   meta error (structured) : code=${e.code ?? "?"} type=${e.type ?? "?"} subcode=${e.subcode ?? "?"}`);
      console.log("RESULT: REJECTED — no retry, no second POST");
      return exitCodeForOutcome(Outcome.REFUSED);
    }

    // ONE read-only readback, whether the create was clean or ambiguous.
    const back = await http.get(
      `/message_templates?name=${encodeURIComponent(TARGET_TEMPLATE_NAME)}&fields=${REQUIRED_TEMPLATE_FIELDS}`);
    const after = classifyPreState(back);
    console.log(`   readback state          : ${after.state}`);

    let semantic = false;
    if (after.row) {
      // The comparison uses ONLY the remote row. Substituting the local payload for a
      // missing `components` would let a row that omits them fabricate a semantic match —
      // i.e. manufacture the very confirmation this readback exists to obtain. Absent or
      // non-array remote components therefore mean UNCONFIRMED, never CREATED.
      const remoteComponents = after.row.components;
      const componentsUsable = Array.isArray(remoteComponents);
      semantic = componentsUsable && templatesAreIdentical(
        {
          name: after.row.name,
          language: after.row.language,
          category: after.row.category,
          components: remoteComponents,
        },
        payloadResult.payload);
      console.log(`   remote id               : ${after.row.id ?? "(not returned)"}`);
      console.log(`   remote status           : ${after.row.status}`);
      console.log(`   remote category         : ${after.row.category}`);
      console.log(`   remote language         : ${after.row.language}`);
      console.log(`   remote components       : ${componentsUsable ? `${remoteComponents.length} returned` : "MISSING — cannot confirm"}`);
      console.log(`   semantic match          : ${semantic}`);
    }

    // A clean HTTP create that is NOT confirmed by a matching remote row is AMBIGUOUS,
    // never CREATED. Conservative by construction, and still no retry.
    const confirmed = after.state === PreState.ALREADY_CREATED && semantic === true;
    const outcome =
      classification === CreateClassification.SUCCESS && confirmed
        ? Outcome.CREATED
        : Outcome.CREATE_AMBIGUOUS;

    console.log(`RESULT: ${outcome} — exactly ${http.postCount()} POST, no retry`);
    return exitCodeForOutcome(outcome);
  };

  run().then((code) => process.exit(code)).catch(() => {
    console.log("RESULT: REFUSED (unexpected failure) — no retry");
    process.exit(ExitCode.REFUSED);
  });
}
