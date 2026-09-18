export const QFJ_SERVICE_AVAILABILITY_PROTOCOL = "qfj.core.service-availability.read" as const;
export const QFJ_SERVICE_AVAILABILITY_VERSION = 1 as const;
export const QFJ_SERVICE_AVAILABILITY_PATH = "/api/internal/jarvis/service-availability" as const;
export const QFJ_SERVICE_AVAILABILITY_SIGNING_DOMAIN = "qfj.core.service-availability.http.sig.v1" as const;

export interface QfjServiceAvailabilityRequestV1 {
  readonly protocol: typeof QFJ_SERVICE_AVAILABILITY_PROTOCOL;
  readonly version: typeof QFJ_SERVICE_AVAILABILITY_VERSION;
  readonly caller: "qf-jarvis";
  readonly audience: "quickfurno-core";
  readonly requestId: string;
  readonly issuedAt: string;
  readonly tenantId: string;
}

const ID128 = /^[A-Za-z0-9._:-]{1,128}$/;
const REF64 = /^[A-Za-z0-9._:-]{1,64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const LABEL = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} .,'&()/+-]*$/u;
const URL_SHAPE = /(?:www\.|maps\.google|openstreetmap|\b[a-z0-9-]+\.(?:com|net|org|in|co|io)\b)/i;
const PHONE_SHAPE = /(?:\+\d[\d\s().-]{6,}\d|\d{10,})/;
const COORDINATE_PAIR = /(?<![\d.])[+-]?(?:[0-8]?\d|90)\.\d{3,}\s*[,;/|]\s*[+-]?(?:1[0-7]\d|[0-9]?\d)\.\d{3,}(?![\d.])/;
const BEARER = /\bBearer\s+[A-Za-z0-9.-]{12,}/i;
const PRIVATE_KEY = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/;
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function validLabel(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 1 && value.length <= 64
    && value === value.trim() && !/\s{2,}/.test(value)
    && LABEL.test(value) && !URL_SHAPE.test(value)
    && !PHONE_SHAPE.test(value) && !COORDINATE_PAIR.test(value)
    && !BEARER.test(value) && !PRIVATE_KEY.test(value);
}

export function parseQfjServiceAvailabilityRequest(value: unknown): QfjServiceAvailabilityRequestV1 | null {
  if (!record(value) || !exactKeys(value, ["protocol","version","caller","audience","requestId","issuedAt","tenantId"])) return null;
  if (value.protocol !== QFJ_SERVICE_AVAILABILITY_PROTOCOL || value.version !== 1 || value.caller !== "qf-jarvis" || value.audience !== "quickfurno-core") return null;
  if (typeof value.requestId !== "string" || !ID128.test(value.requestId) || typeof value.tenantId !== "string" || !ID128.test(value.tenantId)) return null;
  if (typeof value.issuedAt !== "string" || !INSTANT.test(value.issuedAt) || !Number.isFinite(Date.parse(value.issuedAt))) return null;
  return Object.freeze({ protocol:QFJ_SERVICE_AVAILABILITY_PROTOCOL, version:1, caller:"qf-jarvis", audience:"quickfurno-core", requestId:value.requestId, issuedAt:value.issuedAt, tenantId:value.tenantId });
}
export interface QfjServiceAvailabilitySnapshotV1 {
  readonly version: 1;
  readonly snapshotRef: string;
  readonly taxonomyVersion: number;
  readonly cities: readonly Readonly<{ ref:string; displayName:string }>[];
  readonly services: readonly Readonly<{ ref:string; displayName:string }>[];
  readonly availability: readonly Readonly<{ serviceRef:string; cityRefs:readonly string[] }>[];
}

type Node = Readonly<{ref:string;displayName:string}>;
type Row = Readonly<{serviceRef:string;cityRefs:readonly string[]}>;
function parseNode(value: unknown): Node | null {
  if (!record(value) || !exactKeys(value,["ref","displayName"])) return null;
  if (typeof value.ref !== "string" || !REF64.test(value.ref) || !validLabel(value.displayName)) return null;
  return Object.freeze({ref:value.ref,displayName:value.displayName});
}
function parseRow(value: unknown): Row | null {
  if (!record(value) || !exactKeys(value,["serviceRef","cityRefs"])) return null;
  if (typeof value.serviceRef !== "string" || !REF64.test(value.serviceRef) || !Array.isArray(value.cityRefs) || value.cityRefs.length > 64) return null;
  if (value.cityRefs.some((ref) => typeof ref !== "string" || !REF64.test(ref as string))) return null;
  const cityRefs=(value.cityRefs as string[]).slice();
  if (new Set(cityRefs).size !== cityRefs.length) return null;
  return Object.freeze({serviceRef:value.serviceRef,cityRefs:Object.freeze(cityRefs.sort())});
}
export function parseQfjServiceAvailabilitySnapshot(value: unknown): QfjServiceAvailabilitySnapshotV1 | null {
  if (!record(value) || !exactKeys(value,["version","snapshotRef","taxonomyVersion","cities","services","availability"])) return null;
  if (value.version !== 1 || typeof value.snapshotRef !== "string" || !ID128.test(value.snapshotRef)) return null;
  if (!Number.isInteger(value.taxonomyVersion) || (value.taxonomyVersion as number) < 1 || (value.taxonomyVersion as number) > 1_000_000) return null;
  if (!Array.isArray(value.cities) || !Array.isArray(value.services) || !Array.isArray(value.availability)) return null;
  if (value.cities.length > 64 || value.services.length > 64 || value.availability.length > 64) return null;
  const cities=value.cities.map(parseNode), services=value.services.map(parseNode), rows=value.availability.map(parseRow);
  if (cities.some((v)=>!v) || services.some((v)=>!v) || rows.some((v)=>!v)) return null;
  const cityNodes=cities as Node[], serviceNodes=services as Node[], availability=rows as Row[];
  const cityRefs=cityNodes.map((v)=>v.ref), serviceRefs=serviceNodes.map((v)=>v.ref), rowRefs=availability.map((v)=>v.serviceRef);
  if (new Set(cityRefs).size !== cityRefs.length || new Set(serviceRefs).size !== serviceRefs.length || new Set(rowRefs).size !== rowRefs.length) return null;
  const citySet=new Set(cityRefs), serviceSet=new Set(serviceRefs);
  if (rowRefs.length !== serviceRefs.length || rowRefs.some((ref)=>!serviceSet.has(ref)) || serviceRefs.some((ref)=>!rowRefs.includes(ref))) return null;
  if (availability.some((row)=>row.cityRefs.some((ref)=>!citySet.has(ref)))) return null;
  const byRef=<T extends {ref:string}>(a:T,b:T)=>a.ref<b.ref?-1:a.ref>b.ref?1:0;
  const byService=(a:Row,b:Row)=>a.serviceRef<b.serviceRef?-1:a.serviceRef>b.serviceRef?1:0;
  const snapshot=Object.freeze({
    version:1 as const, snapshotRef:value.snapshotRef, taxonomyVersion:value.taxonomyVersion as number,
    cities:Object.freeze(cityNodes.slice().sort(byRef)), services:Object.freeze(serviceNodes.slice().sort(byRef)),
    availability:Object.freeze(availability.slice().sort(byService)),
  });
  return JSON.stringify(snapshot).length <= 6000 ? snapshot : null;
}
