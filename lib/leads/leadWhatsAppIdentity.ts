import { hashPhoneE164, normalizePhoneE164 } from "../communication/phone";
import { isIndianLeadMobile } from "./indianMobile";

/**
 * Privacy-safe WhatsApp destination identity for a stored lead phone.
 * Indian capture numbers are stored nationally; communication identity is E.164.
 */
export function leadWhatsAppDestinationHash(phone: unknown): string | null {
  if (typeof phone !== "string") return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;

  const normalized = isIndianLeadMobile(trimmed)
    ? { ok: true as const, e164: `+91${trimmed}` }
    : normalizePhoneE164(trimmed);

  return normalized.ok ? hashPhoneE164(normalized.e164) : null;
}
