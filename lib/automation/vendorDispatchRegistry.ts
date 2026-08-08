// ============================================================================
// QuickFurno — QF-MVP-50.3 Vendor Dispatch Authority
//
// DISPATCH SEMANTICS only. `actionRegistry.ts` remains the REQUESTABILITY
// authority (who may ask for an action); this module answers a different
// question: given an already Core-authorized vendor action, what static Core
// policy governs how it would later be dispatched.
//
// Pure module: no database, network, environment, clock, logging or provider
// import. It authorizes no send, resolves no destination and picks no provider.
//
// NO VENDOR ACCEPT / REJECT. QuickFurno has no accept, reject or decline
// concept for an assigned lead and must never gain one.
//   * `vendor.lead_offer` is a ONE-WAY TRANSACTIONAL ASSIGNMENT NOTIFICATION.
//     It never asks the vendor to accept or reject, creates no decision state
//     and has no decision endpoint.
//   * `vendor.response_reminder` means ONLY "an assigned lead has not
//     progressed past vendor_status = 'New'". It is a contact/progress nudge,
//     never an acceptance prompt, and there is no acceptance or rejection rate.
// `vendors.accepting_leads` remains an availability toggle and is unrelated.
// ============================================================================

import type { AutomationActionType, AutomationWorkflowFamily } from "./actionRegistry";

/**
 * The ACTIVE QF-MVP-50.3 vendor action set — exactly five. Narrowed from the
 * canonical AutomationActionType union so a typo cannot invent a sixth, and so
 * removing an action from the canonical registry breaks this file at compile
 * time.
 *
 * `vendor.document_reminder` is deliberately ABSENT — see
 * NON_PRODUCIBLE_VENDOR_ACTIONS below.
 */
export const VENDOR_AUTOMATION_ACTION_TYPES = [
  "vendor.lead_offer",
  "vendor.response_reminder",
  "vendor.onboarding_reminder",
  "vendor.package_expiry_warning",
  "vendor.low_credit_warning",
] as const satisfies readonly AutomationActionType[];

export type VendorAutomationActionType = (typeof VENDOR_AUTOMATION_ACTION_TYPES)[number];

/**
 * REGISTERED BUT NOT PRODUCIBLE.
 *
 * `vendor.document_reminder` stays in the frozen 14-action requestability
 * registry, but QuickFurno has no vendor document/KYC domain: no documents
 * table, no document status vocabulary, no document expiry column and no
 * required-document concept. KYC/document storage is explicitly out of scope in
 * the CRM foundation.
 *
 * There is therefore no truthful trigger. Rather than invent document truth,
 * this phase records the exact reason and makes the action unproducible in both
 * the database producer and this dispatch authority. A future, separately
 * authorized phase that builds a real document domain can activate it through a
 * governed change.
 */
export const NON_PRODUCIBLE_VENDOR_ACTIONS: Readonly<
  Record<string, { readonly actionType: AutomationActionType; readonly reason: string }>
> = Object.freeze({
  "vendor.document_reminder": Object.freeze({
    actionType: "vendor.document_reminder" as const,
    reason: "NO_CANONICAL_VENDOR_DOCUMENT_DOMAIN",
  }),
});

/**
 * How Core resolves the destination. `vendor_direct` means the authoritative
 * contact stored on the vendor row, resolved by the existing recipient
 * resolver (whatsapp_number, else phone). n8n never supplies a destination.
 */
export const VENDOR_RECIPIENT_STRATEGIES = ["vendor_direct"] as const;
export type VendorRecipientStrategy = (typeof VENDOR_RECIPIENT_STRATEGIES)[number];

/**
 * The entity a vendor action is scoped to. Closed — never a free string.
 * An assignment-scoped action is keyed by the assignment so its
 * execution-time reproof reads exactly one row.
 */
export const VENDOR_DISPATCH_ENTITY_TYPES = ["vendor", "lead_assignment"] as const;
export type VendorDispatchEntityType = (typeof VENDOR_DISPATCH_ENTITY_TYPES)[number];

/** Every active vendor action is transactional on the business lane. */
export type VendorDispatchLane = "business";
export type VendorDispatchConsentScope = "transactional";

/**
 * The owner-locked schedule for an action, expressed in minutes from its source
 * event. A negative offset is relative to a future business instant (package
 * expiry); a positive offset is relative to a past one (assignment, profile
 * creation). `immediate` is the empty schedule.
 */
export interface VendorScheduleOffset {
  readonly key: string;
  readonly minutes: number;
}

export interface VendorAutomationDispatchDefinition {
  readonly actionType: VendorAutomationActionType;
  readonly workflowFamily: AutomationWorkflowFamily;
  readonly allowedEntityTypes: readonly VendorDispatchEntityType[];
  readonly recipientStrategy: VendorRecipientStrategy;
  readonly communicationLane: VendorDispatchLane;
  readonly consentScope: VendorDispatchConsentScope;
  /**
   * The INTENDED internal template key. Core dispatch intent only — never proof
   * that an approved provider template or active mapping exists. Execution must
   * still fail closed unless the communication subsystem proves an exact active
   * approved mapping at dispatch time.
   */
  readonly templateKey: string;
  /** Owner-locked schedule. Empty means immediate at the source event. */
  readonly schedule: readonly VendorScheduleOffset[];
}

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

function definition(
  actionType: VendorAutomationActionType,
  templateKey: string,
  entityType: VendorDispatchEntityType,
  schedule: readonly VendorScheduleOffset[],
): VendorAutomationDispatchDefinition {
  return Object.freeze({
    actionType,
    workflowFamily: "vendor_whatsapp" as const,
    allowedEntityTypes: Object.freeze([entityType]),
    recipientStrategy: "vendor_direct" as const,
    communicationLane: "business" as const,
    consentScope: "transactional" as const,
    templateKey,
    schedule: Object.freeze(schedule.map((s) => Object.freeze(s))),
  });
}

/**
 * Total over exactly the five ACTIVE vendor actions. No default entry and no
 * prefix parser: an unregistered action resolves to nothing and fails closed.
 *
 * Template keys are the EXISTING registered outbound consent-scope entries; no
 * new message type is invented here.
 */
export const VENDOR_DISPATCH_REGISTRY: Readonly<
  Record<VendorAutomationActionType, VendorAutomationDispatchDefinition>
> = Object.freeze({
  // Immediate one-way assignment notice. Not an offer to accept or decline.
  "vendor.lead_offer": definition(
    "vendor.lead_offer",
    "vendor_new_lead",
    "lead_assignment",
    [],
  ),
  // Owner-locked: exactly +2h and +24h from the assignment. Never a third.
  "vendor.response_reminder": definition(
    "vendor.response_reminder",
    "vendor_response_reminder",
    "lead_assignment",
    [
      { key: "resp2h", minutes: 2 * MINUTES_PER_HOUR },
      { key: "resp24h", minutes: 24 * MINUTES_PER_HOUR },
    ],
  ),
  // Owner-locked: exactly one reminder, +24h from CRM profile creation.
  "vendor.onboarding_reminder": definition(
    "vendor.onboarding_reminder",
    "vendor_onboarding_reminder",
    "vendor",
    [{ key: "onbnew24h", minutes: 24 * MINUTES_PER_HOUR }],
  ),
  // Owner-locked: exactly -7d and -1d from the exact package_expires_at.
  "vendor.package_expiry_warning": definition(
    "vendor.package_expiry_warning",
    "vendor_package_expiry_warning",
    "vendor",
    [
      { key: "pkgexp7d", minutes: -7 * MINUTES_PER_DAY },
      { key: "pkgexp1d", minutes: -1 * MINUTES_PER_DAY },
    ],
  ),
  // Immediate, on a real configured-threshold crossing only.
  "vendor.low_credit_warning": definition(
    "vendor.low_credit_warning",
    "low_credit_warning",
    "vendor",
    [],
  ),
});

/**
 * The canonical policy key holding the low-credit threshold. The value lives in
 * `automation_policy_configs` and is read at both produce and execute time.
 * It is deliberately NOT a numeric constant in this module: a hard-coded
 * threshold here would become a second, divergeable send policy.
 */
export const VENDOR_LOW_CREDIT_THRESHOLD_POLICY_KEY =
  "vendor_low_credit_warning_threshold";

export function isVendorAutomationActionType(
  value: unknown,
): value is VendorAutomationActionType {
  return (
    typeof value === "string" &&
    (VENDOR_AUTOMATION_ACTION_TYPES as readonly string[]).includes(value)
  );
}

/** Returns null for anything that is not one of the five. Never a fallback. */
export function getVendorDispatchDefinition(
  actionType: unknown,
): VendorAutomationDispatchDefinition | null {
  if (!isVendorAutomationActionType(actionType)) return null;
  return VENDOR_DISPATCH_REGISTRY[actionType];
}

/** True only when the action is an active vendor action AND the entity is permitted. */
export function isAllowedVendorDispatchEntityType(
  actionType: unknown,
  entityType: unknown,
): boolean {
  const def = getVendorDispatchDefinition(actionType);
  if (!def) return false;
  return (def.allowedEntityTypes as readonly string[]).includes(String(entityType));
}

/**
 * Is this a registered vendor action that this phase deliberately cannot
 * produce? Distinct from "unknown action": the caller must be able to report the
 * exact reason rather than a generic refusal.
 */
export function getNonProducibleVendorReason(actionType: unknown): string | null {
  if (typeof actionType !== "string") return null;
  return NON_PRODUCIBLE_VENDOR_ACTIONS[actionType]?.reason ?? null;
}
