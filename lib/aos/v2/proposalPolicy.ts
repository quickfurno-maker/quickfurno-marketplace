import {
  isAutomationActionType,
  type AutomationActionType,
} from "../../automation/actionRegistry";

export const CERTIFIED_AOS_PROPOSAL_ACTIONS: ReadonlySet<AutomationActionType> =
  new Set<AutomationActionType>([
    "vendor.onboarding_reminder",
    "vendor.package_expiry_warning",
    "vendor.low_credit_warning",
  ]);

export function isCertifiedAosProposalAction(
  value: unknown,
): value is AutomationActionType {
  return isAutomationActionType(value)
    && CERTIFIED_AOS_PROPOSAL_ACTIONS.has(value);
}
