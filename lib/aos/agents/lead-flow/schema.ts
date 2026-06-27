export interface LeadFlowInput {
  leadId?: string;
}

export interface LeadFlowOutput {
  lifecycleMode: "mock-preview";
  nextStatusSuggestion: string;
  replacementPolicy: "replace_not_refund";
}

