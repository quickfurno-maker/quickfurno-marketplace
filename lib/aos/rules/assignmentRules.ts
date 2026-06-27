export const assignmentRules = {
  maxVendorsPerLead: 3,
  autoAssignEnabled: false,
  clientSelectedVendorLimit: 3,
  paidVendorPriorityEnabled: false,
} as const;

export function isAssignmentPreviewWithinLimit(vendorIds: string[]): boolean {
  return vendorIds.length <= assignmentRules.maxVendorsPerLead;
}

