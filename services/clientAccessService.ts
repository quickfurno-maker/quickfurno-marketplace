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

    if (byUser) {
      if (!byUser.id || !isClientAccountStatus(byUser.status)) {
        return provisioningConflict(ClientOtpVerifyFailureClassification.PROVISIONING_FAILED);
      }
      // Suspended/disabled → deny, never reactivate.
      if (!isActiveClientAccount(byUser.status)) {
        return provisioningConflict(ClientOtpVerifyFailureClassification.ACCOUNT_NOT_ACTIVE);
      }

      // Same user, same phone → idempotent. Preserve an existing first verification
      // timestamp; stamp one only if it is still null.
      if (byUser.phone_e164 === phoneE164) {
        if (!byUser.whatsapp_verified_at) {
          const stamped = await stampVerifiedTimestamp(byUser.id);
          return { ok: true, context: toContext(stamped ?? byUser, authUserId) };
        }
        return { ok: true, context: toContext(byUser, authUserId) };
      }

      // User row with a NULL phone → may adopt the verified phone, but only if no
      // other account owns it (already checked above: byPhone is null or ours).
      if (byUser.phone_e164 === null) {
        return await adoptPhone(byUser.id, authUserId, phoneE164);
      }

      // User row with a DIFFERENT non-null phone → never overwrite established
      // identity. Fail closed.
      return provisioningConflict(ClientOtpVerifyFailureClassification.IDENTITY_CONFLICT);
    }

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
  if (rows.length !== 1) {
    return provisioningConflict(ClientOtpVerifyFailureClassification.IDENTITY_CONFLICT);
  }
  return { ok: true, context: toContext(rows[0], authUserId) };
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
  if (!data) return provisioningConflict(ClientOtpVerifyFailureClassification.PROVISIONING_FAILED);
  return { ok: true, context: toContext(data as ClientAccountRow, authUserId) };
}

async function resolveConcurrentWinner(
  authUserId: string,
  phoneE164: string
): Promise<ClientProvisioningResult> {
  const winnerByUser = await fetchByUser(authUserId);
  const winnerByPhone = await fetchByPhone(phoneE164);

  if (winnerByPhone && winnerByPhone.user_id && winnerByPhone.user_id !== authUserId) {
    return provisioningConflict(ClientOtpVerifyFailureClassification.IDENTITY_CONFLICT);
  }
  if (winnerByUser && winnerByUser.id && isClientAccountStatus(winnerByUser.status)) {
    if (!isActiveClientAccount(winnerByUser.status)) {
      return provisioningConflict(ClientOtpVerifyFailureClassification.ACCOUNT_NOT_ACTIVE);
    }
    if (winnerByUser.phone_e164 === phoneE164 || winnerByUser.phone_e164 === null) {
      return { ok: true, context: toContext(winnerByUser, authUserId) };
    }
    return provisioningConflict(ClientOtpVerifyFailureClassification.IDENTITY_CONFLICT);
  }
  return provisioningConflict(ClientOtpVerifyFailureClassification.IDENTITY_CONFLICT);
}
