// ============================================================================
// QuickFurno — services/inboundConsentCommandService.ts   (Phase 5F-D2-E, server-only)
//
// The D2-E ORCHESTRATOR: the single seam between a verified, ALREADY-PERSISTED inbound WhatsApp message
// and the frozen D2-D consent writer. It is the ONLY module the webhook is allowed to call for command
// processing, and it exists precisely so the webhook never learns a single D2-D implementation detail.
//
// THE FLOW (persistence STRICTLY precedes command processing):
//   verified webhook → D1-B persists (durable row + unique fence) → THIS service → D2-D writer → RPC
//
// WHAT IT DOES
//   • Only TEXT messages are command-eligible. A button/list reply, an image, a location — anything else —
//     is SKIPPED. It never interprets a sentence, a substring, or a payload id as a command.
//   • It normalizes the token with the PURE D2-D normalizer (the sole allowlist authority).
//   • STOP / START → it builds the narrow D2-D input and calls the D2-D writer EXACTLY ONCE, after
//     persistence has already succeeded. It NEVER writes consent state itself.
//   • HELP → a sanitized internal acknowledgement. NO writer call, NO RPC, NO outbound reply.
//   • Unsupported text → a sanitized internal ignore. NO writer call, NO RPC.
//
// WHAT IT NEVER DOES
//   • It NEVER calls D2-C. D2-C is a SEND-AUTHORIZATION authority ("may we send?"), not a command-
//     processing one. Consulting it here would add read-failure modes that could BLOCK a STOP from being
//     recorded, and it would be a stale TOCTOU snapshot anyway: the D2-D RPC re-reads suppression state
//     inside its own locked transaction. A STOP must never be gated on a consent read.
//   • It NEVER touches communication_preferences or communication_suppressions directly, never emits a
//     domain/outbox event, never calls n8n, never invokes Jarvis/AI, and SENDS NOTHING (not even a HELP
//     acknowledgement — no outbound reply is approved in D2-E).
//   • It NEVER re-reads the raw webhook body: everything it needs is the minimized message + the sanitized
//     D1-B persistence receipt.
//
// REPLAY. It deliberately processes DUPLICATE inbound messages too. A first attempt may have persisted the
// row and then failed the command write; skipping duplicates would lose that command forever. Re-processing
// is safe because the provider-event identity is deterministic (sha256 of the wamid), so D2-D's receipt
// returns the ORIGINAL stored outcome with `replayed: true` and applies no second effect.
//
// FAILURE MODEL (the D1-B truth principle). RETRYABLE (→ webhook 500 → Meta retries into a convergent
// path) is kept strictly apart from DETERMINISTIC (→ webhook 200; retrying could never help and would
// storm forever). The already-persisted inbound row is the durable record of a deterministic failure.
// No raw database error, SQLSTATE, stack, phone, destination hash or message body ever leaves this module.
// ============================================================================

import { normalizeConsentCommand, type NormalizedConsentCommand } from "../lib/communication/consentCommand";
import {
  buildInboundConsentCommandInput,
  isCommandEligible,
  readCommandToken,
  type BuiltConsentCommandInput,
  type CommandCandidateMessage,
  type CommandPersistenceReceipt,
} from "../lib/communication/inboundConsentCommandInput";
import { writeConsentCommand, type ConsentWriteOutcome } from "./communicationConsentWriterService";

/** One durably-persisted inbound message + its sanitized D1-B context (structurally D1-B's own type). */
export interface InboundCommandCandidate {
  readonly message: CommandCandidateMessage;
  readonly receipt: CommandPersistenceReceipt;
}

/** The sanitized per-message disposition. Never a raw error; never a policy decision made here. */
export type InboundCommandDisposition =
  // not a command at all
  | "not_command_eligible"
  | "help_acknowledged"
  | "unsupported_command"
  // D2-D writer successes (verbatim from the writer's own closed result vocabulary)
  | "stop_applied"
  | "stop_already_effective"
  | "start_applied"
  | "start_partially_applied"
  | "start_no_reversible_stop"
  | "start_blocked_by_stronger_suppression"
  // DETERMINISTIC failures — handled, never retried
  | "input_not_buildable"
  | "writer_rejected_input"
  | "writer_conflict"
  | "writer_integrity_violation"
  | "writer_unsupported_policy_version"
  // RETRYABLE failure
  | "writer_unavailable";

export interface InboundCommandItemResult {
  readonly inboundMessageId: string;
  /** null when the message was never command-eligible (no interpretation was attempted). */
  readonly command: NormalizedConsentCommand | null;
  readonly disposition: InboundCommandDisposition;
  readonly replayed: boolean;
  readonly retryable: boolean;
}

/** Every field is a count or an opaque id — never PII, never raw text. */
export interface InboundCommandProcessingResult {
  readonly candidates: number;
  readonly skippedNotEligible: number;
  readonly helpAcknowledged: number;
  readonly unsupported: number;
  readonly writerInvocations: number;
  readonly applied: number;
  readonly replayed: number;
  readonly deterministicFailures: number;
  readonly items: readonly InboundCommandItemResult[];
}

export type InboundCommandOutcome =
  | { readonly ok: true; readonly result: InboundCommandProcessingResult }
  /** A RETRYABLE failure: the webhook must return 500 so Meta retries. `code` is stable + sanitized. */
  | { readonly ok: false; readonly code: string; readonly result: InboundCommandProcessingResult };

/** The stable, sanitized retryable code. It carries no database detail. */
export const COMMAND_WRITE_UNAVAILABLE = "inbound_command_write_unavailable" as const;

// ----------------------------------------------------------------------------
// Injectable collaborators — production binds the pure normalizer + the D2-D writer
// ----------------------------------------------------------------------------
export interface InboundConsentCommandDeps {
  readonly normalize: (raw: unknown) => NormalizedConsentCommand;
  readonly writeCommand: (input: BuiltConsentCommandInput) => Promise<ConsentWriteOutcome>;
}

export function defaultInboundConsentCommandDeps(): InboundConsentCommandDeps {
  return {
    normalize: normalizeConsentCommand,
    // The SOLE mutation authority. D2-E derives and adapts; D2-D decides and writes.
    writeCommand: (input) => writeConsentCommand(input),
  };
}

const emptyResult = (): InboundCommandProcessingResult => ({
  candidates: 0,
  skippedNotEligible: 0,
  helpAcknowledged: 0,
  unsupported: 0,
  writerInvocations: 0,
  applied: 0,
  replayed: 0,
  deterministicFailures: 0,
  items: [],
});

/** The D2-D failure codes that retrying can never fix. Each is ACKNOWLEDGED (200), never retried. */
const DETERMINISTIC_WRITER_FAILURES: Readonly<Record<string, InboundCommandDisposition>> = Object.freeze({
  INVALID_WRITER_INPUT: "writer_rejected_input",
  WRITER_CONFLICT: "writer_conflict",
  WRITER_INTEGRITY_VIOLATION: "writer_integrity_violation",
  UNSUPPORTED_POLICY_VERSION: "writer_unsupported_policy_version",
});

/**
 * Process the command layer for one verified webhook's ALREADY-PERSISTED inbound messages.
 *
 * Batch semantics: every candidate is attempted. ANY retryable item makes the whole webhook retryable;
 * deterministic and no-op items never do. A retry is safe because D1-B's unique fence makes re-persistence
 * idempotent and D2-D's receipt makes re-writing a replay.
 */
export async function processInboundConsentCommands(
  candidates: readonly InboundCommandCandidate[],
  deps: InboundConsentCommandDeps = defaultInboundConsentCommandDeps()
): Promise<InboundCommandOutcome> {
  const list = Array.isArray(candidates) ? candidates : [];
  let result: InboundCommandProcessingResult = { ...emptyResult(), candidates: list.length };
  const items: InboundCommandItemResult[] = [];
  let retryableCode: string | null = null;

  const push = (item: InboundCommandItemResult): void => { items.push(item); };

  for (const candidate of list) {
    const message = candidate?.message;
    const receipt = candidate?.receipt;
    const inboundMessageId = typeof receipt?.inboundMessageId === "string" ? receipt.inboundMessageId : "";

    // 1) ONLY text is command-eligible. Everything else is skipped WITHOUT interpretation and WITHOUT
    //    ever reaching the writer.
    if (!message || !receipt || !isCommandEligible(message)) {
      result = { ...result, skippedNotEligible: result.skippedNotEligible + 1 };
      push({ inboundMessageId, command: null, disposition: "not_command_eligible", replayed: false, retryable: false });
      continue;
    }

    // 2) The PURE D2-D normalizer is the sole allowlist authority. Raw text never travels further.
    const command = deps.normalize(readCommandToken(message));

    // 3) HELP → sanitized acknowledgement. NO writer, NO RPC, NO outbound reply (none is approved in D2-E).
    if (command === "help") {
      result = { ...result, helpAcknowledged: result.helpAcknowledged + 1 };
      push({ inboundMessageId, command, disposition: "help_acknowledged", replayed: false, retryable: false });
      continue;
    }
    // 4) Unsupported text → sanitized ignore. NO writer, NO RPC. Fail safe: never coerced to stop/start.
    if (command === "unsupported") {
      result = { ...result, unsupported: result.unsupported + 1 };
      push({ inboundMessageId, command, disposition: "unsupported_command", replayed: false, retryable: false });
      continue;
    }

    // 5) STOP / START → adapt to the frozen D2-D contract. A non-buildable input is DETERMINISTIC.
    const built = buildInboundConsentCommandInput(command, message, receipt);
    if (!built.ok) {
      result = { ...result, deterministicFailures: result.deterministicFailures + 1 };
      push({ inboundMessageId, command, disposition: "input_not_buildable", replayed: false, retryable: false });
      continue;
    }

    // 6) The D2-D writer, EXACTLY ONCE, and only after persistence already succeeded.
    let outcome: ConsentWriteOutcome;
    result = { ...result, writerInvocations: result.writerInvocations + 1 };
    try {
      outcome = await deps.writeCommand(built.input);
    } catch {
      // A thrown dependency/database error is RETRYABLE and sanitized — no raw error escapes.
      retryableCode = retryableCode ?? COMMAND_WRITE_UNAVAILABLE;
      push({ inboundMessageId, command, disposition: "writer_unavailable", replayed: false, retryable: true });
      continue;
    }

    if (outcome.ok) {
      result = {
        ...result,
        applied: result.applied + (outcome.replayed ? 0 : 1),
        replayed: result.replayed + (outcome.replayed ? 1 : 0),
      };
      push({
        inboundMessageId,
        command,
        disposition: outcome.result as InboundCommandDisposition,
        replayed: outcome.replayed,
        retryable: false,
      });
      continue;
    }

    // 7) A writer failure: RETRYABLE (the transaction failed) vs DETERMINISTIC (retrying cannot help).
    if (outcome.code === "WRITER_TRANSACTION_FAILED") {
      retryableCode = retryableCode ?? COMMAND_WRITE_UNAVAILABLE;
      push({ inboundMessageId, command, disposition: "writer_unavailable", replayed: false, retryable: true });
      continue;
    }
    const disposition = DETERMINISTIC_WRITER_FAILURES[outcome.code] ?? "writer_integrity_violation";
    result = { ...result, deterministicFailures: result.deterministicFailures + 1 };
    push({ inboundMessageId, command, disposition, replayed: false, retryable: false });
  }

  result = { ...result, items };
  if (retryableCode) return { ok: false, code: retryableCode, result };
  return { ok: true, result };
}
