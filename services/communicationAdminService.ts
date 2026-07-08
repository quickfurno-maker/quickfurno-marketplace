// ============================================================================
// QuickFurno — services/communicationAdminService.ts
//
// Admin read-model services for the future Admin WhatsApp Automation Center.
// Leverages adminClient to query communication tables, returning Result<T>.
// ============================================================================

import { adminClient } from "../lib/supabase";
import { appError, fail, ok, type Result } from "../lib/errors";
import { getActiveWhatsAppProvider } from "./communicationService";
import type {
  CommunicationAutomationCatalog,
  CommunicationMessage,
  CommunicationTemplate,
  CommunicationWebhookReceipt,
} from "../lib/communication/types";
import type { WhatsAppProviderHealth } from "../lib/communication/providers/whatsappProvider";

export interface CommunicationOverview {
  totalMessages: number;
  statusBreakdown: Record<string, number>;
  queuedCount: number;
  acceptedCount: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  retryScheduledCount: number;
  deadLetterCount: number;
}

export interface AutomationActivitySummary {
  automationKey: string;
  totalTriggered: number;
  lastTriggeredAt: string | null;
  statusBreakdown: Record<string, number>;
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
    const breakdown: Record<string, number> = {
      queued: 0,
      dispatching: 0,
      accepted: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      retry_scheduled: 0,
      dead_letter: 0,
      cancelled: 0,
    };

    messages.forEach((msg) => {
      const status = msg.status || "queued";
      if (status in breakdown) {
        breakdown[status]++;
      }
    });

    const overview: CommunicationOverview = {
      totalMessages: messages.length,
      statusBreakdown: breakdown,
      queuedCount: breakdown.queued,
      acceptedCount: breakdown.accepted,
      sentCount: breakdown.sent,
      deliveredCount: breakdown.delivered,
      readCount: breakdown.read,
      failedCount: breakdown.failed,
      retryScheduledCount: breakdown.retry_scheduled,
      deadLetterCount: breakdown.dead_letter,
    };

    return ok(overview);
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
    const breakdown: Record<string, number> = {
      draft: 0,
      mock_ready: 0,
      provider_mapping_required: 0,
      provider_ready: 0,
      disabled: 0,
    };

    let activeCount = 0;
    templates.forEach((tpl) => {
      const status = tpl.readiness_status || "draft";
      if (status in breakdown) {
        breakdown[status]++;
      }
      if (tpl.is_active) {
        activeCount++;
      }
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
    const provider = getActiveWhatsAppProvider();
    const health = await provider.healthCheck();
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

    messages.forEach((msg) => {
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
