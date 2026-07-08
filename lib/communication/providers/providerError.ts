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

import type { WhatsAppSendResult } from "./whatsappProvider";

/** Fallback code for a throw we cannot classify. */
export const PROVIDER_EXCEPTION_CODE = "PROVIDER_EXCEPTION";

/**
 * The exception type adapters should throw. `code` is persisted (after an
 * identifier check); `message` is for logs only and is never written to the
 * ledger. `retryable` states whether the request is known not to have been
 * delivered — only then may the message be retried.
 */
export class ProviderDispatchError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "ProviderDispatchError";
    this.code = code;
    this.retryable = retryable;
  }
}

/** A transport-level failure the adapter knows never reached the provider. */
export function transientProviderError(code: string, message: string): ProviderDispatchError {
  return new ProviderDispatchError(code, message, true);
}

/** A definitive provider rejection. Retrying it would fail identically. */
export function permanentProviderError(code: string, message: string): ProviderDispatchError {
  return new ProviderDispatchError(code, message, false);
}

/**
 * Node / undici transport codes where the request demonstrably did not complete,
 * so a retry cannot produce a duplicate WhatsApp message.
 */
const TRANSIENT_TRANSPORT_CODES: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "EAI_AGAIN",
  "ENOTFOUND",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/** Abort/timeout errors raised by fetch and AbortController. */
const TRANSIENT_ERROR_NAMES: ReadonlySet<string> = new Set(["AbortError", "TimeoutError"]);

const SAFE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** Only allowlisted identifier-shaped strings may reach the ledger. */
function safeIdentifier(value: unknown): string | null {
  return typeof value === "string" && SAFE_IDENTIFIER.test(value) ? value : null;
}

export interface ProviderExceptionClassification {
  readonly code: string;
  readonly retryable: boolean;
}

/**
 * Classifies a thrown value.
 *
 * An UNCLASSIFIED exception is treated as NOT retryable. We cannot prove the
 * message was not delivered before the adapter blew up, and a blind retry would
 * risk sending the same WhatsApp message twice. Only recognised transport
 * failures — where the request provably never completed — are retried.
 */
export function classifyProviderException(err: unknown): ProviderExceptionClassification {
  if (err instanceof ProviderDispatchError) {
    return { code: safeIdentifier(err.code) ?? PROVIDER_EXCEPTION_CODE, retryable: err.retryable };
  }

  const nodeCode = safeIdentifier((err as { code?: unknown } | null)?.code);
  if (nodeCode && TRANSIENT_TRANSPORT_CODES.has(nodeCode)) {
    return { code: nodeCode, retryable: true };
  }

  const name = safeIdentifier((err as { name?: unknown } | null)?.name);
  if (name && TRANSIENT_ERROR_NAMES.has(name)) {
    return { code: name.toUpperCase(), retryable: true };
  }

  return { code: PROVIDER_EXCEPTION_CODE, retryable: false };
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
  const { code, retryable } = classifyProviderException(err);
  return {
    accepted: false,
    provider: providerKey,
    providerMessageId: null,
    normalizedStatus: "failed",
    errorCode: code,
    errorMessage: describeProviderException(err, code),
    retryable,
  };
}
