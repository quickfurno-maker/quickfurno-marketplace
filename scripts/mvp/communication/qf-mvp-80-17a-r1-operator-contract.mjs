// ============================================================================
// QF-MVP-80.17A-R1 — the PURE decision half of the one-shot historical
// lead-assignment intent reconciliation operator.
//
// WHY A SEPARATE PURE MODULE
//   Everything that decides — flag parsing, the production-project fence, the
//   frozen trial window, candidate identity, attestation validity, summary
//   certification and post-state certification — lives here with NO I/O, so the
//   offline validator EXECUTES the real operator decisions instead of reading
//   the operator's source and hoping.
//
// WHAT IS DELIBERATELY NOT HERE
//   No database client, no fetch, no filesystem write, no provider, no send, no
//   status derivation of its own. The projection rules stay in
//   lib/communication/leadAssignmentResultContract.ts, which the CLI executes
//   directly; this module never re-implements them.
//
// CANONICAL VALUES ARE INJECTED, NEVER COPIED
//   Every lane identifier (aggregate type, channel, template purpose, template
//   key, entity type, provider key, idempotency key, intent statuses, the
//   projection function) arrives through a `canon` object built from the real
//   repository authorities. This file contains no second copy of them, which is
//   why a drift in the authorities cannot leave a stale duplicate behind.
// ============================================================================

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Frozen operator constants. None of these is caller-tunable.
// ---------------------------------------------------------------------------

export const R1 = Object.freeze({
  /** QuickFurno PRODUCTION Supabase project ref. The only permitted target. */
  PRODUCTION_PROJECT_REF: "yqpgcsduqbxulrlzwzap",
  /** Named refusals, so a mis-set environment fails loudly rather than silently. */
  STAGING_PROJECT_REF: "uckafzuochmbvtiodmcl",
  JARVIS_PROJECT_REF: "coilipywdvxklewquqvv",

  /**
   * The QF-MVP-80.16D-R2 controlled trial fence. HARD-CODED and half-open
   * [start, end). The trial lead was created ~2026-09-05T18:03:05Z. No CLI
   * argument can move either edge — widening the window to make a candidate
   * appear is exactly the failure this operator exists to make impossible.
   */
  TRIAL_WINDOW_START_ISO: "2026-09-05T18:00:00.000Z",
  TRIAL_WINDOW_END_ISO: "2026-09-05T18:30:00.000Z",

  /**
   * The raw `communication_messages.status` lifecycle value the historical
   * anomaly carries. Deliberately narrower than "projects to failed": the trial
   * message is `failed`, not `dead_letter` or `cancelled`. `assertCanonAgrees`
   * cross-checks this literal against the real projection authority so it can
   * never drift away from the code that owns the vocabulary.
   */
  CANONICAL_MESSAGE_STATUS_FAILED: "failed",

  ATTESTATION_SCHEMA: "qf-mvp-80-17a-r1-attestation/v1",
  /** Fifteen minutes. A longer TTL is refused, not clamped. */
  ATTESTATION_TTL_MS: 15 * 60 * 1000,

  PREFLIGHT_FLAG: "--preflight-readonly",
  EXECUTE_FLAG: "--execute",
  OWNER_ACK_FLAG: "--owner-authorized-once-historical-intent-reconciliation",
});

/** Closed mode vocabulary. Anything not listed here cannot reach a database. */
export const R1Mode = Object.freeze({
  OFFLINE_NOOP: "OFFLINE_NOOP",
  PREFLIGHT_READONLY: "PREFLIGHT_READONLY",
  EXECUTE: "EXECUTE",
  REFUSED: "REFUSED",
});

/** Closed refusal vocabulary. Never a raw error string, never a DB message. */
export const R1Refusal = Object.freeze({
  UNKNOWN_FLAG: "UNKNOWN_FLAG",
  DUPLICATE_FLAG: "DUPLICATE_FLAG",
  CONFLICTING_MODES: "CONFLICTING_MODES",
  EXECUTE_WITHOUT_OWNER_ACKNOWLEDGEMENT: "EXECUTE_WITHOUT_OWNER_ACKNOWLEDGEMENT",
  ACKNOWLEDGEMENT_WITHOUT_EXECUTE: "ACKNOWLEDGEMENT_WITHOUT_EXECUTE",

  SUPABASE_URL_MISSING: "SUPABASE_URL_MISSING",
  SUPABASE_URL_UNPARSABLE: "SUPABASE_URL_UNPARSABLE",
  PROJECT_REF_IS_STAGING: "PROJECT_REF_IS_STAGING",
  PROJECT_REF_IS_JARVIS: "PROJECT_REF_IS_JARVIS",
  PROJECT_REF_UNKNOWN: "PROJECT_REF_UNKNOWN",
  SERVICE_ROLE_KEY_MISSING: "SERVICE_ROLE_KEY_MISSING",

  NO_CANDIDATE: "NO_CANDIDATE",
  MULTIPLE_CANDIDATES: "MULTIPLE_CANDIDATES",
  AMBIGUOUS_LINEAGE: "AMBIGUOUS_LINEAGE",

  ATTESTATION_MISSING: "ATTESTATION_MISSING",
  ATTESTATION_MALFORMED: "ATTESTATION_MALFORMED",
  ATTESTATION_SCHEMA_MISMATCH: "ATTESTATION_SCHEMA_MISMATCH",
  ATTESTATION_TTL_TOO_LONG: "ATTESTATION_TTL_TOO_LONG",
  ATTESTATION_EXPIRED: "ATTESTATION_EXPIRED",
  ATTESTATION_PROJECT_REF_CHANGED: "ATTESTATION_PROJECT_REF_CHANGED",
  ATTESTATION_GIT_SHA_CHANGED: "ATTESTATION_GIT_SHA_CHANGED",
  ATTESTATION_CANDIDATE_CHANGED: "ATTESTATION_CANDIDATE_CHANGED",
  ATTESTATION_STATE_CHANGED: "ATTESTATION_STATE_CHANGED",
  ATTESTATION_LINKAGE_CHANGED: "ATTESTATION_LINKAGE_CHANGED",
  ATTESTATION_EVIDENCE_CHANGED: "ATTESTATION_EVIDENCE_CHANGED",
  ATTESTATION_INSIDE_REPOSITORY: "ATTESTATION_INSIDE_REPOSITORY",

  WORKING_TREE_DIRTY: "WORKING_TREE_DIRTY",
  CANON_DISAGREES_WITH_AUTHORITY: "CANON_DISAGREES_WITH_AUTHORITY",
});

/** Per-pair classification. Closed; every value is a decision, not a guess. */
export const R1CandidateState = Object.freeze({
  CANDIDATE: "CANDIDATE",
  ALREADY_RECONCILED: "ALREADY_RECONCILED",
  REFUSED_INTENT_MISSING: "REFUSED_INTENT_MISSING",
  REFUSED_INTENT_NOT_LEAD_ASSIGNMENT: "REFUSED_INTENT_NOT_LEAD_ASSIGNMENT",
  REFUSED_INTENT_CHANNEL: "REFUSED_INTENT_CHANNEL",
  REFUSED_INTENT_PURPOSE: "REFUSED_INTENT_PURPOSE",
  REFUSED_INTENT_OUTSIDE_TRIAL_WINDOW: "REFUSED_INTENT_OUTSIDE_TRIAL_WINDOW",
  REFUSED_INTENT_STATUS_NOT_REPAIRABLE: "REFUSED_INTENT_STATUS_NOT_REPAIRABLE",
  REFUSED_MESSAGE_MISSING: "REFUSED_MESSAGE_MISSING",
  REFUSED_MESSAGE_ENTITY_TYPE: "REFUSED_MESSAGE_ENTITY_TYPE",
  REFUSED_MESSAGE_ENTITY_ID: "REFUSED_MESSAGE_ENTITY_ID",
  REFUSED_MESSAGE_CHANNEL: "REFUSED_MESSAGE_CHANNEL",
  REFUSED_MESSAGE_TEMPLATE: "REFUSED_MESSAGE_TEMPLATE",
  REFUSED_MESSAGE_IDEMPOTENCY_KEY: "REFUSED_MESSAGE_IDEMPOTENCY_KEY",
  REFUSED_MESSAGE_PROVIDER: "REFUSED_MESSAGE_PROVIDER",
  REFUSED_MESSAGE_PROVIDER_MESSAGE_ID_MISSING: "REFUSED_MESSAGE_PROVIDER_MESSAGE_ID_MISSING",
  REFUSED_MESSAGE_PROVIDER_ACCOUNT_ID_MISSING: "REFUSED_MESSAGE_PROVIDER_ACCOUNT_ID_MISSING",
  REFUSED_MESSAGE_STATUS_NOT_FAILED: "REFUSED_MESSAGE_STATUS_NOT_FAILED",
});

const isNonEmptyString = (v) => typeof v === "string" && v.length > 0;

/** Privacy: identifiers are reported as digests, never in the clear. */
export function digestOf(value) {
  if (!isNonEmptyString(value)) return "sha256:absent";
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

// ---------------------------------------------------------------------------
// 1. Argument parsing — fail-closed, dry run by default
// ---------------------------------------------------------------------------

/**
 * The ONLY three accepted tokens. Anything else — including any attempt to pass
 * a time window, an id, a status or a batch size — is an unknown flag and the
 * operator refuses before it ever looks at the environment.
 */
export function parseR1Args(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const seen = new Set();
  for (const raw of args) {
    const arg = typeof raw === "string" ? raw : String(raw);
    if (arg !== R1.PREFLIGHT_FLAG && arg !== R1.EXECUTE_FLAG && arg !== R1.OWNER_ACK_FLAG) {
      return { mode: R1Mode.REFUSED, reason: R1Refusal.UNKNOWN_FLAG };
    }
    if (seen.has(arg)) return { mode: R1Mode.REFUSED, reason: R1Refusal.DUPLICATE_FLAG };
    seen.add(arg);
  }

  const preflight = seen.has(R1.PREFLIGHT_FLAG);
  const execute = seen.has(R1.EXECUTE_FLAG);
  const acknowledged = seen.has(R1.OWNER_ACK_FLAG);

  if (preflight && execute) return { mode: R1Mode.REFUSED, reason: R1Refusal.CONFLICTING_MODES };
  if (execute && !acknowledged) {
    return { mode: R1Mode.REFUSED, reason: R1Refusal.EXECUTE_WITHOUT_OWNER_ACKNOWLEDGEMENT };
  }
  if (acknowledged && !execute) {
    return { mode: R1Mode.REFUSED, reason: R1Refusal.ACKNOWLEDGEMENT_WITHOUT_EXECUTE };
  }
  if (execute) return { mode: R1Mode.EXECUTE, reason: null };
  if (preflight) return { mode: R1Mode.PREFLIGHT_READONLY, reason: null };
  return { mode: R1Mode.OFFLINE_NOOP, reason: null };
}

/** Only EXECUTE may write. Everything else is read-only or refuses. */
export const r1ModeMayWrite = (mode) => mode === R1Mode.EXECUTE;
/** Only preflight and execute may open a database connection at all. */
export const r1ModeMayReadDatabase = (mode) =>
  mode === R1Mode.PREFLIGHT_READONLY || mode === R1Mode.EXECUTE;

// ---------------------------------------------------------------------------
// 2. Production environment fence
// ---------------------------------------------------------------------------

/** `https://<ref>.supabase.co` -> `<ref>`; anything else is unparsable. */
export function projectRefOfSupabaseUrl(url) {
  if (!isNonEmptyString(url)) return null;
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  const m = /^([a-z0-9]{20})\.supabase\.(co|in)$/i.exec(host);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Proves the operator is pointed at QuickFurno PRODUCTION before any privileged
 * client is constructed. Neither the URL nor the key is ever returned or logged.
 */
export function decideR1Environment(input) {
  if (!isNonEmptyString(input?.supabaseUrl)) {
    return { allowed: false, projectRef: null, reason: R1Refusal.SUPABASE_URL_MISSING };
  }
  const ref = projectRefOfSupabaseUrl(input.supabaseUrl);
  if (ref === null) {
    return { allowed: false, projectRef: null, reason: R1Refusal.SUPABASE_URL_UNPARSABLE };
  }
  if (ref === R1.STAGING_PROJECT_REF) {
    return { allowed: false, projectRef: ref, reason: R1Refusal.PROJECT_REF_IS_STAGING };
  }
  if (ref === R1.JARVIS_PROJECT_REF) {
    return { allowed: false, projectRef: ref, reason: R1Refusal.PROJECT_REF_IS_JARVIS };
  }
  if (ref !== R1.PRODUCTION_PROJECT_REF) {
    return { allowed: false, projectRef: ref, reason: R1Refusal.PROJECT_REF_UNKNOWN };
  }
  if (input?.serviceRoleKeyPresent !== true) {
    return { allowed: false, projectRef: ref, reason: R1Refusal.SERVICE_ROLE_KEY_MISSING };
  }
  return { allowed: true, projectRef: ref, reason: null };
}

// ---------------------------------------------------------------------------
// 3. The frozen trial window
// ---------------------------------------------------------------------------

const WINDOW_START_MS = Date.parse(R1.TRIAL_WINDOW_START_ISO);
const WINDOW_END_MS = Date.parse(R1.TRIAL_WINDOW_END_ISO);

/** Half-open [start, end). Unparsable timestamps are outside, never inside. */
export function isInsideR1TrialWindow(iso) {
  if (!isNonEmptyString(iso)) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return t >= WINDOW_START_MS && t < WINDOW_END_MS;
}

// ---------------------------------------------------------------------------
// 4. canon — the injected repository authorities
// ---------------------------------------------------------------------------

/**
 * Proves the injected canon is internally consistent with the real projection
 * authority before any of it is used. In particular the raw message status this
 * operator repairs must actually project to the failed intent status; if the
 * shared vocabulary ever moves, the operator refuses instead of matching a
 * string that no longer means what it meant.
 */
export function assertCanonAgrees(canon) {
  const required = [
    "aggregateType", "intentChannel", "templatePurpose", "templateKey",
    "intentEntityType", "provider", "dispatchedIntentStatus", "failedIntentStatus",
    "reconcileTable", "reconcileColumn",
  ];
  for (const key of required) {
    if (!isNonEmptyString(canon?.[key])) {
      return { ok: false, reason: R1Refusal.CANON_DISAGREES_WITH_AUTHORITY, missing: key };
    }
  }
  if (typeof canon.idempotencyKeyFor !== "function" || typeof canon.project !== "function") {
    return { ok: false, reason: R1Refusal.CANON_DISAGREES_WITH_AUTHORITY, missing: "functions" };
  }
  if (canon.project(R1.CANONICAL_MESSAGE_STATUS_FAILED) !== canon.failedIntentStatus) {
    return { ok: false, reason: R1Refusal.CANON_DISAGREES_WITH_AUTHORITY, missing: "projection" };
  }
  if (canon.dispatchedIntentStatus === canon.failedIntentStatus) {
    return { ok: false, reason: R1Refusal.CANON_DISAGREES_WITH_AUTHORITY, missing: "statuses" };
  }
  return { ok: true, reason: null };
}

// ---------------------------------------------------------------------------
// 5. Candidate identity
// ---------------------------------------------------------------------------

/**
 * Classifies ONE intent/message pair against the historical anomaly's exact
 * lineage. Every fact is required; there is no "close enough" branch, and the
 * intent status is examined LAST so that a row failing linkage can never be
 * reported as reconciled or repairable.
 */
export function classifyR1Pair(input) {
  const intent = input?.intent ?? null;
  const message = input?.message ?? null;
  const canon = input?.canon;
  const S = R1CandidateState;

  if (intent === null || typeof intent !== "object") return { state: S.REFUSED_INTENT_MISSING };
  if (intent.aggregate_type !== canon.aggregateType) return { state: S.REFUSED_INTENT_NOT_LEAD_ASSIGNMENT };
  if (intent.channel !== canon.intentChannel) return { state: S.REFUSED_INTENT_CHANNEL };
  if (intent.template_purpose !== canon.templatePurpose) return { state: S.REFUSED_INTENT_PURPOSE };
  if (!isInsideR1TrialWindow(intent.created_at)) return { state: S.REFUSED_INTENT_OUTSIDE_TRIAL_WINDOW };

  if (message === null || typeof message !== "object") return { state: S.REFUSED_MESSAGE_MISSING };
  if (message.entity_type !== canon.intentEntityType) return { state: S.REFUSED_MESSAGE_ENTITY_TYPE };
  if (!isNonEmptyString(intent.id) || message.entity_id !== intent.id) return { state: S.REFUSED_MESSAGE_ENTITY_ID };
  if (message.channel !== canon.intentChannel) return { state: S.REFUSED_MESSAGE_CHANNEL };
  if (message.template_key !== canon.templateKey) return { state: S.REFUSED_MESSAGE_TEMPLATE };
  if (message.idempotency_key !== canon.idempotencyKeyFor(intent.id)) {
    return { state: S.REFUSED_MESSAGE_IDEMPOTENCY_KEY };
  }
  if (message.provider !== canon.provider) return { state: S.REFUSED_MESSAGE_PROVIDER };
  if (!isNonEmptyString(message.provider_message_id)) {
    return { state: S.REFUSED_MESSAGE_PROVIDER_MESSAGE_ID_MISSING };
  }
  if (!isNonEmptyString(message.provider_account_id)) {
    return { state: S.REFUSED_MESSAGE_PROVIDER_ACCOUNT_ID_MISSING };
  }
  if (message.status !== R1.CANONICAL_MESSAGE_STATUS_FAILED) {
    return { state: S.REFUSED_MESSAGE_STATUS_NOT_FAILED };
  }

  // Linkage is now fully proved. Only here may the intent status be read.
  if (intent.status === canon.dispatchedIntentStatus) {
    return {
      state: S.CANDIDATE,
      candidate: Object.freeze({
        intentId: intent.id,
        messageId: message.id,
        provider: message.provider,
        providerMessageId: message.provider_message_id,
        providerAccountId: message.provider_account_id,
        idempotencyKey: message.idempotency_key,
        observedIntentStatus: intent.status,
        canonicalMessageStatus: message.status,
        intentCreatedAt: intent.created_at,
        intentDispatchedAt: intent.dispatched_at ?? null,
      }),
    };
  }
  if (intent.status === canon.failedIntentStatus) return { state: S.ALREADY_RECONCILED };
  return { state: S.REFUSED_INTENT_STATUS_NOT_REPAIRABLE };
}

/**
 * Collapses the classified pairs into ONE decision. Exactly one candidate, or
 * nothing happens. "Zero drift rows" is never on its own a success claim: an
 * ALREADY_RECONCILED verdict requires the exact historical lineage to have been
 * located and proved.
 */
export function decideR1Discovery(classified) {
  const rows = Array.isArray(classified) ? classified : [];
  const candidates = rows.filter((r) => r?.state === R1CandidateState.CANDIDATE);
  const reconciled = rows.filter((r) => r?.state === R1CandidateState.ALREADY_RECONCILED);

  if (candidates.length > 1) {
    return { state: R1Mode.REFUSED, reason: R1Refusal.MULTIPLE_CANDIDATES, candidate: null };
  }
  if (candidates.length === 1 && reconciled.length > 0) {
    return { state: R1Mode.REFUSED, reason: R1Refusal.AMBIGUOUS_LINEAGE, candidate: null };
  }
  if (candidates.length === 1) {
    return { state: R1CandidateState.CANDIDATE, reason: null, candidate: candidates[0].candidate };
  }
  if (reconciled.length > 1) {
    return { state: R1Mode.REFUSED, reason: R1Refusal.AMBIGUOUS_LINEAGE, candidate: null };
  }
  if (reconciled.length === 1) {
    return { state: R1CandidateState.ALREADY_RECONCILED, reason: null, candidate: null };
  }
  return { state: R1Mode.REFUSED, reason: R1Refusal.NO_CANDIDATE, candidate: null };
}

// ---------------------------------------------------------------------------
// 6. Write-plan certification (executed against the REAL 80.17A contract)
// ---------------------------------------------------------------------------

/**
 * Given the decision the real `evaluateLeadAssignmentReconciliation` returned,
 * prove the write it plans is the single-column CAS this repair is allowed to
 * make — and nothing else. `dispatched_at` must not appear anywhere in it.
 */
export function certifyR1WritePlan(input) {
  const decision = input?.decision;
  const canon = input?.canon;
  const appliedOutcome = input?.appliedOutcome;
  const fail = (reason) => ({ certified: false, reason });

  if (!decision || typeof decision !== "object") return fail("PLAN_MISSING");
  if (decision.outcome !== appliedOutcome) return fail("PLAN_OUTCOME_NOT_APPLIED");
  if (decision.derived !== canon.failedIntentStatus) return fail("PLAN_DERIVED_NOT_FAILED");

  const plan = decision.plan;
  if (!plan || typeof plan !== "object") return fail("PLAN_ABSENT");
  if (plan.table !== canon.reconcileTable) return fail("PLAN_TABLE_UNEXPECTED");

  const patchKeys = Object.keys(plan.patch ?? {});
  // The dispatch timestamp is checked FIRST so a widened patch is named for the
  // column it wrongly reaches for, not merely for being wide.
  if (Object.prototype.hasOwnProperty.call(plan.patch ?? {}, "dispatched_at")) {
    return fail("PLAN_PATCH_TOUCHES_DISPATCHED_AT");
  }
  if (patchKeys.length !== 1) return fail("PLAN_PATCH_NOT_SINGLE_COLUMN");
  if (patchKeys[0] !== canon.reconcileColumn) return fail("PLAN_PATCH_COLUMN_UNEXPECTED");
  if (plan.patch[canon.reconcileColumn] !== canon.failedIntentStatus) return fail("PLAN_PATCH_VALUE_UNEXPECTED");

  const filters = Array.isArray(plan.filters) ? plan.filters : [];
  if (filters.length !== 3) return fail("PLAN_FENCES_NOT_THREE");
  const columns = filters.map((f) => (Array.isArray(f) ? f[0] : null));
  for (const expected of ["id", "aggregate_type", canon.reconcileColumn]) {
    if (!columns.includes(expected)) return fail("PLAN_FENCE_MISSING");
  }
  if (columns.includes("dispatched_at")) return fail("PLAN_FENCE_TOUCHES_DISPATCHED_AT");
  return { certified: true, reason: null };
}

// ---------------------------------------------------------------------------
// 7. Single-use attestation
// ---------------------------------------------------------------------------

const ATTESTATION_BOUND_FIELDS = Object.freeze([
  "projectRef", "gitSha", "intentId", "messageId", "provider", "providerMessageId",
  "providerAccountId", "idempotencyKey", "observedIntentStatus", "canonicalMessageStatus",
]);

const canonicalJson = (o) => JSON.stringify(ATTESTATION_BOUND_FIELDS.map((k) => [k, o?.[k] ?? null]));

export function r1EvidenceDigest(bound) {
  return createHash("sha256").update(canonicalJson(bound)).digest("hex");
}

export function buildR1Attestation(input) {
  const c = input?.candidate ?? {};
  const bound = {
    projectRef: input?.projectRef ?? null,
    gitSha: input?.gitSha ?? null,
    intentId: c.intentId ?? null,
    messageId: c.messageId ?? null,
    provider: c.provider ?? null,
    providerMessageId: c.providerMessageId ?? null,
    providerAccountId: c.providerAccountId ?? null,
    idempotencyKey: c.idempotencyKey ?? null,
    observedIntentStatus: c.observedIntentStatus ?? null,
    canonicalMessageStatus: c.canonicalMessageStatus ?? null,
  };
  const issuedAtMs = Number(input?.nowMs);
  return {
    schema: R1.ATTESTATION_SCHEMA,
    issuedAtMs,
    ttlMs: R1.ATTESTATION_TTL_MS,
    expiresAtMs: issuedAtMs + R1.ATTESTATION_TTL_MS,
    ...bound,
    intentDispatchedAt: c.intentDispatchedAt ?? null,
    evidenceDigest: r1EvidenceDigest(bound),
  };
}

/**
 * The execute gate. The attestation binds the project, the exact reviewed git
 * SHA, the exact candidate and the exact observed state; ANY drift between the
 * preflight and the execution refuses. It never carries a credential.
 */
export function validateR1Attestation(input) {
  const a = input?.attestation;
  const fail = (reason) => ({ ok: false, reason });
  if (a === null || a === undefined) return fail(R1Refusal.ATTESTATION_MISSING);
  if (typeof a !== "object") return fail(R1Refusal.ATTESTATION_MALFORMED);
  if (a.schema !== R1.ATTESTATION_SCHEMA) return fail(R1Refusal.ATTESTATION_SCHEMA_MISMATCH);

  for (const field of ATTESTATION_BOUND_FIELDS) {
    if (!isNonEmptyString(a[field])) return fail(R1Refusal.ATTESTATION_MALFORMED);
  }
  if (!Number.isFinite(a.issuedAtMs) || !Number.isFinite(a.expiresAtMs) || !Number.isFinite(a.ttlMs)) {
    return fail(R1Refusal.ATTESTATION_MALFORMED);
  }
  if (a.ttlMs > R1.ATTESTATION_TTL_MS || a.expiresAtMs - a.issuedAtMs > R1.ATTESTATION_TTL_MS) {
    return fail(R1Refusal.ATTESTATION_TTL_TOO_LONG);
  }
  const now = Number(input?.nowMs);
  if (!Number.isFinite(now) || now > a.expiresAtMs || now < a.issuedAtMs) {
    return fail(R1Refusal.ATTESTATION_EXPIRED);
  }
  if (a.projectRef !== input?.projectRef) return fail(R1Refusal.ATTESTATION_PROJECT_REF_CHANGED);
  if (a.gitSha !== input?.gitSha) return fail(R1Refusal.ATTESTATION_GIT_SHA_CHANGED);

  const c = input?.candidate ?? {};
  if (a.intentId !== c.intentId || a.messageId !== c.messageId ||
      a.providerMessageId !== c.providerMessageId || a.providerAccountId !== c.providerAccountId ||
      a.provider !== c.provider) {
    return fail(R1Refusal.ATTESTATION_CANDIDATE_CHANGED);
  }
  if (a.observedIntentStatus !== c.observedIntentStatus ||
      a.canonicalMessageStatus !== c.canonicalMessageStatus) {
    return fail(R1Refusal.ATTESTATION_STATE_CHANGED);
  }
  if (a.idempotencyKey !== c.idempotencyKey) return fail(R1Refusal.ATTESTATION_LINKAGE_CHANGED);
  if (a.evidenceDigest !== r1EvidenceDigest(a)) return fail(R1Refusal.ATTESTATION_EVIDENCE_CHANGED);
  return { ok: true, reason: null };
}

/** The attestation must never live inside the repository, so it cannot be committed. */
export function isR1AttestationPathOutsideRepo(attestationPath, repoRoot) {
  if (!isNonEmptyString(attestationPath) || !isNonEmptyString(repoRoot)) return false;
  const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const a = norm(attestationPath);
  const r = norm(repoRoot);
  return a !== r && !a.startsWith(`${r}/`);
}

// ---------------------------------------------------------------------------
// 8. Certifying what the REAL service actually did
// ---------------------------------------------------------------------------

/**
 * Exactly one examined row, exactly one applied write, nothing else — including
 * a zero `concurrent`. A CAS miss or a write failure is explicitly NOT success,
 * and neither is retried: the operator stops and a later explicit action starts
 * from a fresh read-only preflight.
 */
export function certifyR1Summary(summary) {
  if (!summary || typeof summary !== "object") return { certified: false, reason: "SUMMARY_MISSING" };
  if (summary.concurrent > 0) return { certified: false, reason: "NOT_CERTIFIED_CONCURRENT_MODIFICATION" };
  if (summary.refused > 0) return { certified: false, reason: "NOT_CERTIFIED_WRITE_REFUSED" };
  const ok =
    summary.examined === 1 && summary.applied === 1 && summary.unchanged === 0 &&
    summary.notApplicable === 0 && summary.concurrent === 0 && summary.refused === 0 &&
    summary.outcomes && summary.outcomes.APPLIED === 1;
  return ok ? { certified: true, reason: null } : { certified: false, reason: "NOT_CERTIFIED_UNEXPECTED_SUMMARY" };
}

/**
 * Read-back proof. The canonical message must be unchanged in every field this
 * operator observed (it has no authority over that row at all) and the intent
 * must have moved exactly one column.
 */
export function certifyR1PostState(input) {
  const message = input?.message;
  const intent = input?.intent;
  const canon = input?.canon;
  const before = input?.before ?? {};
  const fail = (reason) => ({ certified: false, reason });

  if (!message || typeof message !== "object") return fail("POST_MESSAGE_MISSING");
  if (!intent || typeof intent !== "object") return fail("POST_INTENT_MISSING");
  if (message.status !== R1.CANONICAL_MESSAGE_STATUS_FAILED) return fail("POST_CANONICAL_MESSAGE_MUTATED");
  if (message.id !== before.messageId) return fail("POST_CANONICAL_MESSAGE_MUTATED");
  if (message.provider_message_id !== before.providerMessageId) return fail("POST_CANONICAL_MESSAGE_MUTATED");
  if (message.idempotency_key !== before.idempotencyKey) return fail("POST_CANONICAL_MESSAGE_MUTATED");
  if (intent.id !== before.intentId) return fail("POST_INTENT_IDENTITY_CHANGED");
  if (intent.status !== canon.failedIntentStatus) return fail("POST_INTENT_NOT_CONVERGED");
  if ((intent.dispatched_at ?? null) !== (before.intentDispatchedAt ?? null)) {
    return fail("POST_DISPATCHED_AT_MUTATED");
  }
  return { certified: true, reason: null };
}

// ---------------------------------------------------------------------------
// 9. Meta failure evidence (QF-MVP-80.16D-R2 observed error 131026)
// ---------------------------------------------------------------------------

/** The code the controlled trial actually recorded. Supporting evidence only. */
export const R1_KNOWN_TRIAL_FAILURE_CODE = "131026";

export const R1FailureEvidence = Object.freeze({
  MATCHES_KNOWN_TRIAL: "MATCHES_KNOWN_TRIAL",
  UNPROVEN: "UNPROVEN",
  CONTRADICTS_KNOWN_TRIAL: "CONTRADICTS_KNOWN_TRIAL",
});

/**
 * Deliberately three-valued. The exact storage spelling of the canonical failure
 * code is not assumed: anything that is not a plain numeric code is UNPROVEN and
 * never weakens candidate identity, while a numeric code that is NOT the trial's
 * code is a contradiction the operator must stop on rather than repair.
 */
export function classifyR1FailureEvidence(failureCode) {
  if (failureCode === null || failureCode === undefined) return R1FailureEvidence.UNPROVEN;
  const s = String(failureCode).trim();
  if (!/^[0-9]{1,10}$/.test(s)) return R1FailureEvidence.UNPROVEN;
  return s === R1_KNOWN_TRIAL_FAILURE_CODE
    ? R1FailureEvidence.MATCHES_KNOWN_TRIAL
    : R1FailureEvidence.CONTRADICTS_KNOWN_TRIAL;
}

/** Only a bare numeric provider error code may be printed in the clear. */
export function r1FailureCodeIsSafeToPrint(failureCode) {
  return typeof failureCode === "string" && /^[0-9]{1,10}$/.test(failureCode.trim());
}
