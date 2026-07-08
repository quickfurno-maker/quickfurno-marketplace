import type { DomainEventRecord, JsonRecord } from "../../../workflow/workflowPersistenceTypes";
import { LeadLifecycleEventType } from "../leadLifecycleEvents";
import { LEAD_ENTITY_TYPE, LEAD_LIFECYCLE_WORKFLOW_TYPE } from "../leadLifecycleStates";
import {
  MAX_DISTRIBUTION_VENDORS,
  type DistributionAutoAuthorizedContract,
  type DistributionValidationResult,
  type LeadDistributionAuthorizationExpectation,
  type LeadDistributionAuthorizationSnapshot,
} from "./leadDistributionTypes";
import {
  LeadDistributionAuthorizationSource,
} from "./leadDistributionTypes";
import { normalizeVendorIdList } from "./leadDistributionValidation";
import {
  assertPolicyAuditIsAutoAuthorization,
  pickPolicyAuditFields,
  validatePolicyDecisionAuditContract,
} from "./leadDistributionPolicyAudit";

const AUTO_AUTHORIZED_PAYLOAD_KEYS = new Set([
  "workflow_type",
  "lead_id",
  "recommendation_event_id",
  "recommended_vendor_count",
  "recommended_vendor_ids",
  "authorized_vendor_count",
  "authorized_vendor_ids",
  "authorization_source",
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

export function validateDistributionAutoAuthorized(
  payload: JsonRecord,
): DistributionValidationResult<DistributionAutoAuthorizedContract> {
  if (!isPlainObject(payload)) {
    return { ok: false, message: "AUTO_AUTH_PAYLOAD_REQUIRED" };
  }
  for (const key of Object.keys(payload)) {
    if (!AUTO_AUTHORIZED_PAYLOAD_KEYS.has(key)) {
      return { ok: false, message: "AUTO_AUTH_UNKNOWN_FIELD" };
    }
  }
  if (payload.workflow_type !== LEAD_LIFECYCLE_WORKFLOW_TYPE) {
    return { ok: false, message: "AUTO_AUTH_WORKFLOW_TYPE_INVALID" };
  }
  if (!isNonEmptyString(payload.lead_id)) {
    return { ok: false, message: "AUTO_AUTH_LEAD_ID_REQUIRED" };
  }
  if (!isNonEmptyString(payload.recommendation_event_id)) {
    return { ok: false, message: "AUTO_AUTH_RECOMMENDATION_EVENT_ID_REQUIRED" };
  }

  if (!isIntegerInRange(payload.recommended_vendor_count, 1, MAX_DISTRIBUTION_VENDORS)) {
    return { ok: false, message: "AUTO_AUTH_RECOMMENDED_COUNT_INVALID" };
  }
  const recommendedCount = payload.recommended_vendor_count;
  const recommended = normalizeVendorIdList(
    payload.recommended_vendor_ids,
    "AUTO_AUTH_RECOMMENDED_IDS_REQUIRED",
  );
  if (!recommended.ok) return recommended;
  if (recommended.value.length !== recommendedCount) {
    return { ok: false, message: "AUTO_AUTH_RECOMMENDED_IDS_COUNT_MISMATCH" };
  }

  if (!isIntegerInRange(payload.authorized_vendor_count, 1, MAX_DISTRIBUTION_VENDORS)) {
    return { ok: false, message: "AUTO_AUTH_AUTHORIZED_COUNT_INVALID" };
  }
  const authorizedCount = payload.authorized_vendor_count;
  const authorized = normalizeVendorIdList(
    payload.authorized_vendor_ids,
    "AUTO_AUTH_AUTHORIZED_IDS_REQUIRED",
  );
  if (!authorized.ok) return authorized;
  if (authorized.value.length !== authorizedCount) {
    return { ok: false, message: "AUTO_AUTH_AUTHORIZED_IDS_COUNT_MISMATCH" };
  }
  if (authorizedCount !== recommendedCount) {
    return { ok: false, message: "AUTO_AUTH_AUTHORIZED_RECOMMENDED_COUNT_MISMATCH" };
  }
  for (let index = 0; index < recommended.value.length; index += 1) {
    if (authorized.value[index] !== recommended.value[index]) {
      return { ok: false, message: "AUTO_AUTH_AUTHORIZED_MUST_EQUAL_RECOMMENDED" };
    }
  }

  if (
    payload.authorization_source !==
    LeadDistributionAuthorizationSource.POLICY_AUTO_AUTHORIZATION
  ) {
    return { ok: false, message: "AUTO_AUTH_SOURCE_INVALID" };
  }

  const audit = validatePolicyDecisionAuditContract(pickPolicyAuditFields(payload));
  if (!audit.ok) return audit;
  const autoAudit = assertPolicyAuditIsAutoAuthorization(audit.value);
  if (!autoAudit.ok) return autoAudit;

  return {
    ok: true,
    value: {
      recommendationEventId: payload.recommendation_event_id.trim(),
      recommendedVendorCount: recommendedCount,
      recommendedVendorIds: recommended.value,
      authorizedVendorCount: authorizedCount,
      authorizedVendorIds: authorized.value,
      authorizationSource:
        LeadDistributionAuthorizationSource.POLICY_AUTO_AUTHORIZATION,
      policyAudit: Object.freeze({ ...autoAudit.value }),
    },
  };
}

export function validateAutoAuthorizedEventSnapshot(
  event: DomainEventRecord,
  expectation: LeadDistributionAuthorizationExpectation,
): DistributionValidationResult<LeadDistributionAuthorizationSnapshot> {
  if (event.id !== expectation.authorizationEventId) {
    return { ok: false, message: "AUTHORIZATION_EVENT_ID_MISMATCH" };
  }
  if (event.event_type !== LeadLifecycleEventType.DISTRIBUTION_AUTO_AUTHORIZED) {
    return { ok: false, message: "AUTO_AUTH_EVENT_TYPE_INVALID" };
  }
  if (event.entity_type !== LEAD_ENTITY_TYPE) {
    return { ok: false, message: "AUTHORIZATION_EVENT_ENTITY_TYPE_INVALID" };
  }
  if (!isNonEmptyString(expectation.expectedLeadId)) {
    return { ok: false, message: "AUTHORIZATION_EXPECTED_LEAD_REQUIRED" };
  }
  if (event.entity_id !== expectation.expectedLeadId) {
    return { ok: false, message: "AUTHORIZATION_EVENT_LEAD_MISMATCH" };
  }
  if (!isNonEmptyString(expectation.expectedWorkflowInstanceId)) {
    return { ok: false, message: "AUTHORIZATION_EXPECTED_WORKFLOW_REQUIRED" };
  }
  if (event.correlation_id !== expectation.expectedWorkflowInstanceId) {
    return { ok: false, message: "AUTHORIZATION_EVENT_WORKFLOW_MISMATCH" };
  }

  const payload = isPlainObject(event.payload_json) ? event.payload_json : null;
  if (!payload) {
    return { ok: false, message: "AUTO_AUTH_EVENT_PAYLOAD_REQUIRED" };
  }
  if (payload.lead_id !== expectation.expectedLeadId) {
    return { ok: false, message: "AUTHORIZATION_EVENT_LEAD_MISMATCH" };
  }

  const authorized = validateDistributionAutoAuthorized(payload);
  if (!authorized.ok) return authorized;

  return {
    ok: true,
    value: Object.freeze({
      authorizationEventId: expectation.authorizationEventId,
      authorizationSource:
        LeadDistributionAuthorizationSource.POLICY_AUTO_AUTHORIZATION,
      recommendationEventId: authorized.value.recommendationEventId,
      leadId: expectation.expectedLeadId,
      workflowInstanceId: expectation.expectedWorkflowInstanceId,
      recommendedVendorIds: Object.freeze([...authorized.value.recommendedVendorIds]),
      recommendedVendorCount: authorized.value.recommendedVendorCount,
      authorizedVendorIds: Object.freeze([...authorized.value.authorizedVendorIds]),
      authorizedVendorCount: authorized.value.authorizedVendorCount,
      humanApprovedBy: null,
      policyAudit: Object.freeze({ ...authorized.value.policyAudit }),
    }),
  };
}

function isPlainObject(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}
