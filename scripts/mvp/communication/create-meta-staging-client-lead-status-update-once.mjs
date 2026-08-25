// ============================================================================
// QF-MVP-40-R7K — ONE-SHOT governed WABA-SCOPED RECOVERY of the client
// lead-status Utility template on the dedicated staging WABA. DRY RUN BY DEFAULT.
//
//   node scripts/mvp/communication/create-meta-staging-client-lead-status-update-once.mjs
//     -> DRY RUN. Proves identity, pre-state and payload. No POST, no mutation.
//
//   … --execute --owner-authorized-once
//     -> Performs AT MOST ONE create POST.
//
// WHY THIS RECOVERY EXISTS, AND WHY THE PACKET HOLD STAYS
//   `client_lead_status_update` is APPROVED_UNMAPPED and HELD (`submit_now: false`).
//   That approval was proven against a PREVIOUS WABA context. A GET-only reconciliation
//   of the current dedicated staging WABA proved `qf_client_lead_status_update_v1` is
//   ABSENT there.
//
//   The committed packet is deliberately WABA-BLIND — `noSecretOrPii` forbids it from
//   ever naming a WABA — so it structurally CANNOT express "approved on WABA A, absent on
//   WABA B". Flipping `submit_now` would therefore grant a GLOBAL re-creation permission
//   rather than the WABA-scoped, single-template one the owner authorised. The hold is
//   left exactly as committed and is asserted, never written.
//
// WHY THIS TEMPLATE
//   `docs/QF-MVP-40-LIVE-CANARY-RUNBOOK.md` allows EITHER `client_matching_update` OR
//   `client_lead_status_update` as the one normal client Utility canary, with the other
//   left inactive. `qf_client_matching_update_v1` exists on the current WABA but Meta
//   approved it as MARKETING, so it is quarantined/unmapped and must never be accepted as
//   Utility. This operator recovers the remaining Utility client option.
//
// WHY A THIRD FILE RATHER THAN GENERALISING R7B/R7I
//   Making either spent operator take a template parameter would convert a pinned,
//   single-purpose authority into a generic template-creation tool — the exact property
//   that makes them safe. This file PINS a different single target and IMPORTS R7B's
//   already-audited pure safety layer, exactly as R7I does. Neither R7B nor R7I is
//   modified, relaxed, or re-exported with different meaning.
//
// HOW THIS IS STRICTER THAN R7I (QF-MVP-40-R7J finding)
//   R7I treated ANY existing APPROVED/PENDING row as ALREADY_CREATED. The live WABA has
//   since proven that Meta can approve a requested-UTILITY template as MARKETING. A row
//   that merely exists is therefore NOT proof that the right template exists. This
//   operator's pre-state additionally requires remote category UTILITY, usable remote
//   components and a full semantic match before it will call a row ALREADY_CREATED;
//   anything else REFUSES with a distinct, legible code and zero POST.
//
// WHAT IT CANNOT DO — enforced below and asserted by the validator
//   * no messaging/send endpoint;  * no DELETE / PUT / PATCH;
//   * no database access, no Supabase client, no RPC;
//   * no mapping, provider-runtime, readiness, canary or webhook mutation;
//   * no template selector — key, name, language, category and payload fingerprint
//     are PINNED literals with no argv or env path;
//   * no second POST, ever, including after ambiguity, 4xx, 5xx or timeout.
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
export const TARGET_TEMPLATE_KEY = "client_lead_status_update";
export const TARGET_TEMPLATE_NAME = "qf_client_lead_status_update_v1";
export const TARGET_LANGUAGE = "en";
export const TARGET_CATEGORY = "UTILITY";

/** sha256 of the canonical creation payload, as produced by the packet generator. */
export const EXPECTED_PAYLOAD_FINGERPRINT =
  "ce8982c652515e2434abb2159a4024a199de54cede0bd1f95552eb8d6270e7ac";

/** The exact committed body. Pinned so a packet edit cannot silently change the message. */
export const EXPECTED_BODY_TEXT =
  "Hi {{1}}, the status of your QuickFurno enquiry is now: {{2}}. Reply here if you have any questions.";

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
 * Presence/absence is proven from `name`, `language` and `status`; the category and
 * semantic proofs need `category` and `components`. Requesting them explicitly fails
 * closed against Graph API default-field drift — a narrowed default projection would
 * otherwise make an existing row look ABSENT, and ABSENT is the only state that may POST.
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

/**
 * The closed pre-state vocabulary. R7B's states plus three REFUSAL states this operator
 * needs because "a row exists" is not proof that "the right row exists".
 *
 * Only ABSENT can reach a create decision; only ALREADY_CREATED is a safe no-op. Every
 * other member is a refusal, and `decide()` treats them as such without modification
 * because it only ever admits ABSENT and ALREADY_CREATED by name.
 */
export const ClientPreState = Object.freeze({
  ...PreState,
  PRESENT_CATEGORY_MISMATCH: "PRESENT_CATEGORY_MISMATCH",
  PRESENT_CONTENT_MISMATCH: "PRESENT_CONTENT_MISMATCH",
  PRESENT_COMPONENTS_UNUSABLE: "PRESENT_COMPONENTS_UNUSABLE",
});

/** Re-exported for the validator so it proves the SAME objects R7B pinned. */
export { EXPECTED_IDENTITY_DIGESTS, OWNER_ACK_FLAG, Outcome, PreState, ALREADY_CREATED_STATUSES };

// ---------------------------------------------------------------------------
// PURE: the canonical payload, sourced FROM THE COMMITTED PACKET so it cannot drift
// from the audited catalogue, then proved against the pinned fingerprint.
//
// This target carries TWO positional variables: {{1}} client name, {{2}} status text.
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

  // The exact committed sentence, not merely a well-shaped one.
  if (body.text !== EXPECTED_BODY_TEXT) return bad("body_text_mismatch");

  // Exactly two positional variables, in order, and no other placeholder.
  const placeholders = (body.text.match(/\{\{\s*\d+\s*\}\}/g) ?? []).map((p) => p.replace(/\s/g, ""));
  if (placeholders.length !== 2 || placeholders[0] !== "{{1}}" || placeholders[1] !== "{{2}}") {
    return bad("variable_shape_unexpected");
  }

  // Exactly one example row carrying exactly two positional example values.
  const rows = body.example?.body_text;
  if (!Array.isArray(rows) || rows.length !== 1) return bad("example_shape_unexpected");
  if (!Array.isArray(rows[0]) || rows[0].length !== 2) return bad("example_arity_unexpected");
  if (!rows[0].every((v) => typeof v === "string" && v.length > 0)) return bad("example_value_invalid");

  const fingerprint = sha256Hex(JSON.stringify(payload));
  if (fingerprint !== EXPECTED_PAYLOAD_FINGERPRINT) return bad("fingerprint_drift");

  return { ok: true, reason: null, payload, fingerprint };
}

// ---------------------------------------------------------------------------
// PURE: remote pre-state from an exact-name lookup, proved against the canonical payload.
//
// "A row exists" is NOT "the right row exists": the current WABA already holds a
// requested-UTILITY template that Meta approved as MARKETING. Category, component
// usability and full semantic identity are therefore all required before a row may be
// treated as an acceptable no-op.
// ---------------------------------------------------------------------------
export function classifyPreState(lookup, expectedPayload) {
  const unreadable = { state: ClientPreState.UNREADABLE, row: null };

  if (!lookup || lookup.ok !== true) return unreadable;

  // A 200 is not the same as a READABLE 200. `body: null`, `body: {}`, `{data: null}` and
  // `{data: {}}` are all malformed successful responses, and collapsing any of them to an
  // empty list would yield ABSENT — the ONE state that can reach a POST. Absence must be
  // PROVEN by a real empty array, never inferred from a shape we could not parse.
  const body = lookup.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return unreadable;
  if (!Array.isArray(body.data)) return unreadable;

  const rows = body.data;

  // Every returned row must be interpretable before any conclusion is drawn from the set.
  // A null/non-object row, or a row without a usable string `name`, means the response
  // cannot be reliably filtered — so the target's absence is unproven.
  for (const r of rows) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return unreadable;
    if (typeof r.name !== "string" || r.name.length === 0) return unreadable;
    // A row bearing the target NAME must also carry a usable language, or "is this the
    // en target?" is unanswerable. A different-name row needs no language to be excluded.
    if (r.name === TARGET_TEMPLATE_NAME && (typeof r.language !== "string" || r.language.length === 0)) {
      return unreadable;
    }
  }

  const exact = rows.filter((r) => r.name === TARGET_TEMPLATE_NAME && r.language === TARGET_LANGUAGE);

  if (exact.length === 0) return { state: ClientPreState.ABSENT, row: null };
  if (exact.length > 1) return { state: ClientPreState.AMBIGUOUS, row: null };

  const row = exact[0];
  const status = String(row.status ?? "").toUpperCase();
  if (!ALREADY_CREATED_STATUSES.includes(status)) {
    return { state: ClientPreState.PRESENT_OTHER_STATUS, row };
  }
  if (String(row.category ?? "").toUpperCase() !== TARGET_CATEGORY) {
    return { state: ClientPreState.PRESENT_CATEGORY_MISMATCH, row };
  }
  if (!Array.isArray(row.components)) {
    return { state: ClientPreState.PRESENT_COMPONENTS_UNUSABLE, row };
  }
  // Remote components ONLY — never the local payload.
  const identical = expectedPayload
    ? templatesAreIdentical(
        {
          name: row.name,
          language: row.language,
          category: row.category,
          components: row.components,
        },
        expectedPayload)
    : false;
  if (!identical) return { state: ClientPreState.PRESENT_CONTENT_MISMATCH, row };

  return { state: ClientPreState.ALREADY_CREATED, row };
}

// ---------------------------------------------------------------------------
// CLI. Only runs as entry point, so the validator imports the pure layer freely.
// ---------------------------------------------------------------------------
const isEntry = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntry) {
  const parsedFlags = parseFlags(process.argv.slice(2));
  // QF-MVP-40-R8 — spent historical authority: the mutation bit is forced false here,
  // before any decision, network call or readback. Dry-run reading still works.
  const flags = retireHistoricalMutation(parsedFlags, { operatorId: "QF-MVP-40-R7K", mutationKey: "mayPost" });
  const env = process.env;

  console.log("== QF-MVP-40-R7K one-shot staging CLIENT lead-status recovery ==");
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
    const pre = classifyPreState(lookup, payloadResult.payload);
    console.log(`   remote pre-state        : ${pre.state}`);
    if (pre.row) {
      console.log(`   existing row            : status=${pre.row.status} category=${pre.row.category} language=${pre.row.language}`);
    }

    const decision = decide({ flags, identity, payloadResult, preState: pre.state });

    if (decision.outcome === Outcome.ALREADY_CREATED) {
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
      // safeMetaError() returns { code, subcode, type, is_transient } — already sanitized.
      const e = safeMetaError(res.body);
      console.log(`   meta error (structured) : code=${e.code ?? "?"} type=${e.type ?? "?"} subcode=${e.subcode ?? "?"} transient=${e.is_transient ?? "?"}`);
      console.log("RESULT: REJECTED — no retry, no second POST");
      return exitCodeForOutcome(Outcome.REFUSED);
    }

    // ONE read-only readback, whether the create was clean or ambiguous.
    const back = await http.get(
      `/message_templates?name=${encodeURIComponent(TARGET_TEMPLATE_NAME)}&fields=${REQUIRED_TEMPLATE_FIELDS}`);
    const after = classifyPreState(back, payloadResult.payload);
    console.log(`   readback state          : ${after.state}`);
    if (after.row) {
      console.log(`   remote id               : ${after.row.id ?? "(not returned)"}`);
      console.log(`   remote status           : ${after.row.status}`);
      console.log(`   remote category         : ${after.row.category}`);
      console.log(`   remote language         : ${after.row.language}`);
      console.log(`   remote components       : ${Array.isArray(after.row.components) ? `${after.row.components.length} returned` : "MISSING — cannot confirm"}`);
    }

    // CONFIRMED only when the readback itself reached ALREADY_CREATED, which already
    // requires exactly one row, UTILITY category, usable REMOTE components and a full
    // semantic match. Anything else is AMBIGUOUS — never CREATED, and never retried.
    const confirmed = after.state === ClientPreState.ALREADY_CREATED;
    const outcome =
      classification === CreateClassification.SUCCESS && confirmed
        ? Outcome.CREATED
        : Outcome.CREATE_AMBIGUOUS;

    console.log(`   semantic confirmation   : ${confirmed}`);
    console.log(`RESULT: ${outcome} — exactly ${http.postCount()} POST, no retry`);
    return exitCodeForOutcome(outcome);
  };

  /**
   * TERMINAL FAILURE HANDLER.
   *
   * An unexpected exception is NOT automatically a refusal. If it happens AFTER
   * `createOnce` consumed the single POST budget, a real mutation was issued whose outcome
   * this process never proved — that is exactly CREATE_AMBIGUOUS, and reporting it as a
   * plain REFUSED would tell an operator "nothing happened" when something did.
   *
   * The POST counter is the authority: it is incremented BEFORE the request is issued, so
   * `postCount() > 0` means "a request left this process" even if the throw came from the
   * transport itself. Neither branch retries, and neither can issue a second POST — the
   * budget is already spent and `createOnce` throws on a second call.
   *
   * The exception itself is never printed: it may carry the Authorization header, the
   * token, or a raw provider payload.
   */
  run()
    .then((code) => process.exit(code))
    .catch(() => {
      const posted = http.postCount() > 0;
      const outcome = posted ? Outcome.CREATE_AMBIGUOUS : Outcome.REFUSED;
      console.log(`POST_ATTEMPT_COUNT=${http.postCount()}`);
      console.log(
        posted
          ? "RESULT: CREATE_AMBIGUOUS (unexpected failure AFTER the single POST; outcome unproven) — no retry, no second POST"
          : "RESULT: REFUSED (unexpected failure before any POST) — no retry");
      process.exit(exitCodeForOutcome(outcome));
    });
}
