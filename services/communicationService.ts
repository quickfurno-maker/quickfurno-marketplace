// ============================================================================
// QuickFurno — services/communicationService.ts
//
// Core Communication Service implementing the Unified Communication Core logic.
// Enforces lane rules, security sanitization, safe status transitions, retries,
// and webhook processing.
// ============================================================================

import crypto from "crypto";
import { adminClient } from "../lib/supabase";
import { AppError, appError, fail, ok, type Result } from "../lib/errors";
import {
  isForbiddenSecurityMetadataKey,
  containsForbiddenSecurityKey,
  sanitizeAuthSecurityMetadata,
} from "../lib/identity/authSecurityEvent";
import type {
  CommunicationIntent,
  CommunicationMessage,
  CommunicationMessageStatus,
} from "../lib/communication/types";
import type {
  WhatsAppProvider,
  WhatsAppSendResult,
  WhatsAppWebhookEvent,
} from "../lib/communication/providers/whatsappProvider";
import { MockWhatsAppProvider } from "../lib/communication/providers/mockWhatsAppProvider";

// Global provider registry for unified provider-neutral switching
let activeWhatsAppProvider: WhatsAppProvider = new MockWhatsAppProvider();

export function getActiveWhatsAppProvider(): WhatsAppProvider {
  return activeWhatsAppProvider;
}

export function setActiveWhatsAppProvider(provider: WhatsAppProvider): void {
  activeWhatsAppProvider = provider;
}

// Immutable safe transition map
const ALLOWED_TRANSITIONS: Record<CommunicationMessageStatus, CommunicationMessageStatus[]> = {
  queued: ["dispatching", "failed", "cancelled"],
  dispatching: ["accepted", "failed", "retry_scheduled", "dead_letter"],
  accepted: ["sent", "delivered", "read", "failed"],
  sent: ["delivered", "read", "failed"],
  delivered: ["read", "failed"],
  read: [],
  failed: ["retry_scheduled", "dead_letter", "cancelled"],
  retry_scheduled: ["dispatching", "dead_letter", "cancelled"],
  dead_letter: [],
  cancelled: [],
};

/**
 * Pure transition validator to prevent invalid backwards status regressions.
 */
export function isValidTransition(
  from: CommunicationMessageStatus,
  to: CommunicationMessageStatus
): boolean {
  if (from === to) return true;
  const allowed = ALLOWED_TRANSITIONS[from] || [];
  return allowed.includes(to);
}

/**
 * Normalized E.164 phone hashing helper.
 */
export function hashDestination(destination: string): string {
  const cleaned = destination.trim();
  return crypto.createHash("sha256").update(cleaned).digest("hex");
}

/**
 * Normalized destination masking helper.
 */
export function maskDestination(destination: string): string {
  const cleaned = destination.replace(/\D/g, "");
  if (cleaned.length <= 4) return "****";
  const last4 = cleaned.slice(-4);
  const countryCodeLength = cleaned.length - 10;
  const prefix = countryCodeLength > 0 ? "+" + cleaned.slice(0, countryCodeLength) : "";
  return `${prefix}******${last4}`;
}

export class CommunicationService {
  private provider: WhatsAppProvider;

  constructor(provider: WhatsAppProvider = getActiveWhatsAppProvider()) {
    this.provider = provider;
  }

  /**
   * Dispatches an authorized CommunicationIntent.
   */
  async send(intent: CommunicationIntent): Promise<Result<CommunicationMessage>> {
    try {
      // 1. Validate intent parameters
      if (!intent.idempotency_key || !intent.destination || !intent.template_key) {
        throw appError("VALIDATION");
      }

      // 2. Enforce idempotency - check for existing message
      const existing = await this.getMessageByIdempotencyKey(intent.idempotency_key);
      if (existing) {
        return ok(existing);
      }

      // 3. Verify template exists and is active
      const template = await this.getTemplate(intent.template_key);
      if (!template || !template.is_active) {
        return fail(new AppError("TEMPLATE_NOT_FOUND_OR_INACTIVE", "TEMPLATE_NOT_FOUND_OR_INACTIVE"));
      }

      // Templates category must match the lane category
      if (template.category !== intent.lane) {
        return fail(new AppError("TEMPLATE_LANE_MISMATCH", "TEMPLATE_LANE_MISMATCH"));
      }

      if (
        template.readiness_status === "draft" ||
        template.readiness_status === "disabled"
      ) {
        return fail(new AppError("TEMPLATE_NOT_READY", "TEMPLATE_NOT_READY"));
      }

      // 4. Sanitize variables and metadata. Drop any keys matching forbidden security patterns.
      const sanitizedVariables = this.sanitizeVariables(intent.variables);
      const sanitizedMetadata = sanitizeAuthSecurityMetadata(intent.metadata);

      // Plaintext OTP values are forbidden in both variables and metadata persistence
      if (intent.lane === "authentication") {
        if (
          containsForbiddenSecurityKey(intent.variables) ||
          containsForbiddenSecurityKey(intent.metadata)
        ) {
          // Continue, but variables/metadata saved to DB will be sanitized/redacted
        }
      }

      // 5. Hash & mask destination
      const destHash = hashDestination(intent.destination);
      const destMasked = maskDestination(intent.destination);

      // For DB storage:
      // - authentication lane: DO NOT persist OTP-bearing variables at all
      const dbVariables = intent.lane === "authentication" ? {} : sanitizedVariables;

      // 6. Insert new ledger row in communication_messages (status = 'queued')
      const { data: dbMsg, error: insertError } = await adminClient()
        .from("communication_messages")
        .insert({
          message_type: intent.type,
          lane: intent.lane,
          channel: intent.channel,
          recipient_type: intent.recipient_type,
          recipient_id: intent.recipient_id,
          destination_hash: destHash,
          destination_masked: destMasked,
          template_key: intent.template_key,
          entity_type: intent.entity_type,
          entity_id: intent.entity_id,
          correlation_id: intent.correlation_id,
          idempotency_key: intent.idempotency_key,
          policy_decision_id: intent.policy_decision_id,
          status: "queued",
          priority: intent.priority,
          scheduled_at: intent.scheduled_at,
          attempt_count: 0,
          max_attempts: intent.lane === "authentication" ? 1 : 5, // No retries for Auth OTP
          provider: "mock",
          variables: dbVariables,
          metadata: sanitizedMetadata,
        })
        .select("*")
        .single();

      if (insertError) throw insertError;

      // 7. Dispatching
      let message = dbMsg as CommunicationMessage;
      
      // If intent specifies scheduled_at in the future, keep it queued
      if (intent.scheduled_at && new Date(intent.scheduled_at) > new Date()) {
        return ok(message);
      }

      return this.dispatchMessage(message, intent.destination, intent.variables, template.provider_template_name);
    } catch (e) {
      return fail(e);
    }
  }

  /**
   * Dispatcher for execution. Made public to enable direct worker retries and tests.
   */
  async dispatchMessage(
    message: CommunicationMessage,
    destination: string,
    rawVariables: Record<string, string>,
    providerTemplateName?: string
  ): Promise<Result<CommunicationMessage>> {
    // Transition to 'dispatching'
    const transitionOk = await this.updateMessageState(message.id, message.status, "dispatching");
    if (!transitionOk) {
      return fail(new Error("INVALID_STATE_TRANSITION"));
    }

    const currentAttempt = message.attempt_count + 1;
    const providerTemplate = providerTemplateName || message.template_key || "";

    let result: WhatsAppSendResult;

    if (message.lane === "authentication") {
      // Sync dispatch, bypass policy engine. Pass raw (sensitive) variables to provider call.
      result = await this.provider.sendAuthenticationMessage(
        destination,
        providerTemplate,
        rawVariables
      );
    } else {
      // Business dispatch, sanitized variables passed.
      const sanitizedVariables = this.sanitizeVariables(rawVariables);
      result = await this.provider.sendTemplateMessage(
        destination,
        providerTemplate,
        sanitizedVariables
      );
    }

    if (result.accepted) {
      // Success update
      const { data: updatedMsg } = await adminClient()
        .from("communication_messages")
        .update({
          status: "accepted",
          provider_message_id: result.providerMessageId,
          attempt_count: currentAttempt,
          accepted_at: new Date().toISOString(),
          sent_at: new Date().toISOString(), // Mock provider maps accepted directly to sent
          updated_at: new Date().toISOString(),
        })
        .eq("id", message.id)
        .select("*")
        .single();

      return ok(updatedMsg as CommunicationMessage);
    } else {
      // Failure update.
      const isRetryable = result.retryable && currentAttempt < message.max_attempts && message.lane !== "authentication";

      if (isRetryable) {
        // Schedule retry with exponential backoff (e.g., attempt * 10 seconds)
        const nextRetrySeconds = currentAttempt * 10;
        const nextRetryAt = new Date(Date.now() + nextRetrySeconds * 1000).toISOString();

        const { data: updatedMsg } = await adminClient()
          .from("communication_messages")
          .update({
            status: "retry_scheduled",
            attempt_count: currentAttempt,
            next_retry_at: nextRetryAt,
            failure_code: result.errorCode,
            failure_reason_sanitized: result.errorMessage,
            updated_at: new Date().toISOString(),
          })
          .eq("id", message.id)
          .select("*")
          .single();

        return ok(updatedMsg as CommunicationMessage);
      } else {
        // Permanent failure or maximum attempts exceeded
        const finalStatus = currentAttempt >= message.max_attempts ? "dead_letter" : "failed";

        const { data: updatedMsg } = await adminClient()
          .from("communication_messages")
          .update({
            status: finalStatus,
            attempt_count: currentAttempt,
            failed_at: new Date().toISOString(),
            failure_code: result.errorCode,
            failure_reason_sanitized: result.errorMessage,
            updated_at: new Date().toISOString(),
          })
          .eq("id", message.id)
          .select("*")
          .single();

        return ok(updatedMsg as CommunicationMessage);
      }
    }
  }

  /**
   * Process incoming webhook delivery reports.
   */
  async processWebhook(payload: Record<string, unknown>, signature: string, secret: string = "mock-secret"): Promise<Result<null>> {
    try {
      // 1. Verify Signature
      const signatureValid = this.provider.verifyWebhookSignature(JSON.stringify(payload), signature, secret);
      
      const providerEventId = String(payload.event_id || payload.eventId || `mock-evt-${Math.random()}`);
      const payloadString = JSON.stringify(payload);
      const payloadHash = crypto.createHash("sha256").update(payloadString).digest("hex");

      if (!signatureValid) {
        await adminClient()
          .from("communication_webhook_receipts")
          .insert({
            provider: "mock",
            provider_event_id: providerEventId,
            payload_hash: payloadHash,
            signature_valid: false,
            processing_status: "rejected",
            failure_reason_sanitized: "Invalid signature payload verification failure",
          });
        return fail(new Error("INVALID_WEBHOOK_SIGNATURE"));
      }

      // 2. Check for Duplicate Webhook Events
      const isDuplicate = await this.checkWebhookDuplicate(providerEventId, payloadHash);
      if (isDuplicate) {
        await adminClient()
          .from("communication_webhook_receipts")
          .insert({
            provider: "mock",
            provider_event_id: providerEventId,
            payload_hash: payloadHash,
            signature_valid: true,
            processing_status: "duplicate",
          });
        return ok(null); // Return success to avoid re-deliveries from provider
      }

      // Record receipt as received
      const { data: receipt } = await adminClient()
        .from("communication_webhook_receipts")
        .insert({
          provider: "mock",
          provider_event_id: providerEventId,
          payload_hash: payloadHash,
          signature_valid: true,
          processing_status: "received",
        })
        .select("*")
        .single();

      // 3. Normalize Webhook payload
      const events = this.provider.normalizeWebhook(payload);

      for (const event of events) {
        // Query message by providerMessageId
        const { data: msgData } = await adminClient()
          .from("communication_messages")
          .select("*")
          .eq("provider_message_id", event.providerMessageId)
          .single();

        if (msgData) {
          const message = msgData as CommunicationMessage;

          // Enforce state transition rules
          const transitionValid = isValidTransition(message.status, event.normalizedEventType);
          if (transitionValid) {
            // Apply transitions in DB
            const updates: Record<string, any> = {
              status: event.normalizedEventType,
              updated_at: new Date().toISOString(),
            };

            if (event.normalizedEventType === "accepted") updates.accepted_at = event.occurredAt;
            else if (event.normalizedEventType === "sent") updates.sent_at = event.occurredAt;
            else if (event.normalizedEventType === "delivered") updates.delivered_at = event.occurredAt;
            else if (event.normalizedEventType === "read") updates.read_at = event.occurredAt;
            else if (event.normalizedEventType === "failed") {
              updates.failed_at = event.occurredAt;
              updates.failure_code = String(event.sanitizedMetadata.error_code || "WEBHOOK_FAILED");
              updates.failure_reason_sanitized = String(event.sanitizedMetadata.error_message || "Webhook delivery failed");
            }

            await adminClient()
              .from("communication_messages")
              .update(updates)
              .eq("id", message.id);

            // Log immutable delivery event
            await adminClient()
              .from("communication_delivery_events")
              .insert({
                communication_message_id: message.id,
                provider: "mock",
                provider_event_id: event.providerEventId,
                normalized_event_type: event.normalizedEventType,
                provider_message_id: event.providerMessageId,
                occurred_at: event.occurredAt,
                sanitized_metadata: event.sanitizedMetadata,
              });
          }
        }
      }

      // Update receipt to processed
      await adminClient()
        .from("communication_webhook_receipts")
        .update({
          processing_status: "processed",
          processed_at: new Date().toISOString(),
          normalized_event_type: events[0]?.normalizedEventType || null,
        })
        .eq("id", receipt.id);

      return ok(null);
    } catch (e) {
      return fail(e);
    }
  }

  /**
   * Check if a webhook payload is a duplicate.
   */
  private async checkWebhookDuplicate(providerEventId: string, payloadHash: string): Promise<boolean> {
    const { count, error } = await adminClient()
      .from("communication_webhook_receipts")
      .select("id", { count: "exact", head: true })
      .or(`provider_event_id.eq.${providerEventId},payload_hash.eq.${payloadHash}`);

    if (error) return false;
    return (count ?? 0) > 0;
  }

  /**
   * State transitions helper.
   */
  private async updateMessageState(
    messageId: string,
    currentStatus: CommunicationMessageStatus,
    targetStatus: CommunicationMessageStatus
  ): Promise<boolean> {
    if (!isValidTransition(currentStatus, targetStatus)) {
      return false;
    }
    const { error } = await adminClient()
      .from("communication_messages")
      .update({ status: targetStatus, updated_at: new Date().toISOString() })
      .eq("id", messageId);

    return !error;
  }

  /**
   * Helper to retrieve message by idempotency key.
   */
  private async getMessageByIdempotencyKey(key: string): Promise<CommunicationMessage | null> {
    const { data, error } = await adminClient()
      .from("communication_messages")
      .select("*")
      .eq("idempotency_key", key)
      .maybeSingle();

    if (error || !data) return null;
    return data as CommunicationMessage;
  }

  /**
   * Template lookup.
   */
  private async getTemplate(key: string) {
    const { data, error } = await adminClient()
      .from("communication_templates")
      .select("*")
      .eq("template_key", key)
      .maybeSingle();

    if (error || !data) return null;
    return data;
  }

  /**
   * Strips plaintext variables matching secrets pattern.
   */
  private sanitizeVariables(variables: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(variables)) {
      if (isForbiddenSecurityMetadataKey(key)) {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
}
