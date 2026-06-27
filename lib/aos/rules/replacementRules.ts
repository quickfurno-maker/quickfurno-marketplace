export const replacementRules = {
  invalidLeadOutcome: "replacement",
  requiresAdminApproval: true,
  autoCreditRestoreEnabled: false,
} as const;

export function buildReplacementReason(reason: string): string {
  return reason.trim() || "Invalid lead replacement requested.";
}

