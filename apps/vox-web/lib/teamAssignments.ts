import "server-only";
import {verifiedMfaSession} from "./auth";
import {origin} from "./core";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=(x:unknown):x is string=>typeof x==="string"&&UUID.test(x);
const enabled=()=>process.env.VOX_STAFF_PORTAL_ENABLED==="staging"&&
 process.env.VOX_TEAM_WORKSPACE_ENABLED==="staging"&&
 process.env.VOX_VO5_TL_ASSIGNMENT_UI_ENABLED==="staging"&&
 process.env.VOX_VO5_TL_ASSIGNMENT_READ_ENABLED==="staging";
const deny=(status:number,error:string)=>({ok:false,status,error} as const);
const exact=(x:Record<string,unknown>,fields:string[])=>
 Object.keys(x).sort().join("|")===[...fields].sort().join("|");
export type TeamAssignmentPreview={ok:true;status:200;
 items:{itemId:string;revision:number;kind:string;state:"NEW"}[];
 staff:{staffId:string;ref:string}[];totalKnown:false;actionsEnabled:false};
export type TeamAssignmentCommand={itemId:string;targetStaffId:string;
 nonce:string;expectedRevision:number;reason:string};
export async function fetchTeamAssignments():Promise<TeamAssignmentPreview|
 ReturnType<typeof deny>>{
 if(!enabled())return deny(503,"TL_ASSIGNMENT_NOT_CERTIFIED");
 const token=await verifiedMfaSession();
 if(!token)return deny(401,"STAFF_MFA_REQUIRED");
 const base=origin();if(!base)return deny(503,"CORE_ORIGIN_UNAVAILABLE");
 try{
  const r=await fetch(base+"/api/vox/v1/tl-assignments",{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(5000)
  });
  if(!r.ok)return deny(r.status===403?403:r.status===401?401:503,"TL_CORE_UNAVAILABLE");
  const raw:unknown=await r.json();
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return deny(503,"UNTRUSTED_TL_PREVIEW");
  const x=raw as Record<string,unknown>;
  if(!exact(x,["ok","schema","mode","boundedWindow","totalKnown",
   "actionsEnabled","items","staff","externalMessagesSent",
   "marketplaceLeadAssignmentsChanged"])||
   x.ok!==true||x.schema!=="qf.vox.tl.assignment.preview.v1"||
   x.mode!=="REFERENCES_ONLY"||x.boundedWindow!==true||
   x.totalKnown!==false||x.actionsEnabled!==false||
   x.externalMessagesSent!==0||x.marketplaceLeadAssignmentsChanged!==0||
   !Array.isArray(x.items)||x.items.length>20||
   !Array.isArray(x.staff)||x.staff.length>20)
   return deny(503,"UNTRUSTED_TL_PREVIEW");
  const items:TeamAssignmentPreview["items"]=[],staff:TeamAssignmentPreview["staff"]=[];
  const seenWork=new Set(),seenStaff=new Set();
  for(const item of x.items){
   if(!item||typeof item!=="object"||Array.isArray(item))return deny(503,"UNTRUSTED_TL_ITEM");
   const v=item as Record<string,unknown>;
   if(!exact(v,["itemId","revision","kind","state"])||!id(v.itemId)||
      seenWork.has(v.itemId)||v.state!=="NEW"||
      !["prospect","vendor","support_thread"].includes(String(v.kind))||
      !Number.isSafeInteger(v.revision)||(v.revision as number)<0||
      (v.revision as number)>2147483646)return deny(503,"UNTRUSTED_TL_ITEM");
   seenWork.add(v.itemId);
   items.push({itemId:v.itemId,revision:v.revision as number,
    kind:v.kind as string,state:"NEW"});
  }
  for(const item of x.staff){
   if(!item||typeof item!=="object"||Array.isArray(item))return deny(503,"UNTRUSTED_TL_STAFF");
   const v=item as Record<string,unknown>;
   if(!exact(v,["staffId","ref"])||!id(v.staffId)||seenStaff.has(v.staffId)||
      v.ref!=="STAFF-"+v.staffId.slice(0,8).toUpperCase())
    return deny(503,"UNTRUSTED_TL_STAFF");
   seenStaff.add(v.staffId);
   staff.push({staffId:v.staffId,ref:v.ref as string});
  }
  return {ok:true,status:200,items,staff,totalKnown:false,actionsEnabled:false};
 }catch{return deny(503,"TL_CORE_UNAVAILABLE");}
}
const outcomeUnknown=()=>({ok:false,status:503,error:"TL_ASSIGNMENT_OUTCOME_UNKNOWN",
 committed:null,retrySameNonceOnly:true} as const);
export async function submitTeamAssignment(command:TeamAssignmentCommand){
 if(!enabled()||process.env.VOX_VO5_TL_ASSIGNMENT_WRITES_ENABLED!=="staging")
  return deny(503,"TL_ASSIGNMENT_NOT_CERTIFIED");
 if(!command||typeof command!=="object"||
    !exact(command as unknown as Record<string,unknown>,
    ["itemId","targetStaffId","nonce","expectedRevision","reason"])||
    !id(command.itemId)||!id(command.targetStaffId)||!id(command.nonce)||
    !Number.isSafeInteger(command.expectedRevision)||command.expectedRevision<0||
    command.expectedRevision>2147483646||typeof command.reason!=="string"||
    command.reason.length>200||command.reason!==command.reason.trim()||
    /[\u0000-\u001f\u007f]/.test(command.reason))
  return deny(400,"INVALID_ASSIGNMENT_COMMAND");
 const token=await verifiedMfaSession();
 if(!token)return deny(401,"STAFF_MFA_REQUIRED");
 const base=origin();if(!base)return outcomeUnknown();
 try{
  const r=await fetch(base+"/api/vox/v1/tl-assignments",{
   method:"POST",headers:{authorization:"Bearer "+token,
    accept:"application/json","content-type":"application/json"},
   body:JSON.stringify(command),cache:"no-store",redirect:"error",
   signal:AbortSignal.timeout(12000)});
  if(!r.ok)return outcomeUnknown();
  const raw:unknown=await r.json();
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return outcomeUnknown();
  const x=raw as Record<string,unknown>;
  if(!exact(x,["ok","schema","itemId","targetStaffId","nonce","revision",
   "externalMessagesSent","vendorAssignmentsChanged","moneyMinorUnits"])||
   x.ok!==true||x.schema!=="qf.vox.tl.assignment.receipt.v1"||
   x.itemId!==command.itemId||x.targetStaffId!==command.targetStaffId||
   x.nonce!==command.nonce||x.revision!==command.expectedRevision+1||
   x.externalMessagesSent!==0||x.vendorAssignmentsChanged!==0||
   x.moneyMinorUnits!==0)return outcomeUnknown();
  return {ok:true,status:200,receipt:raw as Record<string,unknown>} as const;
 }catch{return outcomeUnknown();}
}
