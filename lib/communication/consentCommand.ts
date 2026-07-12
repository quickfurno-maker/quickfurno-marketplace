// ============================================================================
// QuickFurno — lib/communication/consentCommand.ts   (Phase 5F-D2-D, server-safe pure module)
//
// The ONE place that maps a raw inbound command text to a CLOSED normalized-command
// vocabulary. It is a PURE module: no I/O, no logging, no DB, no network, no clock. The
// consent WRITER never receives raw text — normalization happens here, upstream of the
// writer, so raw message bodies never reach the writer, the RPC, or the projection tables.
//
// CONSERVATIVE, ALLOWLIST-ONLY. It matches ONLY a complete, explicitly documented command
// keyword (after trim + Unicode NFKC + upper-case). It uses NO substring matching and NEVER
// interprets a sentence that merely CONTAINS a keyword as a command ("please stop texting"
// is UNSUPPORTED, not STOP). Anything not on the allowlist is `unsupported` — fail safe.
//
// The raw text is NEVER retained or returned. The only output is the closed enum below.
// The vocabulary is deliberately small; it is NEVER expanded implicitly.
// ============================================================================

/** Closed normalized-command vocabulary. `unsupported` is the safe default for anything else. */
export type NormalizedConsentCommand = "stop" | "start" | "help" | "unsupported";

// Explicit, documented, case-insensitive allowlists. Each entry is a COMPLETE command token
// (already upper-cased + NFKC-normalized). No synonym is added silently — extending any list
// is a deliberate, reviewed vocabulary change, never an inference.
const STOP_WORDS: ReadonlySet<string> = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_WORDS: ReadonlySet<string> = new Set(["START", "UNSTOP", "SUBSCRIBE"]);
const HELP_WORDS: ReadonlySet<string> = new Set(["HELP", "INFO"]);

/**
 * Normalize a raw inbound command text to the closed vocabulary. Pure + total: any input
 * (including a non-string, empty, whitespace, multi-word, or decorated value) yields a value
 * of the enum, defaulting to `unsupported`. The raw text is neither logged nor returned.
 *
 * Matching is EXACT on the full trimmed token: trim → NFKC → upper-case → whole-string set
 * membership. A trailing period, extra words, emoji, or zero-width character makes the token
 * unequal to any keyword and therefore `unsupported` — intentionally conservative.
 */
export function normalizeConsentCommand(raw: unknown): NormalizedConsentCommand {
  if (typeof raw !== "string") return "unsupported";
  // NFKC folds safe compatibility/width/casing variants; trim removes surrounding whitespace only.
  const token = raw.normalize("NFKC").trim().toUpperCase();
  if (token.length === 0) return "unsupported";
  if (STOP_WORDS.has(token)) return "stop";
  if (START_WORDS.has(token)) return "start";
  if (HELP_WORDS.has(token)) return "help";
  return "unsupported"; // NOT a recognized complete command — never coerced to stop/start/help
}
