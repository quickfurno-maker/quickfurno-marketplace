export interface LeadLensInput {
  leadId?: string;
  source?: string;
}

export interface LeadLensOutput {
  qualityLabel: "mock-review-only";
  riskFlags: string[];
  recommendedNextStep: string;
}

