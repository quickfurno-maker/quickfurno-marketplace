// ============================================================================
// QuickFurno — services/clientAccessService.ts   (server-only)
//
// THE one canonical resolver + provisioner for client (homeowner) dashboard
// access. No route, page, or action may re-derive client identity by hand.
//
// IDENTITY CHAIN (the only trustworthy one):
//   Supabase Auth user  →  client_accounts.user_id  →  client_accounts.id
//
// Client access depends on EXACTLY three things: an authentic Supabase user, a
// valid user→client_accounts mapping, and an active account status. It must
// NEVER depend on lead status, lead quality, vendor matching, subscription,
// vendor state, or marketing consent. Anonymous lead submission is independent
// of everything here.
//
// PRIVILEGE MODEL (Phase 5D migration): `authenticated` holds SELECT only;
// provisioning and the WhatsApp-verified timestamp are service-role writes made
// here, never from the browser.
// ============================================================================

import { adminClient, serverClient } from "../lib/supabase";
import { appError, fail, ok, type Result } from "../lib/errors";
import { isUniqueViolationError } from "../lib/communication/dbErrors";
import { isClientAccountStatus, type ClientAccountStatusValue } from "../lib/identity/clientAccount";
import {
  ClientAccessDenialReason,
  denyClientAccess,
  grantClientAccess,
  isActiveClientAccount,
  type ClientAccessContext,
  type ClientAccessResolution,
} from "../lib/identity/clientAccess";
import { ClientOtpVerifyFailureClassification, type ClientOtpVerifyFailureClassificationValue } from "../lib/identity/clientOtp";

export const CLIENT_ACCOUNTS_TABLE = "client_accounts";

/** Columns this service reads/writes. No lead/vendor/consent state is selected. */
const CLIENT_ACCOUNT_COLUMNS = "id, user_id, phone_e164, display_name, whatsapp_verified_at, status";

interface ClientAccountRow {
  id: string | null;
  user_id: string | null;
  phone_e164: string | null;
  display_name: string | null;
  whatsapp_verified_at: string | null;
  status: string | null;
}

function toContext(row: ClientAccountRow, authUserId: string): ClientAccessContext {
  return Object.freeze({
    authUserId,
    clientAccountId: row.id as string,
    phoneE164: row.phone_e164 ?? null,
    status: (row.status as ClientAccountStatusValue) ?? "active",
    whatsappVerifiedAt: row.whatsapp_verified_at ?? null,
  });
}

// ----------------------------------------------------------------------------
// Resolution
// ----------------------------------------------------------------------------

/**
 * Resolve client access for an ALREADY-AUTHENTICATED Supabase user id. Uses the
 * service-role client because the caller has already been validated by Supabase
 * Auth. `resolveCurrentClientAccess()` is the entry point that establishes
 * authenticity first.
 */
export async function resolveClientAccess(authUserId: string): Promise<ClientAccessResolution> {
  if (typeof authUserId !== "string" || authUserId.trim() === "") {
    return denyClientAccess(ClientAccessDenialReason.NOT_AUTHENTICATED);
  }

  let row: ClientAccountRow | null;
  try {
    const { data, error } = await adminClient()
      .from(CLIENT_ACCOUNTS_TABLE)
      .select(CLIENT_ACCOUNT_COLUMNS)
      // A unique index on (user_id) guarantees at most one row. If duplicates ever
      // existed, maybeSingle() errors and we fail closed rather than pick one.
      .eq("user_id", authUserId)
      .maybeSingle();

    if (error) return denyClientAccess(ClientAccessDenialReason.LOOKUP_FAILED);
    row = (data as ClientAccountRow | null) ?? null;
  } catch {
    return denyClientAccess(ClientAccessDenialReason.LOOKUP_FAILED);
  }

  if (!row) return denyClientAccess(ClientAccessDenialReason.NO_CLIENT_ACCOUNT);
  if (!row.id || !row.user_id || !isClientAccountStatus(row.status)) {
    return denyClientAccess(ClientAccessDenialReason.MALFORMED_ACCOUNT);
  }
  if (!isActiveClientAccount(row.status)) {
    return denyClientAccess(ClientAccessDenialReason.ACCOUNT_NOT_ACTIVE);
  }

  return grantClientAccess(toContext(row, authUserId));
}

/**
 * Resolve client access for the CURRENT request. `auth.getUser()` on the
 * request-scoped SSR client revalidates the session against the Auth server — not
 * a local JWT decode, and there is no second QuickFurno session cookie.
 */
export async function resolveCurrentClientAccess(): Promise<ClientAccessResolution> {
  let authUserId: string;
  try {
    const sb = await serverClient();
    const { data, error } = await sb.auth.getUser();
    if (error || !data?.user?.id) {
      return denyClientAccess(ClientAccessDenialReason.NOT_AUTHENTICATED);
    }
    authUserId = data.user.id;
  } catch {
    return denyClientAccess(ClientAccessDenialReason.NOT_AUTHENTICATED);
  }
  return resolveClientAccess(authUserId);
}

/**
 * The reusable guard for protected client routes. Fails closed and returns the
 * canonical clientAccountId — callers must use `context.clientAccountId`, never a
 * request parameter. The denial reason is deliberately not surfaced.
 */
export async function requireClientAccess(): Promise<Result<ClientAccessContext>> {
  const resolution = await resolveCurrentClientAccess();
  if (!resolution.ok) return fail(appError("UNAUTHORIZED"));
  return ok(resolution.context);
}

// ----------------------------------------------------------------------------
// Provisioning (server-only, after successful verifyOtp + attestation)
// ----------------------------------------------------------------------------
export type ClientProvisioningResult =
  | { readonly ok: true; readonly context: ClientAccessContext }
  | { readonly ok: false; readonly classification: ClientOtpVerifyFailureClassificationValue };

function provisioningConflict(
  classification: ClientOtpVerifyFailureClassificationValue
): ClientProvisioningResult {
  return { ok: false, classification };
}

async function fetchByUser(authUserId: string): Promise<ClientAccountRow | null> {
  const { data, error } = await adminClient()
    .from(CLIENT_ACCOUNTS_TABLE)
    .select(CLIENT_ACCOUNT_COLUMNS)
    .eq("user_id", authUserId)
    .maybeSingle();
  if (error) throw error;
  return (data as ClientAccountRow | null) ?? null;
}

async function fetchByPhone(phoneE164: string): Promise<ClientAccountRow | null> {
  const { data, error } = await adminClient()
    .from(CLIENT_ACCOUNTS_TABLE)
    .select(CLIENT_ACCOUNT_COLUMNS)
    .eq("phone_e164", phoneE164)
    .maybeSingle();
  if (error) throw error;
  return (data as ClientAccountRow | null) ?? null;
}

/**
 * THE canonical success postcondition. NOTHING returns a provisioning success
 * without passing through here, so a success result can never carry an
 * incompletely-bound identity.
 *
 * A successful Phase 5D provisioning ALWAYS satisfies, on the FINAL persisted row:
 *   • authUserId          === the verified Supabase Auth user id
 *   • phoneE164           === the verified canonical phone (never null)
 *   • status              === active
 *   • whatsappVerifiedAt  !== null
 *
 * Anything else is a conflict, not a partially-good login.
 */
function finalizeSuccess(
  row: ClientAccountRow | null,
  authUserId: string,
  phoneE164: string
): ClientProvisioningResult {
  if (!row || !row.id || !row.user_id || !isClientAccountStatus(row.status)) {
    return provisioningConflict(ClientOtpVerifyFailureClassification.PROVISIONING_FAILED);
  }
  // The row must belong to the auth user we verified — never another principal.
  if (row.user_id !== authUserId) {
    return provisioningConflict(ClientOtpVerifyFailureClassification.IDENTITY_CONFLICT);
  }
  // Suspended/disabled never becomes a success, on any path.
  if (!isActiveClientAccount(row.status)) {
    return provisioningConflict(ClientOtpVerifyFailureClassification.ACCOUNT_NOT_ACTIVE);
  }
  // A null or divergent phone means the identity is not bound. Never succeed.
  if (row.phone_e164 !== phoneE164) {
    return provisioningConflict(ClientOtpVerifyFailureClassification.IDENTITY_CONFLICT);
  }
  // The WhatsApp verification stamp is the proof this login wrote. Never succeed
  // without it — a null timestamp means some path skipped or lost the write.
  if (!row.whatsapp_verified_at) {
    return provisioningConflict(ClientOtpVerifyFailureClassification.PROVISIONING_FAILED);
  }
  return { ok: true, context: toContext(row, authUserId) };
}

/**
 * A conditional (compare-and-set) update matched zero rows because a concurrent
 * request for the SAME user won. Re-read the FINAL row and validate every success
 * invariant against it — never return the stale pre-update context.
 */
async function finalizeFromRefetch(
  authUserId: string,
  phoneE164: string
): Promise<ClientProvisioningResult> {
  const final = await fetchByUser(authUserId);
  return finalizeSuccess(final, authUserId, phoneE164);
}

/**
 * Reconcile an EXISTING client_accounts row for this auth user against the
 * verified phone. Shared by the first-pass lookup and the concurrent-insert
 * loser, so both obey exactly the same identity rules and the same success
 * postcondition.
 */
async function reconcileExistingClient(
  row: ClientAccountRow,
  authUserId: string,
  phoneE164: string
): Promise<ClientProvisioningResult> {
  if (!row.id || !row.user_id || !isClientAccountStatus(row.status)) {
    return provisioningConflict(ClientOtpVerifyFailureClassification.PROVISIONING_FAILED);
  }
  if (row.user_id !== authUserId) {
    return provisioningConflict(ClientOtpVerifyFailureClassification.IDENTITY_CONFLICT);
  }
  // Suspended/disabled → deny, never reactivate.
  if (!isActiveClientAccount(row.status)) {
    return provisioningConflict(ClientOtpVerifyFailureClassification.ACCOUNT_NOT_ACTIVE);
  }

  // Same user, same phone → idempotent. Preserve an existing first verification
  // timestamp; stamp one only if it is still null.
  if (row.phone_e164 === phoneE164) {
    if (row.whatsapp_verified_at) return finalizeSuccess(row, authUserId, phoneE164);
    const stamped = await stampVerifiedTimestamp(row.id);
    // Zero rows → a concurrent same-user request stamped it first. Re-read the
    // final row rather than returning the stale, still-null context.
    if (!stamped) return await finalizeFromRefetch(authUserId, phoneE164);
    return finalizeSuccess(stamped, authUserId, phoneE164);
  }

  // User row with a NULL phone → may adopt the verified phone, under compare-and-set.
  if (row.phone_e164 === null) {
    return await adoptPhone(row.id, authUserId, phoneE164);
  }

  // User row with a DIFFERENT non-null phone → never overwrite established
  // identity. Fail closed.
  return provisioningConflict(ClientOtpVerifyFailureClassification.IDENTITY_CONFLICT);
}

/**
 * Resolve or create the client_accounts row for a verified (authUserId, phoneE164).
 *
 * The unique index on user_id and the partial unique index on phone_e164 are the
 * FINAL authorities. This function never reassigns phone ownership, never
 * overwrites an established identity, never reactivates a suspended/disabled
 * account, and handles a 23505 race by refetching and re-validating the winner.
 *
 * Preconditions (enforced by the caller): Supabase verifyOtp already succeeded,
 * the Auth phone matched `phoneE164`, and a fresh WhatsApp communication
 * attestation exists. Only then is `whatsapp_verified_at` written.
 */
export async function provisionVerifiedClientAccount(input: {
  authUserId: string;
  phoneE164: string;
}): Promise<ClientProvisioningResult> {
  const { authUserId, phoneE164 } = input;
  try {
    const byUser = await fetchByUser(authUserId);
    const byPhone = await fetchByPhone(phoneE164);

    // Phone owned by a DIFFERENT auth user → fail closed. Never reassign ownership.
    if (byPhone && byPhone.user_id && byPhone.user_id !== authUserId) {
      return provisioningConflict(ClientOtpVerifyFailureClassification.IDENTITY_CONFLICT);
    }

    if (byUser) return await reconcileExistingClient(byUser, authUserId, phoneE164);

    // No row for this user, but a row already holds this phone for THIS user with
    // no user-id match above — a contradiction under the unique user_id index.
    if (byPhone) {
      return provisioningConflict(ClientOtpVerifyFailureClassification.IDENTITY_CONFLICT);
    }

    // Truly new client.
    return await insertNewClient(authUserId, phoneE164);
  } catch {
    return provisioningConflict(ClientOtpVerifyFailureClassification.PROVISIONING_FAILED);
  }
}

/**
 * Compare-and-set the first verification timestamp. Returns null when zero rows
 * matched — i.e. a concurrent request stamped it first, which the caller must
 * resolve by re-reading the final row.
 */
async function stampVerifiedTimestamp(clientAccountId: string): Promise<ClientAccountRow | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await adminClient()
    .from(CLIENT_ACCOUNTS_TABLE)
    .update({ whatsapp_verified_at: nowIso, updated_at: nowIso })
    .eq("id", clientAccountId)
    .is("whatsapp_verified_at", null)
    .select(CLIENT_ACCOUNT_COLUMNS);
  if (error) throw error;
  const rows = (data ?? []) as ClientAccountRow[];
  return rows[0] ?? null;
}

/**
 * Adopt the verified phone onto a null-phone row belonging to this user, setting
 * the verification timestamp in the SAME statement so the two can never diverge.
 *
 * The update is a compare-and-set: it matches only while the row still belongs to
 * `authUserId` AND its phone is still null. Zero rows therefore means a concurrent
 * same-user request adopted first, and the final row is re-read and re-validated.
 */
async function adoptPhone(
  clientAccountId: string,
  authUserId: string,
  phoneE164: string
): Promise<ClientProvisioningResult> {
  const nowIso = new Date().toISOString();
  const { data, error } = await adminClient()
    .from(CLIENT_ACCOUNTS_TABLE)
    .update({ phone_e164: phoneE164, whatsapp_verified_at: nowIso, updated_at: nowIso })
    .eq("id", clientAccountId)
    .eq("user_id", authUserId)
    .is("phone_e164", null)
    .select(CLIENT_ACCOUNT_COLUMNS);

  if (error) {
    // The partial unique index on phone_e164 is the final authority: another
    // account adopted this number first. Never reassign ownership.
    if (isUniqueViolationError(error)) {
      return provisioningConflict(ClientOtpVerifyFailureClassification.IDENTITY_CONFLICT);
    }
    throw error;
  }
  const rows = (data ?? []) as ClientAccountRow[];
  if (rows.length === 1) return finalizeSuccess(rows[0], authUserId, phoneE164);
  if (rows.length === 0) return await finalizeFromRefetch(authUserId, phoneE164);
  // More than one row matched an id-scoped update — impossible; fail closed.
  return provisioningConflict(ClientOtpVerifyFailureClassification.PROVISIONING_FAILED);
}

async function insertNewClient(
  authUserId: string,
  phoneE164: string
): Promise<ClientProvisioningResult> {
  const nowIso = new Date().toISOString();
  const { data, error } = await adminClient()
    .from(CLIENT_ACCOUNTS_TABLE)
    .insert({
      user_id: authUserId,
      phone_e164: phoneE164,
      status: "active",
      whatsapp_verified_at: nowIso,
    })
    .select(CLIENT_ACCOUNT_COLUMNS)
    .single();

  if (error) {
    // A concurrent verify won the insert. Refetch and re-validate the winner —
    // never arbitrarily pick an identity, never overwrite another client's phone.
    if (isUniqueViolationError(error)) {
      return await resolveConcurrentWinner(authUserId, phoneE164);
    }
    throw error;
  }
  return finalizeSuccess((data as ClientAccountRow | null) ?? null, authUserId, phoneE164);
}

/**
 * Our INSERT lost a 23505 race. Adopt the winning row only if it can be brought to
 * the full success postcondition — including safely completing a phone adoption
 * the winner had not finished. A winner with a null phone is NEVER returned as-is.
 */
async function resolveConcurrentWinner(
  authUserId: string,
  phoneE164: string
): Promise<ClientProvisioningResult> {
  const winnerByPhone = await fetchByPhone(phoneE164);
  // The phone belongs to a different auth user → identity conflict, no adoption.
  if (winnerByPhone && winnerByPhone.user_id && winnerByPhone.user_id !== authUserId) {
    return provisioningConflict(ClientOtpVerifyFailureClassification.IDENTITY_CONFLICT);
  }

  const winnerByUser = await fetchByUser(authUserId);
  // We lost the insert but no row exists for this user — a contradiction under the
  // unique user_id index. Fail closed rather than invent an identity.
  if (!winnerByUser) {
    return provisioningConflict(ClientOtpVerifyFailureClassification.IDENTITY_CONFLICT);
  }

  // Same rules as the first-pass path: adopt a null phone under compare-and-set,
  // stamp a missing timestamp, deny a divergent phone or a non-active status.
  return await reconcileExistingClient(winnerByUser, authUserId, phoneE164);
}
