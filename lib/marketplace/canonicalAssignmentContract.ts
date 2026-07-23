// ============================================================================
// QuickFurno — lib/marketplace/canonicalAssignmentContract.ts
//
// QF-MVP-20.3R1 — the PURE half of the canonical assignment authority seam.
//
// Constants, types and deterministic helpers that mirror the in-database
// contract of public.qf_assign_lead_vendors_v2. Deliberately dependency-free
// (no Supabase client, no network, no clock, no randomness) so the offline MVP
// suite can exercise the real production code rather than a copy of it.
//
// The I/O half — the one place that actually calls the authority — lives in
// services/canonicalAssignmentAuthority.ts, which re-exports everything here.
// ============================================================================

// ---------------------------------------------------------------------------
// Locked constants (mirrors of the in-database contract — never a substitute)
// ---------------------------------------------------------------------------

/** The sole assignment authority. No other assignment RPC may be called. */
export const CANONICAL_ASSIGNMENT_RPC = "qf_assign_lead_vendors_v2";

/** Enforced INSIDE the authority; reproduced here for previews/messages only. */
export const CANONICAL_ACTIVE_ASSIGNMENT_CAP = 3;
export const CANONICAL_LIFETIME_ASSIGNMENT_CAP = 6;

/** Exactly one wallet credit per successful assignment. Not caller-selectable. */
export const CANONICAL_ASSIGNMENT_CREDIT_COST = 1;

/**
 * Sanity bound on the RANKED candidate pool a consumer may submit. This is not
 * an assignment ceiling: the authority still stops at 3 successful active
 * assignments no matter how long the pool is.
 */
export const MAX_CANONICAL_CANDIDATE_POOL = 20;

export const CANONICAL_ASSIGNMENT_MODES = [
  "automatic",
  "client_selected",
  "admin_manual",
  "delayed_fill",
  "replacement",
  "recovery_replay",
] as const;
export type CanonicalAssignmentMode = (typeof CANONICAL_ASSIGNMENT_MODES)[number];

export const CANONICAL_ACTOR_KINDS = ["system", "client", "admin", "worker"] as const;
export type CanonicalActorKind = (typeof CANONICAL_ACTOR_KINDS)[number];

/** Actor kinds the authority requires to pass a NULL actor id. */
const UNATTRIBUTED_ACTOR_KINDS: readonly CanonicalActorKind[] = ["system", "worker"];
/** Actor kinds the authority requires to pass a NON-NULL actor id. */
const ATTRIBUTED_ACTOR_KINDS: readonly CanonicalActorKind[] = ["client", "admin"];

// ---------------------------------------------------------------------------
// R1_BLOCKED_PENDING_OWNER_BINDING
// ---------------------------------------------------------------------------

/**
 * Application error code returned by every runtime path that would otherwise
 * have performed a CLIENT-SELECTED assignment.
 *
 * MISSING PREREQUISITE (exact): the database has no trustworthy binding from a
 * lead to the client who owns it. `public.leads` carries no `client_account_id`,
 * `user_id` or `created_by` column, and there is no server-created
 * client-selection request row binding an authenticated client, a lead and a
 * requested vendor. The only available correlation is the lead's phone TEXT,
 * and phone equality is explicitly NOT accepted as ownership authority
 * (`public.qf_norm_text` is `lower(trim(...))`, which cannot canonicalise a
 * telephone number).
 *
 * Because the authority cannot RE-ASSERT ownership server-side, it rejects
 * `client_selected` before claiming an operation — mutating nothing. This
 * module therefore refuses the mode locally too, so a blocked selection costs
 * no database round-trip and can have no side effect whatsoever.
 *
 * UNBLOCKING requires ONE of, delivered as a reviewed migration:
 *   1. an explicit lead → client ownership binding column, or
 *   2. a server-created client-selection request row binding the authenticated
 *      client, the lead and the requested vendor.
 *
 * Until then no runtime consumer may activate `client_selected`, and no legacy
 * RPC (`assign_client_selected_vendor_to_group`, `assign_lead_to_vendors`,
 * `assign_lead_to_preferred_vendor`, …) may be used as a fallback.
 */
export const R1_BLOCKED_PENDING_OWNER_BINDING = "R1_BLOCKED_PENDING_OWNER_BINDING";

export const CLIENT_SELECTED_BLOCK_REASON =
  "Client-selected assignment is disabled: the database has no trustworthy lead-to-client " +
  "ownership binding to re-assert, and phone equality is not accepted as ownership authority. " +
  "No vendor was assigned and no credit was deducted.";

/** Client-facing wording for a blocked client-selected selection. */
export const CLIENT_SELECTED_BLOCK_CLIENT_MESSAGE =
  "Your enquiry is safe with QuickFurno. Our team will connect you with suitable verified vendors shortly.";

/** Invalid-request code. Always fail-closed: nothing is sent to the authority. */
export const CANONICAL_ASSIGNMENT_INVALID_REQUEST = "CANONICAL_ASSIGNMENT_INVALID_REQUEST";

/** The authority is missing on this database (migration not applied). */
export const CANONICAL_ASSIGNMENT_AUTHORITY_MISSING = "CANONICAL_ASSIGNMENT_AUTHORITY_MISSING";

export const CANONICAL_AUTHORITY_MIGRATION_HINT =
  `${CANONICAL_ASSIGNMENT_RPC} is missing on this database. Apply migration ` +
  "20260723000300_qf_mvp_canonical_assignment_authority.sql. Assignment is disabled until then.";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CanonicalAssignmentStatus =
  | "applied"
  | "partial"
  | "rejected"
  | "already_applied"
  | "unauthorized";

export type CanonicalAssignedVendor = {
  assignment_id: string;
  vendor_id: string;
  credit_ledger_id: string | null;
};

export type CanonicalSkippedVendor = {
  vendor_id: string;
  reason_code: string;
};

export type CanonicalAssignmentOutcome = {
  status: CanonicalAssignmentStatus;
  reason_code: string | null;
  operation_id: string | null;
  operation_key: string;
  lead_id: string;
  mode: CanonicalAssignmentMode;
  assigned: CanonicalAssignedVendor[];
  skipped: CanonicalSkippedVendor[];
  /** Vendor ids only — convenience for consumers that used the legacy shape. */
  assigned_vendor_ids: string[];
  skipped_vendor_ids: string[];
  active_count_after: number | null;
  lifetime_count_after: number | null;
  communication_intent_ids: string[];
  already_applied: boolean;
};

export type CanonicalAssignmentRequest = {
  leadId: string;
  mode: CanonicalAssignmentMode;
  /** Ranked candidate pool. Order is a preference only, never authority. */
  candidateVendorIds: string[];
  /**
   * Deterministic discriminator for this LOGICAL operation. It must be stable
   * across retries of the same operation and distinct between operations that
   * are genuinely different (e.g. `"auto_match"`, `"delayed_fill:attempt-2"`,
   * `"admin_manual:top_up"`). Never derive it from a clock or a random value.
   */
  operationScope: string;
  actorKind: CanonicalActorKind;
  actorId?: string | null;
  replacementRequestId?: string | null;
  reasonCode?: string | null;
};

/** A validated request, normalized exactly as it will be sent to the authority. */
export type NormalizedCanonicalAssignmentRequest = {
  leadId: string;
  mode: CanonicalAssignmentMode;
  candidateVendorIds: string[];
  operationKey: string;
  actorKind: CanonicalActorKind;
  actorId: string | null;
  replacementRequestId: string | null;
  reasonCode: string | null;
};

export type CanonicalRequestValidation =
  | { ok: true; request: NormalizedCanonicalAssignmentRequest }
  | { ok: false; code: string; error: string };

// ---------------------------------------------------------------------------
// Pure helpers (deterministic, offline, no I/O — covered by the MVP suite)
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

/**
 * Trim, drop blanks/non-uuids, lowercase and de-duplicate while PRESERVING the
 * caller's ranking order. The authority re-deduplicates and re-orders for
 * locking, so this is a hygiene step, never an authority step.
 */
export function normalizeCandidateVendorIds(vendorIds: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of vendorIds ?? []) {
    if (typeof raw !== "string") continue;
    const id = raw.trim().toLowerCase();
    if (!UUID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * FNV-1a (64-bit) over the sorted candidate set.
 *
 * This digest only keeps the operation key short and stable; it carries NO
 * authority. The authority computes its own SHA-256 `request_fingerprint` over
 * the full normalized request, so a digest collision can only ever cause an
 * `idempotency_conflict` REJECTION — never a wrong or duplicated assignment.
 */
export function candidateSetDigest(vendorIds: readonly string[]): string {
  const canonical = [...new Set(vendorIds)].sort().join(",");
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < canonical.length; i += 1) {
    hash = (hash ^ BigInt(canonical.charCodeAt(i) & 0xff)) & mask;
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Collapse anything that could vary between retries out of a scope token. */
export function normalizeOperationScope(scope: string): string {
  return String(scope ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Build the deterministic operation key.
 *
 * Same logical operation -> same key -> the authority replays instead of
 * assigning again. Different operation -> different key. The key is NOT a
 * secret and NOT an authorization token; the authority independently
 * fingerprints the request before trusting the key.
 */
export function buildAssignmentOperationKey(input: {
  leadId: string;
  mode: CanonicalAssignmentMode;
  actorKind: CanonicalActorKind;
  actorId: string | null;
  replacementRequestId: string | null;
  reasonCode: string | null;
  operationScope: string;
  candidateVendorIds: readonly string[];
}): string {
  return [
    "qf20r1",
    "v1",
    input.mode,
    input.leadId.toLowerCase(),
    input.actorKind,
    input.actorId ? input.actorId.toLowerCase() : "-",
    input.replacementRequestId ? input.replacementRequestId.toLowerCase() : "-",
    normalizeOperationScope(input.reasonCode ?? "") || "-",
    normalizeOperationScope(input.operationScope) || "-",
    candidateSetDigest(input.candidateVendorIds),
  ].join(":");
}

/**
 * Fail-closed request validation. Mirrors the authority's own argument rules so
 * an invalid request never reaches the database, and rejects `client_selected`
 * outright (R1_BLOCKED_PENDING_OWNER_BINDING).
 */
export function validateCanonicalAssignmentRequest(
  input: CanonicalAssignmentRequest,
): CanonicalRequestValidation {
  const invalid = (error: string): CanonicalRequestValidation => ({
    ok: false,
    code: CANONICAL_ASSIGNMENT_INVALID_REQUEST,
    error,
  });

  const leadId = typeof input?.leadId === "string" ? input.leadId.trim().toLowerCase() : "";
  if (!isCanonicalUuid(leadId)) return invalid("A valid lead id is required.");

  const mode = input?.mode;
  if (!CANONICAL_ASSIGNMENT_MODES.includes(mode)) return invalid("Unsupported assignment mode.");

  // R1: client-selected mode is fail-closed BEFORE any database round-trip.
  if (mode === "client_selected") {
    return { ok: false, code: R1_BLOCKED_PENDING_OWNER_BINDING, error: CLIENT_SELECTED_BLOCK_REASON };
  }

  const actorKind = input?.actorKind;
  if (!CANONICAL_ACTOR_KINDS.includes(actorKind)) return invalid("Unsupported actor kind.");

  const rawActorId = typeof input?.actorId === "string" ? input.actorId.trim().toLowerCase() : null;
  const actorId = rawActorId && rawActorId.length > 0 ? rawActorId : null;

  if (UNATTRIBUTED_ACTOR_KINDS.includes(actorKind) && actorId !== null) {
    return invalid("A system or worker actor must not carry an actor id.");
  }
  if (ATTRIBUTED_ACTOR_KINDS.includes(actorKind)) {
    if (!isCanonicalUuid(actorId)) return invalid("A client or admin actor requires a valid actor id.");
  }

  const rawReplacement =
    typeof input?.replacementRequestId === "string" ? input.replacementRequestId.trim().toLowerCase() : null;
  const replacementRequestId = rawReplacement && rawReplacement.length > 0 ? rawReplacement : null;
  if (replacementRequestId !== null && !isCanonicalUuid(replacementRequestId)) {
    return invalid("The replacement reference must be a valid id.");
  }
  if ((mode === "replacement") !== (replacementRequestId !== null)) {
    return invalid("Replacement mode requires its approved replacement reference, and only replacement mode may supply one.");
  }

  const candidateVendorIds = normalizeCandidateVendorIds(input?.candidateVendorIds ?? []);
  if (candidateVendorIds.length === 0) return invalid("At least one candidate vendor is required.");
  if (candidateVendorIds.length > MAX_CANONICAL_CANDIDATE_POOL) {
    return invalid(`At most ${MAX_CANONICAL_CANDIDATE_POOL} candidate vendors may be submitted.`);
  }

  const reasonCodeRaw = typeof input?.reasonCode === "string" ? input.reasonCode.trim() : "";
  const reasonCode = reasonCodeRaw.length > 0 ? reasonCodeRaw.slice(0, 120) : null;

  const operationScope = typeof input?.operationScope === "string" ? input.operationScope.trim() : "";
  if (!normalizeOperationScope(operationScope)) return invalid("A deterministic operation scope is required.");

  const operationKey = buildAssignmentOperationKey({
    leadId,
    mode,
    actorKind,
    actorId,
    replacementRequestId,
    reasonCode,
    operationScope,
    candidateVendorIds,
  });

  return {
    ok: true,
    request: { leadId, mode, candidateVendorIds, operationKey, actorKind, actorId, replacementRequestId, reasonCode },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asTrimmed(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asCount(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asStatus(value: unknown): CanonicalAssignmentStatus {
  const text = asTrimmed(value);
  switch (text) {
    case "applied":
    case "partial":
    case "already_applied":
    case "unauthorized":
      return text;
    // Anything the authority does not explicitly mark as successful is treated
    // as a rejection. Unknown values must never read as success.
    default:
      return "rejected";
  }
}

/**
 * Normalize the authority's jsonb into the typed outcome. Unknown or missing
 * fields degrade to the SAFE value (rejected / empty / null), never to success.
 */
export function normalizeCanonicalAssignmentResult(
  raw: unknown,
  request: NormalizedCanonicalAssignmentRequest,
): CanonicalAssignmentOutcome {
  const record = asRecord(raw);
  const status = asStatus(record.status);

  const assigned: CanonicalAssignedVendor[] = Array.isArray(record.assigned)
    ? record.assigned.flatMap((item) => {
        const row = asRecord(item);
        const vendorId = asTrimmed(row.vendor_id);
        const assignmentId = asTrimmed(row.assignment_id);
        if (!vendorId || !assignmentId) return [];
        return [{ assignment_id: assignmentId, vendor_id: vendorId, credit_ledger_id: asTrimmed(row.credit_ledger_id) }];
      })
    : [];

  const skipped: CanonicalSkippedVendor[] = Array.isArray(record.skipped)
    ? record.skipped.flatMap((item) => {
        const row = asRecord(item);
        const vendorId = asTrimmed(row.vendor_id);
        if (!vendorId) return [];
        return [{ vendor_id: vendorId, reason_code: asTrimmed(row.reason_code) ?? "rejected" }];
      })
    : [];

  const intentIds = Array.isArray(record.communication_intent_ids)
    ? record.communication_intent_ids.map((id) => asTrimmed(id)).filter((id): id is string => Boolean(id))
    : [];

  // A whole-operation rejection (e.g. active_limit_reached) carries a top-level
  // reason_code. A per-vendor-only rejection does not, so surface the first
  // skip reason rather than reporting an unexplained failure.
  const topReason = asTrimmed(record.reason_code);
  const reasonCode = topReason ?? (status === "rejected" ? skipped[0]?.reason_code ?? "rejected" : null);

  return {
    status,
    reason_code: reasonCode,
    operation_id: asTrimmed(record.operation_id),
    operation_key: request.operationKey,
    lead_id: asTrimmed(record.lead_id) ?? request.leadId,
    mode: request.mode,
    assigned,
    skipped,
    assigned_vendor_ids: assigned.map((a) => a.vendor_id),
    skipped_vendor_ids: skipped.map((s) => s.vendor_id),
    active_count_after: asCount(record.active_count_after),
    lifetime_count_after: asCount(record.lifetime_count_after),
    communication_intent_ids: intentIds,
    already_applied: record.already_applied === true || status === "already_applied",
  };
}

/** True when the outcome placed at least one vendor (including on replay). */
export function canonicalAssignmentPlacedVendors(outcome: CanonicalAssignmentOutcome): boolean {
  return outcome.assigned.length > 0;
}

/** 42883 = undefined_function; PGRST202 = function absent from the schema cache. */
export function isMissingAuthorityError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42883" || error.code === "PGRST202") return true;
  const message = error.message ?? "";
  return message.includes(CANONICAL_ASSIGNMENT_RPC) && /does not exist|schema cache|could not find the function/i.test(message);
}

