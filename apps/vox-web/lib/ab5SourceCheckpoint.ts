import "server-only";
import {verifiedMfaSession} from "./auth";
import {origin} from "./core";
const sources=["CORE_WORK_LEDGER","CRM_AAROHI","SUPPORT_DESK","CORE_CONVERSATION"] as const;
type Source=typeof sources[number];
export type CheckpointRead=Readonly<
 |{ok:true;status:200;businessDate:string;
   checkpoints:readonly {source:Source;present:boolean;count:number|null}[];
   cryptoVerified:false;official:false}
 |{ok:false;status:401|403|503;error:string}>;
const deny=(status:401|403|503,error:string):CheckpointRead=>({ok:false,status,error});
const exact=(v:Record<string,unknown>,fields:string[])=>
 Object.keys(v).sort().join("|")===fields.slice().sort().join("|");
export function parseAb5SourceCheckpoints(raw:unknown):CheckpointRead{
 if(!raw||typeof raw!=="object"||Array.isArray(raw))
  return deny(503,"UNTRUSTED_CORE_SOURCE");
 const r=raw as Record<string,unknown>;
 if(!exact(r,["ok","schema","mode","businessDate","source",
  "completeness","sources","checkpointRows","totalKnown",
  "official","canSubmit","canAcknowledge",
  "providerMessagesSent","actionsEnabled"])||
  r.ok!==true||r.schema!=="qf.vox.ab5.source-checkpoint.inventory.v1"||
  r.mode!=="READ_ONLY"||r.source!=="CORE_CANDIDATE_SQL_SNAPSHOT"||
  !["FOUR_SQL_CHECKPOINTS_PRESENT_NOT_CRYPTO_CERTIFIED",
   "INCOMPLETE_SOURCE_CHECKPOINTS"].includes(String(r.completeness))||
  typeof r.businessDate!=="string"||
  !/^\d{4}-\d{2}-\d{2}$/.test(r.businessDate)||
  !Number.isFinite(Date.parse(r.businessDate+"T00:00:00Z"))||
  r.totalKnown!==false||r.official!==false||
  r.canSubmit!==false||r.canAcknowledge!==false||
  r.providerMessagesSent!==0||r.actionsEnabled!==false||
  !Number.isInteger(r.checkpointRows)||(r.checkpointRows as number)<0||
  (r.checkpointRows as number)>4||
  !Array.isArray(r.sources)||r.sources.length!==4)
  return deny(503,"UNTRUSTED_CORE_SOURCE");
 const checkpoints:({source:Source;present:boolean;count:number|null})[]=[];
 for(let i=0;i<4;i++){
  const x=r.sources[i];
  if(!x||typeof x!=="object"||Array.isArray(x))
   return deny(503,"SOURCE_ROW_INVALID");
  const row=x as Record<string,unknown>;
  if(!exact(row,["source","recordPresent","eventCountInSnapshot",
   "watermarkCryptoVerified","officialSourceCertified"])||
   row.source!==sources[i]||
   typeof row.recordPresent!=="boolean"||
   row.watermarkCryptoVerified!==false||
   row.officialSourceCertified!==false||
   (row.recordPresent?
    !Number.isSafeInteger(row.eventCountInSnapshot)||
     (row.eventCountInSnapshot as number)<0||
     (row.eventCountInSnapshot as number)>10000:
    row.eventCountInSnapshot!==null))
   return deny(503,"SOURCE_ROW_INVALID");
  checkpoints.push({source:sources[i],
   present:row.recordPresent,
   count:row.recordPresent?row.eventCountInSnapshot as number:null});
 }
 const found=checkpoints.filter(c=>c.present).length;
 if(found!==r.checkpointRows||
  (found===4)!==
  (r.completeness==="FOUR_SQL_CHECKPOINTS_PRESENT_NOT_CRYPTO_CERTIFIED"))
  return deny(503,"SOURCE_WINDOW_INCONSISTENT");
 return {ok:true,status:200,businessDate:r.businessDate,
  checkpoints,cryptoVerified:false,official:false};
}
export async function fetchAb5SourceCheckpoints():Promise<CheckpointRead>{
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
  process.env.VOX_AB5_SOURCE_CHECKPOINT_UI_ENABLED!=="staging"||
  !["scoped","dual"].includes(String(process.env.VOX_STAFF_VIEW_MODE)))
  return deny(503,"CHECKPOINT_UI_DISABLED");
 const token=await verifiedMfaSession();
 if(!token)return deny(401,"VERIFIED_STAFF_MFA_REQUIRED");
 const base=origin();
 if(!base)return deny(503,"CANONICAL_CORE_ORIGIN_NOT_CONFIGURED");
 try{
  const res=await fetch(base+"/api/vox/v1/ab5-source-checkpoints",{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(8000)});
  if(!res.ok)return deny(res.status===403?403:503,
   "CURRENT_SOURCE_SCOPE_REQUIRED");
  if(!(res.headers.get("content-type")??"").startsWith("application/json"))
   return deny(503,"SOURCE_MEDIA_TYPE_DENIED");
  const text=await res.text();
  if(!text||text.length>9000)return deny(503,"SOURCE_PAYLOAD_SIZE_DENIED");
  return parseAb5SourceCheckpoints(JSON.parse(text));
 }catch{return deny(503,"CORE_SOURCE_CHECKPOINTS_UNAVAILABLE");}
}
