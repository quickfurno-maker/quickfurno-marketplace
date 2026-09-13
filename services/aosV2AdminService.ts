import { adminClient } from "@/lib/supabase";
import {
  AOS_V2_AGENT_CAPABILITIES,
  AOS_V2_OPERATIONAL_AGENT_COUNT,
  AOS_V2_AGENT_COUNT,
} from "@/lib/aos/v2/agentCapabilities";
import { getAosV2RuntimeState } from "@/lib/aos/v2/runtime";
import {
  QUICKFURNO_LEAD_GENERATION_BOUNDARY,
  QUICKFURNO_PLATFORM_BOUNDARY,
} from "@/lib/aos/v2/architectureBoundary";

export interface AosV2AdminSnapshot {
  runtime: Awaited<ReturnType<typeof getAosV2RuntimeState>>;
  persistenceReady: boolean;
  counts: {
    totalAgents: number;
    operationalAgents: number;
    runs24h: number;
    completed24h: number;
    failed24h: number;
    recommendations24h: number;
    proposable24h: number;
  };
  latestRuns: Array<Record<string, unknown>>;
  latestRecommendations: Array<Record<string, unknown>>;
  agents: typeof AOS_V2_AGENT_CAPABILITIES;
  architecture: {
    coreAuthority: true;
    directN8nFromAos: false;
    legacyPreviewRouterRetired: true;
    oldWorkflowKernelInstalledByAosV2: false;
    actionProposalsEnabled: boolean;
    coreIntegrationHub: true;
    jarvisIntegration: "future_via_quickfurno_core";
    leadGenerationResponsibilityEndsAt: "delivery_plus_bounded_connection_assurance";
    postDeliveryCommercialManagement: false;
  };
}

export async function getAosV2AdminSnapshot(): Promise<AosV2AdminSnapshot> {
  const runtime = await getAosV2RuntimeState();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    const db = adminClient();
    const [
      runs,
      completed,
      failed,
      recommendations,
      proposable,
      latestRuns,
      latestRecommendations,
    ] = await Promise.all([
      countRows(db, "aos_runs", since),
      countRows(db, "aos_runs", since, { column: "status", value: "completed" }),
      countRows(db, "aos_runs", since, { column: "status", value: "failed" }),
      countRows(db, "aos_recommendations", since),
      countRows(db, "aos_recommendations", since, { column: "action_state", value: "proposable" }),
      db.from("aos_runs")
        .select("id, entity_type, entity_id, event_type, mode, status, error_code, started_at, completed_at")
        .order("created_at", { ascending: false })
        .limit(10),
      db.from("aos_recommendations")
        .select("id, run_id, recommendation_key, entity_type, entity_id, priority, confidence_score, suggested_action_type, action_state, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    const persistenceReady = !latestRuns.error && !latestRecommendations.error;
    return {
      runtime,
      persistenceReady,
      counts: {
        totalAgents: AOS_V2_AGENT_COUNT,
        operationalAgents: AOS_V2_OPERATIONAL_AGENT_COUNT,
        runs24h: runs,
        completed24h: completed,
        failed24h: failed,
        recommendations24h: recommendations,
        proposable24h: proposable,
      },
      latestRuns: (latestRuns.data ?? []) as Array<Record<string, unknown>>,
      latestRecommendations: (latestRecommendations.data ?? []) as Array<Record<string, unknown>>,
      agents: AOS_V2_AGENT_CAPABILITIES,
      architecture: architecture(runtime.actionProposalsEnabled),
    };
  } catch {
    return {
      runtime,
      persistenceReady: false,
      counts: {
        totalAgents: AOS_V2_AGENT_COUNT,
        operationalAgents: AOS_V2_OPERATIONAL_AGENT_COUNT,
        runs24h: 0,
        completed24h: 0,
        failed24h: 0,
        recommendations24h: 0,
        proposable24h: 0,
      },
      latestRuns: [],
      latestRecommendations: [],
      agents: AOS_V2_AGENT_CAPABILITIES,
      architecture: architecture(runtime.actionProposalsEnabled),
    };
  }
}

function architecture(actionProposalsEnabled: boolean) {
  return {
    coreAuthority: true as const,
    directN8nFromAos: false as const,
    legacyPreviewRouterRetired: true as const,
    oldWorkflowKernelInstalledByAosV2: false as const,
    actionProposalsEnabled,
    coreIntegrationHub: QUICKFURNO_PLATFORM_BOUNDARY.core.integrationHub,
    jarvisIntegration: QUICKFURNO_PLATFORM_BOUNDARY.jarvis.integration,
    leadGenerationResponsibilityEndsAt: QUICKFURNO_LEAD_GENERATION_BOUNDARY.responsibilityEndsAt,
    postDeliveryCommercialManagement: QUICKFURNO_LEAD_GENERATION_BOUNDARY.postDeliveryCommercialManagement,
  };
}

async function countRows(
  db: ReturnType<typeof adminClient>,
  table: string,
  since: string,
  filter?: { column: string; value: string },
): Promise<number> {
  let query = db.from(table).select("id", { count: "exact", head: true }).gte("created_at", since);
  if (filter) query = query.eq(filter.column, filter.value);
  const { count, error } = await query;
  return error ? 0 : count ?? 0;
}
