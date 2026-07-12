// ============================================================================
// QuickFurno — services/communicationConsentWriterService.ts   (Phase 5F-D2-C→D2-D, server-only)
//
// The SOLE controlled transactional WRITER for inbound consent commands (STOP / START / HELP /
// unsupported). It appends IMMUTABLE consent evidence and mutates the authoritative SUPPRESSION
// projection ATOMICALLY, inside ONE database RPC transaction. It is idempotent, concurrency-safe,
// fails closed, and returns a sanitized discriminated union only.
//
// LOCKED POLICY (Phase 5F-D2-D):
//   P1 — STOP/START apply INDEPENDENTLY to the `marketing` and `transactional` suppression scopes
//        ONLY. They NEVER create/clear a `global` suppression and NEVER touch `authentication`;
//        OTP stays available unless a SEPARATE existing global suppression independently blocks it.
//   P2 — STOP/START are SUPPRESSION-ONLY. This writer NEVER creates/blocks/allows/withdraws/modifies
//        communication_preferences — even for an EXACT principal. Explicit marketing consent is a
//        separate authority. START NEVER creates marketing consent.
//   P3 — HELP causes NO consent-state transition, so it writes NO communication_consent_events row
//        and NO projection; its audit trail is the separately-persisted inbound-message record. It
//        returns `help_acknowledged` and sends nothing.
//
// AUTHORITY. QuickFurno Core is the sole consent authority (Jarvis recommends, QuickFurno authorizes,
// n8n executes, providers deliver, results return here). This writer reuses communication_consent_events,
// communication_suppressions and CONSENT_POLICY_VERSION — it creates NO parallel consent truth.
//
// SERVER-ONLY. It imports the RLS-bypassing `adminClient` and lives in the service layer; it exposes
// no API route and is imported by no client code, no webhook, no provider, and no n8n bridge. It SENDS
// nothing and NEVER authorizes final delivery (consent ≠ send authorization).
//
// The atomic transaction, row locking, replay/conflict detection and evidence↔projection ordering all
// live in the SECURITY DEFINER RPC `public.apply_communication_consent_command` (the additive D2-D
// migration). This module validates the narrow input, routes HELP/unsupported WITHOUT touching the DB,
// derives the aggregate result, and sanitizes every outcome. No raw destination / phone / message text
// / payload / SQL error / SQLSTATE / stack ever leaves this module.
// ============================================================================

import { adminClient } from "../lib/supabase";
import { CONSENT_POLICY_VERSION } from "../lib/communication/consentPolicy";
import type { NormalizedConsentCommand } from "../lib/communication/consentCommand";

// ----------------------------------------------------------------------------
// Public input contract (narrow, server-only; NO plaintext destination / raw text / payload / token)
// ----------------------------------------------------------------------------
export type WriterChannel = "whatsapp" | "sms" | "rcs";
export type WriterPrincipalType = "client" | "vendor" | "admin";
export type WriterPrincipal = { readonly type: WriterPrincipalType; readonly id: string } | null;
export type WriterIdentityConfidence = "exact" | "ambiguous" | "unknown";

export interface ConsentWriterInput {
  readonly channel: WriterChannel;
  /** ALREADY normalized upstream (lib/communication/consentCommand). NEVER raw inbound text. */
  readonly command: NormalizedConsentCommand;
  /** sha256(canonical E.164) lowercase hex. NEVER a plaintext phone / wa_id / MSISDN. */
  readonly destinationHash: string;
  readonly identityConfidence: WriterIdentityConfidence;
  /** Present iff identityConfidence === 'exact'; null otherwise. Optional AUDIT linkage only —
   *  it NEVER causes a preference write (P2). */
  readonly principal: WriterPrincipal;
  /** Trusted server-resolved provider key (closed/allowlisted). NEVER a token/secret/signature. */
  readonly provider: string;
  /** Trusted provider event/message identifier (durable inbound-action identity). */
  readonly providerMessageId: string;
  /** Server event-type provenance, identifier-shaped. */
  readonly sourceEventType: string;
  /** OPTIONAL link to the verified persisted inbound-message row (UUID) or null. */
  readonly inboundMessageId: string | null;
  /** Strict timezone-qualified RFC3339 (provider occurrence time). Validated; fails closed. */
  readonly occurredAt: string;
  /** OPTIONAL bounded correlation/causation ids (stored only in sanitized metadata). */
  readonly correlationId?: string;
  readonly causationId?: string;
  // NOTE: policyVersion is NEVER an input — CONSENT_POLICY_VERSION (code) is always used.
  // NOTE: receivedAt is NEVER a caller value — it comes from the injected server clock (deps.now()).
}

// ----------------------------------------------------------------------------
// Public output contract (sanitized discriminated union; multi-scope aware)
// ----------------------------------------------------------------------------
export type ConsentScopeName = "marketing" | "transactional";
export type ConsentScopeOutcome =
  | "suppression_created"
  | "user_stop_already_active"
  | "stronger_suppression_preserved"
  | "user_stop_reversed"
  | "no_reversible_user_stop";

export interface ConsentScopeWriteResult {
  readonly scope: ConsentScopeName;
  readonly outcome: ConsentScopeOutcome;
  readonly eventId: string | null;
  readonly suppressionId: string | null;
}

export type ConsentWriteResult =
  | "stop_applied"
  | "stop_already_effective"
  | "start_applied"
  | "start_partially_applied"
  | "start_no_reversible_stop"
  | "start_blocked_by_stronger_suppression"
  | "help_acknowledged"
  | "unsupported_command";

export interface ConsentWriteSuccess {
  readonly ok: true;
  readonly result: ConsentWriteResult;
  readonly replayed: boolean;
  readonly scopeResults: readonly ConsentScopeWriteResult[];
  readonly eventIds: readonly string[];
  readonly suppressionIds: readonly string[];
}
export interface ConsentWriteFailure {
  readonly ok: false;
  readonly code:
    | "INVALID_WRITER_INPUT"
    | "WRITER_INTEGRITY_VIOLATION"
    | "WRITER_TRANSACTION_FAILED"
    | "WRITER_CONFLICT"
    | "UNSUPPORTED_POLICY_VERSION";
}
export type ConsentWriteOutcome = ConsentWriteSuccess | ConsentWriteFailure;

// ----------------------------------------------------------------------------
// RPC contract (sanitized JSON the SECURITY DEFINER function returns / the deps adapter yields)
// ----------------------------------------------------------------------------
export interface ConsentCommandRpcArgs {
  readonly policyVersion: string;
  readonly channel: string;
  readonly command: "stop" | "start";
  readonly destinationHash: string;
  readonly principalType: string | null;
  readonly principalId: string | null;
  readonly provider: string;
  readonly providerMessageId: string;
  readonly sourceEventType: string;
  readonly sourceEventId: string;
  readonly inboundMessageId: string | null;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly correlationId: string | null;
  readonly causationId: string | null;
}
export type ConsentCommandRpcResult =
  | { readonly ok: true; readonly replayed: boolean; readonly scopeResults: readonly ConsentScopeWriteResult[] }
  | { readonly ok: false; readonly code: ConsentWriteFailure["code"] };

export interface ConsentWriterDeps {
  readonly now: () => Date;
  readonly applyConsentCommand: (args: ConsentCommandRpcArgs) => Promise<ConsentCommandRpcResult>;
}

// ----------------------------------------------------------------------------
// Vocabularies + shapes (input fences; no DB access for invalid input)
// ----------------------------------------------------------------------------
const CHANNELS: readonly string[] = ["whatsapp", "sms", "rcs"];
const COMMANDS: readonly string[] = ["stop", "start", "help", "unsupported"];
const PRINCIPAL_TYPES: readonly string[] = ["client", "vendor", "admin"];
const CONFIDENCES: readonly string[] = ["exact", "ambiguous", "unknown"];
/** Closed trusted provider allowlist (server-resolved keys only; never a token). */
const PROVIDERS: readonly string[] = ["meta_whatsapp", "exotel_sms", "system"];
const HEX64 = /^[0-9a-f]{64}$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_TYPE_SHAPE = /^[A-Za-z0-9._:-]{1,64}$/;
const BOUNDED_ID_SHAPE = /^[A-Za-z0-9._:-]{1,200}$/;

// STRICT timezone-qualified RFC3339 (Supabase timestamptz). Intentionally a REPEATED copy of the
// Phase 5F-D2-C contract — D2-C's `parseNullableTimestamp` is private and D2-C MUST remain unchanged
// (read-only), so it cannot be imported. The RPC re-validates this same contract so a direct RPC
// caller cannot bypass TypeScript validation. Anchored; timezone-less/date-only/locale never match.
const RFC3339_TS = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/**
 * STRICT, timezone-qualified, calendar-valid RFC3339 check (NOT lenient Date.parse). Mirrors the
 * Phase 5F-D2-C contract exactly: mandatory `T`, full `HH:MM:SS`, explicit `Z`/`±HH:MM`, 1–6
 * fractional digits, real calendar + range validation via a `setUTC*` round-trip. Returns true only
 * for a well-formed instant. Any raw invalid value is rejected; it never enters a result.
 */
function isStrictRfc3339(v: string): boolean {
  const m = RFC3339_TS.exec(v);
  if (!m) return false;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const hour = Number(m[4]), minute = Number(m[5]), second = Number(m[6]);
  if (year < 1 || month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  const millis = m[7] ? Number((m[7] + "000").slice(0, 3)) : 0;
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(hour, minute, second, millis);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day
      || d.getUTCHours() !== hour || d.getUTCMinutes() !== minute || d.getUTCSeconds() !== second) return false;
  if (m[8] !== "Z") {
    const offHour = Number(m[10]), offMin = Number(m[11]);
    if (offHour > 23 || offMin > 59) return false;
  }
  return true;
}

// ----------------------------------------------------------------------------
// Input validation (never touches the DB for invalid input)
// ----------------------------------------------------------------------------
function isValidInput(input: ConsentWriterInput): boolean {
  if (!input || typeof input !== "object") return false;
  if (!CHANNELS.includes(input.channel)) return false;
  if (!COMMANDS.includes(input.command)) return false;
  if (typeof input.destinationHash !== "string" || !HEX64.test(input.destinationHash)) return false;
  if (!CONFIDENCES.includes(input.identityConfidence)) return false;
  if (input.identityConfidence === "exact") {
    const p = input.principal;
    if (!p || !PRINCIPAL_TYPES.includes(p.type) || typeof p.id !== "string" || !UUID_SHAPE.test(p.id)) return false;
  } else if (input.principal !== null) {
    return false;
  }
  if (typeof input.provider !== "string" || !PROVIDERS.includes(input.provider)) return false;
  if (typeof input.providerMessageId !== "string" || !BOUNDED_ID_SHAPE.test(input.providerMessageId)) return false;
  if (typeof input.sourceEventType !== "string" || !EVENT_TYPE_SHAPE.test(input.sourceEventType)) return false;
  if (input.inboundMessageId !== null && (typeof input.inboundMessageId !== "string" || !UUID_SHAPE.test(input.inboundMessageId))) return false;
  if (typeof input.occurredAt !== "string" || !isStrictRfc3339(input.occurredAt)) return false;
  if (input.correlationId !== undefined && (typeof input.correlationId !== "string" || !BOUNDED_ID_SHAPE.test(input.correlationId))) return false;
  if (input.causationId !== undefined && (typeof input.causationId !== "string" || !BOUNDED_ID_SHAPE.test(input.causationId))) return false;
  return true;
}

// ----------------------------------------------------------------------------
// Pure aggregate-result derivation (from the per-scope outcomes the RPC returns)
// ----------------------------------------------------------------------------
/** STOP: any scope newly created a suppression → applied; otherwise already-effective (no-op). */
function aggregateStop(scopeResults: readonly ConsentScopeWriteResult[]): ConsentWriteResult {
  const changed = scopeResults.some((s) => s.outcome === "suppression_created");
  return changed ? "stop_applied" : "stop_already_effective";
}

/**
 * START: independent per scope.
 *   reversed + no stronger block            → start_applied
 *   reversed + a stronger block remains      → start_partially_applied
 *   nothing reversed + a stronger block      → start_blocked_by_stronger_suppression
 *   nothing reversed + no stronger block     → start_no_reversible_stop
 */
function aggregateStart(scopeResults: readonly ConsentScopeWriteResult[]): ConsentWriteResult {
  const reversed = scopeResults.some((s) => s.outcome === "user_stop_reversed");
  const stronger = scopeResults.some((s) => s.outcome === "stronger_suppression_preserved");
  if (reversed && !stronger) return "start_applied";
  if (reversed && stronger) return "start_partially_applied";
  if (!reversed && stronger) return "start_blocked_by_stronger_suppression";
  return "start_no_reversible_stop";
}

function success(
  result: ConsentWriteResult,
  replayed: boolean,
  scopeResults: readonly ConsentScopeWriteResult[]
): ConsentWriteSuccess {
  const eventIds = scopeResults.map((s) => s.eventId).filter((x): x is string => x !== null);
  const suppressionIds = scopeResults.map((s) => s.suppressionId).filter((x): x is string => x !== null);
  return { ok: true, result, replayed, scopeResults: [...scopeResults], eventIds, suppressionIds };
}
const failure = (code: ConsentWriteFailure["code"]): ConsentWriteFailure => ({ ok: false, code });

// ----------------------------------------------------------------------------
// Production RPC adapter (SECURITY DEFINER function; sanitized JSON only)
// ----------------------------------------------------------------------------
/** LAZY: constructed per request. Calls the additive D2-D RPC — the SOLE transactional authority. */
export function defaultConsentWriterDeps(): ConsentWriterDeps {
  return {
    now: () => new Date(),
    applyConsentCommand: async (args) => {
      const { data, error } = await adminClient().rpc("apply_communication_consent_command", {
        p_policy_version: args.policyVersion,
        p_channel: args.channel,
        p_command: args.command,
        p_destination_hash: args.destinationHash,
        p_principal_type: args.principalType,
        p_principal_id: args.principalId,
        p_provider: args.provider,
        p_provider_message_id: args.providerMessageId,
        p_source_event_type: args.sourceEventType,
        p_source_event_id: args.sourceEventId,
        p_inbound_message_id: args.inboundMessageId,
        p_occurred_at: args.occurredAt,
        p_received_at: args.receivedAt,
        p_correlation_id: args.correlationId,
        p_causation_id: args.causationId,
      });
      // A raw DB/transport error is NEVER surfaced — the caller maps a throw to WRITER_TRANSACTION_FAILED.
      if (error) throw error;
      return normalizeRpcResult(data);
    },
  };
}

const OUTCOMES: readonly ConsentScopeOutcome[] = [
  "suppression_created", "user_stop_already_active", "stronger_suppression_preserved",
  "user_stop_reversed", "no_reversible_user_stop",
];
/** Deterministic scope order the RPC/receipt must always produce (one marketing, one transactional). */
const SCOPE_ORDER: readonly ConsentScopeName[] = ["marketing", "transactional"];

/** Sentinel for "this id field is NOT usable" — absent, aliased inconsistently, or malformed. */
const ID_INVALID = Symbol("id_invalid");

/**
 * Read ONE id field from its snake_case/camelCase aliases WITHOUT inventing a value.
 *
 * The key must be explicitly PRESENT: an ABSENT key is NEVER silently coerced to `null` (that would let
 * a truncated RPC row masquerade as a legitimate "no id for this outcome" result and pass the
 * outcome⟷id consistency check below). An explicit `null` IS valid — the consistency check decides
 * whether the outcome permits it. If BOTH aliases are present they must carry the SAME value; a row
 * that disagrees with itself is not trustworthy evidence. A present non-null value must be a UUID.
 *
 * Returns `string | null` when usable, else ID_INVALID (→ WRITER_INTEGRITY_VIOLATION).
 */
function readIdField(s: Record<string, unknown>, snake: string, camel: string): string | null | typeof ID_INVALID {
  const hasSnake = Object.prototype.hasOwnProperty.call(s, snake);
  const hasCamel = Object.prototype.hasOwnProperty.call(s, camel);
  if (!hasSnake && !hasCamel) return ID_INVALID;                            // absent → never becomes null
  if (hasSnake && hasCamel && !Object.is(s[snake], s[camel])) return ID_INVALID; // aliases disagree
  const v = hasSnake ? s[snake] : s[camel];
  if (v === null) return null;                                              // explicit null stays null
  if (typeof v !== "string" || !UUID_SHAPE.test(v)) return ID_INVALID;
  return v;
}

/**
 * Normalize the RPC's JSON into the typed contract WITHOUT trusting arbitrary shapes. A success MUST be
 * a fully-formed, deterministic TWO-scope result — exactly one marketing + one transactional in that
 * order, both id keys explicitly PRESENT (absent ≠ null) and alias-consistent, valid UUIDs, and
 * outcome⟷id consistency; anything empty / partial / duplicated / contradictory (or a non-boolean
 * `replayed`) is a WRITER_INTEGRITY_VIOLATION (never a success). This is an INDEPENDENT fence: the SQL
 * validator enforces the same contract on the stored receipt, and neither layer relies on the other.
 * Exported for direct testing. It copies only allowlisted fields — no raw row / error / value passes through.
 */
export function normalizeRpcResult(data: unknown): ConsentCommandRpcResult {
  if (!data || typeof data !== "object") return { ok: false, code: "WRITER_INTEGRITY_VIOLATION" };
  const d = data as Record<string, unknown>;
  if (d.ok === false) {
    const code = d.code;
    if (code === "INVALID_WRITER_INPUT" || code === "WRITER_INTEGRITY_VIOLATION" || code === "WRITER_CONFLICT"
        || code === "UNSUPPORTED_POLICY_VERSION" || code === "WRITER_TRANSACTION_FAILED") {
      return { ok: false, code };
    }
    return { ok: false, code: "WRITER_INTEGRITY_VIOLATION" };
  }
  if (d.ok !== true || typeof d.replayed !== "boolean") return { ok: false, code: "WRITER_INTEGRITY_VIOLATION" };
  const rawScopes = d.scopeResults ?? d.scope_results;
  // Exactly two scope results — never empty, partial, or padded.
  if (!Array.isArray(rawScopes) || rawScopes.length !== SCOPE_ORDER.length) return { ok: false, code: "WRITER_INTEGRITY_VIOLATION" };
  const scopeResults: ConsentScopeWriteResult[] = [];
  for (let i = 0; i < rawScopes.length; i++) {
    const r = rawScopes[i];
    if (!r || typeof r !== "object") return { ok: false, code: "WRITER_INTEGRITY_VIOLATION" };
    const s = r as Record<string, unknown>;
    const scope = s.scope;
    const outcome = s.outcome;
    // Deterministic order enforces one-marketing-one-transactional and rejects duplicates.
    if (scope !== SCOPE_ORDER[i]) return { ok: false, code: "WRITER_INTEGRITY_VIOLATION" };
    if (typeof outcome !== "string" || !OUTCOMES.includes(outcome as ConsentScopeOutcome)) return { ok: false, code: "WRITER_INTEGRITY_VIOLATION" };
    // Both id keys must be explicitly PRESENT (absent is NOT null), alias-consistent, and UUID-shaped.
    const eventId = readIdField(s, "event_id", "eventId");
    const suppressionId = readIdField(s, "suppression_id", "suppressionId");
    if (eventId === ID_INVALID || suppressionId === ID_INVALID) return { ok: false, code: "WRITER_INTEGRITY_VIOLATION" };
    // Outcome ⟷ id consistency:
    //   suppression_created / user_stop_reversed              → eventId + suppressionId
    //   user_stop_already_active / stronger_suppression_preserved → suppressionId, eventId null
    //   no_reversible_user_stop                               → eventId null + suppressionId null
    const needsEvent = outcome === "suppression_created" || outcome === "user_stop_reversed";
    const needsSuppression = needsEvent || outcome === "user_stop_already_active" || outcome === "stronger_suppression_preserved";
    if (needsEvent ? eventId === null : eventId !== null) return { ok: false, code: "WRITER_INTEGRITY_VIOLATION" };
    if (needsSuppression ? suppressionId === null : suppressionId !== null) return { ok: false, code: "WRITER_INTEGRITY_VIOLATION" };
    scopeResults.push({ scope: scope as ConsentScopeName, outcome: outcome as ConsentScopeOutcome, eventId, suppressionId });
  }
  return { ok: true, replayed: d.replayed, scopeResults };
}

// ----------------------------------------------------------------------------
// The writer
// ----------------------------------------------------------------------------
/**
 * Record + project one inbound consent command. Order: validate → route (HELP/unsupported never touch
 * the DB) → single atomic RPC for STOP/START → derive aggregate result → sanitize. Read/derive only in
 * this module; the RPC owns the transaction, locking, replay/conflict, and evidence↔projection atomicity.
 */
export async function writeConsentCommand(
  input: ConsentWriterInput,
  deps: ConsentWriterDeps = defaultConsentWriterDeps()
): Promise<ConsentWriteOutcome> {
  // 1) Validate — NEVER touch the DB for invalid input.
  if (!isValidInput(input)) return failure("INVALID_WRITER_INPUT");

  // 2) HELP / unsupported: NO consent-state transition, NO DB write, NO evidence, NO projection (P3).
  if (input.command === "help") return success("help_acknowledged", false, []);
  if (input.command === "unsupported") return success("unsupported_command", false, []);

  // 3) STOP / START: a single atomic RPC owns the whole transaction. receivedAt = injected server clock.
  const receivedAt = deps.now();
  if (!(receivedAt instanceof Date) || Number.isNaN(receivedAt.getTime())) return failure("WRITER_TRANSACTION_FAILED");
  const args: ConsentCommandRpcArgs = {
    policyVersion: CONSENT_POLICY_VERSION, // ALWAYS from code — never an input.
    channel: input.channel,
    command: input.command,
    destinationHash: input.destinationHash,
    principalType: input.identityConfidence === "exact" && input.principal ? input.principal.type : null,
    principalId: input.identityConfidence === "exact" && input.principal ? input.principal.id : null,
    provider: input.provider,
    providerMessageId: input.providerMessageId,
    sourceEventType: input.sourceEventType,
    sourceEventId: input.providerMessageId, // durable inbound-action identity
    inboundMessageId: input.inboundMessageId,
    occurredAt: input.occurredAt,
    receivedAt: receivedAt.toISOString(),
    correlationId: input.correlationId ?? null,
    causationId: input.causationId ?? null,
  };

  let rpc: ConsentCommandRpcResult;
  try {
    rpc = await deps.applyConsentCommand(args);
  } catch {
    // Any thrown DB/transport error → sanitized transaction failure (no raw error / SQLSTATE / stack).
    return failure("WRITER_TRANSACTION_FAILED");
  }
  if (rpc.ok === false) return failure(rpc.code);

  // 4) Derive the aggregate result from the per-scope outcomes (pure).
  const result = input.command === "stop" ? aggregateStop(rpc.scopeResults) : aggregateStart(rpc.scopeResults);
  return success(result, rpc.replayed, rpc.scopeResults);
}
