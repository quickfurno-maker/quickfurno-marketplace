// ============================================================================
// QuickFurno — lib/communication/providerMappingFingerprint.ts   (Phase 5F-B)
//
// A deterministic, NON-SECRET fingerprint of the exact dispatch-critical content of
// an approved provider template mapping.
//
// WHY: pinning `provider_template_mapping_id` + `provider_template_version` on a
// message is not sufficient. A mapping row can be edited IN PLACE while keeping the
// same id and the same version — a changed `provider_template_name`, a changed
// `variables_schema`, a changed language or provider. A restart-safe retry that
// re-resolved that row by id would then reproduce DIFFERENT content under an
// identical identity, and silently send the mutated template.
//
// So the initial send also pins a SHA-256 (lowercase hex) fingerprint of the exact
// mapping content it dispatched, and the retry recomputes it from the freshly-read
// row and compares with EXACT equality. Any drift fails closed with zero provider
// calls and no retry scheduled.
//
// The fingerprint input contains ONLY non-secret operational references: mapping id,
// template key, channel, provider key, language, version, provider template
// name/id, and the canonicalized variables schema. It never contains an access
// token, an app secret, a verify token, an OTP, a plaintext destination, or a
// rendered variable value.
// ============================================================================

import crypto from "crypto";
import { canonicalJsonStringify } from "./canonicalJson";
import type { WhatsAppResolvedTemplate } from "./whatsappTemplate";

/** Bumping this deliberately invalidates every pinned fingerprint (fails closed). */
export const MAPPING_FINGERPRINT_VERSION = 1;
export const MAPPING_FINGERPRINT_ALGORITHM = "sha256";
/** SHA-256 rendered as lowercase hex. */
export const MAPPING_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The exact, ordered set of dispatch-critical fields the fingerprint covers. Every
 * field here changes WHAT is sent or HOW it renders; anything absent here (e.g.
 * `updated_at`) must not invalidate an in-flight retry.
 */
export interface MappingFingerprintInput {
  readonly fingerprintVersion: number;
  readonly mappingId: string | null;
  readonly templateKey: string;
  readonly channel: string;
  readonly providerKey: string;
  readonly language: string;
  readonly version: string;
  readonly providerTemplateName: string;
  readonly providerTemplateId: string | null;
  readonly variablesSchema: unknown;
}

export function buildMappingFingerprintInput(
  resolved: WhatsAppResolvedTemplate
): MappingFingerprintInput {
  return {
    fingerprintVersion: MAPPING_FINGERPRINT_VERSION,
    mappingId: resolved.mappingId,
    templateKey: resolved.internalTemplateKey,
    channel: resolved.channel,
    providerKey: resolved.providerKey,
    language: resolved.language,
    version: resolved.version,
    providerTemplateName: resolved.providerTemplateName,
    providerTemplateId: resolved.providerTemplateId,
    variablesSchema: resolved.variablesSchema,
  };
}

/**
 * SHA-256 (lowercase hex) over the canonical JSON of the dispatch-critical mapping
 * content. Deterministic across processes, restarts, and jsonb key ordering.
 */
export function computeMappingFingerprint(resolved: WhatsAppResolvedTemplate): string {
  const canonical = canonicalJsonStringify(buildMappingFingerprintInput(resolved));
  return crypto.createHash(MAPPING_FINGERPRINT_ALGORITHM).update(canonical, "utf8").digest("hex");
}

/**
 * EXACT equality of two well-formed fingerprints. A missing, malformed, or
 * differently-shaped value is never a match — this is a fail-closed comparison, not
 * a lenient one. The fingerprint is not a secret, so a constant-time compare buys
 * nothing here; correctness of the refusal is what matters.
 */
export function mappingFingerprintMatches(
  pinned: string | null | undefined,
  recomputed: string | null | undefined
): boolean {
  if (typeof pinned !== "string" || typeof recomputed !== "string") return false;
  if (!MAPPING_FINGERPRINT_PATTERN.test(pinned) || !MAPPING_FINGERPRINT_PATTERN.test(recomputed)) {
    return false;
  }
  return pinned === recomputed;
}
