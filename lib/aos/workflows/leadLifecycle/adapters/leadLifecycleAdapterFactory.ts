import { LeadClarificationServiceAdapter } from "./leadClarificationServiceAdapter";
import {
  LatestPersistedLeadQualityAdapter,
  LeadQualityServiceAdapter,
} from "./leadQualityServiceAdapter";
import { LeadMatchingRecommendationAdapter } from "./leadMatchingRecommendationAdapter";
import type { LeadLifecycleServicePorts } from "./leadLifecycleServicePorts";

export function createLeadLifecycleServiceAdapters(): LeadLifecycleServicePorts {
  return {
    quality: new LeadQualityServiceAdapter(),
    latestQuality: new LatestPersistedLeadQualityAdapter(),
    clarification: new LeadClarificationServiceAdapter(),
    matchingRecommendation: new LeadMatchingRecommendationAdapter(),
  };
}
