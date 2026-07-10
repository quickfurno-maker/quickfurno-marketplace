// ============================================================================
// QuickFurno — lib/communication/providers/providerError.ts
//
// Normalized provider-exception handling.
//
// A provider adapter may THROW rather than return a WhatsAppSendResult: a socket
// resets, a fetch aborts, an SDK blows up, an adapter has a bug. Without this
// module such a throw escapes CommunicationService mid-dispatch and strands the
// message in `dispatching` forever. Here every thrown value is folded back into
// the provider-neutral WhatsAppSendResult failure shape, so the ordinary lane
// rules (auth → failed; business retryable → retry_scheduled / dead_letter;
// permanent → failed) decide the outcome.
//
// SECURITY — WHY EXCEPTION TEXT IS NEVER PERSISTED
// An arbitrary exception message routinely embeds an Authorization header, a
// bearer token, an API key, or a raw provider payload. Regex-scrubbing free text
// is not a guarantee, so we do not try: the ledger only ever receives a sentence
// assembled from ALLOWLISTED identifiers (the error's `name` and a classified
// `code`, each matched against a strict identifier pattern). Adapter authors get
// diagnostics by throwing `ProviderDispatchError` with a meaningful `code`; the
// human-readable `message` is for logs and never reaches the database.
//
// No provider-specific type crosses into CommunicationService — the only export
// it consumes is `normalizeProviderException`, which returns WhatsAppSendResult.
// ============================================================================

// `ProviderOutcomeCertainty` comes straight from the generic module; `WhatsAppSendResult`
// is a type-only import, so nothing here creates a runtime cycle with providerOutcome.ts
// (which imports the code SETS below as values).
import type { ProviderOutcomeCertainty } from "./providerOutcome";
import type { WhatsAppSendResult } from "./whatsappProvider";

/** Fallback code for a throw we cannot classify. */
export const PROVIDER_EXCEPTION_CODE = "PROVIDER_EXCEPTION";

/**
 * The exception type adapters should throw. `code` is persisted (after an
 * identifier check); `message` is for logs only and is never written to the ledger.
 *
 * Certainty is EXPLICIT, not inferred from `retryable`. A thrown failure is never
 * `accepted`, and an `unknown_outcome` can never be retried (delivery cannot be
 * proven not to have happened). The constructor VALIDATES/normalizes both invariants
 * (accepted → unknown_outcome; unknown_outcome → retryable=false).
 */
export class ProviderDispatchError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly outcomeCertainty: ProviderOutcomeCertainty;

  constructor(code: string, message: string, outcomeCertainty: ProviderOutcomeCertainty, retryable: boolean) {
    super(message);
    this.name = "ProviderDispatchError";
    this.code = code;
    const certainty: ProviderOutcomeCertainty = outcomeCertainty === "accepted" ? "unknown_outcome" : outcomeCertainty;
    this.outcomeCertainty = certainty;
    this.retryable = certainty === "unknown_outcome" ? false : retryable;
  }
}

/**
 * A DEFINITIVE, safely-retryable failure — the adapter can PROVE the request did not
 * reach the provider, so retrying cannot duplicate a message.
 */
export function definitiveRetryableProviderError(code: string, message: string): ProviderDispatchError {
  return new ProviderDispatchError(code, message, "definitive_failure", true);
}

/** A DEFINITIVE, permanent provider rejection. Retrying it would fail identically. */
export function definitivePermanentProviderError(code: string, message: string): ProviderDispatchError {
  return new ProviderDispatchError(code, message, "definitive_failure", false);
}

/**
 * An UNKNOWN outcome — delivery can be neither proven nor disproven. Never retried
 * (the constructor forces `retryable=false`).
 */
export function unknownOutcomeProviderError(code: string, message: string): ProviderDispatchError {
  return new ProviderDispatchError(code, message, "unknown_outcome", false);
}

/**
 * AMBIGUOUS transport codes: the provider MAY have accepted the request before the
 * client lost certainty. Treated as `unknown_outcome`, NEVER retried.
 */
export const AMBIGUOUS_TRANSPORT_CODES: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "ECONNABORTED",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/** Abort/timeout error NAMES — ambiguous, `unknown_outcome`, never retried. */
export const AMBIGUOUS_ERROR_NAMES: ReadonlySet<string> = new Set(["AbortError", "TimeoutError"]);

/**
 * PROVEN pre-connect failure codes: the error semantics prove the request could not
 * have reached Meta (DNS/connect refused/unreachable). ONLY these are treated as a
 * `definitive_failure` that is safely retryable. Ambiguous socket failures are NOT
 * here.
 */
export const PROVEN_PRECONNECT_FAILURE_CODES: ReadonlySet<string> = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "UND_ERR_CONNECT_TIMEOUT",
]);

const SAFE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** Only allowlisted identifier-shaped strings may reach the ledger. */
function safeIdentifier(value: unknown): string | null {
  return typeof value === "string" && SAFE_IDENTIFIER.test(value) ? value : null;
}

export interface ProviderExceptionClassification {
  readonly code: string;
  readonly retryable: boolean;
  /**
   * Provable outcome certainty. `definitive_failure` ONLY when the provider provably
   * did not accept the message (an explicit rejection or a PROVEN pre-connect
   * failure). An ambiguous transport error, an abort/timeout, and an UNCLASSIFIED
   * exception are all `unknown_outcome` — delivery can be neither proven nor
   * disproven. Nothing is ever `accepted` here.
   */
  readonly outcomeCertainty: ProviderOutcomeCertainty;
}

/**
 * Classifies a thrown value by PROVABLE outcome certainty (not by the mere existence
 * of an exception or a familiar transport code). Order:
 *   A. explicit typed ProviderDispatchError → its validated certainty (unknown → not
 *      retried);
 *   B. abort/timeout or ambiguous transport code → unknown_outcome, not retried;
 *   C. proven pre-connect failure → definitive_failure, safely retryable;
 *   D. unknown/unclassified → unknown_outcome, not retried.
 * An UNCLASSIFIED exception is NEVER definitive_failure, and an ambiguous transport
 * error is NEVER retryable merely because it has a familiar Node/undici code.
 */
export function classifyProviderException(err: unknown): ProviderExceptionClassification {
  // A. Explicit typed error carries its own validated certainty.
  if (err instanceof ProviderDispatchError) {
    const certainty: ProviderOutcomeCertainty = err.outcomeCertainty === "accepted" ? "unknown_outcome" : err.outcomeCertainty;
    const retryable = certainty === "unknown_outcome" ? false : err.retryable;
    return { code: safeIdentifier(err.code) ?? PROVIDER_EXCEPTION_CODE, retryable, outcomeCertainty: certainty };
  }

  const nodeCode = safeIdentifier((err as { code?: unknown } | null)?.code);
  const name = safeIdentifier((err as { name?: unknown } | null)?.name);

  // B. Abort/timeout or ambiguous transport: the provider MAY have accepted the
  // request before certainty was lost. Never retried.
  if (nodeCode && AMBIGUOUS_TRANSPORT_CODES.has(nodeCode)) {
    return { code: nodeCode, retryable: false, outcomeCertainty: "unknown_outcome" };
  }
  if (name && AMBIGUOUS_ERROR_NAMES.has(name)) {
    return { code: name.toUpperCase(), retryable: false, outcomeCertainty: "unknown_outcome" };
  }

  // C. Proven pre-connect failure: provably never reached the provider → safe retry.
  if (nodeCode && PROVEN_PRECONNECT_FAILURE_CODES.has(nodeCode)) {
    return { code: nodeCode, retryable: true, outcomeCertainty: "definitive_failure" };
  }

  // D. Unknown/unclassified: delivery is UNPROVABLE. Never definitive, never retried.
  return { code: PROVIDER_EXCEPTION_CODE, retryable: false, outcomeCertainty: "unknown_outcome" };
}

/**
 * Builds the ledger-safe failure reason. Every component is an allowlisted
 * identifier — no character of the original exception message survives.
 */
export function describeProviderException(err: unknown, code: string): string {
  const name = safeIdentifier((err as { name?: unknown } | null)?.name) ?? "Error";
  return `Provider adapter threw ${name} (${code}). Exception text withheld: it may embed provider secrets.`;
}

/**
 * Folds ANY thrown value into the provider-neutral failure result, so a throwing
 * adapter follows exactly the same lane rules as a well-behaved one that returns
 * `accepted: false`.
 */
export function normalizeProviderException(err: unknown, providerKey: string): WhatsAppSendResult {
  const { code, retryable, outcomeCertainty } = classifyProviderException(err);
  return {
    accepted: false,
    provider: providerKey,
    providerMessageId: null,
    normalizedStatus: "failed",
    errorCode: code,
    errorMessage: describeProviderException(err, code),
    retryable,
    outcomeCertainty,
  };
}
