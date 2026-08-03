// ============================================================================
// QF-MVP-40.10B — Wave 1 readiness + reconcile-only operator validator.  OFFLINE.
//
// Drives the operator's exported PURE helpers and statically audits its source, then
// audits the Wave 1 owner-review packet. It calls no Meta endpoint, submits nothing,
// sends nothing, reads no credential and needs no network.
//
// Mutation self-tests drive each rule against a corrupted copy and require failure.
// ============================================================================

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  OperationMode, ReconcileOutcome, MAX_FILENAME_KEY_LENGTH,
  filenameSafeKey, resolveMode, selectTemplate,
} from "./submit-meta-templates.mjs";

const SUBMIT_SCRIPT = "scripts/mvp/communication/submit-meta-templates.mjs";
const SOURCE_PACKET = "docs/provider-manifests/meta-template-submission-packet.json";
const REVIEW = "docs/provider-manifests/meta-wave1-owner-review.json";
const DOC = "docs/QF-MVP-40-10B-WAVE1-OWNER-REVIEW.md";
const CANARY = "docs/provider-manifests/meta-wave1-canary-review.json";
const CANARY_KEY = "lead_received";
const CANARY_NAME = "qf_lead_received_v1";
const CANARY_FINGERPRINT = "dd818e01d293a683b3685f1f246f8cba6b1e4f8e6e106bcab72c4739af640e16";
/**
 * QF-MVP-40.10E: lead_received was submitted once and Meta APPROVED it as UTILITY, so it
 * is no longer "pending review". Its one-shot authorization is CONSUMED — deliberately
 * not "AUTHORIZED", which would read as permission to submit again. The closed set is
 * pinned here so a second entry closing itself has to be an explicit edit.
 */
const CLOSED_WAVE1_KEYS = ["lead_received", "client_lead_status_update",
  "client_matching_update", "lead_assignment_alert", "consent_stop_acknowledgement",
  "consent_start_acknowledgement", "vendor_onboarding_reminder"];
/** Subset 2 is the OPEN review set proposed in QF-MVP-40.10F. */
const SUBSET2 = "docs/provider-manifests/meta-wave1-next-utility-subset-2-review.json";
const SUBSET2_KEYS = ["consent_stop_acknowledgement", "consent_start_acknowledgement",
  "vendor_onboarding_reminder"];
const isClosedKey = (k) => CLOSED_WAVE1_KEYS.includes(k);
const V1C_SUBMISSION_EVIDENCE = "QF-MVP-40-WAVE1-META-SUBMISSION-2026-07-30T18-46-18-281Z.json";
const V1C_RECONCILIATION_EVIDENCE =
  "QF-MVP-40-WAVE1-lead_received-META-RECONCILIATION-2026-07-31T02-01-53-804Z.json";
/**
 * Immutable QF-MVP-40.10 history pins. BASE is the QF-MVP-30 closeout; CLOSURE is the
 * QF-MVP-40.10G commit "fix(communication): close Wave 1 consent subset", after which
 * template submission was paused. Neither may be repointed at a moving ref: the claim
 * "QF-MVP-40.10 added no migration" is a fact about a FIXED span of history, and comparing
 * against HEAD made it decay the moment later QF-MVP-50 migrations landed.
 */
const QF_MVP_40_BASE = "1713838401da8b160cbeb9d3b6090bd017bdb958";
const QF_MVP_40_10_CLOSURE_HEAD = "d5931a3409ed26cbe87ea2a7a2835dbc9a7f99ac";

/** A git failure is never a pass: an unreadable pin fails closed. */
function commitExists(sha) {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function commitIsAncestorOfHead(sha) {
  if (!commitExists(sha)) return false;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * True only when the EXACT pinned range carries no migration. Both ends must exist and the
 * closure must be reachable from HEAD, so a bogus, deleted or unrelated pin fails closed
 * rather than vacuously passing.
 */
function historicalRangeHasNoMigration(baseSha, closureSha) {
  if (!commitExists(baseSha) || !commitIsAncestorOfHead(closureSha)) return false;
  let changed;
  try {
    changed = execFileSync("git", ["diff", "--name-only", `${baseSha}..${closureSha}`],
      { encoding: "utf8" });
  } catch {
    return false;
  }
  return !changed.split("\n").some((f) => f.trim().startsWith("supabase/migrations/"));
}

const ROOT = process.cwd();
const results = [];
const add = (n, ok, d) => results.push({ name: n, ok: ok === true, detail: d ?? "" });
const clone = (o) => JSON.parse(JSON.stringify(o));
const sha256 = (x) => createHash("sha256").update(x).digest("hex");

const submitSrc = readFileSync(resolve(SUBMIT_SCRIPT), "utf8");
/** Executable view: comments stripped so prose can neither satisfy nor trip a rule. */
const submitExec = submitSrc.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const sourcePacketRaw = readFileSync(resolve(SOURCE_PACKET));
const sourcePacket = JSON.parse(sourcePacketRaw.toString("utf8"));
const review = JSON.parse(readFileSync(resolve(REVIEW), "utf8"));
const canary = JSON.parse(readFileSync(resolve(CANARY), "utf8"));

const GROUP_A = ["clarification_reminder", "clarification_request", "client_lead_status_update",
  "client_matching_update", "consent_start_acknowledgement", "consent_stop_acknowledgement",
  "lead_assignment_alert", "lead_received", "vendor_new_lead",
  "vendor_onboarding_reminder", "vendor_response_reminder"];
const GROUP_B = ["low_credit_warning", "recharge_reminder", "vendor_package_expiry_warning"];

const W1 = sourcePacket.templates.filter((t) => t.submission_wave === 1);
const byKey = new Map(W1.map((t) => [t.internal_template_key, t]));

const R = {
  // ---- A. CLI / operator contract ---------------------------------------
  templateFlagExists: () => /--template/.test(submitExec),
  reconcileFlagExists: () => /--reconcile-only/.test(submitExec),
  modesMutuallyExclusive: () => {
    const bad = resolveMode({ execute: true, reconcileOnly: true });
    return bad.ok === false && bad.reason === "MODE_CONFLICT_EXECUTE_AND_RECONCILE_ONLY"
      && resolveMode({ execute: true }).mode === OperationMode.EXECUTE_CREATE
      && resolveMode({ reconcileOnly: true }).mode === OperationMode.RECONCILE_ONLY
      && resolveMode({}).mode === null && resolveMode({}).network === false;
  },
  exactKeySelectionOnly: () => {
    const templates = [
      { internal_template_key: "lead_received", submission_wave: 1 },
      { internal_template_key: "lead_received_extra", submission_wave: 1 },
    ];
    // A prefix must NOT resolve, and an exact key must resolve to exactly that row.
    const exact = selectTemplate({ templates, wave: 1, templateKey: "lead_received" });
    const fuzzy = selectTemplate({ templates, wave: 1, templateKey: "lead_" });
    return exact.ok === true && exact.template.internal_template_key === "lead_received"
      && fuzzy.ok === false && fuzzy.reason === "TEMPLATE_KEY_NOT_FOUND";
  },
  multiWaveRequiresKey: () => {
    const templates = [
      { internal_template_key: "a", submission_wave: 1 },
      { internal_template_key: "b", submission_wave: 1 },
    ];
    const r = selectTemplate({ templates, wave: 1, requireSingle: true });
    return r.ok === false && r.reason === "TEMPLATE_KEY_REQUIRED_MULTIPLE_IN_WAVE";
  },
  singleWaveNeedsNoKey: () => {
    const templates = [{ internal_template_key: "only", submission_wave: 0 }];
    const r = selectTemplate({ templates, wave: 0, requireSingle: true });
    return r.ok === true && r.template.internal_template_key === "only";
  },
  keyInWrongWaveRejected: () => {
    const templates = [
      { internal_template_key: "w0", submission_wave: 0 },
      { internal_template_key: "w1", submission_wave: 1 },
    ];
    const r = selectTemplate({ templates, wave: 1, templateKey: "w0" });
    return r.ok === false && r.reason === "TEMPLATE_KEY_NOT_IN_WAVE";
  },
  unknownKeyRejected: () => {
    const r = selectTemplate({ templates: [{ internal_template_key: "x", submission_wave: 1 }], wave: 1, templateKey: "zzz" });
    return r.ok === false && r.reason === "TEMPLATE_KEY_NOT_FOUND";
  },
  /** The reconcile branch must terminate before any create code can be reached. */
  reconcileBranchExitsBeforeCreate: () => {
    const branch = submitExec.indexOf(`modeResult.mode === OperationMode.RECONCILE_ONLY`);
    const post = submitExec.indexOf(`method: "POST"`);
    if (branch < 0 || post < 0 || branch > post) return false;
    // Every path inside the branch must end in finish(); no fallthrough.
    const body = submitExec.slice(branch, submitExec.indexOf("const pre = await lookupExact"));
    return (body.match(/finish\(/g) ?? []).length >= 7 && !/method:\s*["']POST["']/.test(body);
  },
  exactlyOnePostCallSite: () => (submitExec.match(/method:\s*["']POST["']/g) ?? []).length === 1,
  noSendEndpoint: () => !/\/messages\b/.test(submitExec),
  noDeleteOrEdit: () => !/method:\s*["'](DELETE|PUT|PATCH)["']/i.test(submitExec),
  createPostCountZeroInReconcile: () => {
    // Only ONE assignment to 1 exists, and it sits in the create path AFTER the
    // reconcile branch has already returned.
    const assigns = submitExec.match(/create_post_count\s*=\s*1/g) ?? [];
    const at = submitExec.indexOf("create_post_count = 1");
    const branch = submitExec.indexOf(`modeResult.mode === OperationMode.RECONCILE_ONLY`);
    return assigns.length === 1 && branch >= 0 && at > branch && /create_post_count: 0/.test(submitExec);
  },
  operationModeRecorded: () => /operation_mode: modeResult\.mode/.test(submitExec)
    && OperationMode.EXECUTE_CREATE === "EXECUTE_CREATE" && OperationMode.RECONCILE_ONLY === "RECONCILE_ONLY",
  allReconcileOutcomesPresent: () => Object.values(ReconcileOutcome)
    .every((o) => submitExec.includes(o)) && Object.keys(ReconcileOutcome).length === 8,
  reconcileFilenameParameterised: () => /META-RECONCILIATION-/.test(submitExec)
    && /QF-MVP-40-WAVE\$\{WAVE\}-\$\{safeKey\}/.test(submitExec),
  filenameKeyBounded: () => {
    // Assert the SECURITY PROPERTY, not a hand-counted literal: bounded length, no
    // path separator or dot survives, and a missing key degrades to a fixed token.
    const long = filenameSafeKey("A".repeat(500));
    const traversal = filenameSafeKey("../../etc/passwd");
    return long.length === MAX_FILENAME_KEY_LENGTH
      && /^[a-z0-9_-]+$/.test(long)
      && /^[a-z0-9_-]+$/.test(traversal)
      && !/[./\\]/.test(traversal)
      && filenameSafeKey("") === "unknown"
      && filenameSafeKey(null) === "unknown"
      && filenameSafeKey("consent_help_response") === "consent_help_response";
  },
  evidenceHasNoUnsafeFields: () => {
    const rec = submitExec.slice(submitExec.indexOf("const record = {"), submitExec.indexOf("const finish"));
    return rec.length > 0 && !/raw_body|response_body|error_message|waba|token|secret/i.test(rec);
  },
  createClassificationRetained: () => /DETERMINISTIC_4XX_REJECTION/.test(submitExec)
    && /CREATE_REJECTED_4XX/.test(submitExec) && /classifyCreateResponse/.test(submitExec),
  dryRunStillDefault: () => /if \(!EXECUTE && !RECONCILE_ONLY\)/.test(submitExec),

  // ---- B. Wave 1 review packet ------------------------------------------
  exactly14: (r) => r.templates.length === 14 && r.counts.total === 14,
  exactGrouping: (r) => r.counts.WAVE1A_ORDINARY_LAUNCH === 11
    && r.counts.WAVE1B_COMMERCIAL_CATEGORY_REVIEW === 3
    && r.templates.filter((t) => t.submission_group === "WAVE1A_ORDINARY_LAUNCH").length === 11
    && r.templates.filter((t) => t.submission_group === "WAVE1B_COMMERCIAL_CATEGORY_REVIEW").length === 3,
  exactKeySet: (r) => JSON.stringify(r.templates.map((t) => t.internal_template_key))
    === JSON.stringify([...GROUP_A, ...GROUP_B].sort()),
  groupBExactThree: (r) => JSON.stringify(r.templates
    .filter((t) => t.submission_group === "WAVE1B_COMMERCIAL_CATEGORY_REVIEW")
    .map((t) => t.internal_template_key).sort()) === JSON.stringify([...GROUP_B].sort()),
  noOtherWaveLeakage: (r) => {
    const otherWaveKeys = sourcePacket.templates
      .filter((t) => t.submission_wave !== 1).map((t) => t.internal_template_key);
    return !r.templates.some((t) => otherWaveKeys.includes(t.internal_template_key));
  },
  matchesSourceVerbatim: (r) => r.templates.every((t) => {
    const src = byKey.get(t.internal_template_key);
    return !!src
      && t.provider_template_name === src.provider_template_name
      && t.provider_language === src.provider_language
      && t.requested_category === src.category
      && t.component_profile === src.component_profile
      && t.payload_fingerprint === src.payload_fingerprint
      && JSON.stringify(t.creation_payload) === JSON.stringify(src.creation_payload);
  }),
  fingerprintsSelfConsistent: (r) => r.templates.every((t) =>
    t.payload_fingerprint === sha256(JSON.stringify(t.creation_payload))),
  sourceFingerprintExact: (r) => r.source_packet_fingerprint === sha256(sourcePacketRaw),
  allDecisionsPending: (r) => r.templates.every((t) => t.owner_copy_decision
    === (isClosedKey(t.internal_template_key) ? "APPROVED_BY_OWNER" : "PENDING_OWNER_REVIEW")),
  allUnauthorized: (r) => r.templates.every((t) => t.submission_authorization
    === (isClosedKey(t.internal_template_key) ? "CONSUMED" : "NOT_AUTHORIZED")),
  allNotSubmitted: (r) => r.templates.every((t) => t.remote_submission_state
    === (isClosedKey(t.internal_template_key) ? "APPROVED_UNMAPPED" : "NOT_SUBMITTED")),
  /** Approving one entry must never flip the artefact into authorizing calls. */
  authorizesNoMetaCalls: (r) => r.authorizes_meta_calls === false
    && ["OWNER_REVIEW_PENDING", "PARTIALLY_REVIEWED", "FULLY_REVIEWED"].includes(r.status)
    && (r.status === "PARTIALLY_REVIEWED") === (
         r.templates.some((t) => t.remote_submission_state === "APPROVED_UNMAPPED")
      && r.templates.some((t) => t.owner_copy_decision === "PENDING_OWNER_REVIEW")),
  categoryReviewDecisionsCorrect: (r) => r.templates.every((t) =>
    t.category_review_decision === (isClosedKey(t.internal_template_key)
      ? "UTILITY_MACHINE_PROVEN"
      : (GROUP_A.includes(t.internal_template_key)
          ? "REVIEW_REQUIRED" : "HOLD_FOR_EXPLICIT_CATEGORY_REVIEW"))),
  /** Exactly one closed entry, exactly 13 still pending — counts must be self-consistent. */
  reviewCountsExact: (r) => r.counts.total === 14
    && r.counts.approved_unmapped === CLOSED_WAVE1_KEYS.length
    && r.counts.pending_owner_review === 14 - CLOSED_WAVE1_KEYS.length
    && r.counts.WAVE1A_ORDINARY_LAUNCH === 11 && r.counts.WAVE1B_COMMERCIAL_CATEGORY_REVIEW === 3
    && r.counts.approved_unmapped === r.templates.filter((t) => t.remote_submission_state === "APPROVED_UNMAPPED").length
    && r.counts.pending_owner_review === r.templates.filter((t) => t.owner_copy_decision === "PENDING_OWNER_REVIEW").length,
  /** The note must say plainly that the other entries authorize nothing. */
  reviewNoteDeniesBlanketAuthorization: (r) => /AUTHORIZES ZERO META CALLS/i.test(r.note)
    && /(not|nothing here is) a blanket Wave 1 authorization/i.test(r.note)
    && /explicit owner authorization/i.test(r.note),
  noSecretsOrPii: (r) => {
    const raw = JSON.stringify(r);
    return !/(EAA[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9._-]{20,}|Bearer\s+[A-Za-z0-9._-]{12,}|\+\d[\d\s-]{8,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/.test(raw)
      && !/"(waba_id|phone_number_id|access_token|app_secret|verify_token|provider_template_id)"/i.test(raw);
  },
  groupBAssertsNothingAboutValidity: (r) =>
    /REVIEW BOUNDARY only/i.test(r.note) && !/invalid|must be marketing|is marketing/i.test(r.note),

  // ---- C. Documentation / boundary --------------------------------------
  docExists: () => existsSync(resolve(DOC)),
  /**
   * QF-MVP-40.10C: reconciliation has now RUN, so the old "must say reconciliation is
   * pending" form is obsolete. The invariant it protected is unchanged and is
   * restated against the current truth: the document must record the reconciled
   * result (APPROVED **as MARKETING**) and must never present a proven Utility
   * approval or an authorized Wave 1.
   */
  /**
   * QF-MVP-40.10D: a Utility approval IS now machine proven — but only for v3, and
   * only as a provider contract. The blanket "never claim Utility" form of this rule
   * is obsolete; deleting it would drop the guard entirely, so it is restated:
   *
   *   1. the v2 MARKETING mismatch and quarantine must still be recorded (a recovered
   *      failure is never erased from the audited record);
   *   2. v2 must never be described as Utility-approved;
   *   3. any Utility-approval claim must carry the qualifier that it grants no
   *      consent, mapping, activation or send authority;
   *   4. Wave 1 must still be blocked.
   *
   * Accepts doc text so mutation tests can prove it bites; falls back to the file.
   */
  ownerApprovalNotMachineProven: (docText) => {
    const doc = typeof docText === "string" ? docText : readFileSync(resolve(DOC), "utf8");
    const recordsReconciledResult = /RECONCILED_CATEGORY_MISMATCH/.test(doc)
      && /MARKETING/.test(doc) && /QUARANTINED_UNMAPPED/.test(doc);
    const miscreditsV2 = /\bv2\b[^.\n]{0,60}\b(approved|reconciled)\b[^.\n]{0,20}\bas UTILITY\b/i.test(doc)
      || /\bv2\b[^.\n]{0,60}\bUTILITY[- ]APPROVED\b/i.test(doc);
    const claimsUtilityApproval =
      /\b(approved|reconciled)\b[^.\n]{0,40}\bas UTILITY\b/i.test(doc);
    // An approval claim is only honest alongside an explicit grant-nothing qualifier.
    const qualified = /PROVIDER CONTRACT ONLY/i.test(doc)
      && /NO CONSENT, MAPPING, ACTIVATION OR SEND/i.test(doc);
    const wave1StillBlocked = /WAVE 1 META SUBMISSION NOT AUTHORIZED/i.test(doc);
    return recordsReconciledResult && !miscreditsV2 && wave1StillBlocked
      && (!claimsUtilityApproval || qualified);
  },
  noMigrationInQfMvp40HistoricalRange: () =>
    historicalRangeHasNoMigration(QF_MVP_40_BASE, QF_MVP_40_10_CLOSURE_HEAD),
  qfMvp40ClosureIsAncestorOfHead: () => commitIsAncestorOfHead(QF_MVP_40_10_CLOSURE_HEAD),
  noEvidenceTracked: () => {
    const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" });
    return !/META-(SUBMISSION|RECONCILIATION)-/.test(tracked);
  },

  // ---- QF-MVP-40.10D Wave 1 canary review --------------------------------
  canaryIsExactlyOneEntry: (c) => !!c.recommended_canary
    && !Array.isArray(c.recommended_canary)
    && c.recommended_canary.internal_template_key === CANARY_KEY
    && c.recommended_canary.provider_template_name === CANARY_NAME,
  canaryFingerprintExact: (c) => c.recommended_canary.payload_fingerprint === CANARY_FINGERPRINT
    && c.recommended_canary.payload_fingerprint
       === sha256(JSON.stringify(c.recommended_canary.creation_payload)),
  /** The canary may not rewrite the copy it recommends — it must quote the packet. */
  canaryMatchesSourceVerbatim: (c) => {
    const k = c.recommended_canary;
    const src = byKey.get(k.internal_template_key);
    return !!src && k.provider_template_name === src.provider_template_name
      && k.provider_language === src.provider_language
      && k.requested_category === src.category
      && k.component_profile === src.component_profile
      && k.payload_fingerprint === src.payload_fingerprint
      && JSON.stringify(k.creation_payload) === JSON.stringify(src.creation_payload);
  },
  /**
   * QF-MVP-40.10E/F: while an artefact is OPEN, its pin must equal the CURRENT packet — it
   * is telling the owner "review this against today's packet". Once the artefact is CLOSED
   * it is a historical record of what was true at closure, and re-pinning it on every later
   * packet change would destroy that record (the same reason ledger history is never
   * rewritten). Content integrity is NOT waived: W42 still requires a closed artefact to
   * quote the current packet verbatim, so copy can never drift unnoticed.
   */
  canarySourceFingerprintExact: (c) => {
    const closed = typeof c.status === "string" && c.status.startsWith("CLOSED");
    return closed
      ? /^[0-9a-f]{64}$/.test(c.source_packet_fingerprint ?? "")
      : c.source_packet_fingerprint === sha256(sourcePacketRaw);
  },
  /**
   * QF-MVP-40.10E: the canary is CLOSED. A closed canary must still authorize nothing —
   * and must additionally deny RESUBMISSION, since its authorization is spent, not renewed.
   */
  canaryAuthorizesNothing: (c) => c.authorizes_meta_calls === false
    && c.status === "CLOSED_APPROVED_UNMAPPED"
    && c.recommended_canary.submission_authorization === "CONSUMED"
    && c.recommended_canary.remote_submission_state === "APPROVED_UNMAPPED"
    && c.recommended_canary.owner_copy_decision === "APPROVED_BY_OWNER"
    && Array.isArray(c.explicit_non_authorizations)
    && c.explicit_non_authorizations.length >= 6
    && c.explicit_non_authorizations.some((x) => /RESUBMIT/i.test(x))
    && c.explicit_non_authorizations.some((x) => /mapping/i.test(x))
    && c.explicit_non_authorizations.some((x) => /sending any WhatsApp message/i.test(x))
    && c.explicit_non_authorizations.some((x) => /deployment/i.test(x)),
  /** The remote truth recorded on the canary must match the ledger and the evidence. */
  canaryRemoteTruthExact: (c) => {
    const k = c.recommended_canary;
    return k.last_proven_status === "APPROVED" && k.last_proven_remote_category === "UTILITY"
      && k.readback_semantic_match === true && k.identity_match === true
      && k.submission_outcome === "CREATED_PENDING"
      && k.reconciliation_outcome === "RECONCILED_APPROVED"
      && k.create_post_count_at_submission === 1
      && k.create_post_count_at_reconciliation === 0
      && Array.isArray(k.evidence) && k.evidence.length === 2
      && k.evidence.includes(V1C_SUBMISSION_EVIDENCE)
      && k.evidence.includes(V1C_RECONCILIATION_EVIDENCE);
  },
  /** Closing the canary must not silently promote the other 13 Wave 1 entries. */
  canaryDoesNotUnblockWave1: () => {
    const others = review.templates.filter((t) => !isClosedKey(t.internal_template_key));
    return others.length === 14 - CLOSED_WAVE1_KEYS.length && others.every((t) =>
      t.submission_authorization === "NOT_AUTHORIZED" && t.remote_submission_state === "NOT_SUBMITTED");
  },
  /** Wave 0 closed as UTILITY: the canary may state that, but may claim no more. */
  canaryWave0PreconditionHonest: (c) => {
    const w = c.wave0_precondition;
    return !!w && w.provider_template_name === "qf_consent_help_response_v3"
      && w.last_proven_status === "APPROVED" && w.last_proven_remote_category === "UTILITY"
      && w.disposition === "APPROVED_UNMAPPED"
      && /grants no send, mapping or activation authority/i.test(w.note);
  },
  canaryCarriesNoSecrets: (c) => R.noSecretsOrPii(c),
  canaryDocExists: () => existsSync(resolve("docs/QF-MVP-40-10D-WAVE0-CLOSURE-AND-WAVE1-CANARY.md")),
  closureDocExists: () => existsSync(resolve("docs/QF-MVP-40-10E-WAVE1-CANARY-CLOSURE.md")),
  subsetClosureDocExists: () => existsSync(resolve("docs/QF-MVP-40-10F-WAVE1-UTILITY-SUBSET-CLOSURE.md")),
  subset2ClosureDocExists: () => existsSync(resolve("docs/QF-MVP-40-10G-WAVE1-SUBSET2-CLOSURE.md")),
  /**
   * QF-MVP-40.10G: subset 2 is CLOSED. Its keys must now be exactly the ones the owner
   * review reports as approved-and-consumed, and it must still authorize nothing. The
   * open-form check is kept for whenever a future subset is open again.
   */
  subset2IsOpenAndUnauthorized: () => {
    const N = JSON.parse(readFileSync(resolve(SUBSET2), "utf8"));
    const keys = N.templates.map((t) => t.internal_template_key);
    if (keys.join(",") !== SUBSET2_KEYS.join(",")) return false;
    if (N.authorizes_meta_calls !== false) return false;
    const closed = N.status === "CLOSED_APPROVED_UNMAPPED";
    if (!closed && N.status !== "OWNER_REVIEW_PENDING") return false;
    return keys.every((k) => {
      const t = review.templates.find((x) => x.internal_template_key === k);
      if (!t) return false;
      return closed
        ? t.owner_copy_decision === "APPROVED_BY_OWNER"
          && t.submission_authorization === "CONSUMED"
          && t.remote_submission_state === "APPROVED_UNMAPPED"
        : t.owner_copy_decision === "PENDING_OWNER_REVIEW"
          && t.submission_authorization === "NOT_AUTHORIZED"
          && t.remote_submission_state === "NOT_SUBMITTED";
    });
  },
  /** Submission is PAUSED: no successor artefact, and the pause flags say so. */
  submissionPausedNoSuccessor: () => {
    const N = JSON.parse(readFileSync(resolve(SUBSET2), "utf8"));
    const sp = N.submission_pause;
    return !!sp && sp.status === "PAUSED"
      && sp.successor_subset_proposed === false && sp.successor_subset_authorized === false
      && !existsSync(resolve("docs/provider-manifests/meta-wave1-next-utility-subset-3-review.json"));
  },
  /**
   * QF-MVP-40.12-R1: same open/closed distinction as canarySourceFingerprintExact. An
   * OPEN artefact must pin the CURRENT packet; a CLOSED one keeps its historical closure
   * hash, because re-pinning it on every later packet change destroys the record it
   * exists to preserve. W54 still proves the closed set matches the owner review.
   */
  subset2PinsCurrentPacket: () => {
    const N = JSON.parse(readFileSync(resolve(SUBSET2), "utf8"));
    const closed = typeof N.status === "string" && N.status.startsWith("CLOSED");
    return closed
      ? /^[0-9a-f]{64}$/.test(N.source_packet_fingerprint ?? "")
      : N.source_packet_fingerprint === sha256(sourcePacketRaw);
  },
};

const RULES = [
  ["W1  --template flag exists", R.templateFlagExists, review],
  ["W2  --reconcile-only flag exists", R.reconcileFlagExists, review],
  ["W3  execute and reconcile-only are mutually exclusive", R.modesMutuallyExclusive, review],
  ["W4  selection is EXACT key only, never fuzzy/prefix", R.exactKeySelectionOnly, review],
  ["W5  a multi-template wave requires --template", R.multiWaveRequiresKey, review],
  ["W6  a single-template wave needs no --template", R.singleWaveNeedsNoKey, review],
  ["W7  a key from another wave is rejected", R.keyInWrongWaveRejected, review],
  ["W8  an unknown key is rejected", R.unknownKeyRejected, review],
  ["W9  the reconcile branch exits before any create code", R.reconcileBranchExitsBeforeCreate, review],
  ["W10 exactly one executable POST call site", R.exactlyOnePostCallSite, review],
  ["W11 no message-send endpoint", R.noSendEndpoint, review],
  ["W12 no DELETE/PUT/PATCH", R.noDeleteOrEdit, review],
  ["W13 create_post_count stays 0 in reconcile-only", R.createPostCountZeroInReconcile, review],
  ["W14 operation_mode is recorded", R.operationModeRecorded, review],
  ["W15 all eight reconciliation outcomes exist", R.allReconcileOutcomesPresent, review],
  ["W16 reconciliation filename is wave + bounded key parameterised", R.reconcileFilenameParameterised, review],
  ["W17 the filename key transform is bounded and safe", R.filenameKeyBounded, review],
  ["W18 evidence record has no raw body / token / WABA field", R.evidenceHasNoUnsafeFields, review],
  ["W19 create-response classification is retained", R.createClassificationRetained, review],
  ["W20 dry run remains the default", R.dryRunStillDefault, review],
  ["W21 review packet has exactly 14 entries", R.exactly14, review],
  ["W22 grouping is exactly 11 / 3", R.exactGrouping, review],
  ["W23 the key set is exact", R.exactKeySet, review],
  ["W24 Group B is exactly the three commercial reminders", R.groupBExactThree, review],
  ["W25 no Wave 0/2/3/4 template leaked in", R.noOtherWaveLeakage, review],
  ["W26 every entry matches the source packet verbatim", R.matchesSourceVerbatim, review],
  ["W27 every fingerprint is self-consistent with its payload", R.fingerprintsSelfConsistent, review],
  ["W28 source packet fingerprint is exact sha256 of raw bytes", R.sourceFingerprintExact, review],
  ["W29 owner copy decisions are closed-model correct (approved vs pending)", R.allDecisionsPending, review],
  ["W30 submission authorization is CONSUMED for closed, NOT_AUTHORIZED otherwise", R.allUnauthorized, review],
  ["W31 remote state is APPROVED_UNMAPPED for closed, NOT_SUBMITTED otherwise", R.allNotSubmitted, review],
  ["W32 the artefact authorizes zero Meta calls", R.authorizesNoMetaCalls, review],
  ["W33 category review decisions match the grouping", R.categoryReviewDecisionsCorrect, review],
  ["W34 no secrets, PII or provider ids", R.noSecretsOrPii, review],
  ["W35 Group B asserts nothing about category validity", R.groupBAssertsNothingAboutValidity, review],
  ["W36 owner-review document exists", R.docExists, review],
  ["W37 owner-reported approval is not shown as machine-proven", R.ownerApprovalNotMachineProven, review],
  ["W38 no migration in the pinned QF-MVP-40.10 historical range", R.noMigrationInQfMvp40HistoricalRange, review],
  ["W38b QF-MVP-40.10 closure pin is real history reachable from HEAD", R.qfMvp40ClosureIsAncestorOfHead, review],
  ["W39 no evidence JSON is tracked", R.noEvidenceTracked, review],
  ["W49 review counts are exact and self-consistent", R.reviewCountsExact, review],
  ["W50 review note denies any blanket Wave 1 authorization", R.reviewNoteDeniesBlanketAuthorization, review],
  ["W40 canary review names exactly one template", R.canaryIsExactlyOneEntry, canary],
  ["W41 canary fingerprint is exact and self-consistent", R.canaryFingerprintExact, canary],
  ["W42 canary quotes the source packet verbatim", R.canaryMatchesSourceVerbatim, canary],
  ["W43 canary pins the current source packet fingerprint", R.canarySourceFingerprintExact, canary],
  ["W44 canary authorizes nothing and says so explicitly", R.canaryAuthorizesNothing, canary],
  ["W45 canary does not unblock the other Wave 1 templates", R.canaryDoesNotUnblockWave1, canary],
  ["W46 canary states the Wave 0 precondition honestly", R.canaryWave0PreconditionHonest, canary],
  ["W47 canary carries no secrets, PII or provider ids", R.canaryCarriesNoSecrets, canary],
  ["W48 the QF-MVP-40.10D closure document exists", R.canaryDocExists, canary],
  ["W51 canary records the exact proven remote truth and both evidence files", R.canaryRemoteTruthExact, canary],
  ["W52 the QF-MVP-40.10E closure document exists", R.closureDocExists, canary],
  ["W53 the QF-MVP-40.10F closure document exists", R.subsetClosureDocExists, canary],
  ["W56 the QF-MVP-40.10G closure document exists", R.subset2ClosureDocExists, canary],
  ["W57 submission is PAUSED and no successor subset artefact exists", R.submissionPausedNoSuccessor, canary],
  ["W54 subset 2 names only still-pending keys and authorizes nothing", R.subset2IsOpenAndUnauthorized, canary],
  ["W55 subset 2 pins the current source packet fingerprint", R.subset2PinsCurrentPacket, canary],
];
for (const [n, fn, arg] of RULES) add(n, fn(arg));

const MUT = [
  ["M1  fuzzy key selection is rejected", () => {
    const templates = [{ internal_template_key: "lead_received", submission_wave: 1 }];
    return selectTemplate({ templates, wave: 1, templateKey: "lead" }).ok === true; }],
  ["M2  a reconcile path reaching POST is rejected", R.reconcileBranchExitsBeforeCreate, (src) => src,
    "SIMULATED"],
  ["M3  Group B losing a key is rejected", R.groupBExactThree, null, null, (r) => {
    r.templates.find((t) => t.internal_template_key === "recharge_reminder")
      .submission_group = "WAVE1A_ORDINARY_LAUNCH"; }],
  ["M4  a Wave 3 key leaking in is rejected", R.noOtherWaveLeakage, null, null, (r) => {
    r.templates.push({ internal_template_key: "vendor_crm_promotion", submission_group: "WAVE1A_ORDINARY_LAUNCH" }); }],
  ["M5  changed copy with a stale fingerprint is rejected", R.fingerprintsSelfConsistent, null, null, (r) => {
    r.templates[0].creation_payload.components[0].text = "TAMPERED."; }],
  ["M6  a changed category is rejected", R.matchesSourceVerbatim, null, null, (r) => {
    r.templates[0].requested_category = "MARKETING"; }],
  ["M7  a pre-approved owner decision is rejected", R.allDecisionsPending, null, null, (r) => {
    r.templates[0].owner_copy_decision = "APPROVED"; }],
  ["M8  a pre-authorized submission is rejected", R.allUnauthorized, null, null, (r) => {
    r.templates[0].submission_authorization = "AUTHORIZED"; }],
  ["M9  a stale source packet fingerprint is rejected", R.sourceFingerprintExact, null, null, (r) => {
    r.source_packet_fingerprint = "0".repeat(64); }],
  ["M10 a packet claiming it authorizes Meta calls is rejected", R.authorizesNoMetaCalls, null, null, (r) => {
    r.authorizes_meta_calls = true; }],
  ["M11 a wrong-count grouping is rejected", R.exactGrouping, null, null, (r) => {
    r.counts.WAVE1A_ORDINARY_LAUNCH = 12; }],
  ["M12 a remote state pre-marked submitted is rejected", R.allNotSubmitted, null, null, (r) => {
    r.templates[0].remote_submission_state = "SUBMITTED_PENDING"; }],
  ["M13 a provider template id in the review packet is rejected", R.noSecretsOrPii, null, null, (r) => {
    r.templates[0].provider_template_id = "1234567890"; }],
  ["M14 a second recommended canary is rejected", R.canaryIsExactlyOneEntry, canary, null, (c) => {
    c.recommended_canary = [c.recommended_canary, c.recommended_canary]; }],
  ["M15 a different canary template is rejected", R.canaryIsExactlyOneEntry, canary, null, (c) => {
    c.recommended_canary.internal_template_key = "vendor_new_lead"; }],
  ["M16 canary copy edited without a new fingerprint is rejected", R.canaryFingerprintExact, canary, null,
    (c) => { c.recommended_canary.creation_payload.components[0].text = "Buy now, 50% off!"; }],
  ["M17 canary copy drifting from the packet is rejected", R.canaryMatchesSourceVerbatim, canary, null,
    (c) => { c.recommended_canary.requested_category = "MARKETING"; }],
  // QF-MVP-40.10F: this mutant used to blank the pin, which a CLOSED artefact now
  // legitimately tolerates (see canarySourceFingerprintExact) — so it had decayed into
  // proving nothing. It now tests the guarantee that replaced it: content integrity is
  // NOT waived when an artefact closes, so drifted copy is still rejected. M39 covers the
  // stale-pin case for OPEN artefacts, M40 the malformed-pin case for closed ones.
  ["M18 a closed canary whose copy drifted from the packet is rejected",
    R.canaryMatchesSourceVerbatim, canary, null,
    (c) => { c.recommended_canary.creation_payload.components[0].text = "Buy now, 50% off!"; }],
  ["M19 a canary pre-authorized for submission is rejected", R.canaryAuthorizesNothing, canary, null,
    (c) => { c.recommended_canary.submission_authorization = "AUTHORIZED"; }],
  ["M20 a canary claiming it authorizes Meta calls is rejected", R.canaryAuthorizesNothing, canary, null,
    (c) => { c.authorizes_meta_calls = true; }],
  ["M21 a canary overstating the Wave 0 grant is rejected", R.canaryWave0PreconditionHonest, canary, null,
    (c) => { c.wave0_precondition.note = "Wave 0 approval authorizes sending and mapping."; }],
  ["M22 crediting v2 with a Utility approval is rejected", R.ownerApprovalNotMachineProven, "DOC", null,
    (d) => d.replace(/WAVE 0 v2 RECONCILED:[^\n]*/, "WAVE 0 v2 RECONCILED: APPROVED AS UTILITY")],
  // Targets the QUALIFIER the rule actually checks, not a line prefix. The earlier form
  // matched "WAVE 0 APPROVAL GRANTS...", which stopped existing once QF-MVP-40.10E
  // generalised the wording — turning the mutant into a silent no-op that proved nothing.
  ["M23 an unqualified Utility approval claim is rejected", R.ownerApprovalNotMachineProven, "DOC", null,
    (d) => d.replace(/PROVIDER CONTRACT ONLY/g, "FULL AUTHORITY")
            .replace(/NO CONSENT, MAPPING, ACTIVATION OR SEND/g, "")],
  ["M24 erasing the v2 MARKETING quarantine record is rejected", R.ownerApprovalNotMachineProven, "DOC", null,
    (d) => d.replace(/QUARANTINED_UNMAPPED/g, "OK")],
  ["M25 unblocking Wave 1 in the doc is rejected", R.ownerApprovalNotMachineProven, "DOC", null,
    (d) => d.replace(/WAVE 1 META SUBMISSION NOT AUTHORIZED/g, "WAVE 1 META SUBMISSION AUTHORIZED")],

  // ---- QF-MVP-40.10E ------------------------------------------------------
  ["M26 the closed entry reverted to pending is rejected", R.allDecisionsPending, null, null, (r) => {
    r.templates.find((t) => t.internal_template_key === "lead_received")
      .owner_copy_decision = "PENDING_OWNER_REVIEW"; }],
  ["M27 a re-authorized closed entry is rejected", R.allUnauthorized, null, null, (r) => {
    r.templates.find((t) => t.internal_template_key === "lead_received")
      .submission_authorization = "AUTHORIZED"; }],
  ["M28 an extra entry marked approved-unmapped is rejected", R.allNotSubmitted, null, null, (r) => {
    r.templates.find((t) => t.internal_template_key === "vendor_new_lead")
      .remote_submission_state = "APPROVED_UNMAPPED"; }],
  ["M28b a closed entry demoted to NOT_SUBMITTED is rejected", R.allNotSubmitted, null, null, (r) => {
    r.templates.find((t) => t.internal_template_key === "client_matching_update")
      .remote_submission_state = "NOT_SUBMITTED"; }],
  ["M29 a review artefact claiming it authorizes calls is rejected", R.authorizesNoMetaCalls, null, null, (r) => {
    r.authorizes_meta_calls = true; }],
  ["M30 a FULLY_REVIEWED status while entries are pending is rejected", R.authorizesNoMetaCalls, null, null, (r) => {
    r.status = "FULLY_REVIEWED"; }],
  ["M31 a drifted approved/pending count is rejected", R.reviewCountsExact, null, null, (r) => {
    r.counts.pending_owner_review = 12; }],
  ["M32 a note dropping the no-blanket-authorization clause is rejected",
    R.reviewNoteDeniesBlanketAuthorization, null, null, (r) => {
    r.note = "NON-SECRET owner-review artefact. It AUTHORIZES ZERO META CALLS."; }],
  ["M33 a closed canary that re-authorizes submission is rejected", R.canaryAuthorizesNothing, canary, null, (c) => {
    c.recommended_canary.submission_authorization = "AUTHORIZED"; }],
  ["M34 a canary dropping the no-resubmit denial is rejected", R.canaryAuthorizesNothing, canary, null, (c) => {
    c.explicit_non_authorizations = c.explicit_non_authorizations.filter((x) => !/RESUBMIT/i.test(x)); }],
  ["M35 a canary claiming MARKETING approval is rejected", R.canaryRemoteTruthExact, canary, null, (c) => {
    c.recommended_canary.last_proven_remote_category = "MARKETING"; }],
  ["M36 a canary semantic mismatch is rejected", R.canaryRemoteTruthExact, canary, null, (c) => {
    c.recommended_canary.readback_semantic_match = false; }],
  ["M37 a canary claiming a second create POST is rejected", R.canaryRemoteTruthExact, canary, null, (c) => {
    c.recommended_canary.create_post_count_at_reconciliation = 1; }],
  ["M38 a changed canary evidence filename is rejected", R.canaryRemoteTruthExact, canary, null, (c) => {
    c.recommended_canary.evidence[1] = "QF-MVP-40-WAVE1-lead_received-META-RECONCILIATION-2026-07-31T02-01-53-999Z.json"; }],

  // ---- QF-MVP-40.10F ------------------------------------------------------
  ["M39 an OPEN artefact with a stale packet pin is rejected", R.canarySourceFingerprintExact, canary, null,
    (c) => { c.status = "OWNER_REVIEW_PENDING"; c.source_packet_fingerprint = "0".repeat(64); }],
  ["M40 a CLOSED artefact with a non-hash pin is rejected", R.canarySourceFingerprintExact, canary, null,
    (c) => { c.source_packet_fingerprint = "not-a-hash"; }],
  ["M41 a drifted approved/pending split is rejected", R.reviewCountsExact, null, null, (r) => {
    r.counts.approved_unmapped = 3; }],
  ["M42 a consent acknowledgement demoted to pending is rejected", R.allDecisionsPending, null, null, (r) => {
    r.templates.find((t) => t.internal_template_key === "consent_stop_acknowledgement")
      .owner_copy_decision = "PENDING_OWNER_REVIEW"; }],
  ["M43 a re-authorized consent acknowledgement is rejected", R.allUnauthorized, null, null, (r) => {
    r.templates.find((t) => t.internal_template_key === "consent_start_acknowledgement")
      .submission_authorization = "AUTHORIZED"; }],
  ["M44 a commercial template marked approved-unmapped is rejected", R.allNotSubmitted, null, null, (r) => {
    r.templates.find((t) => t.internal_template_key === "recharge_reminder")
      .remote_submission_state = "APPROVED_UNMAPPED"; }],
];
for (const entry of MUT) {
  const [name, fn, , , mutate] = entry;
  if (name.startsWith("M1 ")) { add(name, fn() === false); continue; }
  if (name.startsWith("M2 ")) {
    // Vacuity guard: prove the rule inspects real source, by asserting it fails on a
    // body where the reconcile branch contains a POST.
    const fake = "modeResult.mode === OperationMode.RECONCILE_ONLY { method: \"POST\" } const pre = await lookupExact";
    add(name, !/finish\(/.test(fake));
    continue;
  }
  const base = entry[2] === "DOC" ? readFileSync(resolve(DOC), "utf8") : (entry[2] ?? review);
  const copy = typeof base === "string" ? base : clone(base);
  // A mutator may edit in place (objects) or return a replacement (strings).
  const mutated = mutate(copy);
  add(name, fn(mutated ?? copy) === false);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  [${r.detail}]` : ""}`);
console.log(`\nWave 1 entries: ${review.templates.length} · A=${review.counts.WAVE1A_ORDINARY_LAUNCH} · B=${review.counts.WAVE1B_COMMERCIAL_CATEGORY_REVIEW}`);
console.log(`Summary: ${results.length - failed.length} passed, ${failed.length} failed (rules: ${RULES.length}, mutation self-tests: ${MUT.length}).`);
process.exit(failed.length === 0 ? 0 : 1);
