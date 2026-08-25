// ============================================================================
// QuickFurno — lib/communication/outboundConsentScope.ts   (Phase 5F-D3-B, pure module)
//
// The ONE place that maps an OUTBOUND message identity to the consent SCOPE that governs it.
// PURE: no I/O, no database, no network, no logging, no clock, no randomness, no environment.
//
// WHY A REGISTRY AND NOT A LANE LOOKUP
//   The ledger's `lane` vocabulary is only ('authentication', 'business') — it CANNOT distinguish
//   transactional from marketing. Deriving a consent scope from the lane alone would silently let a
//   marketing message be evaluated under transactional rules, which is exactly how a marketing
//   default-deny gets bypassed. So the scope comes from an EXACT, CLOSED, per-message-type registry.
//
// FAIL CLOSED, ALWAYS
//   • An UNKNOWN message type is BLOCKED. It is never "probably transactional" and never "probably
//     marketing" — an unclassified send is an unreviewed send.
//   • A KNOWN message type paired with a DIFFERENT template key is BLOCKED (a template swap must not
//     inherit another type's consent scope).
//   • A KNOWN message type declared under the WRONG lane is BLOCKED.
//   • There is NO wildcard, NO prefix rule (`admin_*` is never a pattern), and NO regex. Every entry is
//     written out. Adding a message type is a deliberate, reviewed vocabulary change.
//
// FOUNDER-RATIFIED (Phase 5F-D3-B): `client_nurture_followup` and `dormant_requirement_reactivation`
// are MARKETING. They are re-engagement messaging, so they are governed by marketing default-deny and
// require an explicit opt-in — they are NOT transactional.
// ============================================================================

/** The consent scopes D2-C understands. (D2-C also knows these three; this is the outbound subset.) */
export type OutboundConsentScope = "authentication" | "transactional" | "marketing";

/** The ledger lane vocabulary. Deliberately NOT a scope — it cannot distinguish the business scopes. */
export type OutboundLane = "authentication" | "business";

/** One approved (messageType, templateKey, lane) → scope binding. All three must match. */
interface RegistryEntry {
  readonly templateKey: string;
  readonly lane: OutboundLane;
  readonly scope: OutboundConsentScope;
}

/**
 * The EXACT closed registry. Every approved outbound message type, written out in full.
 *
 * The invariants the entries themselves encode:
 *   • every `authentication` scope entry declares lane `authentication`;
 *   • every `transactional` and `marketing` scope entry declares lane `business`.
 * `assertRegistryInvariants()` proves this holds, so a future edit cannot quietly violate it.
 */
const REGISTRY: Readonly<Record<string, RegistryEntry>> = Object.freeze({
  // ---- AUTHENTICATION (lane: authentication) --------------------------------------------------
  client_login_otp: { templateKey: "client_login_otp", lane: "authentication", scope: "authentication" },
  vendor_whatsapp_verify: { templateKey: "vendor_whatsapp_verify", lane: "authentication", scope: "authentication" },
  vendor_password_reset: { templateKey: "vendor_password_reset", lane: "authentication", scope: "authentication" },

  // ---- TRANSACTIONAL (lane: business) --------------------------------------------------------
  lead_received: { templateKey: "lead_received", lane: "business", scope: "transactional" },
  vendor_new_lead: { templateKey: "vendor_new_lead", lane: "business", scope: "transactional" },
  clarification_request: { templateKey: "clarification_request", lane: "business", scope: "transactional" },
  clarification_reminder: { templateKey: "clarification_reminder", lane: "business", scope: "transactional" },
  lead_assignment_alert: { templateKey: "lead_assignment_alert", lane: "business", scope: "transactional" },
  low_credit_warning: { templateKey: "low_credit_warning", lane: "business", scope: "transactional" },
  recharge_reminder: { templateKey: "recharge_reminder", lane: "business", scope: "transactional" },
  // ---- QF-MVP-40.6 ordinary additions ---------------------------------------------------------
  // Reviewed transactional types from the QF-MVP-40.4 catalogue. Each is listed EXPLICITLY by exact
  // key, exactly like the admin alerts above — no prefix, no pattern, no wildcard.
  client_lead_status_update: { templateKey: "client_lead_status_update", lane: "business", scope: "transactional" },
  // QF-MVP-40.4 CLIENT transactional follow-up. Listed EXPLICITLY by exact key like every
  // entry above. Scope is transactional, NOT marketing: the copy is tied to an existing
  // enquiry and carries no promotional content, so it must not require marketing consent.
  client_transactional_followup: { templateKey: "client_transactional_followup", lane: "business", scope: "transactional" },
  client_matching_update: { templateKey: "client_matching_update", lane: "business", scope: "transactional" },
  vendor_response_reminder: { templateKey: "vendor_response_reminder", lane: "business", scope: "transactional" },
  vendor_onboarding_reminder: { templateKey: "vendor_onboarding_reminder", lane: "business", scope: "transactional" },
  vendor_package_expiry_warning: { templateKey: "vendor_package_expiry_warning", lane: "business", scope: "transactional" },
  // NOTE: each admin alert is listed EXPLICITLY. `admin_*` is NOT a pattern — a prefix rule would
  // silently classify any future `admin_`-prefixed type without review.
  admin_policy_block_alert: { templateKey: "admin_policy_block_alert", lane: "business", scope: "transactional" },
  admin_assignment_failure_alert: { templateKey: "admin_assignment_failure_alert", lane: "business", scope: "transactional" },
  admin_provider_outage_alert: { templateKey: "admin_provider_outage_alert", lane: "business", scope: "transactional" },
  admin_automation_failure_alert: { templateKey: "admin_automation_failure_alert", lane: "business", scope: "transactional" },

  // ---- MARKETING (lane: business) — FOUNDER-RATIFIED ------------------------------------------
  // Re-engagement messaging. Marketing default-deny applies: an explicit, policy-current opt-in on an
  // EXACT identity is required, and absence of a preference is NEVER an opt-in.
  client_nurture_followup: { templateKey: "client_nurture_followup", lane: "business", scope: "marketing" },
  dormant_requirement_reactivation: { templateKey: "dormant_requirement_reactivation", lane: "business", scope: "marketing" },
  // Admin-approved CRM campaign message. Marketing, so the same default-deny rule applies. Campaign
  // ORCHESTRATION (batching, claiming, the per-recipient loop) remains QF-MVP-50 — classifying the
  // message type here does not create a dispatcher and does not authorise a campaign send.
  vendor_crm_promotion: { templateKey: "vendor_crm_promotion", lane: "business", scope: "marketing" },

  // ---- DELIBERATELY ABSENT: the consent acknowledgement types ----------------------------------
  // The three acknowledgement message types (STOP / START / HELP responses, enumerated as
  // ConsentAckType in lib/communication/consentCommandResponse.ts) are NOT registered here, and must
  // never be. Their absence IS the mechanism: an ordinary resolveOutboundConsentScope call for any of
  // them returns UNCLASSIFIED_MESSAGE_TYPE and DENIES, so the STOP-acknowledgement exception cannot
  // be reused by an arbitrary caller. They are authorised ONLY by the evidence-bound, one-shot
  // enforcer in services/consentCommandResponseService.ts, which requires a validated binding to the
  // exact inbound command. A future approved provider mapping must never create ordinary authority
  // here. See the header of lib/communication/consentCommandResponse.ts for the full rationale.
  //
  // NOTE FOR EDITORS: their literal key strings are deliberately NOT written in this file. The D4-B
  // and D4-C harnesses assert their absence by scanning this source for each key, so even a comment
  // mentioning one would trip that guard — which is exactly the sensitivity we want to keep.
});

/** Every approved outbound message type. Exported for tests + the coordinator's own fences. */
export const REGISTERED_MESSAGE_TYPES: readonly string[] = Object.freeze(Object.keys(REGISTRY));

/** The closed reasons a scope cannot be resolved. Each one is a BLOCK — never a fallback scope. */
export const ScopeResolutionFailure = {
  /** The message type is not in the registry at all. Never coerced to transactional or marketing. */
  UNCLASSIFIED_MESSAGE_TYPE: "UNCLASSIFIED_MESSAGE_TYPE",
  /** A known message type paired with a template key that is not its approved one. */
  MESSAGE_TYPE_TEMPLATE_MISMATCH: "MESSAGE_TYPE_TEMPLATE_MISMATCH",
  /** A known message type declared under a lane that is not its approved one. */
  MESSAGE_LANE_SCOPE_MISMATCH: "MESSAGE_LANE_SCOPE_MISMATCH",
} as const;
export type ScopeResolutionFailureValue =
  (typeof ScopeResolutionFailure)[keyof typeof ScopeResolutionFailure];

/** The closed result. A caller can only ever get a proven scope, or a proven reason it has none. */
export type OutboundConsentScopeResult =
  | { readonly ok: true; readonly scope: OutboundConsentScope; readonly templateKey: string; readonly lane: OutboundLane }
  | { readonly ok: false; readonly reason: ScopeResolutionFailureValue };

/**
 * Resolve the consent scope for one outbound message. Pure + total: any input (including a non-string,
 * an unknown type, a swapped template, or a wrong lane) yields a value of the closed result type.
 *
 * ALL THREE must match the approved entry — the type, its template key, and its lane. Matching on the
 * type alone would let a template swap or a lane swap inherit another message's consent scope.
 */
export function resolveOutboundConsentScope(input: {
  readonly messageType: unknown;
  readonly templateKey: unknown;
  readonly lane: unknown;
}): OutboundConsentScopeResult {
  const messageType = input?.messageType;
  if (typeof messageType !== "string" || !Object.prototype.hasOwnProperty.call(REGISTRY, messageType)) {
    // UNKNOWN → BLOCKED. Deliberately not "assume transactional" and not "assume marketing".
    return { ok: false, reason: ScopeResolutionFailure.UNCLASSIFIED_MESSAGE_TYPE };
  }
  const entry = REGISTRY[messageType];

  if (typeof input.templateKey !== "string" || input.templateKey !== entry.templateKey) {
    return { ok: false, reason: ScopeResolutionFailure.MESSAGE_TYPE_TEMPLATE_MISMATCH };
  }
  if (typeof input.lane !== "string" || input.lane !== entry.lane) {
    return { ok: false, reason: ScopeResolutionFailure.MESSAGE_LANE_SCOPE_MISMATCH };
  }
  return { ok: true, scope: entry.scope, templateKey: entry.templateKey, lane: entry.lane };
}

/**
 * Prove the registry's own lane⟷scope invariant: authentication ⟺ lane 'authentication', and
 * transactional/marketing ⟺ lane 'business'. Returns the offending entries (empty when sound).
 * Exported so the harness can prove a future edit cannot violate it.
 */
export function assertRegistryInvariants(): readonly string[] {
  const problems: string[] = [];
  for (const [messageType, entry] of Object.entries(REGISTRY)) {
    const expectedLane: OutboundLane = entry.scope === "authentication" ? "authentication" : "business";
    if (entry.lane !== expectedLane) {
      problems.push(`${messageType}: scope '${entry.scope}' requires lane '${expectedLane}', got '${entry.lane}'`);
    }
    if (entry.templateKey !== messageType) {
      problems.push(`${messageType}: the approved template key must equal the message type`);
    }
  }
  return problems;
}
