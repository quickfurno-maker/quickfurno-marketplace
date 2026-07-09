// ============================================================================
// QuickFurno — Identity Foundation: local session invalidation (Phase 5D)
//
// Shared, reusable local-session invalidation with the SAME semantics Phase 5C
// established for vendor login (services/vendorAuthService.ts). It is factored
// here so the Phase 5D client OTP verify flow can invalidate a session it must
// not hand out, without importing the vendor login service and without weakening
// the Phase 5C behaviour (that service keeps its own inlined copy verbatim, so
// its source-level regression guards stay green).
//
// INVARIANTS (identical to Phase 5C)
//   • scope is ALWAYS "local". The default scope is GLOBAL, which would revoke
//     every refresh token the user holds — punishing their other devices for a
//     denial on this one. Never global, never "others".
//   • The `{ error }` Supabase returns is INSPECTED. Success is never reported
//     unless Supabase confirmed it. A bounded retry recovers a transient failure.
//   • The raw AuthError is DISCARDED — its message can embed a token or a request
//     URL. Only a sanitized, closed-vocabulary classification survives.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Why a local session invalidation could not be confirmed. A SANITIZED, closed
 * vocabulary — the raw Supabase AuthError is never persisted.
 */
export const SessionInvalidationFailure = {
  /** Supabase returned an error from signOut(). */
  SIGN_OUT_REJECTED: "sign_out_rejected",
  /** signOut() threw (transport, aborted request, adapter bug). */
  SIGN_OUT_THREW: "sign_out_threw",
} as const;

export type SessionInvalidationFailureValue =
  (typeof SessionInvalidationFailure)[keyof typeof SessionInvalidationFailure];

export interface SessionInvalidationOutcome {
  /** True ONLY when Supabase confirmed the local session was cleared. */
  readonly invalidated: boolean;
  readonly failure: SessionInvalidationFailureValue | null;
  readonly attempts: number;
}

/** Bounded retry: one transient failure should not leave a session standing. */
export const SESSION_INVALIDATION_MAX_ATTEMPTS = 2;

/**
 * Invalidate ONLY the current local Supabase session. Inspects the returned
 * error, retries within a bound, and never escalates to a global sign-out. On an
 * unconfirmed outcome it returns `invalidated: false` — the caller must not claim
 * an invalidation that did not happen, but every protected surface still fails
 * closed because no active client mapping resolves for the denied principal.
 */
export async function invalidateLocalSession(sb: SupabaseClient): Promise<SessionInvalidationOutcome> {
  let failure: SessionInvalidationFailureValue | null = null;

  for (let attempt = 1; attempt <= SESSION_INVALIDATION_MAX_ATTEMPTS; attempt += 1) {
    try {
      const { error } = await sb.auth.signOut({ scope: "local" });
      if (!error) return { invalidated: true, failure: null, attempts: attempt };
      failure = SessionInvalidationFailure.SIGN_OUT_REJECTED;
    } catch {
      failure = SessionInvalidationFailure.SIGN_OUT_THREW;
    }
  }

  return { invalidated: false, failure, attempts: SESSION_INVALIDATION_MAX_ATTEMPTS };
}
