export const leadRules = {
  requireNamePhoneCityService: true,
  maxMatchedVendors: 3,
  invalidLeadAction: "replace_not_refund",
  duplicateHandling: "flag_for_review",
} as const;

export function isLeadFoundationEligible(input: {
  name?: string;
  phone?: string;
  city?: string;
  service?: string;
}): boolean {
  return Boolean(input.name?.trim() && input.phone?.trim() && input.city?.trim() && input.service?.trim());
}

