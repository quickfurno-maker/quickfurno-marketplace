export const QFJ_CONTEXT_PROTOCOL = "qfj.context.read" as const;
export const QFJ_CONTEXT_VERSION = 1 as const;
export const QFJ_CONTEXT_PATH = "/api/internal/jarvis/context" as const;
export const QFJ_CONTEXT_SIGNING_DOMAIN = "qfj.context.read.http.sig.v1" as const;
export const QFJ_CONTEXT_ACTORS = ["RIYA", "ANISHA", "JARVIS"] as const;
export const QFJ_CONTEXT_ENTITY_TYPES = ["lead", "vendor"] as const;
export type QfjContextActor = (typeof QFJ_CONTEXT_ACTORS)[number];
export type QfjContextEntityType = (typeof QFJ_CONTEXT_ENTITY_TYPES)[number];

export interface QfjContextReadRequestV1 {
  readonly protocol: typeof QFJ_CONTEXT_PROTOCOL;
  readonly version: typeof QFJ_CONTEXT_VERSION;
  readonly caller: "qf-jarvis";
  readonly audience: "quickfurno-core";
  readonly requestId: string;
  readonly issuedAt: string;
  readonly actor: QfjContextActor;
  readonly entityType: QfjContextEntityType;
  readonly entityId: string;
}

const ID = /^[A-Za-z0-9._:-]{1,240}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function isInstant(value: unknown): value is string { return typeof value === "string" && INSTANT.test(value) && Number.isFinite(Date.parse(value)); }

export function parseQfjContextReadRequest(value: unknown): QfjContextReadRequestV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (!exactKeys(r, ["protocol","version","caller","audience","requestId","issuedAt","actor","entityType","entityId"])) return null;
  if (r.protocol !== QFJ_CONTEXT_PROTOCOL || r.version !== QFJ_CONTEXT_VERSION || r.caller !== "qf-jarvis" || r.audience !== "quickfurno-core") return null;
  if (typeof r.requestId !== "string" || !ID.test(r.requestId) || !isInstant(r.issuedAt)) return null;
  if (!QFJ_CONTEXT_ACTORS.includes(r.actor as QfjContextActor) || !QFJ_CONTEXT_ENTITY_TYPES.includes(r.entityType as QfjContextEntityType)) return null;
  if (typeof r.entityId !== "string" || !ID.test(r.entityId)) return null;
  if (r.actor === "RIYA" && r.entityType !== "lead") return null;
  if (r.actor === "ANISHA" && r.entityType !== "vendor") return null;
  return Object.freeze({ protocol: QFJ_CONTEXT_PROTOCOL, version: QFJ_CONTEXT_VERSION, caller: "qf-jarvis", audience: "quickfurno-core",
    requestId: r.requestId, issuedAt: r.issuedAt, actor: r.actor as QfjContextActor, entityType: r.entityType as QfjContextEntityType, entityId: r.entityId });
}

export type QfjLeadContext = Readonly<{ kind: "client_lead"; leadId: string; city: string | null; serviceRequired: string | null; budgetBand: string | null; propertyType: string | null; timeline: string | null; leadStatus: string | null; verificationStatus: string | null; isDuplicate: boolean }>;
export type QfjVendorContext = Readonly<{ kind: "vendor_profile"; vendorId: string; city: string | null; serviceCategories: readonly string[]; vendorStatus: string | null; isActive: boolean; publicVisibility: boolean; paidStatus: string | null; packageReadinessBand: "UNKNOWN" | "NOT_ACTIVE" | "NO_PACKAGE" | "LOW_CREDITS" | "READY" }>;
export type QfjSanitizedContext = QfjLeadContext | QfjVendorContext;