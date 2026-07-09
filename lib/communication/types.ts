// ============================================================================
// QuickFurno — lib/communication/types.ts
//
// Canonical type definitions for the Unified Communication Core.
// Uses snake_case to align 1:1 with Supabase database columns.
// ============================================================================

/**
 * The GENERIC communication channel vocabulary (Phase 5F-A). The platform
 * FOUNDATION supports WhatsApp, SMS, and (future) RCS. Widening this type is a
 * foundation change only: in Phase 5F-A CommunicationService still dispatches
 * WhatsApp exactly as before, and no SMS/RCS send path is wired. A channel is a
 * TRANSPORT decision, never an authentication or business-authorization decision.
 *
 * NOTE: the authentication CHALLENGE delivery channel is a SEPARATE, narrower
 * Phase 5E security vocabulary (whatsapp / sms only — never RCS); see
 * `lib/identity/vendorAuthAutomation.ts#VendorAuthDeliveryChannel`.
 */
export type CommunicationChannel = "whatsapp" | "sms" | "rcs";

export const COMMUNICATION_CHANNELS: readonly CommunicationChannel[] = Object.freeze([
  "whatsapp",
  "sms",
  "rcs",
]);

export function isCommunicationChannel(value: unknown): value is CommunicationChannel {
  return typeof value === "string" && (COMMUNICATION_CHANNELS as readonly string[]).includes(value);
}

/**
 * The ONLY channel CommunicationService actually dispatches on in Phase 5F-A. SMS
 * and RCS are foundation vocabulary; their send paths are not wired until a later
 * controlled phase.
 */
export const ACTIVE_DISPATCH_CHANNEL: CommunicationChannel = "whatsapp";

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
  | "cancelled"
  // Phase 5F-B: provider acceptance could not be proven or disproven (timeout /
  // abort / ambiguous network / ambiguous 5xx / 2xx without a usable message id).
  // Never retried, never dead-lettered by elapsed time; a later verified webhook
  // reconciles it forward to sent/delivered/read/failed.
  | "outcome_unknown";

export type CommunicationPriority = "critical" | "high" | "normal" | "low";

export type CommunicationNormalizedEventType = "accepted" | "sent" | "delivered" | "read" | "failed";

export type CommunicationWebhookProcessingStatus =
  | "received"
  | "verified"
  | "processed"
  | "duplicate"
  | "rejected"
  | "failed";

export type CommunicationTemplateReadiness =
  | "draft"
  | "mock_ready"
  | "provider_mapping_required"
  | "provider_ready"
  | "disabled";

/**
 * Automation READINESS — how far an automation definition has progressed from
 * "the row exists" to "this is a live, wired workflow". Readiness is a build
 * state, deliberately separate from `is_operationally_enabled` (see below).
 *
 *   foundation_ready           — definition exists; no template mapped yet.
 *   wiring_pending             — template mapped; no code path triggers it yet.
 *   mock_ready                 — exercisable end-to-end against the mock provider.
 *   provider_mapping_required  — real provider template not yet registered.
 *   provider_ready             — real provider template registered and approved.
 *   active                     — genuinely wired and intended for live use.
 *
 * Phase 5B seeds every automation at `wiring_pending`: the core exists, but no
 * business or authentication workflow calls it yet.
 */
export type CommunicationAutomationReadiness =
  | "foundation_ready"
  | "wiring_pending"
  | "mock_ready"
  | "provider_mapping_required"
  | "provider_ready"
  | "active";

export const COMMUNICATION_AUTOMATION_READINESS_STATES: readonly CommunicationAutomationReadiness[] =
  Object.freeze([
    "foundation_ready",
    "wiring_pending",
    "mock_ready",
    "provider_mapping_required",
    "provider_ready",
    "active",
  ]);

// ----------------------------------------------------------------------------
// Destination source — a discriminated contract
// ----------------------------------------------------------------------------
/**
 * How a message learns the number to dial.
 *
 * `recipient_reference` is the default and the ONLY source permitted for
 * business communications, for scheduled sends, and for retries: the destination
 * is recovered from the durable `recipient_type` + `recipient_id` pair by a
 * CommunicationRecipientResolver, at dispatch time, which is what makes those
 * paths restart-safe.
 *
 * `ephemeral_auth_destination` exists for exactly one problem: a first-time
 * client requesting a login OTP has no `client_accounts` row yet, so there is
 * nothing to resolve. The caller supplies the number in request memory only. It
 * is tightly fenced — authentication lane only, immediate send only, never
 * schedulable, never re-dispatchable from stored state — and the plaintext never
 * touches the database: only `destination_hash` and `destination_masked` are
 * persisted, exactly as for a resolved recipient.
 */
export type CommunicationDestinationSourceKind =
  | "recipient_reference"
  | "ephemeral_auth_destination";

export interface RecipientReferenceDestinationSource {
  readonly kind: "recipient_reference";
}

export interface EphemeralAuthDestinationSource {
  readonly kind: "ephemeral_auth_destination";
  /** Plaintext, request-memory only. Normalized to E.164, hashed, then dropped. */
  readonly destination: string;
}

export type CommunicationDestinationSource =
  | RecipientReferenceDestinationSource
  | EphemeralAuthDestinationSource;

export const RECIPIENT_REFERENCE_DESTINATION: RecipientReferenceDestinationSource =
  Object.freeze({ kind: "recipient_reference" });

/** Builds the fenced first-time-OTP destination source. */
export function ephemeralAuthDestination(destination: string): EphemeralAuthDestinationSource {
  return { kind: "ephemeral_auth_destination", destination };
}

export function isEphemeralAuthDestination(
  source: CommunicationDestinationSource
): source is EphemeralAuthDestinationSource {
  return source.kind === "ephemeral_auth_destination";
}

/**
 * An authorized communication intent, carrying everything required to build,
 * authorize, and schedule a communication message.
 *
 * NOTE (Phase 5B review fix #1): an intent carries NO plaintext destination
 * field. The durable `recipient_type` + `recipient_id` pair is resolved to a
 * destination server-side, at dispatch time, by a CommunicationRecipientResolver
 * — which is what makes scheduled sends and retries restart-safe. The single,
 * tightly fenced exception is `destination_source: ephemeral_auth_destination`
 * (see {@link CommunicationDestinationSource}).
 */
export interface CommunicationIntent {
  readonly type: string; // e.g. 'vendor_new_lead', 'client_login_otp'
  readonly lane: CommunicationLane;
  readonly channel: CommunicationChannel;
  readonly recipient_type: CommunicationRecipientType;
  readonly recipient_id: string | null; // client_account.id / vendor.id / profile.id
  /** Defaults to `recipient_reference` when omitted. */
  readonly destination_source?: CommunicationDestinationSource;
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
  readonly readiness_status: CommunicationTemplateReadiness;
  readonly is_active: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * Message record representing a row in `communication_messages`.
 *
 * `destination_hash` / `destination_masked` are the ONLY destination artefacts
 * persisted. There is no plaintext destination column, by design.
 */
export interface CommunicationMessage {
  readonly id: string;
  readonly message_type: string;
  readonly lane: CommunicationLane;
  readonly channel: CommunicationChannel;
  readonly recipient_type: CommunicationRecipientType;
  readonly recipient_id: string | null;
  /** Which contract produced the destination. Audited: an OTP sent to a
   *  caller-supplied number is a security-relevant event. */
  readonly destination_source: CommunicationDestinationSourceKind;
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
 * Append-only: the table grants service_role SELECT + INSERT only.
 */
export interface CommunicationDeliveryEvent {
  readonly id: string;
  readonly communication_message_id: string;
  readonly provider: string;
  readonly provider_event_id: string | null;
  readonly normalized_event_type: CommunicationNormalizedEventType;
  readonly provider_message_id: string;
  readonly occurred_at: string;
  readonly sanitized_metadata: Record<string, unknown>;
  readonly created_at: string;
}

/**
 * Webhook receipt log representing a row in `communication_webhook_receipts`.
 *
 * Unique on (provider, provider_event_id) and on payload_hash. A redelivery
 * therefore never inserts a second row — it increments `duplicate_count` on the
 * row that already exists, which keeps admin monitoring informative without
 * fighting the constraints.
 */
export interface CommunicationWebhookReceipt {
  readonly id: string;
  readonly provider: string;
  readonly provider_event_id: string | null;
  readonly payload_hash: string;
  readonly signature_valid: boolean;
  readonly normalized_event_type: CommunicationNormalizedEventType | null;
  readonly processing_status: CommunicationWebhookProcessingStatus;
  readonly duplicate_count: number;
  readonly last_duplicate_at: string | null;
  readonly received_at: string;
  readonly processed_at: string | null;
  readonly failure_reason_sanitized: string | null;
  readonly created_at: string;
}

/**
 * Logical automation catalog representing a row in
 * `communication_automation_catalog`.
 *
 * `readiness_status` describes how far the automation has been BUILT.
 * `is_operationally_enabled` describes whether an operator has TURNED IT ON.
 * They are independent, and the database additionally forbids enabling anything
 * whose readiness is not `active`.
 *
 * Operational enablement is necessary but NEVER sufficient: every dispatch still
 * passes through Phase 4 authorization. Enabling an automation here does not,
 * and must not, bypass a policy decision.
 */
export interface CommunicationAutomationCatalog {
  readonly automation_key: string;
  readonly category: "otp" | "notification" | "alert" | "marketing" | "system";
  readonly description: string | null;
  readonly lane: CommunicationLane;
  readonly channel: CommunicationChannel;
  readonly readiness_status: CommunicationAutomationReadiness;
  readonly provider_required: string;
  readonly template_key: string | null;
  readonly is_operationally_enabled: boolean;
  readonly last_triggered_at: string | null;
  readonly last_success_at: string | null;
  readonly last_failure_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * An automation may only be dispatched when it is both fully built and switched
 * on. Callers must STILL obtain a Phase 4 policy authorization afterwards.
 */
export function isAutomationDispatchable(
  automation: Pick<CommunicationAutomationCatalog, "readiness_status" | "is_operationally_enabled">
): boolean {
  return automation.readiness_status === "active" && automation.is_operationally_enabled === true;
}
