import { findForbiddenAutomationField, type AutomationRequestSource } from "../automation/actionContract";
import { isAutomationActionType, type AutomationActionType } from "../automation/actionRegistry";

export const QFJ_ACTION_REQUEST_PROTOCOL = "qfj.action.request" as const;
export const QFJ_ACTION_REQUEST_VERSION = 1 as const;
export const QFJ_ACTION_REQUEST_PATH = "/api/internal/jarvis/action-request" as const;
export const QFJ_ACTION_REQUEST_SIGNING_DOMAIN = "qfj.action.request.http.sig.v1" as const;
export const QFJ_ACTION_SOURCES = ["jarvis", "riya", "anisha"] as const;
export type QfjActionSource = Extract<AutomationRequestSource, "jarvis" | "riya" | "anisha">;

export const RIYA_RECOMMENDABLE_ACTIONS = new Set<AutomationActionType>([
  "client.requirement_collection", "client.missing_information_reminder", "client.matching_update", "client.lead_status_update",
]);
export const ANISHA_RECOMMENDABLE_ACTIONS = new Set<AutomationActionType>([
  "vendor.onboarding_reminder", "vendor.document_reminder", "vendor.package_expiry_warning", "vendor.low_credit_warning",
]);
export const QFJ_RECOMMENDABLE_ACTIONS = new Set<AutomationActionType>([...RIYA_RECOMMENDABLE_ACTIONS, ...ANISHA_RECOMMENDABLE_ACTIONS]);

export interface QfjActionRequestV1 {
  readonly protocol: typeof QFJ_ACTION_REQUEST_PROTOCOL;
  readonly version: typeof QFJ_ACTION_REQUEST_VERSION;
  readonly caller: "qf-jarvis";
  readonly audience: "quickfurno-core";
  readonly requestId: string;
  readonly issuedAt: string;
  readonly source: QfjActionSource;
  readonly actionType: AutomationActionType;
  readonly entityType: "lead" | "vendor";
  readonly entityId: string;
  readonly evidenceId: string;
  readonly reasonCode: string;
  readonly confidence: number;
  readonly safeContext: Readonly<Record<string, string | number | boolean>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;
const MACHINE = /^[A-Za-z0-9._:-]{1,128}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const a=Object.keys(value).sort(), e=[...keys].sort(); return a.length===e.length && a.every((k,i)=>k===e[i]); }
function safeContext(value: unknown): value is Readonly<Record<string,string|number|boolean>> {
  if (!value || typeof value !== "object" || Array.isArray(value) || findForbiddenAutomationField(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>); if (entries.length > 16) return false;
  return entries.every(([key,item]) => MACHINE.test(key) && ((typeof item === "string" && item.length <= 240) || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))));
}
function sourceCanRecommend(source: QfjActionSource, action: AutomationActionType): boolean {
  if (source === "riya") return RIYA_RECOMMENDABLE_ACTIONS.has(action);
  if (source === "anisha") return ANISHA_RECOMMENDABLE_ACTIONS.has(action);
  return QFJ_RECOMMENDABLE_ACTIONS.has(action);
}
export function parseQfjActionRequest(value: unknown): QfjActionRequestV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null; const r=value as Record<string,unknown>;
  if (!exactKeys(r,["protocol","version","caller","audience","requestId","issuedAt","source","actionType","entityType","entityId","evidenceId","reasonCode","confidence","safeContext"])) return null;
  if (r.protocol!==QFJ_ACTION_REQUEST_PROTOCOL || r.version!==1 || r.caller!=="qf-jarvis" || r.audience!=="quickfurno-core") return null;
  if (typeof r.requestId!=="string" || !UUID.test(r.requestId) || typeof r.issuedAt!=="string" || !INSTANT.test(r.issuedAt) || !Number.isFinite(Date.parse(r.issuedAt))) return null;
  if (!QFJ_ACTION_SOURCES.includes(r.source as QfjActionSource) || !isAutomationActionType(r.actionType)) return null;
  const source=r.source as QfjActionSource, action=r.actionType as AutomationActionType; if (!sourceCanRecommend(source,action)) return null;
  const entityType=action.startsWith("client.") ? "lead" : "vendor"; if (r.entityType!==entityType) return null;
  if (typeof r.entityId!=="string" || !ID.test(r.entityId) || typeof r.evidenceId!=="string" || !ID.test(r.evidenceId) || typeof r.reasonCode!=="string" || !MACHINE.test(r.reasonCode)) return null;
  if (typeof r.confidence!=="number" || !Number.isFinite(r.confidence) || r.confidence<0 || r.confidence>1 || !safeContext(r.safeContext)) return null;
  return Object.freeze({ protocol:QFJ_ACTION_REQUEST_PROTOCOL, version:1, caller:"qf-jarvis", audience:"quickfurno-core", requestId:r.requestId, issuedAt:r.issuedAt,
    source, actionType:action, entityType, entityId:r.entityId, evidenceId:r.evidenceId, reasonCode:r.reasonCode, confidence:r.confidence, safeContext:Object.freeze({ ...(r.safeContext as Record<string,string|number|boolean>) }) });
}