// ============================================================================
// QuickFurno — services/communicationAdminService.ts   (server-only)
//
// Admin read-model services for the future Admin → WhatsApp Automation Center.
// Leverages adminClient to query communication tables, returning Result<T>.
//
// READ-ONLY BY CONSTRUCTION. Nothing here enables an automation, dispatches a
// message, or mutates the ledger. The Automation Center will render these
// projections; turning an automation on is a separate, authorized write, and it
// never bypasses Phase 4 authorization at dispatch time.
//
// The projections deliberately cover every state the Center must show:
// automation readiness, operational enablement, provider health, template
// readiness, queued, retry scheduled, failed, dead letter, and webhook
// processing state.
// ============================================================================

import { adminClient } from "../lib/supabase";
import { fail, ok, type Result } from "../lib/errors";
import { resolveRuntimeWhatsAppProvider } from "./runtimeCommunicationService";
import {
  COMMUNICATION_AUTOMATION_READINESS_STATES,
  isAutomationDispatchable,
  type CommunicationAutomationCatalog,
  type CommunicationAutomationReadiness,
  type CommunicationMessage,
  type CommunicationTemplate,
  type CommunicationWebhookProcessingStatus,
  type CommunicationWebhookReceipt,
} from "../lib/communication/types";
import type { WhatsAppProviderHealth } from "../lib/communication/providers/whatsappProvider";

export interface CommunicationOverview {
  totalMessages: number;
  statusBreakdown: Record<string, number>;
  queuedCount: number;
  dispatchingCount: number;
  acceptedCount: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  retryScheduledCount: number;
  deadLetterCount: number;
  cancelledCount: number;
}

export interface AutomationActivitySummary {
  automationKey: string;
  totalTriggered: number;
  lastTriggeredAt: string | null;
  statusBreakdown: Record<string, number>;
}

/**
 * Readiness (how far it is BUILT) reported separately from operational
 * enablement (whether an operator TURNED IT ON). Phase 5B ships every
 * automation as `wiring_pending` + disabled, so the Center can never present an
 * unwired workflow as live.
 */
export interface AutomationReadinessSummary {
  totalAutomations: number;
  readinessBreakdown: Record<CommunicationAutomationReadiness, number>;
  operationallyEnabledCount: number;
  /** Both `active` AND enabled. Still subject to Phase 4 authorization. */
  dispatchableCount: number;
  automations: CommunicationAutomationCatalog[];
}

export interface WebhookProcessingSummary {
  totalReceipts: number;
  processingBreakdown: Record<CommunicationWebhookProcessingStatus, number>;
  invalidSignatureCount: number;
  duplicateRedeliveryCount: number;
  lastReceivedAt: string | null;
}

const MESSAGE_STATUS_KEYS = [
  "queued",
  "dispatching",
  "accepted",
  "sent",
  "delivered",
  "read",
  "failed",
  "retry_scheduled",
  "dead_letter",
  "cancelled",
] as const;

const WEBHOOK_PROCESSING_KEYS: readonly CommunicationWebhookProcessingStatus[] = [
  "received",
  "verified",
  "processed",
  "duplicate",
  "rejected",
  "failed",
];

function emptyCounts<K extends string>(keys: readonly K[]): Record<K, number> {
  return keys.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {} as Record<K, number>);
}

/**
 * Returns aggregated stats for all messages in the communication ledger.
 */
export async function getCommunicationOverview(): Promise<Result<CommunicationOverview>> {
  try {
    const { data, error } = await adminClient()
      .from("communication_messages")
      .select("status");

    if (error) throw error;

    const messages = data || [];
    const breakdown = emptyCounts(MESSAGE_STATUS_KEYS);

    messages.forEach((msg) => {
      const status = (msg.status || "queued") as (typeof MESSAGE_STATUS_KEYS)[number];
      if (status in breakdown) breakdown[status]++;
    });

    return ok({
      totalMessages: messages.length,
      statusBreakdown: breakdown,
      queuedCount: breakdown.queued,
      dispatchingCount: breakdown.dispatching,
      acceptedCount: breakdown.accepted,
      sentCount: breakdown.sent,
      deliveredCount: breakdown.delivered,
      readCount: breakdown.read,
      failedCount: breakdown.failed,
      retryScheduledCount: breakdown.retry_scheduled,
      deadLetterCount: breakdown.dead_letter,
      cancelledCount: breakdown.cancelled,
    });
  } catch (e) {
    return fail(e);
  }
}

/**
 * Retrieves the logical list of automations configured in the catalog.
 */
export async function listCommunicationAutomations(): Promise<Result<CommunicationAutomationCatalog[]>> {
  try {
    const { data, error } = await adminClient()
      .from("communication_automation_catalog")
      .select("*")
      .order("automation_key", { ascending: true });

    if (error) throw error;
    return ok((data || []) as CommunicationAutomationCatalog[]);
  } catch (e) {
    return fail(e);
  }
}

/**
 * Automation readiness vs operational enablement, kept strictly distinct so the
 * Automation Center never renders "foundation exists" as "workflow is live".
 */
export async function getAutomationReadinessSummary(): Promise<Result<AutomationReadinessSummary>> {
  try {
    const { data, error } = await adminClient()
      .from("communication_automation_catalog")
      .select("*")
      .order("automation_key", { ascending: true });

    if (error) throw error;

    const automations = (data || []) as CommunicationAutomationCatalog[];
    const readinessBreakdown = emptyCounts(COMMUNICATION_AUTOMATION_READINESS_STATES);

    let operationallyEnabledCount = 0;
    let dispatchableCount = 0;

    automations.forEach((automation) => {
      const readiness = automation.readiness_status;
      if (readiness in readinessBreakdown) readinessBreakdown[readiness]++;
      if (automation.is_operationally_enabled) operationallyEnabledCount++;
      if (isAutomationDispatchable(automation)) dispatchableCount++;
    });

    return ok({
      totalAutomations: automations.length,
      readinessBreakdown,
      operationallyEnabledCount,
      dispatchableCount,
      automations,
    });
  } catch (e) {
    return fail(e);
  }
}

/**
 * Retrieves recent messages dispatched or queued in the ledger.
 */
export async function listRecentCommunicationMessages(limit = 50): Promise<Result<CommunicationMessage[]>> {
  try {
    const { data, error } = await adminClient()
      .from("communication_messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return ok((data || []) as CommunicationMessage[]);
  } catch (e) {
    return fail(e);
  }
}

/** Messages waiting to be picked up (immediate or scheduled). */
export async function listQueuedCommunicationMessages(limit = 50): Promise<Result<CommunicationMessage[]>> {
  try {
    const { data, error } = await adminClient()
      .from("communication_messages")
      .select("*")
      .eq("status", "queued")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return ok((data || []) as CommunicationMessage[]);
  } catch (e) {
    return fail(e);
  }
}

/** Messages with a backoff retry pending. */
export async function listRetryScheduledMessages(limit = 50): Promise<Result<CommunicationMessage[]>> {
  try {
    const { data, error } = await adminClient()
      .from("communication_messages")
      .select("*")
      .eq("status", "retry_scheduled")
      .order("next_retry_at", { ascending: true })
      .limit(limit);

    if (error) throw error;
    return ok((data || []) as CommunicationMessage[]);
  } catch (e) {
    return fail(e);
  }
}

/**
 * Retrieves failed messages (either failed or dead_letter status).
 */
export async function listFailedCommunicationMessages(limit = 50): Promise<Result<CommunicationMessage[]>> {
  try {
    const { data, error } = await adminClient()
      .from("communication_messages")
      .select("*")
      .in("status", ["failed", "dead_letter"])
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return ok((data || []) as CommunicationMessage[]);
  } catch (e) {
    return fail(e);
  }
}

/**
 * Retrieves dead letter messages specifically.
 */
export async function listDeadLetterMessages(limit = 50): Promise<Result<CommunicationMessage[]>> {
  try {
    const { data, error } = await adminClient()
      .from("communication_messages")
      .select("*")
      .eq("status", "dead_letter")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return ok((data || []) as CommunicationMessage[]);
  } catch (e) {
    return fail(e);
  }
}

/**
 * Retrieves recent webhook receipts log.
 */
export async function listWebhookReceipts(limit = 50): Promise<Result<CommunicationWebhookReceipt[]>> {
  try {
    const { data, error } = await adminClient()
      .from("communication_webhook_receipts")
      .select("*")
      .order("received_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return ok((data || []) as CommunicationWebhookReceipt[]);
  } catch (e) {
    return fail(e);
  }
}

/**
 * Webhook processing health: how many payloads were verified, processed,
 * rejected, or arrived as redeliveries of an already-recorded receipt.
 */
export async function getWebhookProcessingSummary(): Promise<Result<WebhookProcessingSummary>> {
  try {
    const { data, error } = await adminClient()
      .from("communication_webhook_receipts")
      .select("*");

    if (error) throw error;

    const receipts = (data || []) as CommunicationWebhookReceipt[];
    const processingBreakdown = emptyCounts(WEBHOOK_PROCESSING_KEYS);

    let invalidSignatureCount = 0;
    let duplicateRedeliveryCount = 0;
    let lastReceivedAt: string | null = null;

    receipts.forEach((receipt) => {
      const status = receipt.processing_status;
      if (status in processingBreakdown) processingBreakdown[status]++;
      if (!receipt.signature_valid) invalidSignatureCount++;
      duplicateRedeliveryCount += receipt.duplicate_count ?? 0;
      if (
        receipt.received_at &&
        (!lastReceivedAt || new Date(receipt.received_at) > new Date(lastReceivedAt))
      ) {
        lastReceivedAt = receipt.received_at;
      }
    });

    return ok({
      totalReceipts: receipts.length,
      processingBreakdown,
      invalidSignatureCount,
      duplicateRedeliveryCount,
      lastReceivedAt,
    });
  } catch (e) {
    return fail(e);
  }
}

/**
 * Retrieves a summary of registered templates and their readiness counts.
 */
export async function getTemplateReadinessSummary(): Promise<Result<{
  totalTemplates: number;
  readinessBreakdown: Record<string, number>;
  activeCount: number;
  templates: CommunicationTemplate[];
}>> {
  try {
    const { data, error } = await adminClient()
      .from("communication_templates")
      .select("*")
      .order("template_key", { ascending: true });

    if (error) throw error;

    const templates = (data || []) as CommunicationTemplate[];
    const breakdown = emptyCounts([
      "draft",
      "mock_ready",
      "provider_mapping_required",
      "provider_ready",
      "disabled",
    ] as const);

    let activeCount = 0;
    templates.forEach((tpl) => {
      const status = tpl.readiness_status || "draft";
      if (status in breakdown) breakdown[status]++;
      if (tpl.is_active) activeCount++;
    });

    return ok({
      totalTemplates: templates.length,
      readinessBreakdown: breakdown,
      activeCount,
      templates,
    });
  } catch (e) {
    return fail(e);
  }
}

/**
 * Performs provider check to evaluate configurations and latency.
 */
export async function getProviderHealthSummary(): Promise<Result<WhatsAppProviderHealth>> {
  try {
    // Report the health of the RUNTIME-selected adapter, failing closed when the
    // provider cannot be resolved (never silently reporting mock health for Meta).
    const provider = resolveRuntimeWhatsAppProvider();
    if (!provider.ok) return provider;
    const health = await provider.data.healthCheck();
    return ok(health);
  } catch (e) {
    return fail(e);
  }
}

/**
 * Retrieves statistics about automation activity, grouping message counts per automation key.
 */
export async function getAutomationActivitySummary(): Promise<Result<AutomationActivitySummary[]>> {
  try {
    const { data: messages, error: msgError } = await adminClient()
      .from("communication_messages")
      .select("message_type, status, created_at");

    if (msgError) throw msgError;

    const { data: catalog, error: catError } = await adminClient()
      .from("communication_automation_catalog")
      .select("automation_key");

    if (catError) throw catError;

    const keys = (catalog || []).map((c) => c.automation_key);
    const activityMap: Record<string, AutomationActivitySummary> = {};

    keys.forEach((key) => {
      activityMap[key] = {
        automationKey: key,
        totalTriggered: 0,
        lastTriggeredAt: null,
        statusBreakdown: {},
      };
    });

    (messages || []).forEach((msg) => {
      const key = msg.message_type;
      if (activityMap[key]) {
        activityMap[key].totalTriggered++;
        const createdAt = msg.created_at;
        if (!activityMap[key].lastTriggeredAt || new Date(createdAt) > new Date(activityMap[key].lastTriggeredAt!)) {
          activityMap[key].lastTriggeredAt = createdAt;
        }
        const status = msg.status || "queued";
        if (!activityMap[key].statusBreakdown[status]) {
          activityMap[key].statusBreakdown[status] = 0;
        }
        activityMap[key].statusBreakdown[status]++;
      }
    });

    return ok(Object.values(activityMap));
  } catch (e) {
    return fail(e);
  }
}
