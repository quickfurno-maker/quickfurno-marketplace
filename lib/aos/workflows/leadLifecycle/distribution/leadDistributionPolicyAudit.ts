import type { JsonRecord } from "../../../workflow/workflowPersistenceTypes";
import {
  AutomationPolicyKey,
  DistributionAuthorizationDecision,
} from "../../../policy/policyTypes";
import { LEAD_DISTRIBUTION_AUTHORIZATION_POLICY_VERSION } from "../../../policy/policyConfig";
import { PolicyDecisionReason } from "../../../policy/policyDecisionReasons";
import {
  AutomationPolicyConfigSource,
  type AutomationPolicyConfigSourceValue,
} from "../../../policy/runtime/policyConfigStoreTypes";
import type { DistributionValidationResult } from "./leadDistributionTypes";

export interface PolicyDecisionAuditContract {
  readonly policy_key: string;
  readonly policy_version: string;
  readonly policy_fingerprint: string;
  readonly policy_decision: string;
  readonly policy_reason_code: string;
  readonly policy_config_id: string | null;
  readonly policy_config_source: AutomationPolicyConfigSourceValue;
  readonly policy_facts_summary: JsonRecord;
  readonly policy_passed_gates: readonly string[];
  readonly policy_failed_gates: readonly string[];
}

const POLICY_AUDIT_KEYS = Object.freeze([
  "policy_key",
  "policy_version",
  "policy_fingerprint",
  "policy_decision",
  "policy_reason_code",
  "policy_config_id",
  "policy_config_source",
  "policy_facts_summary",
  "policy_passed_gates",
  "policy_failed_gates",
]);

const POLICY_FACTS_SUMMARY_KEYS = new Set([
  "policyKey",
  "workflowType",
  "workflowInstanceId",
  "leadId",
  "currentLifecycleState",
  "routeClassification",
  "scoreClass",
  "totalScore",
  "hardBlockReasonPresent",
  "recommendedAction",
  "recommendationEventId",
  "recommendedVendorCount",
]);

const SHA256_HEX = /^[0-9a-f]{64}$/;
const PII_KEY_PATTERN =
  /client(_|-)?name|phone|mobile|email|whatsapp|address|raw(_|-)?message|budget(_|-)?text|gps|latitude|longitude|\blat\b|\blng\b/i;

export function validatePolicyDecisionAuditContract(
  payload: JsonRecord,
): DistributionValidationResult<PolicyDecisionAuditContract> {
  if (!isPlainObject(payload)) {
    return { ok: false, message: "POLICY_AUDIT_PAYLOAD_REQUIRED" };
  }

  for (const key of Object.keys(payload)) {
    if (!POLICY_AUDIT_KEYS.includes(key)) {
      return { ok: false, message: "POLICY_AUDIT_UNKNOWN_FIELD" };
    }
    if (PII_KEY_PATTERN.test(key)) {
      return { ok: false, message: "POLICY_AUDIT_PII_FIELD_REJECTED" };
    }
  }

  if (payload.policy_key !== AutomationPolicyKey.LEAD_DISTRIBUTION_AUTHORIZATION) {
    return { ok: false, message: "POLICY_AUDIT_KEY_INVALID" };
  }
  if (payload.policy_version !== LEAD_DISTRIBUTION_AUTHORIZATION_POLICY_VERSION) {
    return { ok: false, message: "POLICY_AUDIT_VERSION_INVALID" };
  }
  if (!isNonEmptyString(payload.policy_fingerprint)) {
    return { ok: false, message: "POLICY_AUDIT_FINGERPRINT_REQUIRED" };
  }
  if (!SHA256_HEX.test(payload.policy_fingerprint)) {
    return { ok: false, message: "POLICY_AUDIT_FINGERPRINT_INVALID" };
  }
  if (
    !Object.values(DistributionAuthorizationDecision).includes(
      payload.policy_decision as never,
    )
  ) {
    return { ok: false, message: "POLICY_AUDIT_DECISION_INVALID" };
  }
  if (!isNonEmptyString(payload.policy_reason_code)) {
    return { ok: false, message: "POLICY_AUDIT_REASON_REQUIRED" };
  }
  if (
    !Object.values(PolicyDecisionReason).includes(
      payload.policy_reason_code as never,
    )
  ) {
    return { ok: false, message: "POLICY_AUDIT_REASON_INVALID" };
  }
  if (
    !Object.values(AutomationPolicyConfigSource).includes(
      payload.policy_config_source as never,
    )
  ) {
    return { ok: false, message: "POLICY_AUDIT_CONFIG_SOURCE_INVALID" };
  }
  if (
    !(
      payload.policy_config_id === null ||
      isNonEmptyString(payload.policy_config_id)
    )
  ) {
    return { ok: false, message: "POLICY_AUDIT_CONFIG_ID_INVALID" };
  }

  const facts = validatePolicyFactsSummary(payload.policy_facts_summary);
  if (!facts.ok) return facts;
  const passed = validateGateList(
    payload.policy_passed_gates,
    "POLICY_AUDIT_PASSED_GATES_REQUIRED",
  );
  if (!passed.ok) return passed;
  const failed = validateGateList(
    payload.policy_failed_gates,
    "POLICY_AUDIT_FAILED_GATES_REQUIRED",
  );
  if (!failed.ok) return failed;

  return {
    ok: true,
    value: Object.freeze({
      policy_key: payload.policy_key,
      policy_version: payload.policy_version,
      policy_fingerprint: payload.policy_fingerprint,
      policy_decision: payload.policy_decision as string,
      policy_reason_code: payload.policy_reason_code,
      policy_config_id: payload.policy_config_id,
      policy_config_source:
        payload.policy_config_source as AutomationPolicyConfigSourceValue,
      policy_facts_summary: Object.freeze({ ...facts.value }),
      policy_passed_gates: Object.freeze([...passed.value]),
      policy_failed_gates: Object.freeze([...failed.value]),
    }),
  };
}

export function pickPolicyAuditFields(
  payload: JsonRecord,
): JsonRecord {
  const audit: JsonRecord = {};
  for (const key of POLICY_AUDIT_KEYS) audit[key] = payload[key];
  return audit;
}

export function assertPolicyAuditIsAutoAuthorization(
  audit: PolicyDecisionAuditContract,
): DistributionValidationResult<PolicyDecisionAuditContract> {
  if (audit.policy_decision !== DistributionAuthorizationDecision.AUTO_AUTHORIZE) {
    return { ok: false, message: "AUTO_AUTH_POLICY_DECISION_INVALID" };
  }
  if (audit.policy_reason_code !== PolicyDecisionReason.GUARDED_AUTO_AUTHORIZATION_ELIGIBLE) {
    return { ok: false, message: "AUTO_AUTH_POLICY_REASON_INVALID" };
  }
  if (audit.policy_version !== LEAD_DISTRIBUTION_AUTHORIZATION_POLICY_VERSION) {
    return { ok: false, message: "AUTO_AUTH_POLICY_VERSION_INVALID" };
  }
  if (audit.policy_failed_gates.length !== 0) {
    return { ok: false, message: "AUTO_AUTH_FAILED_GATES_MUST_BE_EMPTY" };
  }
  if (audit.policy_config_source !== AutomationPolicyConfigSource.ACTIVE_CONFIG) {
    return { ok: false, message: "AUTO_AUTH_CONFIG_SOURCE_INVALID" };
  }
  if (!isNonEmptyString(audit.policy_config_id)) {
    return { ok: false, message: "AUTO_AUTH_CONFIG_ID_REQUIRED" };
  }
  return { ok: true, value: audit };
}

function validatePolicyFactsSummary(
  raw: unknown,
): DistributionValidationResult<JsonRecord> {
  if (!isPlainObject(raw)) {
    return { ok: false, message: "POLICY_AUDIT_FACTS_SUMMARY_REQUIRED" };
  }
  for (const [key, value] of Object.entries(raw)) {
    if (!POLICY_FACTS_SUMMARY_KEYS.has(key)) {
      return { ok: false, message: "POLICY_AUDIT_FACTS_SUMMARY_UNKNOWN_FIELD" };
    }
    if (PII_KEY_PATTERN.test(key) || hasPiiLookingNestedKey(value)) {
      return { ok: false, message: "POLICY_AUDIT_PII_FIELD_REJECTED" };
    }
  }
  return { ok: true, value: { ...raw } };
}

function validateGateList(
  raw: unknown,
  requiredMessage: string,
): DistributionValidationResult<string[]> {
  if (!Array.isArray(raw)) return { ok: false, message: requiredMessage };
  const gates: string[] = [];
  for (const item of raw) {
    if (!isNonEmptyString(item)) {
      return { ok: false, message: "POLICY_AUDIT_GATE_INVALID" };
    }
    gates.push(item.trim());
  }
  return { ok: true, value: gates };
}

function hasPiiLookingNestedKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasPiiLookingNestedKey);
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) => PII_KEY_PATTERN.test(key) || hasPiiLookingNestedKey(nested),
  );
}

function isPlainObject(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
