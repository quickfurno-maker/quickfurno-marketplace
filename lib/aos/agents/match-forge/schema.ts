export interface MatchForgeInput {
  leadId?: string;
  candidateVendorIds?: string[];
}

export interface MatchForgeOutput {
  maxVendorsPerLead: 3;
  selectedVendorIds: string[];
  recommendedNextStep: string;
}

