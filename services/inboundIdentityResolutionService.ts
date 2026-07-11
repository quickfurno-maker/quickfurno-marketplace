// ============================================================================
// QuickFurno — services/inboundIdentityResolutionService.ts   (Phase 5F-D1-A, server-only)
//
// FAIL-SAFE resolution of an inbound WhatsApp sender to a QuickFurno principal. The public
// result is provider-neutral: EXACT / AMBIGUOUS / UNKNOWN. Foundation only — nothing calls
// this from the live webhook yet (Phase 5F-D1-B wires it after the migration is applied).
//
// THE CARDINAL RULE: NEVER FABRICATE A PRINCIPAL.
//   • zero provable candidates            → UNKNOWN, no principal
//   • exactly one provable principal      → EXACT
//   • more than one provable principal    → AMBIGUOUS, no principal
//   (a same-phone client+vendor conflict, or two vendors, is AMBIGUOUS)
//   There is NO `LIMIT 1`, NO first-row-win, and NO client-over-vendor (or vendor-over-client)
//   priority. Candidates are de-duplicated only by PROVABLE identity equality
//   (principalType + principalId). A read failure fails SAFE to UNKNOWN.
//
// WHY A LEAD IS NOT AN IDENTITY. `leads.phone` is non-unique and a lead is NOT a verified
// principal (one phone → many leads), so leads are deliberately NOT a candidate source. A
// matching lead never becomes an authenticated client here.
//
// ADMIN/FOUNDER. There is no authoritative admin/founder phone-identity table today, so no
// admin match is ever produced. No founder phone is hardcoded and none is read from env.
//
// SCHEMA LIMITATION (documented, fail-safe). `client_accounts.phone_e164` is canonical E.164
// and UNIQUE → a provable EXACT client match. Vendor phones (`vendor_dashboard_users.phone`,
// `vendors.phone`) are non-canonical, non-unique `text`; the vendor finder matches ONLY an
// EXACT canonical string on a VERIFIED vendor phone, which yields a safe MISS (never a false
// positive) when the stored value is not canonical. A canonical vendor phone/hash column is a
// prerequisite for reliable vendor inbound identity in a later phase.
// ============================================================================

import { adminClient } from "../lib/supabase";
import { normalizePhoneE164 } from "../lib/communication/phone";

export const InboundIdentityConfidence = {
  EXACT: "exact",
  AMBIGUOUS: "ambiguous",
  UNKNOWN: "unknown",
} as const;
export type InboundIdentityConfidenceValue =
  (typeof InboundIdentityConfidence)[keyof typeof InboundIdentityConfidence];

export const InboundPrincipalType = {
  CLIENT: "client",
  VENDOR: "vendor",
  ADMIN: "admin",
} as const;
export type InboundPrincipalTypeValue =
  (typeof InboundPrincipalType)[keyof typeof InboundPrincipalType];

/** A PROVABLE principal candidate. A finder returns one per provable underlying principal. */
export interface InboundPrincipalCandidate {
  readonly principalType: InboundPrincipalTypeValue;
  readonly principalId: string;
}

/** The observable result. Non-secret: a confidence, an optional principal, and a count. */
export interface InboundIdentityResult {
  readonly confidence: InboundIdentityConfidenceValue;
  readonly principalType: InboundPrincipalTypeValue | null;
  readonly principalId: string | null;
  readonly candidateCount: number;
}

/** Every candidate source is injectable. The default binds the real read-only queries. */
export interface InboundIdentityDeps {
  readonly findClientCandidates: (canonicalE164: string) => Promise<InboundPrincipalCandidate[]>;
  readonly findVendorCandidates: (canonicalE164: string) => Promise<InboundPrincipalCandidate[]>;
  readonly findAdminCandidates: (canonicalE164: string) => Promise<InboundPrincipalCandidate[]>;
}

/** LAZY: constructed per request, never at module import. Read-only queries only. */
export function defaultInboundIdentityDeps(): InboundIdentityDeps {
  return {
    // `client_accounts.phone_e164` is canonical E.164 and UNIQUE → 0 or 1 provable client.
    findClientCandidates: async (e164) => {
      const { data, error } = await adminClient()
        .from("client_accounts")
        .select("id")
        .eq("phone_e164", e164);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        principalType: InboundPrincipalType.CLIENT,
        principalId: String((r as { id: string }).id),
      }));
    },
    // Conservative + fail-safe: EXACT canonical equality on a VERIFIED vendor phone. A
    // non-canonically-stored phone simply does not match (a safe miss, never a false positive).
    findVendorCandidates: async (e164) => {
      const { data, error } = await adminClient()
        .from("vendor_dashboard_users")
        .select("vendor_id")
        .eq("phone", e164)
        .eq("phone_verified", true);
      if (error) throw error;
      return (data ?? [])
        .map((r) => (r as { vendor_id: string | null }).vendor_id)
        .filter((id): id is string => typeof id === "string" && id.trim() !== "")
        .map((id) => ({ principalType: InboundPrincipalType.VENDOR, principalId: String(id) }));
    },
    // No authoritative admin/founder phone-identity table exists. Never invent one.
    findAdminCandidates: async () => [],
  };
}

function unknown(): InboundIdentityResult {
  return { confidence: InboundIdentityConfidence.UNKNOWN, principalType: null, principalId: null, candidateCount: 0 };
}

/**
 * Resolve an inbound sender to EXACT / AMBIGUOUS / UNKNOWN. `senderPhoneE164` is request-memory
 * only and never persisted or logged here.
 */
export async function resolveInboundSenderIdentity(
  input: { readonly senderPhoneE164: string },
  deps: InboundIdentityDeps = defaultInboundIdentityDeps()
): Promise<InboundIdentityResult> {
  // Canonicalize first through the ONE canonical helper. A non-normalizable sender resolves
  // UNKNOWN — never fabricated, and its plaintext value is never surfaced.
  const normalized = normalizePhoneE164(input.senderPhoneE164);
  if (!normalized.ok) return unknown();
  const e164 = normalized.e164;

  let candidates: InboundPrincipalCandidate[];
  try {
    const [clients, vendors, admins] = await Promise.all([
      deps.findClientCandidates(e164),
      deps.findVendorCandidates(e164),
      deps.findAdminCandidates(e164),
    ]);
    candidates = [...clients, ...vendors, ...admins];
  } catch {
    // A read failure is FAIL-SAFE: never fabricate a principal.
    return unknown();
  }

  // De-duplicate by PROVABLE identity equality only. Never first-row-win.
  const uniqueById = new Map<string, InboundPrincipalCandidate>();
  for (const c of candidates) {
    if (!c || typeof c.principalId !== "string" || c.principalId.trim() === "") continue;
    uniqueById.set(`${c.principalType}:${c.principalId}`, c);
  }
  const unique = [...uniqueById.values()];

  if (unique.length === 0) return unknown();
  if (unique.length === 1) {
    const only = unique[0];
    return { confidence: InboundIdentityConfidence.EXACT, principalType: only.principalType, principalId: only.principalId, candidateCount: 1 };
  }
  // More than one provable principal (cross-type conflict, multiple vendors, …) → AMBIGUOUS.
  return { confidence: InboundIdentityConfidence.AMBIGUOUS, principalType: null, principalId: null, candidateCount: unique.length };
}
