export interface TrustShieldInput {
  vendorId?: string;
}

export interface TrustShieldOutput {
  trustLabel: "mock-review-only";
  riskFlags: string[];
  recommendedNextStep: string;
}

