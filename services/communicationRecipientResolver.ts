// ============================================================================
// QuickFurno — services/communicationRecipientResolver.ts   (server-only)
//
// Supabase-backed implementation of CommunicationRecipientResolver.
//
// Reads the destination straight from the existing QuickFurno sources of truth
// at dispatch time, so scheduled sends and retries survive a process restart
// without communication_messages ever storing a plaintext phone number.
//
//   client → public.client_accounts.phone_e164      (Phase 5A identity)
//   vendor → public.vendors.whatsapp_number ?? .phone
//   admin  → public.profiles.phone  (role = 'admin')
//
// integration / system recipients have no destination and always fail closed.
// A row whose stored number is absent or malformed also fails closed — this
// resolver NEVER substitutes a fallback number.
// ============================================================================

import { adminClient } from "../lib/supabase";
import { isMissingRelationError, type Result } from "../lib/errors";
import {
  RecipientResolutionError,
  failRecipientResolution,
  normalizeResolvedDestination,
  validateRecipientReference,
  type CommunicationRecipientResolver,
} from "../lib/communication/recipientResolver";
import type { CommunicationRecipientType } from "../lib/communication/types";

export class SupabaseCommunicationRecipientResolver implements CommunicationRecipientResolver {
  readonly resolverKey = "supabase";

  async resolveDestination(
    recipientType: CommunicationRecipientType,
    recipientId: string | null
  ): Promise<Result<string>> {
    const reference = validateRecipientReference(recipientType, recipientId);
    if (!reference.ok) return reference;
    const id = reference.data;

    try {
      switch (recipientType) {
        case "client":
          return await this.resolveClient(id);
        case "vendor":
          return await this.resolveVendor(id);
        case "admin":
          return await this.resolveAdmin(id);
        default:
          // Unreachable: validateRecipientReference already rejected these.
          return failRecipientResolution(RecipientResolutionError.RECIPIENT_TYPE_UNSUPPORTED);
      }
    } catch {
      return failRecipientResolution(RecipientResolutionError.RECIPIENT_LOOKUP_FAILED);
    }
  }

  /** Phase 5A `client_accounts.phone_e164` is already the normalized identity. */
  private async resolveClient(clientAccountId: string): Promise<Result<string>> {
    const { data, error } = await adminClient()
      .from("client_accounts")
      .select("phone_e164")
      .eq("id", clientAccountId)
      .maybeSingle();

    if (error) return failRecipientResolution(RecipientResolutionError.RECIPIENT_LOOKUP_FAILED);
    if (!data) return failRecipientResolution(RecipientResolutionError.RECIPIENT_NOT_FOUND);
    return normalizeResolvedDestination((data as { phone_e164: string | null }).phone_e164);
  }

  /**
   * Vendors keep a dedicated WhatsApp number (migration 009) and a mandatory
   * contact `phone`. Prefer the WhatsApp number; fall back to the contact phone.
   * `whatsapp_number` is read defensively so a database that predates migration
   * 009 degrades to `phone` instead of throwing.
   */
  private async resolveVendor(vendorId: string): Promise<Result<string>> {
    const withWhatsApp = await adminClient()
      .from("vendors")
      .select("whatsapp_number, phone")
      .eq("id", vendorId)
      .maybeSingle();

    let row = withWhatsApp.data as { whatsapp_number?: string | null; phone?: string | null } | null;

    if (withWhatsApp.error) {
      if (!isMissingRelationError(withWhatsApp.error)) {
        return failRecipientResolution(RecipientResolutionError.RECIPIENT_LOOKUP_FAILED);
      }
      const phoneOnly = await adminClient()
        .from("vendors")
        .select("phone")
        .eq("id", vendorId)
        .maybeSingle();
      if (phoneOnly.error) {
        return failRecipientResolution(RecipientResolutionError.RECIPIENT_LOOKUP_FAILED);
      }
      row = phoneOnly.data as { phone?: string | null } | null;
    }

    if (!row) return failRecipientResolution(RecipientResolutionError.RECIPIENT_NOT_FOUND);

    const preferred = row.whatsapp_number ?? null;
    if (preferred && preferred.trim() !== "") {
      const resolved = normalizeResolvedDestination(preferred);
      if (resolved.ok) return resolved;
      // A malformed WhatsApp number must not silently escalate to the contact
      // phone: surface the misconfiguration instead of dialling a second number.
      return resolved;
    }

    return normalizeResolvedDestination(row.phone ?? null);
  }

  /** Admin alerts route to the admin profile's phone. Non-admins never match. */
  private async resolveAdmin(profileId: string): Promise<Result<string>> {
    const { data, error } = await adminClient()
      .from("profiles")
      .select("phone")
      .eq("id", profileId)
      .eq("role", "admin")
      .maybeSingle();

    if (error) return failRecipientResolution(RecipientResolutionError.RECIPIENT_LOOKUP_FAILED);
    if (!data) return failRecipientResolution(RecipientResolutionError.RECIPIENT_NOT_FOUND);
    return normalizeResolvedDestination((data as { phone: string | null }).phone);
  }
}

// ----------------------------------------------------------------------------
// Active resolver registry — mirrors the provider registry so the dispatcher
// stays injectable/testable without importing test doubles into production code.
// ----------------------------------------------------------------------------
let activeRecipientResolver: CommunicationRecipientResolver = new SupabaseCommunicationRecipientResolver();

export function getActiveRecipientResolver(): CommunicationRecipientResolver {
  return activeRecipientResolver;
}

export function setActiveRecipientResolver(resolver: CommunicationRecipientResolver): void {
  activeRecipientResolver = resolver;
}
