// ============================================================================
// QF-MVP-40-R7L — BOUNDED one-shot WABA-SCOPED RECOVERY of the remaining HELD
// Utility templates on the dedicated staging WABA. DRY RUN BY DEFAULT.
//
//   node scripts/mvp/communication/create-meta-staging-held-utility-recovery-once.mjs \
//     --target consent_stop_acknowledgement
//     -> GET-only DRY RUN for that one target. No POST, no mutation.
//
//   … --target <key> --execute --owner-authorized-once
//     -> Performs AT MOST ONE create POST, for that one target.
//
// WHY ONE BOUNDED OPERATOR RATHER THAN FIVE COPIES
//   R7B, R7I and R7K each pinned exactly one target, which was right while the targets
//   were being discovered one at a time. Five more copy-pasted files would multiply the
//   audit surface without adding safety: the reviewer would have to re-read the same
//   logic five times and diff it for subtle divergence.
//
//   This operator instead carries a FROZEN allow-list of exactly five compiled targets and
//   REQUIRES `--target <key>` to name one of them. The selector is bounded, not generic:
//
//     * the registry is `Object.freeze`d at module scope and every entry is frozen;
//     * a key absent from the registry is refused BEFORE any network call;
//     * provider name, language, category, wave, fingerprint and placeholder arity are
//       PINNED PER TARGET in the registry — none of them can come from argv or env;
//     * the payload is read only from the committed packet and must match the pinned
//       fingerprint exactly;
//     * there is NO batch mode, NO `--all`, and no way to select more than one target;
//     * a SIXTH target therefore requires a reviewed code change to this file.
//
//   That is strictly narrower than a generic submitter and no wider than five hard-pinned
//   operators, because the reachable target SET is identical and is fixed at compile time.
//
// WHY THE PACKET HOLD STAYS
//   All five entries are `submit_now: false` / `approved` / `APPROVED_UNMAPPED`. Those
//   approvals were proven against a PREVIOUS WABA; a GET-only reconciliation proved all
//   five ABSENT on the current dedicated WABA. The committed packet is deliberately
//   WABA-BLIND (`noSecretOrPii` forbids it from naming a WABA), so it cannot express
//   "approved on WABA A, absent on WABA B". Flipping `submit_now` would grant a GLOBAL
//   re-creation permission rather than the WABA-scoped one authorised here. The hold is
//   ASSERTED, never written.
//
// FAIL-CLOSED LOOKUP (inherited from the R7K-R1 review)
//   A 200 is not the same as a READABLE 200. Absence must be PROVEN by a real empty array,
//   never inferred from a shape we could not parse — ABSENT is the only state that can
//   reach a POST.
//
// WHAT IT CANNOT DO — enforced below and asserted by the validator
//   * no messaging/send endpoint;  * no DELETE / PUT / PATCH;
//   * no database, Supabase client or RPC;
//   * no mapping, provider-runtime, readiness, canary or webhook mutation;
//   * no arbitrary template/name/category/payload input;
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
  makeHttp,
  sha256Hex,
  validateIdentity,
} from "./create-meta-staging-vendor-onboarding-reminder-once.mjs";

const PACKET = "docs/provider-manifests/meta-template-submission-packet.json";

/** The packet state EVERY recoverable target must still be in. Asserted, never written. */
export const REQUIRED_PACKET_STATE = Object.freeze({
  submitNow: false,
  approvalStatus: "approved",
  submissionState: "APPROVED_UNMAPPED",
});

/**
 * THE FROZEN ALLOW-LIST. Exactly five compiled targets; a sixth requires a code change.
 *
 * `placeholders` is pinned per target because the shapes genuinely differ: the three
 * consent acknowledgements are ZERO-variable (body keys `text,type`, no `example`), while
 * the two lead templates carry one positional variable (body keys `example,text,type`).
 * A single hard-coded body rule would be wrong for one group or the other.
 */
export const RECOVERABLE_TARGETS = Object.freeze({
  consent_help_response: Object.freeze({
    key: "consent_help_response",
    providerName: "qf_consent_help_response_v3",
    language: "en",
    category: "UTILITY",
    wave: 0,
    fingerprint: "12f98c8b9504194ef9d983a606c9edd1c083dab1ba187915bdbea85fbc3e6c87",
    placeholders: 0,
  }),
  consent_stop_acknowledgement: Object.freeze({
    key: "consent_stop_acknowledgement",
    providerName: "qf_consent_stop_acknowledgement_v1",
    language: "en",
    category: "UTILITY",
    wave: 1,
    fingerprint: "850a4c01a48b78e237a85e186a448d8395abfb1e5049aaf6d8176b8628747268",
    placeholders: 0,
  }),
  consent_start_acknowledgement: Object.freeze({
    key: "consent_start_acknowledgement",
    providerName: "qf_consent_start_acknowledgement_v1",
    language: "en",
    category: "UTILITY",
    wave: 1,
    fingerprint: "70c0ce994180c2ea62ff3413d12d460734f5c004c40eb4d056925feec7e7251a",
    placeholders: 0,
  }),
  lead_received: Object.freeze({
    key: "lead_received",
    providerName: "qf_lead_received_v1",
    language: "en",
    category: "UTILITY",
    wave: 1,
    fingerprint: "dd818e01d293a683b3685f1f246f8cba6b1e4f8e6e106bcab72c4739af640e16",
    placeholders: 1,
  }),
  lead_assignment_alert: Object.freeze({
    key: "lead_assignment_alert",
    providerName: "qf_lead_assignment_alert_v1",
    language: "en",
    category: "UTILITY",
    wave: 1,
    fingerprint: "3f7997be7b8e1b019ba306a058b96f2d68aa84b7a014ea96407510030bb02453",
    placeholders: 1,
  }),
});

/** The exact key set this operator may ever touch. */
export const RECOVERABLE_KEYS = Object.freeze(Object.keys(RECOVERABLE_TARGETS));

/**
 * The EXACT field set both the pre-state GET and the post-create readback must request.
 * Requesting them explicitly fails closed against Graph API default-field drift.
 */
export const REQUIRED_TEMPLATE_FIELDS = "id,name,language,status,category,components";

/** The only flags this operator understands. Anything else is refused before the network. */
export const TARGET_FLAG = "--target";
export const EXECUTE_FLAG = "--execute";
export const KNOWN_FLAGS = Object.freeze([TARGET_FLAG, EXECUTE_FLAG, OWNER_ACK_FLAG]);

/** Process exit codes. An ambiguous MUTATION outcome must never look like success. */
export const ExitCode = Object.freeze({ OK: 0, REFUSED: 1, AMBIGUOUS: 2 });

export const CliFailure = Object.freeze({
  TARGET_MISSING: "TARGET_MISSING",
  TARGET_VALUE_MISSING: "TARGET_VALUE_MISSING",
  TARGET_DUPLICATED: "TARGET_DUPLICATED",
  TARGET_UNKNOWN: "TARGET_UNKNOWN",
  UNKNOWN_FLAG: "UNKNOWN_FLAG",
  POSITIONAL_ARGUMENT: "POSITIONAL_ARGUMENT",
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
 * The closed pre-state vocabulary. R7B's states plus the three REFUSAL states the R7J
 * finding requires, because "a row exists" is not "the right row exists": this WABA
 * already holds a requested-UTILITY template Meta approved as MARKETING.
 */
export const HeldPreState = Object.freeze({
  ...PreState,
  PRESENT_CATEGORY_MISMATCH: "PRESENT_CATEGORY_MISMATCH",
  PRESENT_CONTENT_MISMATCH: "PRESENT_CONTENT_MISMATCH",
  PRESENT_COMPONENTS_UNUSABLE: "PRESENT_COMPONENTS_UNUSABLE",
});

/** Re-exported so the validator proves the SAME objects R7B pinned. */
export { EXPECTED_IDENTITY_DIGESTS, OWNER_ACK_FLAG, Outcome, PreState, ALREADY_CREATED_STATUSES };

// ---------------------------------------------------------------------------
// PURE: strict CLI parsing. Every refusal here happens BEFORE any network call.
//
// `--target` is MANDATORY in every mode, including dry run: an operator that defaults a
// target is how the wrong template gets created. Both `--target=key` and `--target key`
// are accepted; the value of the spaced form is consumed so it is never mistaken for a
// positional argument.
// ---------------------------------------------------------------------------
export function parseCli(argv = []) {
  const bad = (reason, detail = null) => ({ ok: false, reason, detail });

  let targetValue = null;
  let targetSeen = 0;
  let execute = false;
  let ownerAck = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === EXECUTE_FLAG) { execute = true; continue; }
    if (arg === OWNER_ACK_FLAG) { ownerAck = true; continue; }

    if (arg === TARGET_FLAG || arg.startsWith(`${TARGET_FLAG}=`)) {
      targetSeen += 1;
      if (arg.startsWith(`${TARGET_FLAG}=`)) {
        targetValue = arg.slice(TARGET_FLAG.length + 1);
      } else {
        const next = argv[i + 1];
        // A missing value, or a value that is itself a flag, is not a target.
        if (next === undefined || next.startsWith("-")) return bad(CliFailure.TARGET_VALUE_MISSING);
        targetValue = next;
        i += 1; // consume the value so it is never treated as a positional
      }
      continue;
    }

    if (arg.startsWith("-")) return bad(CliFailure.UNKNOWN_FLAG, arg);
    return bad(CliFailure.POSITIONAL_ARGUMENT, arg);
  }

  if (targetSeen === 0) return bad(CliFailure.TARGET_MISSING);
  if (targetSeen > 1) return bad(CliFailure.TARGET_DUPLICATED);
  if (typeof targetValue !== "string" || targetValue.length === 0) {
    return bad(CliFailure.TARGET_VALUE_MISSING);
  }
  // Own-property lookup only: a prototype key such as "constructor" is NOT a target.
  if (!Object.prototype.hasOwnProperty.call(RECOVERABLE_TARGETS, targetValue)) {
    return bad(CliFailure.TARGET_UNKNOWN, targetValue);
  }

  return {
    ok: true,
    target: RECOVERABLE_TARGETS[targetValue],
    execute,
    ownerAck,
    mayPost: execute && ownerAck,
  };
}

// ---------------------------------------------------------------------------
// PURE: the canonical payload for ONE registry target, sourced FROM THE COMMITTED PACKET
// so it cannot drift from the audited catalogue, then proved against the pinned
// fingerprint. Nothing here is constructed from argv or env.
// ---------------------------------------------------------------------------
export function loadCanonicalPayload(packet, target) {
  const bad = (reason) => ({ ok: false, reason, payload: null, fingerprint: null });
  if (!target || !Object.prototype.hasOwnProperty.call(RECOVERABLE_TARGETS, target.key)) {
    return bad("target_not_recoverable");
  }
  if (!packet || !Array.isArray(packet.templates)) return bad("packet_unreadable");

  const matches = packet.templates.filter((t) => t.internal_template_key === target.key);
  if (matches.length !== 1) return bad("target_entry_not_unique");
  const entry = matches[0];

  if (entry.provider_template_name !== target.providerName) return bad("name_mismatch");
  if (entry.submission_wave !== target.wave) return bad("wave_mismatch");

  // The global hold and the approved/unmapped posture must both still stand.
  if (entry.submit_now !== REQUIRED_PACKET_STATE.submitNow) return bad("submit_now_not_held");
  const local = entry.local_state;
  if (!local || typeof local !== "object") return bad("local_state_missing");
  if (local.approval_status !== REQUIRED_PACKET_STATE.approvalStatus) return bad("approval_status_unexpected");
  if (local.submission_state !== REQUIRED_PACKET_STATE.submissionState) return bad("submission_state_unexpected");

  const payload = entry.creation_payload;
  if (!payload || typeof payload !== "object") return bad("payload_missing");

  // Shape is closed: no parameter_format, no header, no footer, no buttons.
  const topKeys = Object.keys(payload).sort().join(",");
  if (topKeys !== "category,components,language,name") return bad("payload_shape_unexpected");
  if (payload.name !== target.providerName) return bad("name_mismatch");
  if (payload.language !== target.language) return bad("language_mismatch");
  if (payload.category !== target.category) return bad("category_mismatch");
  if (!Array.isArray(payload.components) || payload.components.length !== 1) {
    return bad("component_count_unexpected");
  }
  const body = payload.components[0];
  if (!body || body.type !== "body" || typeof body.text !== "string") return bad("body_component_invalid");
  if (Object.prototype.hasOwnProperty.call(body, "buttons")) return bad("buttons_present");

  // Placeholder arity is pinned PER TARGET, and the body shape follows from it: a
  // zero-variable template carries no `example`, a variable-bearing one must.
  const placeholders = (body.text.match(/\{\{\s*\d+\s*\}\}/g) ?? []).map((p) => p.replace(/\s/g, ""));
  if (placeholders.length !== target.placeholders) return bad("variable_shape_unexpected");
  for (let i = 0; i < placeholders.length; i += 1) {
    if (placeholders[i] !== `{{${i + 1}}}`) return bad("variable_shape_unexpected");
  }

  const bodyKeys = Object.keys(body).sort().join(",");
  if (target.placeholders === 0) {
    if (bodyKeys !== "text,type") return bad("body_shape_unexpected");
  } else {
    if (bodyKeys !== "example,text,type") return bad("body_shape_unexpected");
    const rows = body.example?.body_text;
    if (!Array.isArray(rows) || rows.length !== 1) return bad("example_shape_unexpected");
    if (!Array.isArray(rows[0]) || rows[0].length !== target.placeholders) return bad("example_arity_unexpected");
    if (!rows[0].every((v) => typeof v === "string" && v.length > 0)) return bad("example_value_invalid");
  }

  const fingerprint = sha256Hex(JSON.stringify(payload));
  if (fingerprint !== target.fingerprint) return bad("fingerprint_drift");

  return { ok: true, reason: null, payload, fingerprint };
}

// ---------------------------------------------------------------------------
// PURE: remote pre-state, proved against the canonical payload for the SELECTED target.
// Fail-closed on every malformed HTTP-200 shape (R7K-R1 rules).
// ---------------------------------------------------------------------------
export function classifyPreState(lookup, target, expectedPayload) {
  const unreadable = { state: HeldPreState.UNREADABLE, row: null };
  if (!target) return unreadable;
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
    // A row bearing the target NAME must also carry a usable language, or "is this the
    // en target?" is unanswerable. A different-name row needs no language to be excluded.
    if (r.name === target.providerName && (typeof r.language !== "string" || r.language.length === 0)) {
      return unreadable;
    }
  }

  const exact = rows.filter((r) => r.name === target.providerName && r.language === target.language);

  if (exact.length === 0) return { state: HeldPreState.ABSENT, row: null };
  if (exact.length > 1) return { state: HeldPreState.AMBIGUOUS, row: null };

  const row = exact[0];
  const status = String(row.status ?? "").toUpperCase();
  if (!ALREADY_CREATED_STATUSES.includes(status)) return { state: HeldPreState.PRESENT_OTHER_STATUS, row };
  if (String(row.category ?? "").toUpperCase() !== target.category) {
    return { state: HeldPreState.PRESENT_CATEGORY_MISMATCH, row };
  }
  if (!Array.isArray(row.components)) return { state: HeldPreState.PRESENT_COMPONENTS_UNUSABLE, row };

  // Remote components ONLY — never the local payload.
  const identical = expectedPayload
    ? templatesAreIdentical(
        { name: row.name, language: row.language, category: row.category, components: row.components },
        expectedPayload)
    : false;
  if (!identical) return { state: HeldPreState.PRESENT_CONTENT_MISMATCH, row };

  return { state: HeldPreState.ALREADY_CREATED, row };
}

// ---------------------------------------------------------------------------
// PURE: the whole decision. Only ABSENT + both mutation flags may ever post.
// ---------------------------------------------------------------------------
export function decide({ cli, identity, payloadResult, preState }) {
  if (!identity.ok) return { post: false, outcome: Outcome.REFUSED, reason: identity.faults.join(",") };
  if (!payloadResult.ok) return { post: false, outcome: Outcome.REFUSED, reason: payloadResult.reason };
  if (preState === HeldPreState.ALREADY_CREATED) {
    return { post: false, outcome: Outcome.ALREADY_CREATED, reason: "remote row already exists" };
  }
  if (preState !== HeldPreState.ABSENT) {
    return { post: false, outcome: Outcome.REFUSED, reason: `pre_state:${preState}` };
  }
  if (!cli.mayPost) return { post: false, outcome: Outcome.DRY_RUN_WOULD_POST, reason: null };
  return { post: true, outcome: null, reason: null };
}

// ---------------------------------------------------------------------------
// CLI. Only runs as entry point, so the validator imports the pure layer freely.
// ---------------------------------------------------------------------------
const isEntry = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntry) {
  const cli = parseCli(process.argv.slice(2));

  console.log("== QF-MVP-40-R7L bounded held-Utility recovery ==");
  console.log(`   recoverable targets     : ${RECOVERABLE_KEYS.join(", ")}`);

  if (!cli.ok) {
    console.log(`   cli                     : REFUSED -> ${cli.reason}${cli.detail ? ` (${cli.detail})` : ""}`);
    console.log("RESULT: REFUSED (cli) — zero Meta calls");
    process.exit(ExitCode.REFUSED);
  }

  const target = cli.target;
  const env = process.env;

  console.log(`   mode                    : ${cli.mayPost ? "EXECUTE" : "DRY RUN"}`);
  console.log(`   target key              : ${target.key}`);
  console.log(`   target template         : ${target.providerName}`);
  console.log(`   target wave/category    : ${target.wave} / ${target.category}`);

  const identity = validateIdentity(env);
  console.log(`   identity authorised     : ${identity.ok}${identity.ok ? "" : " -> " + identity.faults.join(", ")}`);

  let packet = null;
  try { packet = JSON.parse(readFileSync(resolve(PACKET), "utf8")); } catch { packet = null; }
  const payloadResult = loadCanonicalPayload(packet, target);
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
      `/message_templates?name=${encodeURIComponent(target.providerName)}&fields=${REQUIRED_TEMPLATE_FIELDS}`);
    const pre = classifyPreState(lookup, target, payloadResult.payload);
    console.log(`   remote pre-state        : ${pre.state}`);
    if (pre.row) {
      console.log(`   existing row            : status=${pre.row.status} category=${pre.row.category} language=${pre.row.language}`);
    }

    const decision = decide({ cli, identity, payloadResult, preState: pre.state });

    if (decision.outcome === Outcome.ALREADY_CREATED) {
      console.log(`POST_ATTEMPT_COUNT=${http.postCount()}`);
      console.log("RESULT: ALREADY_CREATED — no POST. This target is already recovered.");
      return exitCodeForOutcome(Outcome.ALREADY_CREATED);
    }
    if (!decision.post) {
      console.log(`POST_ATTEMPT_COUNT=${http.postCount()}`);
      if (decision.outcome === Outcome.DRY_RUN_WOULD_POST) {
        console.log(`   would POST to           : /${env.QF_META_GRAPH_API_VERSION}/<waba>/message_templates`);
        console.log(`   would POST body         : ${JSON.stringify(payloadResult.payload)}`);
        console.log("WOULD_POST=YES");
        console.log(`RESULT: DRY RUN — zero Meta mutation. Re-run with ${EXECUTE_FLAG} ${OWNER_ACK_FLAG} to create.`);
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
      `/message_templates?name=${encodeURIComponent(target.providerName)}&fields=${REQUIRED_TEMPLATE_FIELDS}`);
    const after = classifyPreState(back, target, payloadResult.payload);
    console.log(`   readback state          : ${after.state}`);
    if (after.row) {
      console.log(`   remote id               : ${after.row.id ?? "(not returned)"}`);
      console.log(`   remote status           : ${after.row.status}`);
      console.log(`   remote category         : ${after.row.category}`);
      console.log(`   remote language         : ${after.row.language}`);
      console.log(`   remote components       : ${Array.isArray(after.row.components) ? `${after.row.components.length} returned` : "MISSING — cannot confirm"}`);
    }

    // CONFIRMED only when the readback itself reached ALREADY_CREATED, which already
    // requires exactly one row, the pinned category, usable REMOTE components and a full
    // semantic match. Anything else is AMBIGUOUS — never CREATED, and never retried.
    const confirmed = after.state === HeldPreState.ALREADY_CREATED;
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
   * this process never proved — that is CREATE_AMBIGUOUS. The POST counter is the
   * authority: R7B's `makeHttp` increments it BEFORE issuing, so a throwing transport is
   * correctly counted. Neither branch retries, and neither can issue a second POST.
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
