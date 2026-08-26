// ============================================================================
// QF-MVP-40-R8B — ONE-SHOT governed FIRST CREATION of `qf_vendor_onboarding_reminder_v1`
// on the ACTUAL dedicated staging/test WABA.  DRY RUN BY DEFAULT.
//
//   node scripts/mvp/communication/create-actual-staging-vendor-onboarding-reminder-once.mjs
//     -> DRY RUN. Proves identity, the owner asset attestation, the live asset set, the
//        pre-state and the payload. No POST, no mutation.
//
//   … --execute --owner-authorized-once-actual-staging-create
//     -> Performs AT MOST ONE create POST.
//
// WHY THIS EXISTS, AND WHY IT IS NOT R7B RERUN
//   R7B created this template name once, on 2026-08-13, and its authority is spent. Live
//   diagnosis on 2026-08-25 proved R7B's "staging" WABA/phone pins are the PRODUCTION
//   WABA and phone. The ACTUAL dedicated staging/test WABA carries only Meta's own sample
//   templates and returns ZERO rows for this name.
//
//   R7B is therefore NOT reopened, and its constants are NOT repointed: converting a
//   spent one-shot into a live one against a different WABA by editing a pin is the
//   governance failure QF-MVP-40-R8 exists to prevent. R7B stays retired and read-only.
//   This is a NEW authority with its OWN acknowledgement flag and its OWN manifest.
//
// R7B'S EVIDENCE IS NOT THIS OPERATION'S PRE-STATE
//   The R7B execution record and the 2026-08-24 truth sweep are evidence for the remote
//   identity they actually observed — the historical mixed triple. They are NOT proof of
//   anything on the actual staging WABA, and this operator never consults them. The only
//   pre-state it accepts is a live exact-name lookup returning ABSENT.
//
// THE TWO-SUBSCRIBER WABA IS HANDLED BY ATTESTATION, NOT BY TOLERANCE
//   The actual staging WABA legitimately carries more than one subscribed app. This
//   operator does NOT relax R7B's `subscriberCount === 1` to a count or a range, and it
//   does NOT hard-code any companion app id as safe. It reuses the QF-MVP-40-R7A model
//   already committed in activate-meta-staging-canary.mjs: the owner declares the EXACT
//   subscribed-app id set in a short-lived external proof, and the live readback must
//   equal that set exactly — no extra, no missing, order irrelevant. A display name such
//   as any "1P App" label is free text and is never evidence here.
//
// PHONE STATE IS OBSERVED, NOT ENFORCED (QF-MVP-40-R8B-R1)
//   The WABA-level template endpoint takes no phone number. This operator therefore
//   proves the phone's IDENTITY exactly — one phone on the WABA, matching the pinned
//   actual-staging phone digest — but does NOT require it to be code-verified. See the
//   block comment above readLiveAssets for the live evidence and the reasoning. Send
//   readiness remains mandatory on every send-capable path; none of them is touched here.
//
// WHAT IT CANNOT DO — enforced below and asserted by the validator
//   * no messaging/send endpoint;   * no DELETE / PUT / PATCH;
//   * no database access;            * no provider / mapping / canary / readiness authority;
//   * no template selector — the name, key and payload fingerprint are PINNED;
//   * no second POST, ever, including after an ambiguous result.
// ============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  API_VERSION_PATTERN,
  classifyCreateResponse,
  safeMetaError,
  templatesAreIdentical,
  validateEnvironment,
  CreateClassification,
} from "./submit-meta-templates.mjs";
// The audited R7B PURE layer. Imported, never copied. R7B's CLI is retired and its
// mutation bit is forced false; these helpers are pure and carry no authority. The
// payload loader is deliberately shared so the outbound body cannot drift from the one
// the packet defines.
import {
  ALREADY_CREATED_STATUSES,
  EXPECTED_PAYLOAD_FINGERPRINT,
  PreState,
  TARGET_CATEGORY,
  TARGET_LANGUAGE,
  TARGET_TEMPLATE_KEY,
  TARGET_TEMPLATE_NAME,
  classifyPreState,
  loadCanonicalPayload,
  makeHttp,
} from "./create-meta-staging-vendor-onboarding-reminder-once.mjs";
// The committed QF-MVP-40-R3/R7A asset-scope machinery, reused rather than reimplemented.
import {
  AssetScope,
  STAGING_ASSET_PROOF_ENV,
  buildStagingAssetProofAdapter,
  classifyMetaAssetScope,
  resolveGitHead,
} from "./activate-meta-staging-canary.mjs";
import { AUTHORIZED_STAGING_REF } from "./seed-meta-staging-inactive-mappings.mjs";
import {
  ACTUAL_STAGING_IDENTITY_DIGESTS,
  classifyStagingIdentity,
  isKnownProductionDigest,
  sha256Hex,
} from "./metaStagingIdentity.mjs";

export { ALREADY_CREATED_STATUSES, EXPECTED_PAYLOAD_FINGERPRINT, PreState, TARGET_CATEGORY,
         TARGET_LANGUAGE, TARGET_TEMPLATE_KEY, TARGET_TEMPLATE_NAME, classifyPreState,
         loadCanonicalPayload, makeHttp, sha256Hex, ACTUAL_STAGING_IDENTITY_DIGESTS };

const PACKET = "docs/provider-manifests/meta-template-submission-packet.json";

/**
 * The exact acknowledgement flag. Deliberately DIFFERENT from R7B's
 * `--owner-authorized-once`, which is spent on the historical WABA. An acknowledgement
 * already consumed against one WABA must never authorise a POST to another.
 */
export const OWNER_ACK_FLAG = "--owner-authorized-once-actual-staging-create";

/**
 * The attestation stage this operator consumes, and the only one it will accept.
 *
 * Being a scope-guarded stage grants NOTHING by itself: it makes the value legal in an
 * attestation, and the proof adapter then refuses any proof minted for a different stage.
 * So an ARM_READINESS or ARM_CANARY proof cannot create a template, and this proof cannot
 * arm anything.
 */
export const INTENDED_STAGE = "TEMPLATE_CREATION";

export const Outcome = Object.freeze({
  DRY_RUN_WOULD_POST: "DRY_RUN_WOULD_POST",
  ALREADY_CREATED: "ALREADY_CREATED",
  CREATED: "CREATED",
  CREATE_AMBIGUOUS: "CREATE_AMBIGUOUS",
  REFUSED: "REFUSED",
});

export const CreateFailure = Object.freeze({
  UNKNOWN_FLAG: "UNKNOWN_FLAG",
  IDENTITY_UNAUTHORIZED: "IDENTITY_UNAUTHORIZED",
  ASSET_SCOPE_UNPROVEN: "ASSET_SCOPE_UNPROVEN",
  PHONE_SET_MISMATCH: "PHONE_SET_MISMATCH",
  // QF-MVP-40-R8B-R1 removed PHONE_NOT_CODE_VERIFIED. It was a send-eligibility
  // predicate on an operation that cannot send, and it is not re-declared here: a
  // failure constant that can never fire is a false claim about what this file enforces.
  LIVE_ASSET_IS_PRODUCTION: "LIVE_ASSET_IS_PRODUCTION",
  SOURCE_HEAD_UNPROVEN: "SOURCE_HEAD_UNPROVEN",
});

// ---------------------------------------------------------------------------
// PURE: flags. Dry run unless BOTH flags are present, exactly. An unknown flag is
// REFUSED rather than ignored, so a typo cannot silently degrade to a dry run that the
// operator then reports as a success.
// ---------------------------------------------------------------------------
export function parseFlags(argv = []) {
  const known = new Set(["--execute", OWNER_ACK_FLAG]);
  const unknown = argv.filter((a) => !known.has(a));
  if (unknown.length > 0) {
    return { ok: false, reason: CreateFailure.UNKNOWN_FLAG, flag: unknown[0], mayPost: false };
  }
  const execute = argv.includes("--execute");
  const ownerAck = argv.includes(OWNER_ACK_FLAG);
  return { ok: true, execute, ownerAck, mayPost: execute && ownerAck };
}

// ---------------------------------------------------------------------------
// PURE: identity. Exact digest equality against the CANONICAL actual-staging pins, plus
// the shared R5 environment grammar (version / WABA shape / token presence).
//
// The pins come from metaStagingIdentity.mjs and are never re-declared here, so there is
// exactly one place in the repository where "which assets are staging" is stated.
// ---------------------------------------------------------------------------
export function validateIdentity(env = {}) {
  const base = validateEnvironment(env);
  const faults = [];
  if (!base.ok) {
    faults.push(...base.missing.map((m) => `missing:${m}`));
    faults.push(...base.invalid.map((i) => `invalid:${i}`));
  }
  const classified = classifyStagingIdentity({
    appId: env.QF_META_APP_ID,
    wabaId: env.QF_META_WABA_ID,
    phoneNumberId: env.QF_META_PHONE_NUMBER_ID,
  });
  // Spread rather than iterate: this file is scanned for control-flow constructs, and a
  // one-shot mutation operator must contain no loop a second POST could ever ride on.
  faults.push(...classified.faults);

  const version = env.QF_META_GRAPH_API_VERSION;
  if (version && !API_VERSION_PATTERN.test(version)) faults.push("invalid:QF_META_GRAPH_API_VERSION");
  return { ok: faults.length === 0, faults, digests: classified.digests };
}

// ---------------------------------------------------------------------------
// PURE: reduce the three live GET responses to the shape classifyMetaAssetScope reads,
// and apply the one check it deliberately does not make — the phone must be the ONLY
// phone on the WABA.
//
// QF-MVP-40-R8B-R1 — WHY `code_verification_status` IS OBSERVED BUT NOT ENFORCED
//   R8B creates a template through the WABA-level endpoint
//   `POST /{WABA-ID}/message_templates`. That endpoint takes no phone number, and a
//   template's existence and approval are properties of the WABA, not of any sender.
//   Requiring the phone to be code-verified therefore imposed a SEND-eligibility
//   precondition on an operation that cannot send.
//
//   Measured live on the actual staging WABA on 2026-08-26: the exact attested staging
//   phone (the one matching the pinned phone digest) reports
//   `code_verification_status = NOT_VERIFIED` with `quality_rating = GREEN`, and it is
//   the ONLY phone on that WABA. That is a legitimate state for a Meta TEST number, and it
//   turned an otherwise EXACT actual-staging identity proof into SHARED_OR_UNKNOWN,
//   making the governed creation path unreachable for a reason unrelated to its authority.
//
//   THIS IS A NARROWING, NOT A WEAKENING. The phone is still read live, must still be the
//   ONLY phone on the WABA, and its id must still equal the pinned actual-staging phone
//   identity through proveAssets/classifyMetaAssetScope. What is removed is exclusively
//   the send-eligibility predicate. Phone registration and send readiness remain
//   REQUIRED on every send-capable path (the canary runtime and the Meta provider gate
//   are untouched by this correction), and nothing here makes anything send-capable.
// ---------------------------------------------------------------------------

/**
 * Live phone fields this operator OBSERVES and reports, but deliberately does NOT gate on.
 * `quality_rating` was already advisory here; `code_verification_status` joins it under
 * QF-MVP-40-R8B-R1. Neither may ever become a precondition for template creation, and
 * neither is evidence of identity — identity is digest equality and nothing else.
 */
export const ADVISORY_PHONE_FIELDS = Object.freeze(["code_verification_status", "quality_rating"]);

export function readLiveAssets({ waba, phones, subs } = {}) {
  const faults = [];

  const wabaId = waba?.ok === true ? String(waba.body?.id ?? "") : "";
  if (waba?.ok !== true) faults.push("waba_unreadable");

  const phoneRows = Array.isArray(phones?.body?.data) ? phones.body.data : [];
  if (phones?.ok !== true) faults.push("phones_unreadable");
  else if (phoneRows.length !== 1) faults.push(CreateFailure.PHONE_SET_MISMATCH);
  // NOTE: no `code_verification_status` branch. See the block comment above. A phone that
  // is not code-verified is reported below and changes no decision in this operator.
  const phoneNumberId = phoneRows.length === 1 ? String(phoneRows[0]?.id ?? "") : "";

  // An unreadable subscriber list is NOT evidence of an empty one: leave it undefined so
  // classifyMetaAssetScope fails closed rather than comparing against [].
  const subscribedAppIds = subs?.ok === true && Array.isArray(subs.body?.data)
    ? subs.body.data.map((a) => String(a?.whatsapp_business_api_data?.id ?? a?.id ?? ""))
    : undefined;
  if (subs?.ok !== true) faults.push("subscribers_unreadable");

  // An independent production fence, ahead of and separate from the owner's prohibited
  // list: a known production asset can never appear anywhere in a staging readback.
  // Expressed with .some() rather than a loop, for the same control-flow reason above.
  const anyProductionAsset = [wabaId, phoneNumberId, ...(subscribedAppIds ?? [])]
    .some((id) => Boolean(id) && isKnownProductionDigest(sha256Hex(id)));
  if (anyProductionAsset) faults.push(CreateFailure.LIVE_ASSET_IS_PRODUCTION);

  return {
    ok: faults.length === 0,
    faults,
    live: { wabaId, phoneNumberId, subscribedAppIds },
    qualityRating: phoneRows.length === 1 ? (phoneRows[0]?.quality_rating ?? null) : null,
    // Advisory only — reported so an operator run is never silent about the phone's real
    // state, and never consulted by any decision in this file.
    codeVerificationStatus: phoneRows.length === 1
      ? (phoneRows[0]?.code_verification_status ?? null) : null,
    subscriberCount: Array.isArray(subscribedAppIds) ? subscribedAppIds.length : null,
  };
}

/**
 * PURE: the full asset proof — owner attestation AND live readback AND the local checks.
 *
 * Delegates set equality, head binding, identity agreement and the prohibited-asset rule
 * to the committed `classifyMetaAssetScope`, so this operator adds no second, weaker copy
 * of that logic. Anything short of STAGING_DEDICATED is a hard stop.
 */
export function proveAssets({ proof, assets, expected, branchHead } = {}) {
  if (!assets?.ok) {
    return { ok: false, scope: AssetScope.SHARED_OR_UNKNOWN, faults: assets?.faults ?? ["assets_unreadable"] };
  }
  const classified = classifyMetaAssetScope({ proof, live: assets.live, expected, branchHead });
  if (classified.scope !== AssetScope.STAGING_DEDICATED) {
    return { ok: false, scope: classified.scope, faults: [classified.reason ?? CreateFailure.ASSET_SCOPE_UNPROVEN] };
  }
  return { ok: true, scope: classified.scope, faults: [], proofHash: classified.proofHash };
}

// ---------------------------------------------------------------------------
// PURE: the whole decision. Only ABSENT + a proven asset scope + both flags may ever post.
// ---------------------------------------------------------------------------
export function decide({ flags, identity, assetProof, payloadResult, preState }) {
  const refuse = (reason) => ({ post: false, outcome: Outcome.REFUSED, reason });
  if (!flags.ok) return refuse(`${flags.reason}:${flags.flag ?? ""}`);
  if (!identity.ok) return refuse(identity.faults.join(","));
  if (!assetProof.ok) return refuse(assetProof.faults.join(","));
  if (!payloadResult.ok) return refuse(payloadResult.reason);

  if (preState === PreState.ALREADY_CREATED) {
    return { post: false, outcome: Outcome.ALREADY_CREATED, reason: "remote row already exists" };
  }
  if (preState !== PreState.ABSENT) return refuse(`pre_state:${preState}`);

  if (!flags.mayPost) return { post: false, outcome: Outcome.DRY_RUN_WOULD_POST, reason: null };
  return { post: true, outcome: null, reason: null };
}

// ---------------------------------------------------------------------------
// CLI. Only runs as entry point, so the validator imports the pure layer freely.
// ---------------------------------------------------------------------------
const isEntry = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntry) {
  const flags = parseFlags(process.argv.slice(2));
  const env = process.env;

  console.log("== QF-MVP-40-R8B one-shot ACTUAL-staging template creation ==");
  if (!flags.ok) {
    console.log(`RESULT: REFUSED (${flags.reason}: ${flags.flag}) — zero Meta calls`);
    process.exit(1);
  }
  console.log(`   mode                    : ${flags.mayPost ? "EXECUTE" : "DRY RUN"}`);
  console.log(`   target template         : ${TARGET_TEMPLATE_NAME} (${TARGET_LANGUAGE}, ${TARGET_CATEGORY})`);
  console.log(`   attestation stage       : ${INTENDED_STAGE}`);

  const identity = validateIdentity(env);
  console.log(`   identity authorised     : ${identity.ok}${identity.ok ? "" : " -> " + identity.faults.join(", ")}`);

  let packet = null;
  try { packet = JSON.parse(readFileSync(resolve(PACKET), "utf8")); } catch { packet = null; }
  const payloadResult = loadCanonicalPayload(packet);
  console.log(`   canonical payload proved: ${payloadResult.ok}${payloadResult.ok ? "" : " -> " + payloadResult.reason}`);
  if (payloadResult.ok) console.log(`   payload fingerprint     : ${payloadResult.fingerprint}`);

  if (!identity.ok || !payloadResult.ok) {
    console.log("POST_ATTEMPT_COUNT=0");
    console.log("RESULT: REFUSED (preflight) — zero Meta calls");
    process.exit(1);
  }

  const http = makeHttp({
    version: env.QF_META_GRAPH_API_VERSION,
    wabaId: env.QF_META_WABA_ID,
    token: env.QF_META_ACCESS_TOKEN,
  });

  const run = async () => {
    // -- the running commit, read from the repository, never trusted from env ----
    const branchHead = await resolveGitHead();
    if (!branchHead) {
      console.log("POST_ATTEMPT_COUNT=0");
      console.log(`RESULT: REFUSED (${CreateFailure.SOURCE_HEAD_UNPROVEN}) — zero POST`);
      return 1;
    }

    // -- the owner's short-lived external attestation, bound to THIS stage -------
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
      return 1;
    }

    // -- GET-only live readback --------------------------------------------------
    const waba = await http.get("");
    const phones = await http.get("/phone_numbers?fields=id,verified_name,quality_rating,code_verification_status");
    const subs = await http.get("/subscribed_apps");

    const assets = readLiveAssets({ waba, phones, subs });
    const assetProof = proveAssets({
      proof,
      assets,
      expected: { wabaId: String(env.QF_META_WABA_ID), phoneNumberId: String(env.QF_META_PHONE_NUMBER_ID) },
      branchHead,
    });
    console.log(`   live asset scope        : ${assetProof.scope}${assetProof.ok ? "" : " -> " + assetProof.faults.join(", ")}`);
    console.log(`   phone quality rating    : ${assets.qualityRating ?? "(unproven)"} (advisory)`);
    console.log(`   phone code verification : ${assets.codeVerificationStatus ?? "(unproven)"} (advisory — not a gate for template creation)`);
    console.log(`   subscriber count        : ${assets.subscriberCount ?? "(unreadable)"} (exact attested set required)`);

    if (!assetProof.ok) {
      console.log("POST_ATTEMPT_COUNT=0");
      console.log("RESULT: REFUSED (live asset proof) — zero POST");
      return 1;
    }

    // -- exact-name pre-state ----------------------------------------------------
    const lookup = await http.get(`/message_templates?name=${encodeURIComponent(TARGET_TEMPLATE_NAME)}`);
    const pre = classifyPreState(lookup);
    console.log(`   remote pre-state        : ${pre.state}`);

    const decision = decide({ flags, identity, assetProof, payloadResult, preState: pre.state });

    if (decision.outcome === Outcome.ALREADY_CREATED) {
      console.log(`   existing row            : status=${pre.row.status} category=${pre.row.category} language=${pre.row.language}`);
      console.log(`POST_ATTEMPT_COUNT=${http.postCount()}`);
      console.log("RESULT: ALREADY_CREATED — no POST. Creation authority is spent.");
      return 0;
    }
    if (!decision.post) {
      console.log(`POST_ATTEMPT_COUNT=${http.postCount()}`);
      if (decision.outcome === Outcome.DRY_RUN_WOULD_POST) {
        console.log(`   would POST to           : /${env.QF_META_GRAPH_API_VERSION}/<actual-staging-waba>/message_templates`);
        console.log(`   would POST body         : ${JSON.stringify(payloadResult.payload)}`);
        console.log("WOULD_POST=YES");
        console.log(`RESULT: DRY RUN — zero Meta mutation. Re-run with --execute ${OWNER_ACK_FLAG} to create.`);
        return 0;
      }
      console.log(`RESULT: REFUSED (${decision.outcome}: ${decision.reason}) — zero POST`);
      return 1;
    }

    // -- THE single POST ---------------------------------------------------------
    const res = await http.createOnce(payloadResult.payload);
    // classifyCreateResponse returns { classification, error } — read the FIELD, never the
    // object, or every outcome degrades to a false "ambiguous" label.
    const { classification } = classifyCreateResponse(res);
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
        { name: after.row.name, language: after.row.language, category: after.row.category,
          components: after.row.components ?? payloadResult.payload.components },
        payloadResult.payload);
      console.log(`   remote status           : ${after.row.status}`);
      console.log(`   remote category         : ${after.row.category}`);
      console.log(`   remote language         : ${after.row.language}`);
      console.log(`   semantic match          : ${semantic}`);
    }
    console.log(`RESULT: ${classification === CreateClassification.SUCCESS ? Outcome.CREATED : Outcome.CREATE_AMBIGUOUS}`
      + ` — exactly ${http.postCount()} POST, no retry`);
    return 0;
  };

  run().then((code) => process.exit(code)).catch(() => {
    console.log("RESULT: REFUSED (unexpected failure) — no retry");
    process.exit(1);
  });
}
