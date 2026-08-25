// ============================================================================
// QuickFurno — services/communicationMarketingConsentWriterService.ts  (QF-MVP-40)
//
// The SOLE application writer for EXPLICIT marketing consent.
//
// WHY IT EXISTS
//   `communicationConsentDecisionService` allows a marketing send only on
//   `preference_marketing_opted_in`, which requires an EXACT principal holding an
//   `allowed` marketing preference. No write path to communication_preferences existed
//   anywhere in source, so a genuine marketing opt-in could not be recorded at all —
//   only forged by a manual database edit, which is not an auditable consent record.
//
// AUTHORITY BOUNDARY
//   Consent truth belongs to QuickFurno Core. Meta, n8n, Jarvis, campaign workflows and
//   provider adapters never decide or manufacture consent. This module does not decide
//   anything either: it RECORDS an explicit decision a principal already made, and the
//   read-only decision service remains the sole precedence authority.
//
// WHAT IT CANNOT DO — enforced here and again inside the RPC
//   * No 'start' / 'stop' / 'help' action. START never creates marketing consent; this
//     module is not reachable from the inbound consent command path.
//   * No scope parameter. Scope is hard-coded 'marketing' in both layers, so this can
//     never forge authentication or transactional authority.
//   * It NEVER writes communication_suppressions. Consent and suppression stay distinct:
//     an opt-in does not clear a STOP, and suppression still wins at decision time.
//   * No inference. Consent is never derived from a delivery, a conversation, a vendor
//     status, campaign membership or a template approval.
//   * No plaintext phone, message text, provider payload or secret is written.
//
// SERVER-ONLY. It resolves the RLS-bypassing `adminClient` through a LAZY import inside
// defaultMarketingConsentDeps(), so importing this module constructs no client and reads no
// environment. It lives in the service layer, exposes no API route and is imported by no
// client code. There is deliberately no unauthenticated public consent-writing endpoint.
// ============================================================================


/** Server-set consent policy version. A code constant — never browser-supplied. */
export const MARKETING_CONSENT_POLICY_VERSION = "qf.marketing.v1";

/** The ONLY two explicit actions. There is deliberately no 'start'/'stop'/'help'. */
export const MarketingConsentAction = Object.freeze({
  GRANT: "grant",
  WITHDRAW: "withdraw",
} as const);
export type MarketingConsentActionValue =
  (typeof MarketingConsentAction)[keyof typeof MarketingConsentAction];

/** Marketing authority requires an EXACT principal; anonymous/system are never principals. */
export type MarketingConsentPrincipalType = "client" | "vendor";
export type MarketingConsentSource = "user" | "admin";
export type MarketingConsentChannel = "whatsapp" | "sms" | "rcs";

export const MarketingConsentFailure = Object.freeze({
  ACTION_NOT_EXPLICIT: "action_not_explicit",
  SOURCE_NOT_PERMITTED: "source_not_permitted",
  CHANNEL_INVALID: "channel_invalid",
  PRINCIPAL_NOT_EXACT: "principal_not_exact",
  SOURCE_EVENT_INVALID: "source_event_invalid",
  OCCURRED_AT_INVALID: "occurred_at_invalid",
  WRITE_FAILED: "write_failed",
  UNEXPECTED_RESULT: "unexpected_result",
} as const);
export type MarketingConsentFailureValue =
  (typeof MarketingConsentFailure)[keyof typeof MarketingConsentFailure];

export interface MarketingConsentCommand {
  readonly action: MarketingConsentActionValue;
  readonly principalType: MarketingConsentPrincipalType;
  readonly principalId: string;
  readonly channel: MarketingConsentChannel;
  readonly source: MarketingConsentSource;
  /** Bounded, identifier-shaped provenance of the causing event. Both required. */
  readonly sourceEventType: string;
  readonly sourceEventId: string;
  readonly occurredAt: Date;
}

export type MarketingConsentResult =
  | {
      readonly ok: true;
      /** APPLIED on first write; REPLAYED when the idempotency fence matched. */
      readonly outcome: "APPLIED" | "REPLAYED";
      readonly stateBefore: string;
      readonly stateAfter: string;
    }
  | { readonly ok: false; readonly reason: MarketingConsentFailureValue };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTIFIER_RE = /^[A-Za-z0-9._:-]{1,64}$/;

const fail = (reason: MarketingConsentFailureValue): MarketingConsentResult =>
  ({ ok: false, reason });

/**
 * PURE input fence. Every branch is a refusal — there is no default, no coercion and no
 * "assume grant". An unrecognised input is a denial, never a permissive fallback.
 */
export function validateMarketingConsentCommand(
  cmd: MarketingConsentCommand | null | undefined,
): MarketingConsentResult | null {
  if (!cmd || typeof cmd !== "object") return fail(MarketingConsentFailure.ACTION_NOT_EXPLICIT);
  if (cmd.action !== MarketingConsentAction.GRANT
      && cmd.action !== MarketingConsentAction.WITHDRAW) {
    return fail(MarketingConsentFailure.ACTION_NOT_EXPLICIT);
  }
  if (cmd.source !== "user" && cmd.source !== "admin") {
    return fail(MarketingConsentFailure.SOURCE_NOT_PERMITTED);
  }
  if (cmd.channel !== "whatsapp" && cmd.channel !== "sms" && cmd.channel !== "rcs") {
    return fail(MarketingConsentFailure.CHANNEL_INVALID);
  }
  if (cmd.principalType !== "client" && cmd.principalType !== "vendor") {
    return fail(MarketingConsentFailure.PRINCIPAL_NOT_EXACT);
  }
  if (typeof cmd.principalId !== "string" || !UUID_RE.test(cmd.principalId)) {
    return fail(MarketingConsentFailure.PRINCIPAL_NOT_EXACT);
  }
  if (typeof cmd.sourceEventType !== "string" || !IDENTIFIER_RE.test(cmd.sourceEventType)) {
    return fail(MarketingConsentFailure.SOURCE_EVENT_INVALID);
  }
  if (typeof cmd.sourceEventId !== "string"
      || cmd.sourceEventId.length < 1 || cmd.sourceEventId.length > 200) {
    return fail(MarketingConsentFailure.SOURCE_EVENT_INVALID);
  }
  if (!(cmd.occurredAt instanceof Date) || Number.isNaN(cmd.occurredAt.getTime())) {
    return fail(MarketingConsentFailure.OCCURRED_AT_INVALID);
  }
  return null;
}

export interface MarketingConsentDeps {
  readonly rpc: (name: string, args: Record<string, unknown>)
    => Promise<{ data: unknown; error: unknown }>;
}

/**
 * The Supabase import is LAZY on purpose: importing this module must construct no client
 * and read no environment, so the offline validator can exercise the real logic with an
 * injected fake RPC instead of testing a copy of it.
 */
export function defaultMarketingConsentDeps(): MarketingConsentDeps {
  return {
    rpc: async (name, args) => {
      const { adminClient } = await import("../lib/supabase");
      return adminClient().rpc(name, args);
    },
  };
}

/**
 * Record an EXPLICIT marketing consent decision. A single atomic RPC owns the whole
 * transaction: the immutable consent event and the preference row are written together or
 * not at all, and the event's unique idempotency fence makes a replay a no-op rather than
 * a second grant.
 */
export async function applyMarketingConsent(
  cmd: MarketingConsentCommand,
  deps: MarketingConsentDeps = defaultMarketingConsentDeps(),
): Promise<MarketingConsentResult> {
  const invalid = validateMarketingConsentCommand(cmd);
  if (invalid) return invalid;

  let res: { data: unknown; error: unknown };
  try {
    res = await deps.rpc("qf_apply_marketing_consent_v1", {
      p_policy_version: MARKETING_CONSENT_POLICY_VERSION,
      p_channel: cmd.channel,
      p_principal_type: cmd.principalType,
      p_principal_id: cmd.principalId,
      p_action: cmd.action,
      p_source: cmd.source,
      p_source_event_type: cmd.sourceEventType,
      p_source_event_id: cmd.sourceEventId,
      p_occurred_at: cmd.occurredAt.toISOString(),
    });
  } catch {
    // A transport throw is a CLOSED failure, never a silent success.
    return fail(MarketingConsentFailure.WRITE_FAILED);
  }
  if (res.error) return fail(MarketingConsentFailure.WRITE_FAILED);

  const body = res.data as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return fail(MarketingConsentFailure.UNEXPECTED_RESULT);
  if (body.ok !== true) return fail(MarketingConsentFailure.WRITE_FAILED);
  if (body.scope !== "marketing") return fail(MarketingConsentFailure.UNEXPECTED_RESULT);
  const outcome = body.code;
  if (outcome !== "APPLIED" && outcome !== "REPLAYED") {
    return fail(MarketingConsentFailure.UNEXPECTED_RESULT);
  }
  return {
    ok: true,
    outcome,
    stateBefore: String(body.state_before ?? ""),
    stateAfter: String(body.state_after ?? ""),
  };
}
