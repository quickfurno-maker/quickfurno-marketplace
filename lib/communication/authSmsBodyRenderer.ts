// ============================================================================
// QuickFurno — lib/communication/authSmsBodyRenderer.ts   (Phase 5F-C3-C-1)
//
// The ONE reviewed source of authentication SMS BODY CONTENT. PURE.
//
// WHY THIS IS CODE, NOT SQL
//   Unlike WhatsApp/Meta — which renders an approved template PROVIDER-SIDE from named
//   variables — an SMS provider (Exotel) is handed a raw `Body` string. Something must
//   render the OTP into the approved content locally. That content is an AUTHENTICATION
//   surface: an operator who could edit the body via SQL could weaken or redirect an OTP
//   message. So the body lives in REVIEWED CODE, cross-checked against the runtime provider
//   mapping identity, and there is deliberately NO operator-editable SMS body column.
//
// PURITY CONTRACT (enforced by the C3-C-1 harness)
//   No database, no environment, no network, no clock, no randomness, no provider import,
//   no Exotel literal. Deterministic: the same input always yields the same body. The OTP
//   is accepted only in memory, never logged, never persisted, and never placed in a
//   diagnostic/return object other than inside the rendered body it belongs in.
//
// NARROW BY DESIGN
//   There is no template language, no placeholder engine, no eval, and no generic/marketing
//   rendering. Each reviewed template is a fixed function of the OTP. The registry currently
//   holds exactly the one approved authentication use case, `client_login_otp` / `en`.
//
// TEMPLATE IDENTITY CROSS-CHECK (the boundary)
//   • The RENDERER owns: the message body + the reviewed QuickFurno template key.
//   • The runtime provider MAPPING owns: the provider template name / id and approval state
//     (a readiness fact resolved by the C2 SMS runtime gate).
//   This module proves the reviewed key/language == the runtime mapping key/language and
//   that the mapping is an authentication template carrying a provider template name; it then
//   carries the mapping's provider template name/id THROUGH into the resolved descriptor. It
//   NEVER fabricates DLT approval and NEVER treats "a provider template id string exists" as
//   proof the template is approved — that remains external (DLT) and runtime (readiness).
//
// FAIL CLOSED
//   Any failure — no reviewed template, a key/language/category mismatch, an absent provider
//   template name, or a malformed OTP — returns a stable identifier-shaped code and NO body.
//   A local/preflight failure is deny-only: it never authorizes a fallback, a retry, or a
//   third attempt (the orchestrator maps it to a fallback BLOCK, before any attempt claim).
// ============================================================================

import type { ResolvedAuthenticationSms } from "./providers/smsProvider";

/** The template category an authentication body may ever render for. */
export const AUTHENTICATION_SMS_CATEGORY = "authentication";

/**
 * Supabase issues a numeric OTP. This is a defensive in-memory SHAPE check only — never a
 * value log — so a non-OTP (an error string, an empty value, a payload) can never be
 * rendered into an authentication message.
 */
export const AUTH_SMS_OTP_PATTERN = /^[0-9]{4,10}$/;

/** Stable, ledger-safe failure codes. Identifier-shaped; carry no OTP, phone, or body. */
export const AuthSmsRenderFailure = {
  /** No reviewed body exists for this (template key, language). */
  TEMPLATE_NOT_REVIEWED: "AUTH_SMS_TEMPLATE_NOT_REVIEWED",
  /** The reviewed identity disagrees with the runtime mapping identity. */
  TEMPLATE_IDENTITY_MISMATCH: "AUTH_SMS_TEMPLATE_IDENTITY_MISMATCH",
  /** The runtime mapping is not an authentication template. */
  CATEGORY_NOT_AUTHENTICATION: "AUTH_SMS_CATEGORY_NOT_AUTHENTICATION",
  /** The runtime mapping carries no approved provider template name. */
  PROVIDER_TEMPLATE_NAME_MISSING: "AUTH_SMS_PROVIDER_TEMPLATE_NAME_MISSING",
  /**
   * The runtime mapping carries no usable provider template id. The authentication resolved-send
   * path has exactly ONE template-identity authority (the mapping), so a missing id fails closed
   * — it is never substituted from account/server configuration.
   */
  PROVIDER_TEMPLATE_ID_MISSING: "AUTH_SMS_PROVIDER_TEMPLATE_ID_MISSING",
  /** The OTP is absent or not OTP-shaped. */
  OTP_INVALID: "AUTH_SMS_OTP_INVALID",
} as const;

export type AuthSmsRenderFailureCode =
  (typeof AuthSmsRenderFailure)[keyof typeof AuthSmsRenderFailure];

/** The runtime readiness facts the renderer cross-checks against — the C2 gate's projection. */
export interface AuthSmsRuntimeMappingFacts {
  readonly templateKey: string;
  readonly language: string;
  readonly providerTemplateName: string;
  readonly providerTemplateId: string | null;
  readonly providerCategory: string;
}

export interface AuthSmsRenderInput {
  /** The reviewed QuickFurno authentication template key the caller intends to render. */
  readonly reviewedTemplateKey: string;
  readonly language: string;
  /** The Supabase OTP, in request memory. Never logged, never persisted here. */
  readonly otp: string;
  /** The runtime mapping the C2 SMS runtime gate resolved for this send. */
  readonly runtimeMapping: AuthSmsRuntimeMappingFacts;
}

export type AuthSmsRenderResult =
  | { readonly ok: true; readonly resolved: ResolvedAuthenticationSms }
  | { readonly ok: false; readonly code: AuthSmsRenderFailureCode };

/** One reviewed authentication SMS template. `render` is a fixed function of the OTP. */
interface ReviewedAuthSmsTemplate {
  readonly reviewedTemplateKey: string;
  readonly language: string;
  readonly render: (otp: string) => string;
}

/**
 * The REVIEWED authentication SMS bodies. Exactly one approved use case today.
 *
 * ⚠️ PLACEHOLDER CONTENT — pending India DLT registration (Phase 5F-C3-C-3). Before any live
 * send, this body MUST be reconciled to BYTE-MATCH the DLT-registered content template that
 * the runtime mapping's `providerTemplateId` refers to. Its presence here is NOT a claim that
 * a DLT template is approved; approval is external, and readiness is a runtime fact. The
 * single OTP substitution is the only dynamic part; there is no other variable.
 */
const REVIEWED_AUTH_SMS_TEMPLATES: readonly ReviewedAuthSmsTemplate[] = Object.freeze([
  Object.freeze({
    reviewedTemplateKey: "client_login_otp",
    language: "en",
    render: (otp: string): string =>
      `${otp} is your QuickFurno verification code. It is valid for 10 minutes. Do not share it with anyone.`,
  }),
]);

function findReviewedTemplate(
  reviewedTemplateKey: string,
  language: string
): ReviewedAuthSmsTemplate | null {
  return (
    REVIEWED_AUTH_SMS_TEMPLATES.find(
      (t) => t.reviewedTemplateKey === reviewedTemplateKey && t.language === language
    ) ?? null
  );
}

/**
 * Resolve the reviewed authentication SMS content into a provider-neutral descriptor, or fail
 * closed with a stable code. PURE — see the module header.
 *
 * The returned descriptor carries the rendered body plus the runtime mapping's provider
 * template name/id (readiness facts, carried through — never validated as "approved" here).
 */
export function resolveAuthenticationSmsContent(input: AuthSmsRenderInput): AuthSmsRenderResult {
  // 1) A reviewed body must exist for this exact (key, language).
  const reviewed = findReviewedTemplate(input.reviewedTemplateKey, input.language);
  if (!reviewed) return { ok: false, code: AuthSmsRenderFailure.TEMPLATE_NOT_REVIEWED };

  // 2) The reviewed identity must equal the runtime mapping identity: a reviewed body can
  //    never be rendered for a mapping that belongs to a different template or language.
  const m = input.runtimeMapping;
  if (m.templateKey !== input.reviewedTemplateKey || m.language !== input.language) {
    return { ok: false, code: AuthSmsRenderFailure.TEMPLATE_IDENTITY_MISMATCH };
  }

  // 3) Defense in depth (the gate already checks this): an authentication OTP may only ride an
  //    authentication-category template.
  if (m.providerCategory !== AUTHENTICATION_SMS_CATEGORY) {
    return { ok: false, code: AuthSmsRenderFailure.CATEGORY_NOT_AUTHENTICATION };
  }

  // 4) The provider template name is a required readiness fact carried through to the adapter.
  if (typeof m.providerTemplateName !== "string" || m.providerTemplateName.trim() === "") {
    return { ok: false, code: AuthSmsRenderFailure.PROVIDER_TEMPLATE_NAME_MISSING };
  }

  // 5) The provider TEMPLATE ID is the SINGLE template-identity authority for this send. A
  //    missing or empty id fails closed BEFORE any attempt-2 claim or provider send — it is
  //    never invented, never read from env, and never substituted from account/server config.
  const providerTemplateId =
    typeof m.providerTemplateId === "string" ? m.providerTemplateId.trim() : "";
  if (providerTemplateId === "") {
    return { ok: false, code: AuthSmsRenderFailure.PROVIDER_TEMPLATE_ID_MISSING };
  }

  // 6) The OTP is validated in memory only — its VALUE never reaches a code, a log, or a
  //    diagnostic object. A non-OTP can never be rendered into an authentication message.
  if (typeof input.otp !== "string" || !AUTH_SMS_OTP_PATTERN.test(input.otp)) {
    return { ok: false, code: AuthSmsRenderFailure.OTP_INVALID };
  }

  // 7) Render. The OTP lives only inside the body it belongs in. `providerTemplateId` is the
  //    exact, non-empty mapping id — the one authority the adapter forwards to DLT.
  return {
    ok: true,
    resolved: {
      messageBody: reviewed.render(input.otp),
      providerTemplateName: m.providerTemplateName.trim(),
      providerTemplateId,
    },
  };
}

/** True when a reviewed authentication body exists for this (key, language). No rendering. */
export function hasReviewedAuthenticationSmsTemplate(
  reviewedTemplateKey: string,
  language: string
): boolean {
  return findReviewedTemplate(reviewedTemplateKey, language) !== null;
}
