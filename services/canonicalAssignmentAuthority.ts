// ============================================================================
// QuickFurno — services/canonicalAssignmentAuthority.ts
//
// QF-MVP-20.3R1 — the ONLY runtime path to marketplace lead assignment.
//
// Every compatible runtime consumer calls `executeCanonicalAssignment`, which
// calls exactly one database function:
//
//   public.qf_assign_lead_vendors_v2(
//     p_lead_id uuid, p_mode text, p_candidate_vendors uuid[],
//     p_operation_key text, p_actor_kind text, p_actor_id uuid,
//     p_replacement_ref uuid, p_reason_code text) returns jsonb
//
// introduced by migration 20260723000300_qf_mvp_canonical_assignment_authority.
//
// LOCKED CONTRACT — this module must never weaken any of these:
//   • Max 3 ACTIVE assignments and max 6 LIFETIME distinct vendors per lead.
//     Both caps live INSIDE the authority. There is no caller-supplied ceiling
//     parameter, and this module deliberately exposes none.
//   • Exactly ONE wallet credit per successful assignment. The caller cannot
//     choose, scale or waive the cost.
//   • The wallet ledger is the sole debit authority. No consumer performs a
//     direct credit mutation for an assignment.
//   • `vendor_packages` is never debited for an assignment.
//   • The operation key is DETERMINISTIC, so an infrastructure-level retry of
//     the same logical operation replays instead of double-assigning.
//   • Replay returns `already_applied`; a reused key carrying a DIFFERENT
//     request returns `idempotency_conflict` and mutates nothing.
//   • SERVICE-ROLE CLIENT ONLY. `anon` and `authenticated` have no execute
//     privilege on the authority, and no browser-reachable code path may hold
//     service-role credentials.
//   • NO BLIND FALLBACK. If the authority rejects, errors, or is unavailable,
//     the consumer fails closed. It never falls back to a legacy assignment RPC
//     and never mutates credits directly.
//
// KNOWN LIMITATION — R1_BLOCKED_PENDING_OWNER_BINDING
//   `client_selected` mode is fail-closed. See R1_BLOCKED_PENDING_OWNER_BINDING
//   in lib/marketplace/canonicalAssignmentContract.ts and
//   docs/QF-MVP-20-3R1-CONSUMER-MIGRATION.md.
// ============================================================================
import { adminClient } from "../lib/supabase";
import { fail, ok, type Result } from "../lib/errors";
import {
  CANONICAL_ASSIGNMENT_RPC,
  CANONICAL_ASSIGNMENT_AUTHORITY_MISSING,
  CANONICAL_AUTHORITY_MIGRATION_HINT,
  CLIENT_SELECTED_BLOCK_REASON,
  isMissingAuthorityError,
  R1_BLOCKED_PENDING_OWNER_BINDING,
  normalizeCanonicalAssignmentResult,
  validateCanonicalAssignmentRequest,
  type CanonicalAssignmentOutcome,
  type CanonicalAssignmentRequest,
} from "../lib/marketplace/canonicalAssignmentContract";

// Re-exported so every consumer has ONE import site for the whole seam.
export * from "../lib/marketplace/canonicalAssignmentContract";

// ---------------------------------------------------------------------------
// The single runtime seam
// ---------------------------------------------------------------------------

/**
 * Execute one canonical assignment operation.
 *
 * Fail-closed on every abnormal path: an invalid request, a blocked mode, a
 * missing authority, a transport error or an unrecognised payload all return a
 * failed `Result`. There is NO fallback to a legacy assignment RPC and NO
 * direct credit mutation anywhere in this module.
 */
export async function executeCanonicalAssignment(
  input: CanonicalAssignmentRequest,
): Promise<Result<CanonicalAssignmentOutcome>> {
  const validation = validateCanonicalAssignmentRequest(input);
  if (!validation.ok) return { ok: false, code: validation.code, error: validation.error };
  const request = validation.request;

  try {
    // Service-role client only. `anon`/`authenticated` hold no execute
    // privilege on the authority, and no browser-reachable module imports this.
    const { data, error } = await adminClient().rpc(CANONICAL_ASSIGNMENT_RPC, {
      p_lead_id: request.leadId,
      p_mode: request.mode,
      p_candidate_vendors: request.candidateVendorIds,
      p_operation_key: request.operationKey,
      p_actor_kind: request.actorKind,
      p_actor_id: request.actorId,
      p_replacement_ref: request.replacementRequestId,
      p_reason_code: request.reasonCode,
    });

    if (error) {
      if (isMissingAuthorityError(error)) {
        return { ok: false, code: CANONICAL_ASSIGNMENT_AUTHORITY_MISSING, error: CANONICAL_AUTHORITY_MIGRATION_HINT };
      }
      // The authority raises only to roll the whole transaction back, so an
      // error here means NOTHING was committed. Surface it; never retry with a
      // different path.
      return {
        ok: false,
        code: "CANONICAL_ASSIGNMENT_FAILED",
        error: error.message ?? "Assignment failed and nothing was changed.",
      };
    }

    return ok(normalizeCanonicalAssignmentResult(data, request));
  } catch (e) {
    return fail(e);
  }
}

/**
 * The deterministic blocked result for any runtime path that would have
 * performed a CLIENT-SELECTED assignment. Performs no I/O and has no side
 * effect of any kind: no assignment, no credit, no ledger row, no lineage
 * event, no communication intent.
 */
export function blockedClientSelectedAssignment<T = never>(): Result<T> {
  return { ok: false, code: R1_BLOCKED_PENDING_OWNER_BINDING, error: CLIENT_SELECTED_BLOCK_REASON };
}
