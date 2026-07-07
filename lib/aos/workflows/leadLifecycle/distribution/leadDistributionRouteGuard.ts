import {
  LeadDistributionRoute,
  type LeadDistributionRouteDecision,
  type LeadDistributionRoutingPort,
  type LeadRoutingSnapshot,
} from "./leadDistributionTypes";

/**
 * QuickFurno Distribution Control — standard-route guard (Phase 3A).
 *
 * The controlled distribution/approval path applies ONLY to the standard
 * marketplace route. The preferred-vendor route and the requirement-group /
 * client-selected route remain owned by their existing services; Phase 3A must
 * safely DEFER them (never assign, never call their routing services).
 *
 * Classification uses only real `public.leads` columns:
 *   lead_intent, target_vendor_id, preferred_vendor_id, requirement_group_id.
 */

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const PREFERRED_VENDOR_INTENT = "preferred_vendor";

/**
 * Pure classifier over an already-loaded routing snapshot. Precedence is
 * most-specific first: a requirement group wins, then any preferred/target
 * vendor selection, otherwise the standard route.
 */
export function classifyLeadDistributionRoute(
  routing: LeadRoutingSnapshot,
): LeadDistributionRouteDecision {
  if (hasText(routing.requirementGroupId)) {
    return {
      classification: LeadDistributionRoute.REQUIREMENT_GROUP,
      isStandardRoute: false,
      reason: "Lead belongs to a client requirement group; owned by clientRequirementGroupService.",
    };
  }

  const intent = hasText(routing.leadIntent) ? routing.leadIntent.trim() : null;
  if (
    intent === PREFERRED_VENDOR_INTENT ||
    hasText(routing.preferredVendorId) ||
    hasText(routing.targetVendorId)
  ) {
    return {
      classification: LeadDistributionRoute.PREFERRED_VENDOR,
      isStandardRoute: false,
      reason: "Client explicitly chose a specific vendor; owned by preferredVendorLeadService.",
    };
  }

  return {
    classification: LeadDistributionRoute.STANDARD,
    isStandardRoute: true,
    reason: "General auto-match lead; eligible for controlled standard-route distribution.",
  };
}

/**
 * Load the authoritative routing fields for a lead and classify its route. A
 * missing lead is treated as an error, not silently defaulted to standard.
 */
export async function resolveLeadDistributionRoute(
  leadId: string,
  port: LeadDistributionRoutingPort,
): Promise<LeadDistributionRouteDecision> {
  const id = leadId?.trim();
  if (!id) {
    throw new Error("LEAD_ROUTING_LEAD_ID_REQUIRED");
  }
  const routing = await port.readLeadRouting(id);
  if (!routing) {
    throw new Error("LEAD_ROUTING_NOT_FOUND");
  }
  return classifyLeadDistributionRoute(routing);
}
