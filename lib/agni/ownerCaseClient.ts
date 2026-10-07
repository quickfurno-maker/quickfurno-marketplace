import "server-only";

import { createHash, createPrivateKey, randomUUID, sign } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

const PATH="/v2/cases/ingest";
const PROTOCOL="agni.m2m.http.v1";
const SIGNING_DOMAIN="agni.m2m.http.sig.v1";
const CLIENT="quickfurno-core";
const MACHINE=/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;

export interface QuickFurnoAgniOwnerCaseInput{
  readonly sourceRef:string;
  readonly subjectType:"CLIENT"|"VENDOR"|"PROSPECT"|"SYSTEM"|"AGENT"|"UNKNOWN";
  readonly subjectRef?:string;
  readonly domain:
    "CLIENT_SUPPORT"|"VENDOR_SUPPORT"|"ACQUISITION"|"AUTH"|"LEAD_ASSIGNMENT"|"MATCHING"|
    "PAYMENT"|"WHATSAPP"|"AGENT"|"INFRA"|"SECURITY"|"OTHER";
  readonly severity:"INFO"|"WARNING"|"CRITICAL"|"EMERGENCY";
  readonly summaryCode:string;
  readonly evidenceRefs?:readonly string[];
  readonly platformFault?:Readonly<{
    targetSystem:"QUICKFURNO"|"JARVIS";
    targetService:string;
    category:"RELIABILITY"|"SECURITY"|"PERFORMANCE"|"COST"|"DEPENDENCY"|"OBSERVABILITY";
    signalType:string;
  }>;
}

function hash(raw:Uint8Array):string{
  return createHash("sha256").update(raw).digest("base64url");
}
function deterministicCaseId(value:string):string{
  const bytes=Buffer.from(createHash("sha256").update(value,"utf8").digest().subarray(0,16));
  bytes[6]=(bytes[6]!&0x0f)|0x50;
  bytes[8]=(bytes[8]!&0x3f)|0x80;
  const hex=bytes.toString("hex");
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join("-");
}
function config():Readonly<{baseUrl:string;keyId:string;privateKeyPem:string;timeoutMs:number}>|null{
  const rawUrl=process.env.QF_AGNI_CASE_BASE_URL?.trim();
  const keyId=process.env.QF_AGNI_CASE_KEY_ID?.trim();
  const keyFile=process.env.QF_AGNI_CASE_PRIVATE_KEY_FILE?.trim();
  if(!rawUrl||!keyId||!keyFile)return null;
  if(!MACHINE.test(keyId)||!isAbsolute(keyFile))return null;
  let url:URL;
  try{url=new URL(rawUrl);}catch{return null;}
  if(
    !["http:","https:"].includes(url.protocol)||url.username||url.password||url.search||url.hash||
    url.pathname!=="/"
  )return null;
  try{
    const stat=statSync(keyFile);
    if(!stat.isFile()||stat.size<80||stat.size>16_384)return null;
    const privateKeyPem=readFileSync(keyFile,"utf8").trim();
    const key=createPrivateKey(privateKeyPem);
    if(key.type!=="private"||key.asymmetricKeyType!=="ed25519")return null;
    const timeout=Number(process.env.QF_AGNI_CASE_TIMEOUT_MS??"1500");
    if(!Number.isSafeInteger(timeout)||timeout<100||timeout>5000)return null;
    return Object.freeze({baseUrl:url.toString(),keyId,privateKeyPem,timeoutMs:timeout});
  }catch{return null;}
}

export async function emitAgniOwnerCaseBestEffort(
  input:QuickFurnoAgniOwnerCaseInput,
):Promise<boolean>{
  const cfg=config();
  if(!cfg)return false;
  if(
    !MACHINE.test(input.sourceRef)||!MACHINE.test(input.summaryCode)||
    (input.subjectRef!==undefined&&!MACHINE.test(input.subjectRef))||
    (input.evidenceRefs??[]).length>24||
    (input.evidenceRefs??[]).some((ref)=>!MACHINE.test(ref))
  )return false;
  const caseId=deterministicCaseId([
    input.sourceRef,input.domain,input.summaryCode,input.subjectRef??"none",
  ].join(":"));
  const raw=Buffer.from(JSON.stringify({
    protocol:"qf.owner.case.v1",
    caseId,
    sourceSystem:"QUICKFURNO",
    sourceRef:input.sourceRef,
    subjectType:input.subjectType,
    ...(input.subjectRef===undefined?{}:{subjectRef:input.subjectRef}),
    domain:input.domain,
    severity:input.severity,
    summaryCode:input.summaryCode,
    evidenceRefs:[...new Set(input.evidenceRefs??[])],
    ...(input.platformFault===undefined?{}:{platformFault:input.platformFault}),
  }),"utf8");
  const requestId=randomUUID();
  const issuedAt=new Date();
  const deadlineAt=new Date(issuedAt.getTime()+cfg.timeoutMs);
  const signing=[
    SIGNING_DOMAIN,PROTOCOL,"POST",PATH,CLIENT,requestId,issuedAt.toISOString(),
    deadlineAt.toISOString(),cfg.keyId,hash(raw),
  ].join("\n");
  const signature=sign(
    null,Buffer.from(signing,"utf8"),createPrivateKey(cfg.privateKeyPem),
  ).toString("base64url");
  try{
    const response=await fetch(new URL(PATH,cfg.baseUrl),{
      method:"POST",
      headers:{
        "x-agni-protocol":PROTOCOL,
        "x-agni-client":CLIENT,
        "x-agni-request-id":requestId,
        "x-agni-issued-at":issuedAt.toISOString(),
        "x-agni-deadline-at":deadlineAt.toISOString(),
        "x-agni-key-id":cfg.keyId,
        "x-agni-signature":signature,
        "content-type":"application/json",
      },
      body:raw,
      redirect:"error",
      signal:AbortSignal.timeout(cfg.timeoutMs),
    });
    await response.body?.cancel().catch(()=>undefined);
    return response.ok;
  }catch{
    return false;
  }
}
