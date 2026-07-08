// ============================================================================
// QuickFurno — lib/communication/types.ts
//
// Canonical type definitions for the Unified Communication Core.
// Uses snake_case to align 1:1 with Supabase database columns.
// ============================================================================

export type CommunicationChannel = "whatsapp";

export type CommunicationLane = "authentication" | "business";

export type CommunicationRecipientType =
  | "client"
  | "vendor"
  | "admin"
  | "integration"
  | "system";

export type CommunicationMessageStatus =
  | "queued"
  | "dispatching"
  | "accepted"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "retry_scheduled"
  | "dead_letter"
  | "cancelled";

export type CommunicationPriority = "critical" | "high" | "normal" | "low";

/**
 * An authorized communication intent, carrying everything required to build,
 * authorize, and schedule a communication message.
 */
export interface CommunicationIntent {
  readonly type: string; // e.g. 'vendor_new_lead', 'client_login_otp'
  readonly lane: CommunicationLane;
  readonly channel: CommunicationChannel;
  readonly recipient_type: CommunicationRecipientType;
  readonly recipient_id: string | null; // client_account.id / vendor.id / user_id
  readonly destination: string; // plaintext phone number to be hashed/masked during dispatch
  readonly template_key: string;
  readonly variables: Record<string, string>;
  readonly entity_type: string | null; // e.g. 'lead', 'payment'
  readonly entity_id: string | null;
  readonly correlation_id: string | null;
  readonly idempotency_key: string; // unique key for message deduplication
  readonly priority: CommunicationPriority;
  readonly scheduled_at: string | null;
  readonly policy_decision_id: string | null; // references Phase 4 policy engine decisions
  readonly metadata: Record<string, unknown>;
}

/**
 * Communication template registry representation.
 */
export interface CommunicationTemplate {
  readonly id: string;
  readonly template_key: string;
  readonly channel: CommunicationChannel;
  readonly category: CommunicationLane;
  readonly description: string | null;
  readonly language: string;
  readonly version: string;
  readonly provider_template_name: string | null;
  readonly provider_template_id: string | null;
  readonly readiness_status: "draft" | "mock_ready" | "provider_mapping_required" | "provider_ready" | "disabled";
  readonly is_active: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * Message record representing a row in `communication_messages`.
 */
export interface CommunicationMessage {
  readonly id: string;
  readonly message_type: string;
  readonly lane: CommunicationLane;
  readonly channel: CommunicationChannel;
  readonly recipient_type: CommunicationRecipientType;
  readonly recipient_id: string | null;
  readonly destination_hash: string;
  readonly destination_masked: string;
  readonly template_key: string | null;
  readonly entity_type: string | null;
  readonly entity_id: string | null;
  readonly correlation_id: string | null;
  readonly idempotency_key: string;
  readonly policy_decision_id: string | null;
  readonly status: CommunicationMessageStatus;
  readonly priority: CommunicationPriority;
  readonly scheduled_at: string | null;
  readonly attempt_count: number;
  readonly max_attempts: number;
  readonly next_retry_at: string | null;
  readonly provider: string;
  readonly provider_message_id: string | null;
  readonly failure_code: string | null;
  readonly failure_reason_sanitized: string | null;
  readonly variables: Record<string, string>;
  readonly metadata: Record<string, unknown>;
  readonly created_at: string;
  readonly accepted_at: string | null;
  readonly sent_at: string | null;
  readonly delivered_at: string | null;
  readonly read_at: string | null;
  readonly failed_at: string | null;
  readonly updated_at: string;
}

/**
 * Delivery event trace representing a row in `communication_delivery_events`.
 */
export interface CommunicationDeliveryEvent {
  readonly id: string;
  readonly communication_message_id: string;
  readonly provider: string;
  readonly provider_event_id: string | null;
  readonly normalized_event_type: "accepted" | "sent" | "delivered" | "read" | "failed";
  readonly provider_message_id: string;
  readonly occurred_at: string;
  readonly sanitized_metadata: Record<string, unknown>;
  readonly created_at: string;
}

/**
 * Webhook receipt log representing a row in `communication_webhook_receipts`.
 */
export interface CommunicationWebhookReceipt {
  readonly id: string;
  readonly provider: string;
  readonly provider_event_id: string | null;
  readonly payload_hash: string;
  readonly signature_valid: boolean;
  readonly normalized_event_type: "accepted" | "sent" | "delivered" | "read" | "failed" | null;
  readonly processing_status: "received" | "verified" | "processed" | "duplicate" | "rejected" | "failed";
  readonly received_at: string;
  readonly processed_at: string | null;
  readonly failure_reason_sanitized: string | null;
  readonly created_at: string;
}

/**
 * Logical automation catalog representing a row in `communication_automation_catalog`.
 */
export interface CommunicationAutomationCatalog {
  readonly automation_key: string;
  readonly category: "otp" | "notification" | "alert" | "marketing" | "system";
  readonly description: string | null;
  readonly lane: CommunicationLane;
  readonly channel: CommunicationChannel;
  readonly operational_status: "enabled" | "disabled";
  readonly provider_required: string;
  readonly template_key: string | null;
  readonly is_operationally_enabled: boolean;
  readonly last_triggered_at: string | null;
  readonly last_success_at: string | null;
  readonly last_failure_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}
