// ============================================================================
// QuickFurno — Identity Foundation: canonical principal model (Phase 5A)
//
// One compatible identity vocabulary across authenticated users, vendors,
// clients, admins, integrations, system jobs, and future AI-agent system
// contexts. This is a PURE contract layer: no network calls, no OTP transport,
// no provider code, and it does NOT replace the existing auth guards
// (currentUser / requireAdmin / requireSuperadmin / requireVendorOwner in
// app/actions.ts). It only provides a canonical way to *reference* a principal.
//
// Responsibility separation (do not merge):
//   • Supabase Auth  = authentication session authority
//   • QuickFurno identity layer (this) = principal type + business identity/ownership
//   • Phase 4 policy engine = business authorization authority
// ============================================================================

/**
 * Canonical QuickFurno principal types.
 *
 *   anonymous   — no Supabase session (public enquiry submission, unauthenticated)
 *   client      — a client_accounts identity backed by a Supabase auth user
 *   vendor      — a vendors identity backed by a Supabase auth user (vendors.user_id)
 *   admin       — a profiles(role='admin') identity backed by a Supabase auth user
 *   integration — an authorized external orchestration context (e.g. n8n).
 *                 NEVER an authentication authority; never generates/verifies OTPs.
 *   system      — internal system jobs / the workflow kernel / authorized AI-agent
 *                 system contexts. AI agents act ONLY through a system/integration
 *                 principal with no Supabase session — they hold no independent
 *                 authentication authority of their own.
 */
export const PrincipalType = {
  ANONYMOUS: "anonymous",
  CLIENT: "client",
  VENDOR: "vendor",
  ADMIN: "admin",
  INTEGRATION: "integration",
  SYSTEM: "system",
} as const;

export type PrincipalTypeValue = (typeof PrincipalType)[keyof typeof PrincipalType];

export const KNOWN_PRINCIPAL_TYPES: readonly PrincipalTypeValue[] = Object.freeze(
  Object.values(PrincipalType),
);

/** Principal types that hold a Supabase Auth session (auth.users identity). */
export const SESSION_BACKED_PRINCIPAL_TYPES: readonly PrincipalTypeValue[] = Object.freeze([
  PrincipalType.CLIENT,
  PrincipalType.VENDOR,
  PrincipalType.ADMIN,
]);

export function isPrincipalType(value: unknown): value is PrincipalTypeValue {
  return typeof value === "string" && (KNOWN_PRINCIPAL_TYPES as string[]).includes(value);
}

export function isSessionBackedPrincipalType(value: unknown): value is PrincipalTypeValue {
  return (
    typeof value === "string" &&
    (SESSION_BACKED_PRINCIPAL_TYPES as string[]).includes(value)
  );
}

/**
 * Canonical, immutable reference to a QuickFurno principal.
 *
 *   type   — the principal type
 *   id     — business identity id (client_accounts.id / vendors.id / profiles.id /
 *            integration id); null for anonymous
 *   userId — Supabase auth.users.id where one exists; null for anonymous /
 *            integration / system (they do not hold a Supabase Auth session)
 *   role   — optional role metadata (e.g. admin_role) where appropriate
 */
export interface PrincipalRef {
  readonly type: PrincipalTypeValue;
  readonly id: string | null;
  readonly userId: string | null;
  readonly role: string | null;
}

function freezePrincipal(ref: PrincipalRef): PrincipalRef {
  return Object.freeze(ref);
}

/** The anonymous principal (no session, no identity) — public enquiry submission. */
export function anonymousPrincipal(): PrincipalRef {
  return freezePrincipal({ type: PrincipalType.ANONYMOUS, id: null, userId: null, role: null });
}

export function clientPrincipal(input: { clientAccountId: string; userId: string }): PrincipalRef {
  return freezePrincipal({
    type: PrincipalType.CLIENT,
    id: input.clientAccountId,
    userId: input.userId,
    role: null,
  });
}

export function vendorPrincipal(input: { vendorId: string; userId: string }): PrincipalRef {
  return freezePrincipal({
    type: PrincipalType.VENDOR,
    id: input.vendorId,
    userId: input.userId,
    role: null,
  });
}

export function adminPrincipal(input: { userId: string; adminRole?: string | null }): PrincipalRef {
  return freezePrincipal({
    type: PrincipalType.ADMIN,
    id: input.userId,
    userId: input.userId,
    role: input.adminRole ?? null,
  });
}

/** An authorized external orchestration context (e.g. n8n). No Supabase session. */
export function integrationPrincipal(input: { integrationId: string }): PrincipalRef {
  return freezePrincipal({
    type: PrincipalType.INTEGRATION,
    id: input.integrationId,
    userId: null,
    role: null,
  });
}

/**
 * An internal system context (workflow kernel / system job). AI agents act ONLY
 * through such a system context (role marks the agent), never with their own
 * authentication authority and never with a Supabase session.
 */
export function systemPrincipal(input?: { systemId?: string | null; role?: string | null }): PrincipalRef {
  return freezePrincipal({
    type: PrincipalType.SYSTEM,
    id: input?.systemId ?? null,
    userId: null,
    role: input?.role ?? null,
  });
}
