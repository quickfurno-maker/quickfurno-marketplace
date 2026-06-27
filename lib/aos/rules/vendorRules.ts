export const vendorRules = {
  disabledVendorsReceiveLeads: false,
  pendingVendorsReceiveLeads: false,
  approvedActiveVendorsCanBeMatched: true,
  paidPriority: "future",
} as const;

export function canVendorReceiveLeadPreview(input: {
  status?: string;
  isActive?: boolean;
  remainingCredits?: number;
}): boolean {
  return input.status === "Approved" && input.isActive === true && Number(input.remainingCredits ?? 0) > 0;
}

