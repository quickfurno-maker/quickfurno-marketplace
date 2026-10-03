export const QFJ_AAROHI_PHASE2_PROTOCOL = "qfj.aarohi.phase2" as const;
export const QFJ_AAROHI_PHASE2_VERSION = 1 as const;
export const QFJ_AAROHI_PHASE2_PATH = "/api/internal/jarvis/aarohi-phase2" as const;
export const QFJ_AAROHI_PHASE2_SIGNING_DOMAIN = "qfj.aarohi.phase2.http.sig.v1" as const;

export const QFJ_AAROHI_PHASE2_OPERATIONS = [
  "CLAIM_DISCOVERY_RUN",
  "SUBMIT_DISCOVERY_CANDIDATES",
  "COMPLETE_DISCOVERY_RUN",
  "CLAIM_SOCIAL_OUTREACH",
  "COMPLETE_SOCIAL_OUTREACH",
  "SUBMIT_SOCIAL_REPLY",
] as const;
export type QfjAarohiPhase2OperationKind = typeof QFJ_AAROHI_PHASE2_OPERATIONS[number];

type RecordLike = Record<string,unknown>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSTANT=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const REF=/^[A-Za-z0-9._:-]{1,300}$/;
const E164=/^\+[1-9][0-9]{7,14}$/;

export type QfjAarohiPhase2Request = Readonly<{
  protocol:typeof QFJ_AAROHI_PHASE2_PROTOCOL;
  version:1;
  caller:"qf-jarvis";
  audience:"quickfurno-core";
  requestId:string;
  issuedAt:string;
  tenantId:"quickfurno";
  operation:Readonly<{
    kind:QfjAarohiPhase2OperationKind;
    payload:RecordLike;
  }>;
}>;

function record(value:unknown):value is RecordLike{
  return !!value&&typeof value==="object"&&!Array.isArray(value);
}
function exactKeys(value:RecordLike,keys:readonly string[]):boolean{
  const actual=Object.keys(value).sort();
  const expected=[...keys].sort();
  return actual.length===expected.length&&actual.every((key,index)=>key===expected[index]);
}
function string(value:unknown,min=1,max=500):value is string{
  return typeof value==="string"&&value.trim().length>=min&&value.length<=max;
}
function optionalString(value:unknown,max=500):boolean{
  return value===undefined||value===null||(typeof value==="string"&&value.length<=max);
}
function validInstant(value:unknown):value is string{
  return typeof value==="string"&&INSTANT.test(value)&&Number.isFinite(Date.parse(value));
}

function parseCandidate(value:unknown):RecordLike|null{
  if(!record(value)) return null;
  const allowed=[
    "sourceType","externalReference","profileUrl","businessName","cityHint","categoryHint",
    "website","phoneE164","email","confidence","metadata","observedAt",
  ];
  if(Object.keys(value).some(key=>!allowed.includes(key))) return null;
  if(
    !["INSTAGRAM","FACEBOOK","X","GOOGLE","WEBSITE","JUSTDIAL","INDIAMART"].includes(String(value.sourceType))||
    !string(value.externalReference,1,300)||
    !string(value.businessName,2,240)||
    !optionalString(value.profileUrl,500)||
    !optionalString(value.cityHint,120)||
    !optionalString(value.categoryHint,160)||
    !optionalString(value.website,500)||
    !optionalString(value.email,254)||
    !(value.phoneE164===undefined||value.phoneE164===null||(typeof value.phoneE164==="string"&&E164.test(value.phoneE164)))||
    !(value.confidence===undefined||(typeof value.confidence==="number"&&Number.isInteger(value.confidence)&&value.confidence>=0&&value.confidence<=100))||
    !(value.metadata===undefined||record(value.metadata))||
    !(value.observedAt===undefined||value.observedAt===null||validInstant(value.observedAt))
  ) return null;
  if(record(value.metadata)&&Object.keys(value.metadata).length>30) return null;
  return value;
}

function parseOperation(value:unknown):QfjAarohiPhase2Request["operation"]|null{
  if(!record(value)||!exactKeys(value,["kind","payload"])||!record(value.payload)) return null;
  const kind=String(value.kind) as QfjAarohiPhase2OperationKind;
  if(!QFJ_AAROHI_PHASE2_OPERATIONS.includes(kind)) return null;
  const payload=value.payload;
  if(kind==="CLAIM_DISCOVERY_RUN"){
    if(!exactKeys(payload,["workerRef"])||!string(payload.workerRef,1,128)||!REF.test(String(payload.workerRef))) return null;
  }else if(kind==="SUBMIT_DISCOVERY_CANDIDATES"){
    if(!exactKeys(payload,["runId","connectorId","candidates"])||!UUID.test(String(payload.runId))||!UUID.test(String(payload.connectorId))||!Array.isArray(payload.candidates)||payload.candidates.length<1||payload.candidates.length>100) return null;
    if(payload.candidates.some(candidate=>parseCandidate(candidate)===null)) return null;
  }else if(kind==="COMPLETE_DISCOVERY_RUN"){
    const keys=Object.keys(payload);
    if(keys.some(key=>!["runId","state","candidateCount","promotedCount","errorCode"].includes(key))||!["runId","state","candidateCount","promotedCount"].every(key=>keys.includes(key))) return null;
    if(
      !UUID.test(String(payload.runId))||
      !["COMPLETED","PARTIAL","FAILED","CANCELLED"].includes(String(payload.state))||
      !Number.isSafeInteger(payload.candidateCount)||Number(payload.candidateCount)<0||
      !Number.isSafeInteger(payload.promotedCount)||Number(payload.promotedCount)<0||Number(payload.promotedCount)>Number(payload.candidateCount)||
      !optionalString(payload.errorCode,160)
    ) return null;
  }else if(kind==="CLAIM_SOCIAL_OUTREACH"){
    if(!exactKeys(payload,["workerRef"])||!string(payload.workerRef,1,128)||!REF.test(String(payload.workerRef))) return null;
  }else if(kind==="COMPLETE_SOCIAL_OUTREACH"){
    const keys=Object.keys(payload);
    if(keys.some(key=>!["jobId","executionToken","outcome","providerMessageRef","errorCode"].includes(key))||!["jobId","executionToken","outcome"].every(key=>keys.includes(key))) return null;
    if(
      !UUID.test(String(payload.jobId))||
      !UUID.test(String(payload.executionToken))||
      !["ACCEPTED","DEFINITIVE_FAILURE","UNCERTAIN"].includes(String(payload.outcome))||
      !optionalString(payload.providerMessageRef,300)||
      !optionalString(payload.errorCode,160)
    ) return null;
    if(payload.outcome==="ACCEPTED"&&!string(payload.providerMessageRef,1,300)) return null;
  }else{
    const keys=Object.keys(payload);
    if(keys.some(key=>!["prospectId","channel","threadRef","messageRef","replyKind","safeSummary","occurredAt","phoneE164"].includes(key))||!["prospectId","channel","threadRef","messageRef","replyKind","safeSummary","occurredAt"].every(key=>keys.includes(key))) return null;
    if(
      !UUID.test(String(payload.prospectId))||
      !["INSTAGRAM","FACEBOOK","X"].includes(String(payload.channel))||
      !string(payload.threadRef,1,300)||
      !string(payload.messageRef,1,300)||
      !["INTERESTED","WHATSAPP_SHARED","STOP","OTHER"].includes(String(payload.replyKind))||
      !string(payload.safeSummary,1,500)||
      !validInstant(payload.occurredAt)||
      !(payload.phoneE164===undefined||payload.phoneE164===null||(typeof payload.phoneE164==="string"&&E164.test(payload.phoneE164)))
    ) return null;
    if(payload.replyKind==="WHATSAPP_SHARED"&&typeof payload.phoneE164!=="string") return null;
  }
  return Object.freeze({kind,payload:Object.freeze({...payload})});
}

export function parseQfjAarohiPhase2Request(value:unknown):QfjAarohiPhase2Request|null{
  if(!record(value)||!exactKeys(value,[
    "protocol","version","caller","audience","requestId","issuedAt","tenantId","operation",
  ])) return null;
  if(
    value.protocol!==QFJ_AAROHI_PHASE2_PROTOCOL||
    value.version!==1||
    value.caller!=="qf-jarvis"||
    value.audience!=="quickfurno-core"||
    value.tenantId!=="quickfurno"||
    typeof value.requestId!=="string"||!UUID.test(value.requestId)||
    !validInstant(value.issuedAt)
  ) return null;
  const operation=parseOperation(value.operation);
  if(!operation) return null;
  return Object.freeze({
    protocol:QFJ_AAROHI_PHASE2_PROTOCOL,
    version:1,
    caller:"qf-jarvis",
    audience:"quickfurno-core",
    requestId:value.requestId,
    issuedAt:value.issuedAt,
    tenantId:"quickfurno",
    operation,
  });
}
