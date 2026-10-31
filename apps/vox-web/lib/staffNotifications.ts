import "server-only";
import {verifiedMfaSession} from "./auth";
import {origin} from "./core";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=(x:unknown):x is string=>typeof x==="string"&&UUID.test(x);
const kind=new Set(["CLAIM","START","COMPLETE","BLOCK",
 "REQUEST_APPROVAL","WAIT_EXTERNAL","RESUME"]);
const exact=(x:Record<string,unknown>,keys:string[])=>Object.keys(x).sort().join("|")===
 [...keys].sort().join("|");
const fail=(status:number,error:string)=>({ok:false,status,error} as const);
const enabled=()=>process.env.VOX_STAFF_PORTAL_ENABLED==="staging"&&
 process.env.VOX_TEAM_WORKSPACE_ENABLED==="staging"&&
 ["scoped","dual"].includes(String(process.env.VOX_STAFF_VIEW_MODE))&&
 process.env.VOX_STAFF_NOTIFICATIONS_UI_ENABLED==="staging";
/** Staff-only private Core notification projection. No push transport. */
async function callCore(payload?:Record<string,unknown>){
 const token=await verifiedMfaSession();
 if(!token)return fail(401,"MFA_REQUIRED");
 const base=origin();
 if(!base)return fail(503,"CORE_NOT_CONFIGURED");
 try{
  const res=await fetch(base+"/api/vox/v1/staff-notifications",{
   method:payload?"POST":"GET",cache:"no-store",redirect:"error",
   headers:{authorization:"Bearer "+token,accept:"application/json",
    ...(payload?{"content-type":"application/json"}:{})},
   ...(payload?{body:JSON.stringify(payload)}:{}),
   signal:AbortSignal.timeout(3500)
  });
  if(!res.ok)return fail(res.status===401?401:
   res.status===403?403:res.status===409?409:503,"CORE_NOTIFICATIONS_DENIED");
  const raw:unknown=await res.json();
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
   return fail(503,"INVALID_CORE_NOTIFICATION_RESPONSE");
  return {ok:true,status:res.status,data:raw as Record<string,unknown>} as const;
 }catch{return fail(503,"CORE_NOTIFICATIONS_UNAVAILABLE");}
}
export async function fetchStaffNotifications(){
 if(!enabled())return fail(503,"STAFF_NOTIFICATION_UI_DISABLED");
 const r=await callCore();
 if(!r.ok)return r;
 const obj=r.data;
 if(!exact(obj,["ok","schema","mode","origin","boundedWindow","totalKnown",
   "unreadTotalKnown","pushDeliveriesVerified","providerMessagesSent",
   "unreadInWindow","records"])||
   obj.ok!==true||obj.schema!=="qf.vox.staff.work-notifications.inbox.v1"||
   obj.mode!=="READ_ONLY"||obj.origin!=="CORE_PERSISTED_WORK_EVENTS"||
   obj.boundedWindow!==true||obj.totalKnown!==false||
   obj.unreadTotalKnown!==false||obj.pushDeliveriesVerified!==0||
   obj.providerMessagesSent!==0||!Array.isArray(obj.records)||
   obj.records.length>25)
   return fail(503,"UNVERIFIED_NOTIFICATION_WINDOW");
 const seen=new Set<string>();
 const verified:Array<{notificationId:string;eventKind:string;revision:number;
  createdAt:string;read:boolean}>=[];
 for(const unknownRow of obj.records){
  if(!unknownRow||typeof unknownRow!=="object"||Array.isArray(unknownRow))
   return fail(503,"UNVERIFIED_NOTIFICATION_ROW");
  const row=unknownRow as Record<string,unknown>;
  if(!exact(row,["notificationId","eventKind","revision","createdAt","read"])||
   !id(row.notificationId)||seen.has(row.notificationId)||
   !kind.has(String(row.eventKind))||![0,1].includes(row.revision as number)||
   typeof row.read!=="boolean"||row.read!==(row.revision===1)||
   typeof row.createdAt!=="string"||!Number.isFinite(Date.parse(row.createdAt)))
   return fail(503,"UNVERIFIED_NOTIFICATION_ROW");
  seen.add(row.notificationId);
  verified.push({notificationId:row.notificationId,
   eventKind:row.eventKind as string,revision:row.revision as number,
   createdAt:row.createdAt,read:row.read});
 }
 const unread=verified.filter(x=>!x.read).length;
 if(obj.unreadInWindow!==unread)
  return fail(503,"UNVERIFIED_NOTIFICATION_COUNT");
 return {ok:true,status:200,mode:"IN_APP_ONLY" as const,
  totalKnown:false as const,unreadTotalKnown:false as const,
  unreadInWindow:unread,records:verified,
  pushDeliveriesVerified:0 as const} as const;
}
export async function markStaffNotificationRead(notificationId:string,nonce:string){
 if(!enabled())return fail(503,"STAFF_NOTIFICATION_UI_DISABLED");
 if(!id(notificationId)||!id(nonce))return fail(400,"INVALID_READ_REQUEST");
 const r=await callCore({notificationId,nonce,expectedRevision:0});
 if(!r.ok)return r;
 const v=r.data;
 if(!exact(v,["ok","schema","notificationId","revision","readAt",
   "providerMessagesSent","pushDeliveryNotClaimed","staffPrivilegesChanged"])||
   v.ok!==true||v.schema!=="qf.vox.staff.work-notifications.read-receipt.v1"||
   v.notificationId!==notificationId||v.revision!==1||
   typeof v.readAt!=="string"||!Number.isFinite(Date.parse(v.readAt))||
   v.providerMessagesSent!==0||v.pushDeliveryNotClaimed!==true||
   v.staffPrivilegesChanged!==false)
  return fail(503,"UNVERIFIED_READ_RECEIPT");
 return {ok:true,status:200,notificationId,revision:1,
  readAt:v.readAt as string,pushDeliveryNotClaimed:true as const} as const;
}
