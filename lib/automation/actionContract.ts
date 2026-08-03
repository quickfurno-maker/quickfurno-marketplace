// ============================================================================
// QuickFurno — QF-MVP-50.1A Unified Action Contract
//
// Core is authority. Jarvis/Riya/Anisha may REQUEST. n8n may EXECUTE only a
// Core-authorized job. Meta delivers. Results return to Core.
//
// Pure module: no database, network, environment, provider or clock I/O.
// ============================================================================

import {
  getWorkflowFamilyForAction,
  isAutomationActionType,
  type AutomationWorkflowFamily,
} from "./actionRegistry";

export const AUTOMATION_CONTRACT_VERSION = 1 as const;

export const AUTOMATION_REQUEST_SOURCES = [
  "core",
  "admin",
  "system",
  "jarvis",
  "riya",
  "anisha",
] as const;

export type AutomationRequestSource = (typeof AUTOMATION_REQUEST_SOURCES)[number];

export const AUTOMATION_AUDIT_ACTOR_TYPES = [
  "core_service",
  "admin_user",
  "system",
  "jarvis_agent",
] as const;

export type AutomationAuditActorType =
  (typeof AUTOMATION_AUDIT_ACTOR_TYPES)[number];

export const AUTOMATION_RESULT_CLASSIFICATIONS = [
  "success",
  "retryable_failure",
  "definitive_failure",
  "uncertain",
] as const;

export type AutomationResultClassification =
  (typeof AUTOMATION_RESULT_CLASSIFICATIONS)[number];

export interface AutomationAuditActor {
  actorType: AutomationAuditActorType;
  actorId: string;
}

export interface CoreActionRequest {
  contractVersion: typeof AUTOMATION_CONTRACT_VERSION;
  requestId: string;
  actionType: string;
  entityType: string;
  entityId: string;
  source: AutomationRequestSource;
  requestedBy: AutomationAuditActor;
  requestedAt: string;
  idempotencyKey: string;
  correlationId: string;
  safeContext: Readonly<Record<string, unknown>>;
}

export interface CoreActionAuthorization {
  decision: "authorized";
  authorizationId: string;
  authorizedAt: string;
  authorizedBy: AutomationAuditActor;
  reasonCode: string;
}

export interface CoreAuthorizedAction {
  request: CoreActionRequest;
  authorization: CoreActionAuthorization;
}

export interface AutomationJobEnvelope {
  contractVersion: typeof AUTOMATION_CONTRACT_VERSION;
  jobId: string;
  actionRequestId: string;
  actionType: string;
  entityType: string;
  entityId: string;
  source: AutomationRequestSource;
  idempotencyKey: string;
  correlationId: string;
  authorizedAt: string;
  authorizedBy: AutomationAuditActor;
  safeContext: Readonly<Record<string, unknown>>;
  /**
   * Derived by Core from the action registry — the single source of truth. There is
   * deliberately no caller argument and no safeContext override: n8n receives the
   * family, it never asserts one, and it never parses the actionType prefix itself.
   */
  workflowFamily: AutomationWorkflowFamily;
}

export interface AutomationExecutionResult {
  jobId: string;
  attemptId: string;
  classification: AutomationResultClassification;
  safeCode: string;
  occurredAt: string;
  executorReference?: string | null;
}

export interface ForbiddenAutomationField {
  path: string;
  key: string;
}

const FORBIDDEN_KEY_TOKENS = new Set([
  "forcesend",
  "ignoreconsent",
  "bypassconsent",
  "ignoresuppression",
  "bypasssuppression",
  "recipient",
  "recipientphone",
  "phone",
  "phonenumber",
  "mobile",
  "whatsapp",
  "to",
  "template",
  "templatekey",
  "templatepurpose",
  "provideraccount",
  "provideraccountid",
  "provideroverride",
  "accesstoken",
  "token",
  "secret",
  "authorization",
  "apikey",
  "password",
  "creditdelta",
  "restorecredits",
  "assignvendorids",
  "vendorids",
  "desiredstatus",
  "retryanyway",
  "skipvalidation",
]);

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;

export function isAutomationRequestSource(
  value: unknown,
): value is AutomationRequestSource {
  return (
    typeof value === "string" &&
    AUTOMATION_REQUEST_SOURCES.includes(value as AutomationRequestSource)
  );
}

export function isAutomationResultClassification(
  value: unknown,
): value is AutomationResultClassification {
  return (
    typeof value === "string" &&
    AUTOMATION_RESULT_CLASSIFICATIONS.includes(
      value as AutomationResultClassification,
    )
  );
}

export function isAutomaticRetryAllowed(
  classification: AutomationResultClassification,
): boolean {
  return classification === "retryable_failure";
}

export function isTerminalAutomationResult(
  classification: AutomationResultClassification,
): boolean {
  return classification !== "retryable_failure";
}

export function findForbiddenAutomationField(
  value: unknown,
  path = "$",
  depth = 0,
): ForbiddenAutomationField | null {
  if (depth > 8) return { path, key: "[depth_limit]" };

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const nested = findForbiddenAutomationField(
        value[index],
        `${path}[${index}]`,
        depth + 1,
      );
      if (nested) return nested;
    }
    return null;
  }

  if (!isRecord(value)) return null;

  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEY_TOKENS.has(normalizeKey(key))) {
      return { path: `${path}.${key}`, key };
    }
    const nested = findForbiddenAutomationField(
      item,
      `${path}.${key}`,
      depth + 1,
    );
    if (nested) return nested;
  }

  return null;
}

export function validateCoreActionRequestEnvelope(
  request: CoreActionRequest,
): { ok: true } | { ok: false; reason: string } {
  if (request.contractVersion !== AUTOMATION_CONTRACT_VERSION) {
    return { ok: false, reason: "UNSUPPORTED_CONTRACT_VERSION" };
  }
  if (!isAutomationRequestSource(request.source)) {
    return { ok: false, reason: "INVALID_REQUEST_SOURCE" };
  }
  if (!isSafeIdentifier(request.requestId)) {
    return { ok: false, reason: "INVALID_REQUEST_ID" };
  }
  if (!isSafeIdentifier(request.actionType)) {
    return { ok: false, reason: "INVALID_ACTION_TYPE" };
  }
  if (!isSafeIdentifier(request.entityType) || !isSafeIdentifier(request.entityId)) {
    return { ok: false, reason: "INVALID_ENTITY_IDENTITY" };
  }
  if (!isSafeIdentifier(request.idempotencyKey)) {
    return { ok: false, reason: "INVALID_IDEMPOTENCY_KEY" };
  }
  if (!isSafeIdentifier(request.correlationId)) {
    return { ok: false, reason: "INVALID_CORRELATION_ID" };
  }
  if (!request.requestedAt || Number.isNaN(Date.parse(request.requestedAt))) {
    return { ok: false, reason: "INVALID_REQUESTED_AT" };
  }
  if (!isValidAuditActor(request.requestedBy)) {
    return { ok: false, reason: "INVALID_AUDIT_ACTOR" };
  }

  const forbidden = findForbiddenAutomationField(request.safeContext);
  if (forbidden) {
    return {
      ok: false,
      reason: `FORBIDDEN_AUTOMATION_FIELD:${forbidden.path}`,
    };
  }

  return { ok: true };
}

export function buildAutomationJobEnvelope(
  authorized: CoreAuthorizedAction,
  jobId: string,
): AutomationJobEnvelope {
  const requestValidation = validateCoreActionRequestEnvelope(authorized.request);
  if (!requestValidation.ok) throw new Error(requestValidation.reason);
  if (authorized.authorization?.decision !== "authorized") {
    throw new Error("CORE_AUTHORIZATION_REQUIRED");
  }
  if (!isSafeIdentifier(jobId)) throw new Error("INVALID_JOB_ID");
  if (!isSafeIdentifier(authorized.authorization.authorizationId)) {
    throw new Error("INVALID_AUTHORIZATION_ID");
  }
  if (!isValidAuditActor(authorized.authorization.authorizedBy)) {
    throw new Error("INVALID_AUTHORIZATION_ACTOR");
  }
  // The family is only derivable for a REGISTERED action, so an unregistered one
  // cannot produce an envelope at all rather than defaulting to some family.
  if (!isAutomationActionType(authorized.request.actionType)) {
    throw new Error("AUTOMATION_ACTION_TYPE_NOT_REGISTERED");
  }

  return Object.freeze({
    contractVersion: AUTOMATION_CONTRACT_VERSION,
    jobId,
    actionRequestId: authorized.request.requestId,
    actionType: authorized.request.actionType,
    entityType: authorized.request.entityType,
    entityId: authorized.request.entityId,
    source: authorized.request.source,
    idempotencyKey: authorized.request.idempotencyKey,
    correlationId: authorized.request.correlationId,
    authorizedAt: authorized.authorization.authorizedAt,
    authorizedBy: Object.freeze({ ...authorized.authorization.authorizedBy }),
    safeContext: deepFreezeCopy(authorized.request.safeContext),
    workflowFamily: getWorkflowFamilyForAction(authorized.request.actionType),
  });
}

export function createActionIdempotencyKey(input: {
  actionType: string;
  entityType: string;
  entityId: string;
  evidenceId: string;
}): string {
  const parts = [
    "qf_action_v1",
    input.actionType,
    input.entityType,
    input.entityId,
    input.evidenceId,
  ];
  if (parts.slice(1).some((part) => !isSafeIdentifier(part))) {
    throw new Error("INVALID_IDEMPOTENCY_COMPONENT");
  }
  const value = parts.join(":");
  if (!isSafeIdentifier(value)) throw new Error("INVALID_IDEMPOTENCY_KEY");
  return value;
}

export function createActionCorrelationId(input: {
  entityType: string;
  entityId: string;
}): string {
  if (!isSafeIdentifier(input.entityType) || !isSafeIdentifier(input.entityId)) {
    throw new Error("INVALID_CORRELATION_COMPONENT");
  }
  const value = `qf_corr_v1:${input.entityType}:${input.entityId}`;
  if (!isSafeIdentifier(value)) throw new Error("INVALID_CORRELATION_ID");
  return value;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && SAFE_IDENTIFIER.test(value);
}

function isValidAuditActor(value: AutomationAuditActor): boolean {
  return (
    Boolean(value) &&
    AUTOMATION_AUDIT_ACTOR_TYPES.includes(value.actorType) &&
    isSafeIdentifier(value.actorId)
  );
}

function deepFreezeCopy(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return deepFreezeObject(structuredClone(value)) as Readonly<Record<string, unknown>>;
}

function deepFreezeObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (const item of value) deepFreezeObject(item);
    return Object.freeze(value);
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) deepFreezeObject(item);
    return Object.freeze(value);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
