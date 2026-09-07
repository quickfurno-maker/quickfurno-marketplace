// ============================================================================
// QuickFurno — lib/automation/vendorBusinessEligibility.ts   (PURE)
//
// QF-MVP-50.7 — THE SINGLE AUTHORITATIVE STATEMENT of "is this vendor automation
// action still business-eligible?".
//
// WHY THIS MODULE EXISTS
//   Two callers need that answer and they must never drift apart:
//
//     1. the EXECUTOR (`automationVendorExecutionService`) asks it just before
//        building a communication, to decide whether to send at all;
//     2. the STALE-BUSINESS MAINTENANCE LANE asks it to decide whether a queued
//        job should be terminalized because it can never legitimately send.
//
//   If those two grew separate copies of the rules, a job could be "stale enough
//   to cancel" while the executor still considered it sendable, or worse the
//   reverse. So the executor's rules live HERE, once, as pure total functions
//   over facts the caller has already read.
//
//   BE HONEST ABOUT THE SHAPE OF THIS. The maintenance lane cannot literally call
//   this module: its re-proof must happen INSIDE the mutating SQL transaction,
//   where TypeScript cannot reach. So the migration carries a SQL MIRROR of the
//   four maintenance predicates. This is therefore ONE rule DEFINITION plus a
//   transaction-bound mirror — not one executable predicate in both places. The
//   50.7 gate pins each mirrored rule on both sides, so the two cannot drift
//   silently, but the mirror is a second implementation and should be read as one.
//
// WHAT THIS MODULE DELIBERATELY DOES NOT DO
//   It performs NO database access. Reading the facts stays with each caller —
//   the executor reads them through PostgREST, the maintenance lane re-reads them
//   inside a SQL transaction — because only the caller can know whether a failed
//   read was infrastructure or absence. This module is handed facts and returns a
//   verdict; it never guesses at a missing one.
//
// THE VERDICT VOCABULARY IS CLOSED, AND THE THIRD VALUE IS THE IMPORTANT ONE
//   eligible     — current truth still justifies the action.
//   stale        — current truth DETERMINISTICALLY no longer justifies it.
//   unmapped     — this authority cannot reason about the action/entity pairing.
//
//   `unmapped` is not a soft `stale`. The executor collapses both to its existing
//   refusal code (preserving its behaviour exactly), but the maintenance lane may
//   terminalize ONLY on `stale`. An action this module does not recognise is
//   therefore invisible to cancellation rather than silently swept away.
//
// PURE. No database, no network, no provider, no send, no clock.
// ============================================================================

/** The five vendor actions the EXECUTOR can decide. */
export const VENDOR_ELIGIBILITY_ACTIONS = Object.freeze([
  "vendor.lead_offer",
  "vendor.low_credit_warning",
  "vendor.onboarding_reminder",
  "vendor.package_expiry_warning",
  "vendor.response_reminder",
] as const);

export type VendorEligibilityAction = (typeof VENDOR_ELIGIBILITY_ACTIONS)[number];

/**
 * The CLOSED v1 stale-business vocabulary — the subset the maintenance lane may
 * act on. `vendor.lead_offer` is deliberately absent: its only refusal is that
 * the assignment vanished or changed owner, which is entity truth and belongs to
 * the QF-MVP-50.6 orphan lane, not to business staleness.
 */
export const STALE_BUSINESS_ACTIONS = Object.freeze([
  "vendor.low_credit_warning",
  "vendor.onboarding_reminder",
  "vendor.package_expiry_warning",
  "vendor.response_reminder",
] as const);

export type StaleBusinessAction = (typeof STALE_BUSINESS_ACTIONS)[number];

/**
 * The CLOSED action -> entity_type pairing. A supported action arriving with the
 * wrong entity type is `unmapped`, never decided: the pairing is what makes the
 * fact lookup meaningful in the first place.
 */
export const STALE_BUSINESS_ENTITY_PAIRING = Object.freeze({
  "vendor.response_reminder": "lead_assignment",
  "vendor.onboarding_reminder": "vendor",
  "vendor.package_expiry_warning": "vendor",
  "vendor.low_credit_warning": "vendor",
} as const);

/** The fixed, repository-owned maintenance reason. Never caller-supplied. */
export const STALE_BUSINESS_SAFE_CODE = "QF_AUTOMATION_BUSINESS_STATE_NO_LONGER_ELIGIBLE" as const;

/** The executor's existing refusal code. Unchanged by this phase. */
export const EXECUTOR_BUSINESS_REFUSAL_CODE = "QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE" as const;

export const VendorBusinessState = Object.freeze({
  ELIGIBLE: "eligible",
  STALE: "stale",
  UNMAPPED: "unmapped",
} as const);

export type VendorBusinessStateValue =
  (typeof VendorBusinessState)[keyof typeof VendorBusinessState];

/**
 * The response-reminder source windows. The producer binds each reminder to one
 * of exactly two identities; anything else is not a reminder this authority can
 * interpret.
 */
export const RESPONSE_REMINDER_WINDOW_SUFFIXES = Object.freeze([":resp2h", ":resp24h"] as const);

/** The exact `YYYYMMDDHH24MISS` producer stamp shape. */
export const EXPIRY_STAMP_PATTERN = /^\d{14}$/;

/**
 * The facts each decision rests on. Every field is nullable because the caller
 * may legitimately have found nothing — and "nothing" is a fact this module is
 * allowed to reason about. What it is NEVER handed is "the read failed": callers
 * must treat a failed read as infrastructure and never reach this module.
 */
export interface VendorBusinessFacts {
  readonly actionType: string | null | undefined;
  readonly entityType: string | null | undefined;
  /** `automation_action_requests.idempotency_key` — the durable source identity. */
  readonly sourceEventKey: string | null | undefined;
  /** lead_assignment facts (response_reminder / lead_offer). */
  readonly assignmentExists?: boolean;
  readonly assignmentVendorId?: string | null;
  readonly assignmentVendorStatus?: string | null;
  /** the vendor this action resolved to. */
  readonly resolvedVendorId?: string | null;
  /** vendor_crm_profiles (onboarding_reminder). */
  readonly crmProfileExists?: boolean;
  readonly onboardingStage?: string | null;
  /** vendors (package_expiry_warning). */
  readonly packageStatus?: string | null;
  /** Already formatted to the producer stamp shape by the caller, or null. */
  readonly packageExpiresAtStamp?: string | null;
  /** vendors (low_credit_warning). */
  readonly remainingCredits?: number | null;
  /** The ACTIVE configured threshold, or null when unconfigured. */
  readonly lowCreditThreshold?: number | null;
}

const eligible = (): VendorBusinessStateValue => VendorBusinessState.ELIGIBLE;
const stale = (): VendorBusinessStateValue => VendorBusinessState.STALE;
const unmapped = (): VendorBusinessStateValue => VendorBusinessState.UNMAPPED;

export function isVendorEligibilityAction(v: unknown): v is VendorEligibilityAction {
  return typeof v === "string" && (VENDOR_ELIGIBILITY_ACTIONS as readonly string[]).includes(v);
}

export function isStaleBusinessAction(v: unknown): v is StaleBusinessAction {
  return typeof v === "string" && (STALE_BUSINESS_ACTIONS as readonly string[]).includes(v);
}

/** The response-reminder window, or null when the source identity is not one. */
export function resolveResponseReminderWindow(sourceEventKey: string | null | undefined): string | null {
  if (typeof sourceEventKey !== "string") return null;
  for (const suffix of RESPONSE_REMINDER_WINDOW_SUFFIXES) {
    if (sourceEventKey.endsWith(suffix)) return suffix.slice(1);
  }
  return null;
}

/** The bound expiry stamp, or null when the source identity carries none. */
export function resolveBoundExpiryStamp(sourceEventKey: string | null | undefined): string | null {
  if (typeof sourceEventKey !== "string") return null;
  const tail = sourceEventKey.split(".").pop() ?? "";
  return EXPIRY_STAMP_PATTERN.test(tail) ? tail : null;
}

/**
 * THE decision. Total over its inputs, deterministic, and identical for both
 * callers.
 *
 * Each branch mirrors the exact predicate the executor has always applied — the
 * executor now routes through here rather than restating them, so there is one
 * place a rule can change and both consumers change with it.
 */
export function decideVendorBusinessState(facts: VendorBusinessFacts): VendorBusinessStateValue {
  const action = facts?.actionType;
  if (!isVendorEligibilityAction(action)) return unmapped();

  switch (action) {
    case "vendor.lead_offer": {
      // Entity truth only: the assignment must still exist and still belong to
      // the vendor this action resolved to. Deliberately NOT in the stale
      // vocabulary — a vanished assignment is the orphan lane's business.
      if (facts.entityType !== "lead_assignment") return unmapped();
      if (facts.assignmentExists !== true) return stale();
      if (!facts.assignmentVendorId || facts.assignmentVendorId !== facts.resolvedVendorId) return stale();
      return eligible();
    }

    case "vendor.response_reminder": {
      if (facts.entityType !== "lead_assignment") return unmapped();
      // A reminder whose durable source identity names no known window cannot be
      // interpreted, and the executor already treats that as a definitive refusal.
      if (resolveResponseReminderWindow(facts.sourceEventKey) === null) return stale();
      if (facts.assignmentExists !== true) return stale();
      if (!facts.assignmentVendorId || facts.assignmentVendorId !== facts.resolvedVendorId) return stale();
      // The nudge exists only while the assigned lead has not progressed past New.
      if (facts.assignmentVendorStatus !== "New") return stale();
      return eligible();
    }

    case "vendor.onboarding_reminder": {
      if (facts.entityType !== "vendor") return unmapped();
      if (facts.crmProfileExists !== true) return stale();
      if (facts.onboardingStage !== "new") return stale();
      return eligible();
    }

    case "vendor.package_expiry_warning": {
      if (facts.entityType !== "vendor") return unmapped();
      // The warning is bound to ONE expiry instant. A renewal that moves the
      // expiry makes this warning stale; the new expiry produces its own pair.
      const bound = resolveBoundExpiryStamp(facts.sourceEventKey);
      if (bound === null) return stale();
      if (facts.packageStatus !== "active") return stale();
      if (!facts.packageExpiresAtStamp) return stale();
      if (facts.packageExpiresAtStamp !== bound) return stale();
      return eligible();
    }

    case "vendor.low_credit_warning": {
      if (facts.entityType !== "vendor") return unmapped();
      // OWNER-LOCKED: an unconfigured threshold is a definitive refusal. There is
      // deliberately no numeric fallback — assuming a number would send a warning
      // nobody configured.
      if (typeof facts.lowCreditThreshold !== "number" || !Number.isInteger(facts.lowCreditThreshold)) {
        return stale();
      }
      if (typeof facts.remainingCredits !== "number") return stale();
      // A recharge back above the threshold makes the warning stale.
      if (facts.remainingCredits > facts.lowCreditThreshold) return stale();
      return eligible();
    }

    default:
      return unmapped();
  }
}

/**
 * The MAINTENANCE-LANE view of the same decision.
 *
 * Terminalization additionally requires that the action is inside the closed v1
 * stale vocabulary AND that the mapped entity still EXISTS. An absent entity is
 * QF-MVP-50.6's orphan lane, and the two must never overlap: a job is a candidate
 * for exactly one of them, never both, never neither by accident.
 */
export function isStaleBusinessTerminalizable(input: {
  readonly facts: VendorBusinessFacts;
  /** The QF-MVP-50.6 entity authority verdict: present | missing | unmapped. */
  readonly entityState: string | null | undefined;
  readonly jobStatus: string | null | undefined;
}): boolean {
  if (!isStaleBusinessAction(input?.facts?.actionType)) return false;
  const pairing = STALE_BUSINESS_ENTITY_PAIRING[input.facts.actionType as StaleBusinessAction];
  if (input.facts.entityType !== pairing) return false;
  // Entity MUST still exist — this is the hard boundary against the orphan lane.
  if (input.entityState !== "present") return false;
  if (input.jobStatus !== "pending" && input.jobStatus !== "retry_scheduled") return false;
  return decideVendorBusinessState(input.facts) === VendorBusinessState.STALE;
}

/** The exact row shape a stale-business terminalization must write. */
export const STALE_BUSINESS_CANCELLED_JOB_SHAPE = Object.freeze({
  status: "cancelled",
  completedAtRequired: true,
  lockedAt: null,
  lockedBy: null,
  nextRetryAt: null,
  // Nothing executed, so there is nothing to classify. Writing a
  // `definitive_failure` here would fabricate an attempt outcome that never ran.
  lastResultClassification: null,
  lastSafeCode: STALE_BUSINESS_SAFE_CODE,
} as const);
