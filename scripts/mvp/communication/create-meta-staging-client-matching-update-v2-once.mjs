// ============================================================================
// QF-MVP-40-R7N — ONE-SHOT governed CATEGORY REPAIR for the client matching update.
// DRY RUN BY DEFAULT.
//
//   node scripts/mvp/communication/create-meta-staging-client-matching-update-v2-once.mjs
//     -> GET-only DRY RUN. Proves identity, pre-state and payload. No POST, no mutation.
//
//   … --execute --owner-authorized-once
//     -> Performs AT MOST ONE create POST.
//
// WHY THIS REPAIR EXISTS
//   QF-MVP-40-R7I created `qf_client_matching_update_v1`. A GET-only readback against the
//   current dedicated staging WABA on 2026-08-24 proved:
//
//       existing row : status=APPROVED category=MARKETING language=en
//       POST_ATTEMPT_COUNT=0
//
//   v1 is therefore permanently QUARANTINED: not deleted, not edited, not appealed, not
//   repurposed, and never acceptable as the Utility client matching update. The likely
//   cause is the promotional quality adjective in the v1 copy — "{{2}} verified vendors" —
//   which reads as vendor promotion rather than a service update on an existing request.
//
//   This operator creates the SUCCESSOR, `qf_client_matching_update_v2`, whose body is
//   strictly transactional: it names the recipient's existing QuickFurno enquiry and
//   reports matching progress only. It carries no promotional term, no offer, no
//   recommendation, no CTA and no URL.
//
// OWNERSHIP BOUNDARY — R7I owns v1, R7N owns v2
//   R7I's operator still pins v1 and fingerprint c0930db5…, permanently, as the evidence of
//   what it actually created. It is NOT repinned to v2: that would rewrite history. R7I can
//   no longer create anything for this key (the canonical packet no longer names v1, so its
//   payload load fails closed with `name_mismatch`), and R7I execution authority is NEVER
//   reused for v2. This file is the only authority for v2.
//
// VARIABLE CONTRACT — TWO placeholders, fixed by the runtime
//   lib/communication/businessTemplateVariables.ts binds this template to exactly
//   {{1}} = CLIENT_NAME (text) and {{2}} = MATCHED_VENDOR_COUNT (decimalCount). The
//   successor keeps that contract byte-for-byte: reducing the arity would break the send
//   runtime, so the copy was rewritten around the same two variables rather than dropping one.
//
// PACKET STATE
//   v2 has NEVER been submitted anywhere, so the honest committed state is `draft` /
//   `DRAFT_NOT_SUBMITTED`, and this operator pins THAT. Creation stays HELD
//   (`submit_now: false`) so the ordinary packet submitter can never pick it up — only this
//   one-shot, owner-authorised operator may create it.
//
// WHAT IT CANNOT DO — enforced below and asserted by the validator
//   * no messaging/send endpoint;  * no DELETE / PUT / PATCH;
//   * no database, Supabase client or RPC;
//   * no mapping, provider-runtime, readiness, canary or webhook mutation;
//   * no template/name/category/language/body parameter of any kind;
//   * no second POST, ever, including after 4xx, 5xx, timeout, transport throw,
//     an ambiguous response or a failed readback.
//
// IDENTITY
//   The SAME pinned staging App/WABA/phone digest triple as R7B, imported rather than
//   restated, so there is exactly ONE identity authority in the repository.
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
export const TARGET_TEMPLATE_NAME = "qf_client_matching_update_v2";
export const TARGET_LANGUAGE = "en";
export const TARGET_CATEGORY = "UTILITY";

/** sha256 of the canonical v2 creation payload, as produced by the packet generator. */
export const EXPECTED_PAYLOAD_FINGERPRINT =
  "9d3e900fb42fb23e5059e10ab5ff1bad09ef2cf8f70d86e26387652e74c553d4";

/** The exact committed body. Pinned so a packet edit cannot silently change the message. */
export const EXPECTED_BODY_TEXT =
  "Hi {{1}}, update on your QuickFurno enquiry: {{2}} professionals have been matched to it and may contact you about your request.";

/** The quarantined predecessor. Named ONLY so this operator can refuse to touch it. */
export const QUARANTINED_PREDECESSOR = Object.freeze({
  name: "qf_client_matching_update_v1",
  fingerprint: "c0930db5a9beee61de0076caf234b36f950554bc21c60b697845028a8d057e1c",
  provenRemoteCategory: "MARKETING",
});

/**
 * The packet state this target MUST be in.
 *
 * v2 has NEVER been submitted anywhere, so `draft` / `DRAFT_NOT_SUBMITTED` is the truthful
 * state, and `submit_now: false` keeps the ordinary packet submitter out. Once a live
 * creation is proven APPROVED the canonical packet advances to `approved` /
 * `APPROVED_UNMAPPED` and this pin must follow it, exactly as R7M's did after its own
 * approval. The operator never WRITES these — it refuses on drift.
 */
export const REQUIRED_PACKET_STATE = Object.freeze({
  submitNow: false,
  approvalStatus: "draft",
  submissionState: "DRAFT_NOT_SUBMITTED",
});

/** The EXACT field set both the pre-state GET and the post-create readback must request. */
export const REQUIRED_TEMPLATE_FIELDS = "id,name,language,status,category,components";

/** Process exit codes. An ambiguous MUTATION outcome must never look like success. */
export const ExitCode = Object.freeze({ OK: 0, REFUSED: 1, AMBIGUOUS: 2 });

/** PURE: the terminal exit code for an outcome. */
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
 * The closed pre-state vocabulary. R7B's states plus the three REFUSAL states this repair
 * exists BECAUSE OF: a row existing is not proof the right row exists, and this very key
 * already has a MARKETING row on this WABA.
 */
export const RepairPreState = Object.freeze({
  ...PreState,
  PRESENT_CATEGORY_MISMATCH: "PRESENT_CATEGORY_MISMATCH",
  PRESENT_CONTENT_MISMATCH: "PRESENT_CONTENT_MISMATCH",
  PRESENT_COMPONENTS_UNUSABLE: "PRESENT_COMPONENTS_UNUSABLE",
});

/** Re-exported so the validator proves the SAME objects R7B pinned. */
export { EXPECTED_IDENTITY_DIGESTS, OWNER_ACK_FLAG, Outcome, PreState, ALREADY_CREATED_STATUSES };

// ---------------------------------------------------------------------------
// PURE: the canonical v2 payload, sourced FROM THE COMMITTED PACKET so it cannot drift
// from the audited catalogue, then proved against the pinned fingerprint.
// ---------------------------------------------------------------------------
export function loadCanonicalPayload(packet) {
  const bad = (reason) => ({ ok: false, reason, payload: null, fingerprint: null });
  if (!packet || !Array.isArray(packet.templates)) return bad("packet_unreadable");

  const matches = packet.templates.filter((t) => t.internal_template_key === TARGET_TEMPLATE_KEY);
  if (matches.length !== 1) return bad("target_entry_not_unique");
  const entry = matches[0];

  // The canonical entry must name the SUCCESSOR. If it still names the quarantined v1,
  // the supersession has not been applied and this operator must not run.
  if (entry.provider_template_name === QUARANTINED_PREDECESSOR.name) return bad("still_pinned_to_quarantined_v1");
  if (entry.provider_template_name !== TARGET_TEMPLATE_NAME) return bad("name_mismatch");

  if (entry.submit_now !== REQUIRED_PACKET_STATE.submitNow) return bad("submit_now_not_held");
  const local = entry.local_state;
  if (!local || typeof local !== "object") return bad("local_state_missing");
  if (local.approval_status !== REQUIRED_PACKET_STATE.approvalStatus) return bad("approval_status_unexpected");
  if (local.submission_state !== REQUIRED_PACKET_STATE.submissionState) return bad("submission_state_unexpected");
  if (local.provider_template_id !== null) return bad("provider_template_id_present");

  const payload = entry.creation_payload;
  if (!payload || typeof payload !== "object") return bad("payload_missing");

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

  // TWO positional variables, fixed by the runtime binding contract: body keys are exactly
  // `example,text,type` and the example row carries exactly two values.
  const bodyKeys = Object.keys(body).sort().join(",");
  if (bodyKeys !== "example,text,type") return bad("body_shape_unexpected");
  if (body.text !== EXPECTED_BODY_TEXT) return bad("body_text_mismatch");
  const placeholders = (body.text.match(/\{\{\s*\d+\s*\}\}/g) ?? []).map((p) => p.replace(/\s/g, ""));
  if (placeholders.length !== 2 || placeholders[0] !== "{{1}}" || placeholders[1] !== "{{2}}") {
    return bad("variable_shape_unexpected");
  }
  const rows = body.example?.body_text;
  if (!Array.isArray(rows) || rows.length !== 1) return bad("example_shape_unexpected");
  if (!Array.isArray(rows[0]) || rows[0].length !== 2) return bad("example_arity_unexpected");
  if (!rows[0].every((v) => typeof v === "string" && v.length > 0)) return bad("example_value_invalid");

  const fingerprint = sha256Hex(JSON.stringify(payload));
  if (fingerprint !== EXPECTED_PAYLOAD_FINGERPRINT) return bad("fingerprint_drift");
  // A successor that hashes to the quarantined predecessor is the same template again.
  if (fingerprint === QUARANTINED_PREDECESSOR.fingerprint) return bad("successor_equals_quarantined_v1");

  return { ok: true, reason: null, payload, fingerprint };
}

// ---------------------------------------------------------------------------
// PURE: remote pre-state, proved against the canonical v2 payload.
// Fail-closed on every malformed HTTP-200 shape.
// ---------------------------------------------------------------------------
export function classifyPreState(lookup, expectedPayload) {
  const unreadable = { state: RepairPreState.UNREADABLE, row: null };
  if (!lookup || lookup.ok !== true) return unreadable;

  // A 200 is not a READABLE 200. Collapsing an unparseable shape to an empty list would
  // yield ABSENT — the ONE state that can reach a POST.
  const body = lookup.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return unreadable;
  if (!Array.isArray(body.data)) return unreadable;

  const rows = body.data;
  for (const r of rows) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return unreadable;
    if (typeof r.name !== "string" || r.name.length === 0) return unreadable;
    if (r.name === TARGET_TEMPLATE_NAME && (typeof r.language !== "string" || r.language.length === 0)) {
      return unreadable;
    }
  }

  // The quarantined v1 shares this key but NOT this name, so it is excluded by the exact
  // name filter and can never be mistaken for the successor.
  const exact = rows.filter((r) => r.name === TARGET_TEMPLATE_NAME && r.language === TARGET_LANGUAGE);

  if (exact.length === 0) return { state: RepairPreState.ABSENT, row: null };
  if (exact.length > 1) return { state: RepairPreState.AMBIGUOUS, row: null };

  const row = exact[0];
  const status = String(row.status ?? "").toUpperCase();
  if (!ALREADY_CREATED_STATUSES.includes(status)) return { state: RepairPreState.PRESENT_OTHER_STATUS, row };
  if (String(row.category ?? "").toUpperCase() !== TARGET_CATEGORY) {
    return { state: RepairPreState.PRESENT_CATEGORY_MISMATCH, row };
  }
  if (!Array.isArray(row.components)) return { state: RepairPreState.PRESENT_COMPONENTS_UNUSABLE, row };

  // Remote components ONLY — never the local payload.
  const identical = expectedPayload
    ? templatesAreIdentical(
        { name: row.name, language: row.language, category: row.category, components: row.components },
        expectedPayload)
    : false;
  if (!identical) return { state: RepairPreState.PRESENT_CONTENT_MISMATCH, row };

  return { state: RepairPreState.ALREADY_CREATED, row };
}

// ---------------------------------------------------------------------------
// CLI. Only runs as entry point, so the validator imports the pure layer freely.
// ---------------------------------------------------------------------------
const isEntry = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntry) {
  const parsedFlags = parseFlags(process.argv.slice(2));
  // QF-MVP-40-R8 — spent historical authority: the mutation bit is forced false here,
  // before any decision, network call or readback. Dry-run reading still works.
  const flags = retireHistoricalMutation(parsedFlags, { operatorId: "QF-MVP-40-R7N", mutationKey: "mayPost" });
  const env = process.env;

  console.log("== QF-MVP-40-R7N client matching update Utility category repair ==");
  console.log(`   mode                    : ${flags.mayPost ? "EXECUTE" : "DRY RUN"}`);
  console.log(historicalRetirementBanner(flags.retiredOperatorId));
  console.log(`   target template         : ${TARGET_TEMPLATE_NAME}`);
  console.log(`   quarantined predecessor : ${QUARANTINED_PREDECESSOR.name} (${QUARANTINED_PREDECESSOR.provenRemoteCategory}) — never touched`);

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
      console.log("RESULT: ALREADY_CREATED — no POST. The v2 repair is already in place.");
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
    // semantic match. A second MARKETING approval therefore does NOT confirm the repair.
    const confirmed = after.state === RepairPreState.ALREADY_CREATED;
    const outcome =
      classification === CreateClassification.SUCCESS && confirmed
        ? Outcome.CREATED
        : Outcome.CREATE_AMBIGUOUS;

    console.log(`   semantic confirmation   : ${confirmed}`);
    console.log(`RESULT: ${outcome} — exactly ${http.postCount()} POST, no retry`);
    return exitCodeForOutcome(outcome);
  };

  /**
   * TERMINAL FAILURE HANDLER. An exception AFTER the single POST is a mutation with an
   * unproven outcome — CREATE_AMBIGUOUS, not a plain refusal. The POST counter is the
   * authority (R7B's makeHttp increments BEFORE issuing). Neither branch retries, and
   * neither can issue a second POST. The exception is never printed: it may carry the
   * Authorization header, the token, or a raw provider payload.
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
