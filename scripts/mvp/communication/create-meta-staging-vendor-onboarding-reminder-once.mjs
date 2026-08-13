// ============================================================================
// QF-MVP-40-R7B — ONE-SHOT governed FIRST CREATION of a single named template on
// the dedicated staging WABA.  DRY RUN BY DEFAULT.
//
//   node scripts/mvp/communication/create-meta-staging-vendor-onboarding-reminder-once.mjs
//     -> DRY RUN. Proves identity, pre-state and payload. No POST, no mutation.
//
//   … --execute --owner-authorized-once
//     -> Performs AT MOST ONE create POST.
//
// WHY THIS EXISTS, AND WHY IT IS NOT A SUBMITTER
//   The audited packet operator (submit-meta-templates.mjs) is correctly refusing this
//   template: `vendor_onboarding_reminder` is in the validator's CLOSED_KEYS and
//   `closedStateModel` pins `submit_now === false` for every closed key. That model is
//   GLOBAL and NAME-SCOPED — it deliberately carries no WABA dimension, and the packet is
//   forbidden by `noSecretOrPii` from ever naming one. So the packet CANNOT express
//   "already approved on WABA A, absent on WABA B", and flipping `submit_now` would grant
//   a global re-creation permission rather than the WABA-scoped one the owner authorised.
//
//   Rather than weaken that model, this file is a SEPARATE, DELIBERATELY NON-GENERAL
//   authority for exactly one operation. It reads the packet only to source the canonical
//   payload; it never consults, sets or relies on `submit_now`, and it changes nothing in
//   the packet, the remote-state ledger, CLOSED_KEYS or closedStateModel.
//
// WHAT IT CANNOT DO — enforced below and asserted by the validator
//   * no messaging/send endpoint;  * no DELETE / PUT / PATCH;
//   * no database access;          * no provider / mapping / canary authority;
//   * no template selector — the name, key and payload fingerprint are PINNED;
//   * no second POST, ever, including after an ambiguous result.
//
// IDENTITY IS PINNED AS DIGESTS, NOT RAW IDS
//   The repository's privacy posture keeps Meta asset ids out of committed artifacts
//   (`noSecretOrPii` rejects a "waba_id" key in the packet; the remote-state ledger states
//   no WABA id appears in it). Pinning SHA-256 digests preserves that posture exactly while
//   still failing closed against every other WABA, app and phone: the operator compares
//   digest(process-local id) against the pinned digest. No raw Meta id is committed here.
//
//   There is no committed Meta deny-list to reuse (the R3/R5 deny-list machinery covers
//   SUPABASE project refs, and the R3 asset-scope classifier is canary-ARMING authority
//   gated on an owner attestation that does not exist for template creation). An exact
//   allow-list of ONE identity triple is strictly stronger here than a deny-list would be.
// ============================================================================

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { API_VERSION_PATTERN, classifyCreateResponse, safeMetaError, templatesAreIdentical, validateEnvironment, CreateClassification } from "./submit-meta-templates.mjs";

const PACKET = "docs/provider-manifests/meta-template-submission-packet.json";
const GRAPH = "https://graph.facebook.com";

/** The ONE template this operator may ever create. Not a parameter. */
export const TARGET_TEMPLATE_KEY = "vendor_onboarding_reminder";
export const TARGET_TEMPLATE_NAME = "qf_vendor_onboarding_reminder_v1";
export const TARGET_LANGUAGE = "en";
export const TARGET_CATEGORY = "UTILITY";

/** sha256 of the canonical creation payload, as produced by the packet generator. */
export const EXPECTED_PAYLOAD_FINGERPRINT =
  "c6e95a38dde899f717999520082feddf4c91f2a33c84650c72538ef2c111199a";

/** SHA-256 digests of the ONLY authorised staging identity triple. */
export const EXPECTED_IDENTITY_DIGESTS = Object.freeze({
  appId: "6de73d8d79a40245af3dfa60065ae6a86274b043d8646ec3a84a0719273ece80",
  wabaId: "c9b1f7e0bda69377219b80f8ca73b91475405aefe1e48babd0dc24231cc8037a",
  phoneNumberId: "1b93eabc591212e3cfa0cd53423d6ebb333afa0f07f7e4a5a4ea246d736c969c",
});

/** The exact acknowledgement flag. A truthy env var is deliberately NOT accepted. */
export const OWNER_ACK_FLAG = "--owner-authorized-once";

/** Remote statuses that mean "already created — do not post again". */
export const ALREADY_CREATED_STATUSES = Object.freeze(["APPROVED", "PENDING"]);

export const Outcome = Object.freeze({
  DRY_RUN_WOULD_POST: "DRY_RUN_WOULD_POST",
  ALREADY_CREATED: "ALREADY_CREATED",
  CREATED: "CREATED",
  CREATE_AMBIGUOUS: "CREATE_AMBIGUOUS",
  REFUSED: "REFUSED",
});

export function sha256Hex(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// PURE: flags. Dry run unless BOTH flags are present, exactly.
// ---------------------------------------------------------------------------
export function parseFlags(argv = []) {
  const execute = argv.includes("--execute");
  const ownerAck = argv.includes(OWNER_ACK_FLAG);
  return { execute, ownerAck, mayPost: execute && ownerAck };
}

// ---------------------------------------------------------------------------
// PURE: identity. Exact digest equality for all three ids, plus the shared R5
// environment grammar (version/WABA shape/token presence) from the audited operator.
// ---------------------------------------------------------------------------
export function validateIdentity(env = {}) {
  const base = validateEnvironment(env);
  const faults = [];
  if (!base.ok) {
    for (const m of base.missing) faults.push(`missing:${m}`);
    for (const i of base.invalid) faults.push(`invalid:${i}`);
  }
  if (env.QF_META_PHONE_NUMBER_ID === undefined || env.QF_META_PHONE_NUMBER_ID === "") {
    faults.push("missing:QF_META_PHONE_NUMBER_ID");
  }
  if (env.QF_META_APP_ID === undefined || env.QF_META_APP_ID === "") {
    faults.push("missing:QF_META_APP_ID");
  }
  const pairs = [
    ["QF_META_APP_ID", env.QF_META_APP_ID, EXPECTED_IDENTITY_DIGESTS.appId],
    ["QF_META_WABA_ID", env.QF_META_WABA_ID, EXPECTED_IDENTITY_DIGESTS.wabaId],
    ["QF_META_PHONE_NUMBER_ID", env.QF_META_PHONE_NUMBER_ID, EXPECTED_IDENTITY_DIGESTS.phoneNumberId],
  ];
  for (const [name, value, expected] of pairs) {
    if (value === undefined || value === "") continue;   // already reported as missing
    if (sha256Hex(value) !== expected) faults.push(`unauthorized_identity:${name}`);
  }
  const version = env.QF_META_GRAPH_API_VERSION;
  if (version && !API_VERSION_PATTERN.test(version)) faults.push("invalid:QF_META_GRAPH_API_VERSION");
  return { ok: faults.length === 0, faults };
}

// ---------------------------------------------------------------------------
// PURE: the canonical payload, sourced FROM THE COMMITTED PACKET so it cannot drift
// from the audited catalogue, then proved against the pinned fingerprint.
//
// The packet's `submit_now` is NEVER read: this operator's authority is its own, and
// the packet's global hold is left exactly as committed.
// ---------------------------------------------------------------------------
export function loadCanonicalPayload(packet) {
  const bad = (reason) => ({ ok: false, reason, payload: null, fingerprint: null });
  if (!packet || !Array.isArray(packet.templates)) return bad("packet_unreadable");

  const matches = packet.templates.filter((t) => t.internal_template_key === TARGET_TEMPLATE_KEY);
  if (matches.length !== 1) return bad("target_entry_not_unique");
  const entry = matches[0];

  if (entry.provider_template_name !== TARGET_TEMPLATE_NAME) return bad("name_mismatch");
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

  // Exactly one positional variable, and no other placeholder.
  const placeholders = body.text.match(/\{\{\s*\d+\s*\}\}/g) ?? [];
  if (placeholders.length !== 1 || placeholders[0].replace(/\s/g, "") !== "{{1}}") {
    return bad("variable_shape_unexpected");
  }

  const fingerprint = sha256Hex(JSON.stringify(payload));
  if (fingerprint !== EXPECTED_PAYLOAD_FINGERPRINT) return bad("fingerprint_drift");

  return { ok: true, reason: null, payload, fingerprint };
}

// ---------------------------------------------------------------------------
// PURE: remote pre-state from an exact-name lookup.
// ---------------------------------------------------------------------------
export const PreState = Object.freeze({
  ABSENT: "ABSENT",
  ALREADY_CREATED: "ALREADY_CREATED",
  PRESENT_OTHER_STATUS: "PRESENT_OTHER_STATUS",
  AMBIGUOUS: "AMBIGUOUS",
  UNREADABLE: "UNREADABLE",
});

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
// PURE: live asset proof. Every id is compared as a DIGEST against the pinned
// triple, so an unauthorised (e.g. production) asset can never satisfy it, and the
// subscriber set must be EXACTLY the one staging app — an extra subscriber fails.
// ---------------------------------------------------------------------------
export function classifyLiveAssets({ waba, phones, subs } = {}) {
  const faults = [];

  const wabaId = waba?.ok === true ? String(waba.body?.id ?? "") : "";
  if (waba?.ok !== true) faults.push("waba_unreadable");
  else if (sha256Hex(wabaId) !== EXPECTED_IDENTITY_DIGESTS.wabaId) faults.push("waba_identity_mismatch");

  const phoneRows = Array.isArray(phones?.body?.data) ? phones.body.data : [];
  const phoneExact = phoneRows.filter(
    (p) => sha256Hex(String(p?.id ?? "")) === EXPECTED_IDENTITY_DIGESTS.phoneNumberId);
  if (phones?.ok !== true) faults.push("phones_unreadable");
  else if (phoneRows.length !== 1 || phoneExact.length !== 1) faults.push("phone_set_mismatch");
  else if (String(phoneExact[0].code_verification_status ?? "").toUpperCase() !== "VERIFIED") {
    faults.push("phone_not_code_verified");
  }

  const subRows = Array.isArray(subs?.body?.data) ? subs.body.data : [];
  const subIds = subRows.map((a) => String(a?.whatsapp_business_api_data?.id ?? a?.id ?? ""));
  if (subs?.ok !== true) faults.push("subscribers_unreadable");
  else if (subIds.length !== 1) faults.push("subscriber_set_not_exactly_one");
  else if (sha256Hex(subIds[0]) !== EXPECTED_IDENTITY_DIGESTS.appId) faults.push("subscriber_app_mismatch");

  return {
    ok: faults.length === 0,
    faults,
    qualityRating: phoneExact[0]?.quality_rating ?? null,
    subscriberCount: subIds.length,
  };
}

// ---------------------------------------------------------------------------
// PURE: the whole decision. Only ABSENT + both flags may ever post.
// ---------------------------------------------------------------------------
export function decide({ flags, identity, payloadResult, preState }) {
  if (!identity.ok) return { post: false, outcome: Outcome.REFUSED, reason: identity.faults.join(",") };
  if (!payloadResult.ok) return { post: false, outcome: Outcome.REFUSED, reason: payloadResult.reason };
  if (preState === PreState.ALREADY_CREATED) {
    return { post: false, outcome: Outcome.ALREADY_CREATED, reason: "remote row already exists" };
  }
  if (preState !== PreState.ABSENT) {
    return { post: false, outcome: Outcome.REFUSED, reason: `pre_state:${preState}` };
  }
  if (!flags.mayPost) {
    return { post: false, outcome: Outcome.DRY_RUN_WOULD_POST, reason: null };
  }
  return { post: true, outcome: null, reason: null };
}

// ---------------------------------------------------------------------------
// Network. GET is unrestricted; POST is hard-limited to ONE per process.
// ---------------------------------------------------------------------------
export function makeHttp({ version, wabaId, token, fetchImpl = fetch }) {
  const base = `${GRAPH}/${version}/${wabaId}`;
  let postCount = 0;
  return {
    postCount: () => postCount,
    async get(path) {
      try {
        const r = await fetchImpl(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
        let body = null;
        try { body = await r.json(); } catch { body = null; }
        return { ok: r.ok, status: r.status, body };
      } catch {
        return { ok: false, status: null, body: null };
      }
    },
    /** The ONLY mutating call in this file. A second attempt throws rather than posts. */
    async createOnce(payload) {
      if (postCount > 0) throw new Error("SECOND_POST_REFUSED");
      postCount += 1;
      try {
        const r = await fetchImpl(`${base}/message_templates`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        let body = null;
        try { body = await r.json(); } catch { body = null; }
        return { threw: false, httpStatus: r.status, body };
      } catch {
        return { threw: true, httpStatus: null, body: null };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// CLI. Only runs as entry point, so the validator imports the pure layer freely.
// ---------------------------------------------------------------------------
const isEntry = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntry) {
  const flags = parseFlags(process.argv.slice(2));
  const env = process.env;

  console.log("== QF-MVP-40-R7B one-shot staging template creation ==");
  console.log(`   mode                    : ${flags.mayPost ? "EXECUTE" : "DRY RUN"}`);
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
    process.exit(1);
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
      return 1;
    }

    // -- exact-name pre-state --------------------------------------------------
    const lookup = await http.get(`/message_templates?name=${encodeURIComponent(TARGET_TEMPLATE_NAME)}`);
    const pre = classifyPreState(lookup);
    console.log(`   remote pre-state        : ${pre.state}`);

    const decision = decide({ flags, identity, payloadResult, preState: pre.state });

    if (decision.outcome === Outcome.ALREADY_CREATED) {
      console.log(`   existing row            : status=${pre.row.status} category=${pre.row.category} language=${pre.row.language}`);
      console.log(`POST_ATTEMPT_COUNT=${http.postCount()}`);
      console.log("RESULT: ALREADY_CREATED — no POST. Creation authority is spent.");
      return 0;
    }
    if (!decision.post) {
      console.log(`POST_ATTEMPT_COUNT=${http.postCount()}`);
      if (decision.outcome === Outcome.DRY_RUN_WOULD_POST) {
        console.log(`   would POST to           : /${env.QF_META_GRAPH_API_VERSION}/<waba>/message_templates`);
        console.log(`   would POST body         : ${JSON.stringify(payloadResult.payload)}`);
        console.log("WOULD_POST=YES");
        console.log(`RESULT: DRY RUN — zero Meta mutation. Re-run with --execute ${OWNER_ACK_FLAG} to create.`);
        return 0;
      }
      console.log(`RESULT: REFUSED (${decision.outcome}: ${decision.reason}) — zero POST`);
      return 1;
    }

    // -- THE single POST -------------------------------------------------------
    const res = await http.createOnce(payloadResult.payload);
    const classification = classifyCreateResponse(res);
    console.log(`POST_ATTEMPT_COUNT=${http.postCount()}`);
    console.log(`   create classification   : ${classification}`);
    if (classification === CreateClassification.DETERMINISTIC_4XX_REJECTION) {
      const e = safeMetaError(res.body);
      console.log(`   meta error (structured) : code=${e.code ?? "?"} type=${e.type ?? "?"} subcode=${e.error_subcode ?? "?"}`);
      console.log("RESULT: REJECTED — no retry, no second POST");
      return 1;
    }

    // ONE read-only readback, whether the create was clean or ambiguous.
    const back = await http.get(`/message_templates?name=${encodeURIComponent(TARGET_TEMPLATE_NAME)}`);
    const after = classifyPreState(back);
    console.log(`   readback state          : ${after.state}`);
    if (after.row) {
      const semantic = templatesAreIdentical(
        { name: after.row.name, language: after.row.language, category: after.row.category, components: after.row.components ?? payloadResult.payload.components },
        payloadResult.payload);
      console.log(`   remote id               : ${after.row.id ?? "(not returned)"}`);
      console.log(`   remote status           : ${after.row.status}`);
      console.log(`   remote category         : ${after.row.category}`);
      console.log(`   remote language         : ${after.row.language}`);
      console.log(`   semantic match          : ${semantic}`);
    }
    console.log(`RESULT: ${classification === CreateClassification.SUCCESS ? Outcome.CREATED : Outcome.CREATE_AMBIGUOUS} — exactly ${http.postCount()} POST, no retry`);
    return 0;
  };

  run().then((code) => process.exit(code)).catch(() => {
    console.log("RESULT: REFUSED (unexpected failure) — no retry");
    process.exit(1);
  });
}
