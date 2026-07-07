import type { LeadQualityScoreResult } from "../../../../../services/leadQualityService";

export interface LeadLifecycleQualityPort {
  scoreLead(leadId: string): Promise<LeadQualityScoreResult>;
}

export interface LeadLifecycleLatestQualityPort {
  readLatestQualityResult(leadId: string): Promise<LeadQualityScoreResult>;
}

export interface LeadLifecycleClarificationMetadata {
  requestId: string;
  status: string | null;
  missingFields: string[];
  questionsCount: number;
}

export interface LeadLifecycleClarificationPort {
  prepareClarification(leadId: string): Promise<LeadLifecycleClarificationMetadata>;
}

export interface LeadLifecycleMatchingRecommendation {
  leadId: string;
  eligibleVendorCount: number;
  recommendedVendorIds: string[];
}

export interface LeadLifecycleMatchingRecommendationPort {
  prepareRecommendations(leadId: string): Promise<LeadLifecycleMatchingRecommendation>;
}

export interface LeadLifecycleServicePorts {
  quality: LeadLifecycleQualityPort;
  latestQuality: LeadLifecycleLatestQualityPort;
  clarification: LeadLifecycleClarificationPort;
  matchingRecommendation: LeadLifecycleMatchingRecommendationPort;
}
