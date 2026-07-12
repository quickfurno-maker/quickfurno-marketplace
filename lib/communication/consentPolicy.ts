// ============================================================================
// QuickFurno — lib/communication/consentPolicy.ts   (Phase 5F-D2-C, server-only)
//
// The ONE server-only communication-consent policy version constant. Every consent
// decision (D2-C) and every future controlled writer (D2-D) stamps and compares this
// value. It is a CODE CONSTANT — never read from a browser request, a provider payload,
// or the environment, and never mutated at runtime.
//
// It must satisfy the live database policy-version fence
//   policy_version ~ '^[A-Za-z0-9._:-]{1,64}$'
// on communication_consent_events / communication_preferences / communication_suppressions.
// ============================================================================

/** The current communication-consent policy version. Immutable; server-only. */
export const CONSENT_POLICY_VERSION = "qf-consent-v1" as const;

export type ConsentPolicyVersion = typeof CONSENT_POLICY_VERSION;
