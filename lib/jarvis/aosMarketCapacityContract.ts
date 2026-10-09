export const QFJ_AOS_MARKET_CAPACITY_PROTOCOL = "qfj.aos.market-capacity.read" as const;
export const QFJ_AOS_MARKET_CAPACITY_VERSION = 1 as const;
export const QFJ_AOS_MARKET_CAPACITY_PATH = "/api/internal/jarvis/aos-market-capacity" as const;
export const QFJ_AOS_MARKET_CAPACITY_SIGNING_DOMAIN = "qfj.aos.market-capacity.http.sig.v1" as const;

export interface QfjAosMarketCapacityRequestV1 {
  readonly protocol: typeof QFJ_AOS_MARKET_CAPACITY_PROTOCOL;
  readonly version: typeof QFJ_AOS_MARKET_CAPACITY_VERSION;
  readonly caller: "qf-jarvis";
  readonly audience: "quickfurno-core";
  readonly requestId: string;
  readonly issuedAt: string;
  readonly tenantId: string;
}

export interface QfjAosMarketCapacityCellV1 {
  readonly cellRef: string;
  readonly cityRef: string;
  readonly localityRef: string;
  readonly categoryRef: string;
  readonly demand7d: number;
  readonly demand30d: number;
  readonly demand90d: number;
  readonly registeredSupply: number;
  readonly eligibleSupply: number;
  readonly activeSupply: number;
  readonly creditReadySupply: number;
  readonly threeVendorFillRate: number;
}

export interface QfjAosMarketCapacitySnapshotV1 {
  readonly protocol: "qfj.aos.market-capacity.snapshot.v1";
  readonly observedAt: string;
  readonly windowDays: 90;
  readonly vendorOpportunityPerLead: 3;
  readonly responseEvidence: "UNAVAILABLE";
  readonly coverage: Readonly<{
    demandRows:number;
    excludedDemandRows:number;
    vendorRows:number;
    excludedVendorRows:number;
    assignmentRows:number;
    cellsTotal:number;
    cellsReturned:number;
    cellsTruncated:boolean;
  }>;
  readonly cells: readonly QfjAosMarketCapacityCellV1[];
}

const REF=/^[A-Za-z0-9._:-]{1,128}$/u;
const INSTANT=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

function record(value:unknown):value is Record<string,unknown>{
  return !!value&&typeof value==="object"&&!Array.isArray(value);
}
function exactKeys(value:Record<string,unknown>,keys:readonly string[]):boolean{
  const actual=Object.keys(value).sort(),expected=[...keys].sort();
  return actual.length===expected.length&&actual.every((key,index)=>key===expected[index]);
}
export function parseQfjAosMarketCapacityRequest(value:unknown):QfjAosMarketCapacityRequestV1|null{
  if(!record(value)||!exactKeys(value,["protocol","version","caller","audience","requestId","issuedAt","tenantId"]))return null;
  if(
    value.protocol!==QFJ_AOS_MARKET_CAPACITY_PROTOCOL||
    value.version!==QFJ_AOS_MARKET_CAPACITY_VERSION||
    value.caller!=="qf-jarvis"||
    value.audience!=="quickfurno-core"
  )return null;
  if(
    typeof value.requestId!=="string"||!REF.test(value.requestId)||
    typeof value.tenantId!=="string"||!REF.test(value.tenantId)||
    typeof value.issuedAt!=="string"||!INSTANT.test(value.issuedAt)||
    !Number.isFinite(Date.parse(value.issuedAt))
  )return null;
  return Object.freeze({
    protocol:QFJ_AOS_MARKET_CAPACITY_PROTOCOL,
    version:QFJ_AOS_MARKET_CAPACITY_VERSION,
    caller:"qf-jarvis",
    audience:"quickfurno-core",
    requestId:value.requestId,
    issuedAt:value.issuedAt,
    tenantId:value.tenantId,
  });
}
