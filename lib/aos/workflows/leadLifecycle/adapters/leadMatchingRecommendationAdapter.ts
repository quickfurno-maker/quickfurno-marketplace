import { adminClient } from "../../../../supabase";
import {
  getEligibleVendorsForLead,
  type LeadForMatching,
} from "../../../../../services/leadMatchingEngine";
import type {
  LeadLifecycleMatchingRecommendation,
  LeadLifecycleMatchingRecommendationPort,
} from "./leadLifecycleServicePorts";

const MAX_RECOMMENDATIONS = 3;

export class LeadMatchingRecommendationAdapter implements LeadLifecycleMatchingRecommendationPort {
  async prepareRecommendations(leadId: string): Promise<LeadLifecycleMatchingRecommendation> {
    const lead = await loadLeadForRecommendation(leadId);
    const result = await getEligibleVendorsForLead(lead);
    if (!result.ok) throw new Error(result.code);

    const recommendedVendorIds = result.data
      .slice(0, MAX_RECOMMENDATIONS)
      .map((vendor) => vendor.id);

    return {
      leadId,
      eligibleVendorCount: result.data.length,
      recommendedVendorIds,
    };
  }
}

async function loadLeadForRecommendation(leadId: string): Promise<LeadForMatching> {
  const { data, error } = await adminClient()
    .from("leads")
    .select("id, name, phone, city, area, service_required, category, subcategory, budget, timeline, message, latitude, longitude, share_consent, is_duplicate")
    .eq("id", leadId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("LEAD_NOT_FOUND");
  return data as LeadForMatching;
}
