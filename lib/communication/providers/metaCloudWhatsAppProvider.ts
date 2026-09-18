// ============================================================================
// QuickFurno — lib/communication/providers/metaCloudWhatsAppProvider.ts (Phase 5F-B)
//
// Real Meta WhatsApp Cloud API adapter. SERVER-ONLY. Supports approved templates,
// conversational text/interactive/rich messages and read/typing presence. No Flows,
// no bulk/broadcast, and NO retry loop inside
// the adapter (CommunicationService owns retry). DISABLED BY DEFAULT.
//
// The provider is built from a purpose-scoped MetaProviderRuntime whose fields are
// nullable: a webhook-only provider carries only the app secret, a send provider
// carries only the outbound fields, etc. Each method FAILS CLOSED (as a preflight
// definitive_failure, or `false`) when its required field is absent.
//
// TIMEOUTS: an authentication send uses the short AUTH timeout (fits inside a
// Supabase Auth Hook window); a business send uses the BUSINESS timeout; a health
// check uses the HEALTH timeout — all enforced by AbortController at the request.
//
// OUTCOME CERTAINTY is ALWAYS present and conservative: a timeout/abort/ambiguous
// 5xx/2xx-without-id is `unknown_outcome` (never definitive), an explicit rejection
// or a preflight failure is `definitive_failure`, a proven acceptance is `accepted`.
//
// SECURITY: the access token travels only in the Authorization header; it never
// appears in a result, an error, a log, or a database field. Errors are sanitized.
// ============================================================================

import type {
  ProviderOutcomeCertainty,
  WhatsAppProvider,
  WhatsAppProviderHealth,
  WhatsAppSendResult,
  WhatsAppWebhookEvent,
  WhatsAppInteractiveMessage,
  WhatsAppMediaMessage,
  WhatsAppLocationMessage,
  WhatsAppContactMessage,
} from "./whatsappProvider";
import type { MetaProviderRuntime } from "./metaCloudWhatsAppConfig";
import {
  DEFAULT_MAX_RESPONSE_BYTES,
  effectiveRequestTimeoutMs,
  type HttpTransport,
  type HttpTransportResult,
} from "../httpTransport";
import type { ResolvedTemplateSendOptions, WhatsAppResolvedTemplate } from "../whatsappTemplate";
import { renderWhatsAppTemplateComponents, type MetaTemplateComponent } from "./whatsappTemplateBinding";
import { buildMetaInteractivePayload } from "./metaWhatsAppInteractive";
import {
  buildMetaContactPayload,
  buildMetaLocationPayload,
  buildMetaMediaPayload,
  buildMetaReadReceiptPayload,
} from "./metaWhatsAppRich";
import {
  classifyMetaWebhook,
  deriveMetaWebhookEventId,
  normalizeMetaDeliveryWebhook,
  verifyMetaWebhookSignature,
} from "./metaWhatsAppWebhook";

export const META_WHATSAPP_CLOUD_PROVIDER_KEY = "meta_whatsapp_cloud";
export const GRAPH_API_BASE_URL = "https://graph.facebook.com";

const SAFE_IDENTIFIER = /^[A-Za-z0-9_]{1,64}$/;

export function buildMetaMessagesUrl(cfg: { graphApiVersion: string; phoneNumberId: string }): string {
  return `${GRAPH_API_BASE_URL}/${cfg.graphApiVersion}/${cfg.phoneNumberId}/messages`;
}
export function buildMetaPhoneNumberUrl(cfg: { graphApiVersion: string; phoneNumberId: string }): string {
  return `${GRAPH_API_BASE_URL}/${cfg.graphApiVersion}/${cfg.phoneNumberId}?fields=id,quality_rating,name_status,code_verification_status`;
}

function toMetaRecipient(e164: string): string {
  return e164.startsWith("+") ? e164.slice(1) : e164;
}

export function buildMetaTemplatePayload(
  toE164: string,
  resolved: Pick<WhatsAppResolvedTemplate, "providerTemplateName" | "language">,
  components: readonly MetaTemplateComponent[]
): Record<string, unknown> {
  const template: Record<string, unknown> = {
    name: resolved.providerTemplateName,
    language: { code: resolved.language },
  };
  if (components.length > 0) template.components = components;
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toMetaRecipient(toE164),
    type: "template",
    template,
  };
}

export function buildMetaTextPayload(
  toE164: string,
  body: string,
  replyToProviderMessageId?: string | null,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toMetaRecipient(toE164),
    type: "text",
    text: { preview_url: false, body },
  };
  if (replyToProviderMessageId) payload.context = { message_id: replyToProviderMessageId };
  return payload;
}

function safeParseJson(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function extractMessageId(body: Record<string, unknown> | null): string | null {
  if (!body) return null;
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const id = (messages[0] as { id?: unknown })?.id;
  return typeof id === "string" && id.trim() !== "" ? id.trim() : null;
}

function classifyMetaError(status: number, body: Record<string, unknown> | null): string {
  const err = body?.error as Record<string, unknown> | undefined;
  const codeRaw = err?.code;
  const code = typeof codeRaw === "number" && Number.isFinite(codeRaw) ? String(codeRaw) : null;
  if (code) return `META_ERROR_${code}`;
  const type = typeof err?.type === "string" && SAFE_IDENTIFIER.test(err.type) ? err.type.toUpperCase() : null;
  if (type) return `META_${type}`;
  return `META_HTTP_${status}`;
}

/** Map a transport result to a send result with a conservative, ALWAYS-present certainty. */
export function interpretMetaSendResult(transport: HttpTransportResult, providerKey: string): WhatsAppSendResult {
  const base = { provider: providerKey, providerMessageId: null as string | null };

  if (transport.kind === "aborted") {
    return {
      ...base, accepted: false, normalizedStatus: "failed",
      errorCode: "META_TIMEOUT", errorMessage: "Meta request aborted by timeout; delivery outcome unknown.",
      retryable: false, outcomeCertainty: "unknown_outcome",
    };
  }
  if (transport.kind === "network_error") {
    return {
      ...base, accepted: false, normalizedStatus: "failed",
      errorCode: "META_NETWORK_ERROR", errorMessage: "Meta request failed before a response; delivery outcome unknown.",
      retryable: false, outcomeCertainty: "unknown_outcome",
    };
  }

  const { status, bodyText } = transport;
  const body = safeParseJson(bodyText);

  if (status >= 200 && status < 300) {
    const messageId = extractMessageId(body);
    if (messageId) {
      return {
        provider: providerKey, providerMessageId: messageId, accepted: true,
        normalizedStatus: "accepted", errorCode: null, errorMessage: null,
        retryable: false, outcomeCertainty: "accepted",
      };
    }
    return {
      ...base, accepted: false, normalizedStatus: "failed",
      errorCode: "META_NO_MESSAGE_ID", errorMessage: "Meta returned success without a usable message id; outcome unknown.",
      retryable: false, outcomeCertainty: "unknown_outcome",
    };
  }

  if (status >= 400 && status < 500) {
    const code = classifyMetaError(status, body);
    return {
      ...base, accepted: false, normalizedStatus: "failed",
      errorCode: code, errorMessage: `Meta rejected the request (HTTP ${status}).`,
      retryable: false, outcomeCertainty: "definitive_failure",
    };
  }

  return {
    ...base, accepted: false, normalizedStatus: "failed",
    errorCode: `META_HTTP_${status}`, errorMessage: `Meta returned an ambiguous response (HTTP ${status}); outcome unknown.`,
    retryable: false, outcomeCertainty: "unknown_outcome",
  };
}

function interpretMetaControlResult(
  transport: HttpTransportResult,
  providerKey: string,
): WhatsAppSendResult {
  const base = { provider: providerKey, providerMessageId: null as string | null };
  if (transport.kind === "aborted") {
    return { ...base, accepted: false, normalizedStatus: "failed", errorCode: "META_TIMEOUT",
      errorMessage: "Meta control request timed out; outcome unknown.", retryable: false,
      outcomeCertainty: "unknown_outcome" };
  }
  if (transport.kind === "network_error") {
    return { ...base, accepted: false, normalizedStatus: "failed", errorCode: "META_NETWORK_ERROR",
      errorMessage: "Meta control request failed before a response; outcome unknown.", retryable: false,
      outcomeCertainty: "unknown_outcome" };
  }
  const body = safeParseJson(transport.bodyText);
  if (transport.status >= 200 && transport.status < 300 && body?.success === true) {
    return { ...base, accepted: true, normalizedStatus: "read", errorCode: null, errorMessage: null,
      retryable: false, outcomeCertainty: "accepted" };
  }
  if (transport.status >= 400 && transport.status < 500) {
    return { ...base, accepted: false, normalizedStatus: "failed",
      errorCode: classifyMetaError(transport.status, body),
      errorMessage: `Meta rejected the control request (HTTP ${transport.status}).`,
      retryable: false, outcomeCertainty: "definitive_failure" };
  }
  return { ...base, accepted: false, normalizedStatus: "failed",
    errorCode: `META_HTTP_${transport.status}`,
    errorMessage: "Meta returned an ambiguous control response; outcome unknown.",
    retryable: false, outcomeCertainty: "unknown_outcome" };
}

/** A preflight definitive_failure result (config/render/usage error — no network). */
function preflightFailure(providerKey: string, code: string, message: string): WhatsAppSendResult {
  return {
    provider: providerKey, providerMessageId: null, accepted: false, normalizedStatus: "failed",
    errorCode: code, errorMessage: message, retryable: false, outcomeCertainty: "definitive_failure",
  };
}

export class MetaCloudWhatsAppProvider implements WhatsAppProvider {
  readonly providerKey = META_WHATSAPP_CLOUD_PROVIDER_KEY;
  readonly channel = "whatsapp" as const;
  readonly templateResolutionMode = "approved_provider_mapping" as const;

  constructor(
    private readonly runtime: MetaProviderRuntime,
    private readonly transport: HttpTransport
  ) {}

  /** Interface method — Meta needs a resolved descriptor, so this fails closed. */
  async sendAuthenticationMessage(): Promise<WhatsAppSendResult> {
    return preflightFailure(this.providerKey, "META_RESOLVED_TEMPLATE_REQUIRED",
      "The Meta adapter requires an approved resolved template descriptor; a bare template key is refused.");
  }
  async sendTemplateMessage(): Promise<WhatsAppSendResult> {
    return preflightFailure(this.providerKey, "META_RESOLVED_TEMPLATE_REQUIRED",
      "The Meta adapter requires an approved resolved template descriptor; a bare template key is refused.");
  }

  async sendTextMessage(
    toE164: string,
    body: string,
    options: { readonly replyToProviderMessageId?: string | null } = {},
  ): Promise<WhatsAppSendResult> {
    if (this.runtime.accessToken === null || this.runtime.phoneNumberId === null || this.runtime.graphApiVersion === null) {
      return preflightFailure(this.providerKey, "META_OUTBOUND_CONFIG_MISSING",
        "The Meta adapter is not configured for outbound sending.");
    }
    const text = typeof body === "string" ? body.trim() : "";
    if (text.length < 1 || text.length > 4096) {
      return preflightFailure(this.providerKey, "META_TEXT_BODY_INVALID",
        "The conversational text body is outside the allowed bounds.");
    }
    const replyTo = options.replyToProviderMessageId?.trim() || null;
    if (replyTo && replyTo.length > 512) {
      return preflightFailure(this.providerKey, "META_REPLY_CONTEXT_INVALID",
        "The reply context identifier is outside the allowed bounds.");
    }

    const result = await this.transport.request({
      url: buildMetaMessagesUrl({ graphApiVersion: this.runtime.graphApiVersion, phoneNumberId: this.runtime.phoneNumberId }),
      method: "POST",
      headers: { Authorization: `Bearer ${this.runtime.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildMetaTextPayload(toE164, text, replyTo)),
      timeoutMs: this.runtime.businessHttpTimeoutMs,
      maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
    });
    return interpretMetaSendResult(result, this.providerKey);
  }

  async sendInteractiveMessage(
    toE164: string,
    message: WhatsAppInteractiveMessage,
    options: { readonly replyToProviderMessageId?: string | null } = {},
  ): Promise<WhatsAppSendResult> {
    if (this.runtime.accessToken === null || this.runtime.phoneNumberId === null || this.runtime.graphApiVersion === null) {
      return preflightFailure(this.providerKey, "META_OUTBOUND_CONFIG_MISSING",
        "The Meta adapter is not configured for outbound sending.");
    }
    const heading = message.heading?.trim() ?? "";
    const body = message.body?.trim() ?? "";
    const actions = Array.isArray(message.actions) ? [...message.actions] : [];
    const menuButtonText = (message.menuButtonText ?? "View options").trim();
    const invalid = body.length < 1 || body.length > 1024 || heading.length > 60 ||
      actions.length < 1 || actions.length > 10 || menuButtonText.length < 1 || menuButtonText.length > 20 ||
      actions.some((action) => !/^[A-Za-z0-9._:-]{1,200}$/.test(action.id) ||
        action.title.trim().length < 1 || action.title.trim().length > 24 ||
        (action.description !== undefined && (action.description.trim().length < 1 || action.description.trim().length > 72)));
    if (invalid) {
      return preflightFailure(this.providerKey, "META_INTERACTIVE_INVALID",
        "The interactive conversational payload is outside the allowed bounds.");
    }
    const replyTo = options.replyToProviderMessageId?.trim() || null;
    if (replyTo && replyTo.length > 512) {
      return preflightFailure(this.providerKey, "META_REPLY_CONTEXT_INVALID",
        "The reply context identifier is outside the allowed bounds.");
    }
    const result = await this.transport.request({
      url: buildMetaMessagesUrl({ graphApiVersion: this.runtime.graphApiVersion, phoneNumberId: this.runtime.phoneNumberId }),
      method: "POST",
      headers: { Authorization: `Bearer ${this.runtime.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildMetaInteractivePayload(toE164, { ...message, heading: heading || undefined, body, actions, menuButtonText }, replyTo)),
      timeoutMs: this.runtime.businessHttpTimeoutMs,
      maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
    });
    return interpretMetaSendResult(result, this.providerKey);
  }

  async sendMediaMessage(
    toE164: string,
    message: WhatsAppMediaMessage,
    options: { readonly replyToProviderMessageId?: string | null } = {},
  ): Promise<WhatsAppSendResult> {
    if (this.runtime.accessToken === null || this.runtime.phoneNumberId === null || this.runtime.graphApiVersion === null) {
      return preflightFailure(this.providerKey, "META_OUTBOUND_CONFIG_MISSING",
        "The Meta adapter is not configured for outbound sending.");
    }
    const mediaId = message.mediaId?.trim() ?? "";
    const caption = message.caption?.trim() ?? "";
    const filename = message.filename?.trim() ?? "";
    const captionAllowed = ["image", "document", "video"].includes(message.kind);
    const invalid = !["image", "document", "audio", "video", "sticker"].includes(message.kind) ||
      !/^[A-Za-z0-9._:-]{1,256}$/.test(mediaId) ||
      caption.length > 1024 || (!captionAllowed && caption.length > 0) ||
      filename.length > 240 || (message.kind !== "document" && filename.length > 0);
    if (invalid) {
      return preflightFailure(this.providerKey, "META_MEDIA_INVALID",
        "The rich-media payload is outside the allowed bounds.");
    }
    const replyTo = options.replyToProviderMessageId?.trim() || null;
    if (replyTo && replyTo.length > 512) {
      return preflightFailure(this.providerKey, "META_REPLY_CONTEXT_INVALID",
        "The reply context identifier is outside the allowed bounds.");
    }
    const result = await this.transport.request({
      url: buildMetaMessagesUrl({ graphApiVersion: this.runtime.graphApiVersion, phoneNumberId: this.runtime.phoneNumberId }),
      method: "POST",
      headers: { Authorization: `Bearer ${this.runtime.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildMetaMediaPayload(toE164, {
        kind: message.kind,
        mediaId,
        ...(caption ? { caption } : {}),
        ...(filename ? { filename } : {}),
      }, replyTo)),
      timeoutMs: this.runtime.businessHttpTimeoutMs,
      maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
    });
    return interpretMetaSendResult(result, this.providerKey);
  }

  async sendLocationMessage(
    toE164: string,
    message: WhatsAppLocationMessage,
    options: { readonly replyToProviderMessageId?: string | null } = {},
  ): Promise<WhatsAppSendResult> {
    if (this.runtime.accessToken === null || this.runtime.phoneNumberId === null || this.runtime.graphApiVersion === null) {
      return preflightFailure(this.providerKey, "META_OUTBOUND_CONFIG_MISSING",
        "The Meta adapter is not configured for outbound sending.");
    }
    const name = message.name?.trim() ?? "";
    const address = message.address?.trim() ?? "";
    const invalid = !Number.isFinite(message.latitude) || message.latitude < -90 || message.latitude > 90 ||
      !Number.isFinite(message.longitude) || message.longitude < -180 || message.longitude > 180 ||
      name.length > 1000 || address.length > 1000;
    if (invalid) return preflightFailure(this.providerKey, "META_LOCATION_INVALID", "The location payload is invalid.");
    const replyTo = options.replyToProviderMessageId?.trim() || null;
    if (replyTo && replyTo.length > 512) {
      return preflightFailure(this.providerKey, "META_REPLY_CONTEXT_INVALID",
        "The reply context identifier is outside the allowed bounds.");
    }
    const result = await this.transport.request({
      url: buildMetaMessagesUrl({ graphApiVersion: this.runtime.graphApiVersion, phoneNumberId: this.runtime.phoneNumberId }),
      method: "POST",
      headers: { Authorization: `Bearer ${this.runtime.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildMetaLocationPayload(toE164, {
        latitude: message.latitude, longitude: message.longitude,
        ...(name ? { name } : {}), ...(address ? { address } : {}),
      }, replyTo)),
      timeoutMs: this.runtime.businessHttpTimeoutMs,
      maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
    });
    return interpretMetaSendResult(result, this.providerKey);
  }

  async sendContactMessage(
    toE164: string,
    message: WhatsAppContactMessage,
    options: { readonly replyToProviderMessageId?: string | null } = {},
  ): Promise<WhatsAppSendResult> {
    if (this.runtime.accessToken === null || this.runtime.phoneNumberId === null || this.runtime.graphApiVersion === null) {
      return preflightFailure(this.providerKey, "META_OUTBOUND_CONFIG_MISSING",
        "The Meta adapter is not configured for outbound sending.");
    }
    const formattedName = message.formattedName?.trim() ?? "";
    const firstName = message.firstName?.trim() ?? "";
    const lastName = message.lastName?.trim() ?? "";
    const phones = Array.isArray(message.phones) ? [...message.phones] : [];
    const invalid = formattedName.length < 1 || formattedName.length > 256 ||
      firstName.length > 128 || lastName.length > 128 || phones.length < 1 || phones.length > 10 ||
      phones.some((entry) => !/^\+[1-9]\d{7,14}$/.test(entry.phone) ||
        (entry.type !== undefined && !["CELL", "WORK", "HOME"].includes(entry.type)));
    if (invalid) return preflightFailure(this.providerKey, "META_CONTACT_INVALID", "The contact payload is invalid.");
    const replyTo = options.replyToProviderMessageId?.trim() || null;
    if (replyTo && replyTo.length > 512) {
      return preflightFailure(this.providerKey, "META_REPLY_CONTEXT_INVALID",
        "The reply context identifier is outside the allowed bounds.");
    }
    const result = await this.transport.request({
      url: buildMetaMessagesUrl({ graphApiVersion: this.runtime.graphApiVersion, phoneNumberId: this.runtime.phoneNumberId }),
      method: "POST",
      headers: { Authorization: `Bearer ${this.runtime.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildMetaContactPayload(toE164, {
        formattedName, ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}), phones,
      }, replyTo)),
      timeoutMs: this.runtime.businessHttpTimeoutMs,
      maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
    });
    return interpretMetaSendResult(result, this.providerKey);
  }

  private async sendReadControl(providerMessageId: string, typing: boolean): Promise<WhatsAppSendResult> {
    if (this.runtime.accessToken === null || this.runtime.phoneNumberId === null || this.runtime.graphApiVersion === null) {
      return preflightFailure(this.providerKey, "META_OUTBOUND_CONFIG_MISSING",
        "The Meta adapter is not configured for provider acknowledgements.");
    }
    const id = providerMessageId?.trim() ?? "";
    if (id.length < 1 || id.length > 512) {
      return preflightFailure(this.providerKey, "META_INBOUND_MESSAGE_ID_INVALID",
        "The inbound provider message id is outside the allowed bounds.");
    }
    const result = await this.transport.request({
      url: buildMetaMessagesUrl({ graphApiVersion: this.runtime.graphApiVersion, phoneNumberId: this.runtime.phoneNumberId }),
      method: typing ? "POST" : "PUT",
      headers: { Authorization: `Bearer ${this.runtime.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildMetaReadReceiptPayload(id, typing)),
      timeoutMs: this.runtime.businessHttpTimeoutMs,
      maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
    });
    return interpretMetaControlResult(result, this.providerKey);
  }

  async markInboundRead(providerMessageId: string): Promise<WhatsAppSendResult> {
    return this.sendReadControl(providerMessageId, false);
  }

  async markInboundReadWithTyping(providerMessageId: string): Promise<WhatsAppSendResult> {
    return this.sendReadControl(providerMessageId, true);
  }

  /**
   * The real Meta template send. Renders components strictly from the binding schema
   * (render failure → no network call), then posts through the abortable transport
   * with the lane-appropriate timeout (authentication uses the short AUTH timeout).
   *
   * `options.maxNetworkTimeoutMs` is an optional CEILING supplied by an enclosing
   * request deadline (the Supabase Auth Hook budget). It can only SHORTEN the
   * configured lane timeout, never extend it, and the shortened value still drives the
   * AbortController — the actual request is cancelled, never merely abandoned.
   */
  async sendResolvedTemplate(
    toE164: string,
    resolved: WhatsAppResolvedTemplate,
    sourceVariables: Record<string, string>,
    options: ResolvedTemplateSendOptions = {}
  ): Promise<WhatsAppSendResult> {
    if (this.runtime.accessToken === null || this.runtime.phoneNumberId === null || this.runtime.graphApiVersion === null) {
      return preflightFailure(this.providerKey, "META_OUTBOUND_CONFIG_MISSING",
        "The Meta adapter is not configured for outbound sending.");
    }
    const rendered = renderWhatsAppTemplateComponents(resolved.variablesSchema, sourceVariables);
    if (!rendered.ok) {
      return preflightFailure(this.providerKey, `META_TEMPLATE_RENDER_${rendered.reason.toUpperCase()}`,
        "The template could not be rendered from its binding schema; no request was sent.");
    }

    const configuredMs = options.lane === "authentication" ? this.runtime.authHttpTimeoutMs : this.runtime.businessHttpTimeoutMs;
    const timeoutMs = effectiveRequestTimeoutMs(configuredMs, options.maxNetworkTimeoutMs);
    const payload = buildMetaTemplatePayload(toE164, resolved, rendered.components);
    const result = await this.transport.request({
      url: buildMetaMessagesUrl({ graphApiVersion: this.runtime.graphApiVersion, phoneNumberId: this.runtime.phoneNumberId }),
      method: "POST",
      headers: { Authorization: `Bearer ${this.runtime.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      timeoutMs,
      maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
    });
    return interpretMetaSendResult(result, this.providerKey);
  }

  verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
    const appSecret = secret || this.runtime.appSecret;
    if (!appSecret) return false; // fail closed when no signing secret is configured
    return verifyMetaWebhookSignature(rawBody, signature, appSecret);
  }

  deriveWebhookEventId(payload: Record<string, unknown>): string {
    return deriveMetaWebhookEventId(payload);
  }
  normalizeWebhook(payload: Record<string, unknown>): WhatsAppWebhookEvent[] {
    return normalizeMetaDeliveryWebhook(payload);
  }
  classifyWebhook(payload: unknown): ReturnType<typeof classifyMetaWebhook> {
    return classifyMetaWebhook(payload);
  }

  async healthCheck(): Promise<WhatsAppProviderHealth> {
    const checkedAt = new Date().toISOString();
    if (this.runtime.accessToken === null || this.runtime.phoneNumberId === null || this.runtime.graphApiVersion === null) {
      return {
        provider: this.providerKey, configured: false, reachable: false, status: "unhealthy",
        checkedAt, latencyMs: null, detailsSanitized: { outcome: "not_configured" },
      };
    }
    const started = Date.now();
    const result = await this.transport.request({
      url: buildMetaPhoneNumberUrl({ graphApiVersion: this.runtime.graphApiVersion, phoneNumberId: this.runtime.phoneNumberId }),
      method: "GET",
      headers: { Authorization: `Bearer ${this.runtime.accessToken}` },
      timeoutMs: this.runtime.healthHttpTimeoutMs,
      maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
    });
    const latencyMs = Date.now() - started;

    if (result.kind !== "response") {
      return {
        provider: this.providerKey, configured: true, reachable: false, status: "unhealthy",
        checkedAt, latencyMs, detailsSanitized: { outcome: result.kind === "aborted" ? "timeout" : "network_error" },
      };
    }
    const body = safeParseJson(result.bodyText);
    const reachable = result.status >= 200 && result.status < 500;
    const healthy = result.status >= 200 && result.status < 300;
    const returnedId = body ? (body.id as unknown) : null;
    const phoneNumberIdMatches = typeof returnedId === "string" && returnedId === this.runtime.phoneNumberId;
    const quality = body && typeof body.quality_rating === "string" && SAFE_IDENTIFIER.test(body.quality_rating) ? body.quality_rating : null;
    return {
      provider: this.providerKey, configured: true, reachable, status: healthy ? "healthy" : "unhealthy",
      checkedAt, latencyMs,
      detailsSanitized: { httpStatus: result.status, phoneNumberIdMatches, qualityRatingSanitized: quality, channel: this.channel },
    };
  }

  static certaintyOf(result: WhatsAppSendResult): ProviderOutcomeCertainty {
    // Never inferred from result.accepted: a missing/invalid certainty is unknown.
    return result.outcomeCertainty ?? "unknown_outcome";
  }
}
