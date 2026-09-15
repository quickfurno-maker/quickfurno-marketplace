export const QFJ_CORE_DECISION_PROTOCOL = Object.freeze({
  name: "qfj.core.decision",
  version: 2,
  contractDigest: "c0de0002",
} as const);

export const QFJ_CORE_DECISION_OUTCOMES = [
  "ACCEPTED",
  "REJECTED",
  "HUMAN_REVIEW_REQUIRED",
  "RETRY_LATER",
  "STALE_REVISION",
  "CORE_UNAVAILABLE",
] as const;
export type QfjCoreDecisionOutcome = (typeof QFJ_CORE_DECISION_OUTCOMES)[number];

export const QFJ_CORE_PROPOSAL_KINDS = [
  "REPLY",
  "FOLLOW_UP",
  "ESCALATE_TO_HUMAN",
  "REQUEST_CLARIFICATION",
  "NO_ACTION",
] as const;
export type QfjCoreProposalKind = (typeof QFJ_CORE_PROPOSAL_KINDS)[number];

export const QFJ_RUNTIME_ACTORS = ["RIYA", "ANISHA", "AAROHI", "JARVIS", "HUMAN", "SYSTEM"] as const;
export type QfjRuntimeActor = (typeof QFJ_RUNTIME_ACTORS)[number];
export const QFJ_RUNTIME_PARTY_TYPES = ["CLIENT", "VENDOR", "PROSPECT", "UNKNOWN"] as const;
export type QfjRuntimePartyType = (typeof QFJ_RUNTIME_PARTY_TYPES)[number];

export interface QfjKnowledgeCitationV2 {
  readonly knowledgeId: string;
  readonly version: number;
  readonly source: string;
  readonly digest: string;
}

export interface QfjCoreDecisionCommandV2 {
  readonly protocol: typeof QFJ_CORE_DECISION_PROTOCOL;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly proposalId: string;
  readonly proposalVersion: number;
  readonly conversationId: string;
  readonly expectedRevision: number;
  readonly proposalDigest: string;
  readonly assignedActor: QfjRuntimeActor;
  readonly partyType: QfjRuntimePartyType;
  readonly proposalKind: QfjCoreProposalKind;
  readonly structuredIntent: Readonly<Record<string, string | number | boolean>>;
  readonly policyRevision: string;
  readonly evaluationRef: string | null;
  readonly citations: readonly QfjKnowledgeCitationV2[];
  readonly proposedReplyBody: string | null;
  readonly createdAt: string;
}

export interface QfjCoreDecisionResponseV2 {
  readonly protocol: typeof QFJ_CORE_DECISION_PROTOCOL;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly proposalId: string;
  readonly proposalVersion: number;
  readonly conversationId: string;
  readonly boundRevision: number;
  readonly proposalDigest: string;
  readonly outcome: QfjCoreDecisionOutcome;
  readonly reason: string;
  readonly decidedAt: string;
}

export type QfjCoreCommandParseResult =
  | { readonly ok: true; readonly command: QfjCoreDecisionCommandV2 }
  | { readonly ok: false; readonly reason: string };

const ID = /^[A-Za-z0-9._:-]{1,128}$/;
const DIGEST = /^[0-9a-f]{8,64}$/;
const REASON = /^[A-Za-z0-9._:-]{1,128}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const INTENT_KEY = /^[A-Za-z0-9._:-]{1,64}$/;
const COMMAND_KEYS = [
  "protocol", "commandId", "idempotencyKey", "correlationId", "proposalId", "proposalVersion",
  "conversationId", "expectedRevision", "proposalDigest", "assignedActor", "partyType", "proposalKind",
  "structuredIntent", "policyRevision", "evaluationRef", "citations", "proposedReplyBody", "createdAt",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
}
function isCanonicalInstant(value: unknown): value is string {
  return typeof value === "string" && INSTANT.test(value) && Number.isFinite(Date.parse(value));
}
function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
function isEnum<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}
function isProtocol(value: unknown): value is typeof QFJ_CORE_DECISION_PROTOCOL {
  if (!isRecord(value) || !hasExactKeys(value, ["name", "version", "contractDigest"])) return false;
  return value.name === QFJ_CORE_DECISION_PROTOCOL.name && value.version === QFJ_CORE_DECISION_PROTOCOL.version && value.contractDigest === QFJ_CORE_DECISION_PROTOCOL.contractDigest;
}
function isIntent(value: unknown): value is Record<string, string | number | boolean> {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, item]) =>
    INTENT_KEY.test(key) &&
    ((typeof item === "string" && item.length <= 1024) || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))),
  );
}
function isCitation(value: unknown): value is QfjKnowledgeCitationV2 {
  if (!isRecord(value) || !hasExactKeys(value, ["knowledgeId", "version", "source", "digest"])) return false;
  return typeof value.knowledgeId === "string" && ID.test(value.knowledgeId) && isInt(value.version, 1, 1_000_000) &&
    typeof value.source === "string" && value.source.length >= 1 && value.source.length <= 256 &&
    typeof value.digest === "string" && DIGEST.test(value.digest);
}
function actorPartyCompatible(actor: QfjRuntimeActor, partyType: QfjRuntimePartyType): boolean {
  if (actor === "RIYA") return partyType === "CLIENT";
  if (actor === "ANISHA") return partyType === "VENDOR";
  if (actor === "AAROHI") return partyType === "PROSPECT";
  return actor === "JARVIS" || actor === "HUMAN" || actor === "SYSTEM";
}

export function parseQfjCoreDecisionCommand(value: unknown): QfjCoreCommandParseResult {
  if (!isRecord(value) || !hasExactKeys(value, COMMAND_KEYS)) return { ok: false, reason: "invalid_command_shape" };
  if (!isProtocol(value.protocol)) return { ok: false, reason: "protocol_mismatch" };
  if (typeof value.commandId !== "string" || value.commandId.length < 1 || value.commandId.length > 256) return { ok: false, reason: "invalid_command_id" };
  if (typeof value.idempotencyKey !== "string" || !DIGEST.test(value.idempotencyKey)) return { ok: false, reason: "invalid_idempotency_key" };
  if (typeof value.correlationId !== "string" || !ID.test(value.correlationId)) return { ok: false, reason: "invalid_correlation_id" };
  if (typeof value.proposalId !== "string" || !ID.test(value.proposalId)) return { ok: false, reason: "invalid_proposal_id" };
  if (!isInt(value.proposalVersion, 1, 1_000_000) || !isInt(value.expectedRevision, 0, Number.MAX_SAFE_INTEGER)) return { ok: false, reason: "invalid_revision" };
  if (typeof value.conversationId !== "string" || !ID.test(value.conversationId)) return { ok: false, reason: "invalid_conversation_id" };
  if (typeof value.proposalDigest !== "string" || !DIGEST.test(value.proposalDigest)) return { ok: false, reason: "invalid_proposal_digest" };
  if (!isEnum(value.assignedActor, QFJ_RUNTIME_ACTORS) || !isEnum(value.partyType, QFJ_RUNTIME_PARTY_TYPES) || !actorPartyCompatible(value.assignedActor, value.partyType)) return { ok: false, reason: "scope_violation" };
  if (!isEnum(value.proposalKind, QFJ_CORE_PROPOSAL_KINDS) || !isIntent(value.structuredIntent)) return { ok: false, reason: "invalid_proposal" };
  if (typeof value.policyRevision !== "string" || !ID.test(value.policyRevision)) return { ok: false, reason: "invalid_policy_revision" };
  if (value.evaluationRef !== null && (typeof value.evaluationRef !== "string" || !ID.test(value.evaluationRef))) return { ok: false, reason: "invalid_evaluation_ref" };
  if (!Array.isArray(value.citations) || value.citations.length > 64 || !value.citations.every(isCitation)) return { ok: false, reason: "invalid_citations" };
  const bodyShouldExist = value.proposalKind === "REPLY" || value.proposalKind === "FOLLOW_UP";
  const bodyValid = typeof value.proposedReplyBody === "string" && value.proposedReplyBody.length >= 1 && value.proposedReplyBody.length <= 8192;
  if ((bodyShouldExist && !bodyValid) || (!bodyShouldExist && value.proposedReplyBody !== null)) return { ok: false, reason: "invalid_reply_body" };
  if (!isCanonicalInstant(value.createdAt)) return { ok: false, reason: "invalid_created_at" };
  return { ok: true, command: value as unknown as QfjCoreDecisionCommandV2 };
}

export function parseSerializedQfjCoreDecisionCommand(serialized: string): QfjCoreCommandParseResult {
  if (typeof serialized !== "string" || serialized.length < 2 || serialized.length > 32_768) return { ok: false, reason: "invalid_command_body" };
  try { return parseQfjCoreDecisionCommand(JSON.parse(serialized)); } catch { return { ok: false, reason: "invalid_json" }; }
}

export function buildQfjCoreDecisionResponse(command: QfjCoreDecisionCommandV2, outcome: QfjCoreDecisionOutcome, reason: string, decidedAt: string): QfjCoreDecisionResponseV2 {
  if (!QFJ_CORE_DECISION_OUTCOMES.includes(outcome) || !REASON.test(reason) || !isCanonicalInstant(decidedAt)) throw new Error("INVALID_CORE_DECISION_RESPONSE");
  return Object.freeze({
    protocol: QFJ_CORE_DECISION_PROTOCOL, commandId: command.commandId, idempotencyKey: command.idempotencyKey,
    proposalId: command.proposalId, proposalVersion: command.proposalVersion, conversationId: command.conversationId,
    boundRevision: command.expectedRevision, proposalDigest: command.proposalDigest, outcome, reason, decidedAt,
  });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) { const out: Record<string, unknown> = {}; for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]); return out; }
  return value;
}
export function canonicalQfjJson(value: unknown): string { return JSON.stringify(canonicalize(value)); }
