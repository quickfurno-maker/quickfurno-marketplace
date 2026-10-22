import "server-only";
import {verifiedMfaSession} from "./auth";
import {origin} from "./core";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Entry={kind:"order"|"attempt"|"capture"|"refund"|"credit"|"settlement"|"audit";
 reference:string;occurredAt:string;amountSubunits:number|null;mode:"test"|"live"};
export async function fetchOwnerFinanceHistory(orderId:string):Promise<
 {ok:true;orderId:string;providerMode:"test"|"live";providerStatus:string;
 activationStatus:string;timeline:Entry[]}|{ok:false}>{
 if(process.env.VOX_FINANCE_PAY3_UI_ENABLED!=="staging"||
    process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||!UUID.test(orderId))return {ok:false};
 const token=await verifiedMfaSession();const base=origin();
 if(!token||!base)return {ok:false};
 try{
  const response=await fetch(base+"/api/vox/v1/finance-history?orderId="+encodeURIComponent(orderId),{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500)
  });
  if(!response.ok)return {ok:false};
  const v:unknown=await response.json();
  if(!v||typeof v!=="object"||Array.isArray(v))return {ok:false};
  const raw=v as Record<string,unknown>;
  if(raw.ok!==true||raw.schema!=="qf.vox.finance.history.v1"||
     raw.mode!=="READ_ONLY"||raw.actionsEnabled!==false||
     raw.certification!=="NOT_CERTIFIED"||raw.orderId!==orderId||
     !["test","live"].includes(String(raw.providerMode))||
     !Array.isArray(raw.timeline)||raw.timeline.length>150)return {ok:false};
  const mode=raw.providerMode as "test"|"live";
  const events:Entry[]=[];
  for(const e of raw.timeline){
   if(!e||typeof e!=="object"||Array.isArray(e))return {ok:false};
   const r=e as Record<string,unknown>;
   if(!["order","attempt","capture","refund","credit","settlement","audit"].includes(String(r.kind))||
      r.mode!==mode||typeof r.reference!=="string"||r.reference.length>180||
      !UUID.test(r.reference)||typeof r.occurredAt!=="string"||
      !Number.isFinite(Date.parse(r.occurredAt))||
      !(r.amountSubunits===null||(typeof r.amountSubunits==="number"&&
         Number.isSafeInteger(r.amountSubunits)&&r.amountSubunits>=0)))return {ok:false};
   events.push({kind:r.kind as Entry["kind"],reference:r.reference,
    occurredAt:r.occurredAt,amountSubunits:r.amountSubunits as number|null,mode});
  }
  return {ok:true,orderId,providerMode:mode,
   providerStatus:typeof raw.providerStatus==="string"?raw.providerStatus.slice(0,30):"UNKNOWN",
   activationStatus:typeof raw.activationStatus==="string"?raw.activationStatus.slice(0,30):"UNKNOWN",
   timeline:events};
 }catch{return {ok:false};}
}
