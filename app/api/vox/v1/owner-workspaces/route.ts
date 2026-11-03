import "server-only";
import {adminClient} from "@/lib/supabase";
import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";
import {projectOwnerAcquisition,projectOwnerVendor360,projectOwnerDesk,projectOwnerClientInbox} from "@/services/vox/ownerWorkspaceProjection.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const HEADERS={"cache-control":"private, no-store, max-age=0","vary":"Authorization","x-content-type-options":"nosniff"};
const reply=(v:unknown,status:number)=>Response.json(v,{status,headers:HEADERS});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ids=(rows:Array<{id?:string}>|null)=>Array.isArray(rows)?rows.map(x=>x.id).filter((x):x is string=>typeof x==="string"&&UUID.test(x)):[];
const valid=(r:{error:unknown;data:unknown})=>!r.error&&Array.isArray(r.data)&&r.data.length<=12;
const allowedKinds=new Set(["vendor360","acquisition","desk","clients"]);
/** Owner-only global Core read model. No Staff grants, no payment/credit writes.
 * Disabled unless separately enabled for private Staging. Production HOLD. */
export async function GET(request:Request){
 if(process.env.VOX_OWNER_WORKSPACES_ENABLED!=="staging"||process.env.VOX_OWNER_WORKSPACES_STAGE!=="private")
  return reply({ok:false,error:"OWNER_WORKSPACES_DISABLED"},503);
 const u=new URL(request.url);
 if([...u.searchParams.keys()].length!==1||!allowedKinds.has(u.searchParams.get("kind")??""))
  return reply({ok:false,error:"UNSUPPORTED_FILTER"},400);
 const kind=u.searchParams.get("kind");
 const auth=request.headers.get("authorization");
 try{
  const actor=await verifyVoxOwnerBearer(auth);
  if(!actor)return reply({ok:false,error:"OWNER_AAL2_REQUIRED"},403);
  const db=adminClient();
  let view:unknown;
  if(kind==="vendor360"){
   const vendors=await db.from("vendors")
    .select("id,business_name,status,verification_status,location_verification_status,is_active")
    .order("created_at",{ascending:false}).limit(12);
   if(!valid(vendors))return reply({ok:false,error:"OWNER_VENDOR_READ_UNAVAILABLE"},503);
   const vendorIds=ids(vendors.data);
   const [crm,tasks]=vendorIds.length?await Promise.all([
    db.from("vendor_crm_profiles").select("vendor_id,onboarding_stage,relationship_status")
     .in("vendor_id",vendorIds).order("updated_at",{ascending:false}).limit(12),
    db.from("vendor_tasks").select("id,vendor_id,title,status")
     .in("vendor_id",vendorIds).order("due_at",{ascending:true}).limit(12)
   ]):[{data:[],error:null},{data:[],error:null}];
   if(!valid(crm)||!valid(tasks))return reply({ok:false,error:"OWNER_VENDOR_READ_UNAVAILABLE"},503);
   view=projectOwnerVendor360({vendors:vendors.data??[],crm:crm.data??[],tasks:tasks.data??[]});
  }else if(kind==="acquisition"){
   const prospects=await db.from("aarohi_prospects")
    .select("id,business_name,prospect_stage,priority_band,next_action_type,do_not_contact,human_takeover,last_activity_at")
    .order("last_activity_at",{ascending:false}).limit(12);
   if(!valid(prospects))return reply({ok:false,error:"OWNER_ACQUISITION_UNAVAILABLE"},503);
   const prospectIds=ids(prospects.data);
   const tasks=prospectIds.length?await db.from("aarohi_tasks")
    .select("id,prospect_id,task_type,status,due_at")
    .in("prospect_id",prospectIds).order("due_at",{ascending:true}).limit(12)
    :{data:[],error:null};
   if(!valid(tasks))return reply({ok:false,error:"OWNER_ACQUISITION_UNAVAILABLE"},503);
   view=projectOwnerAcquisition({prospects:prospects.data??[],tasks:tasks.data??[]});
  }else if(kind==="clients"){
   // Reuse canonical Core lead records. Never expose contact PII, requirements,
   // provider identifiers, assignment mutators, or claim a complete lead list.
   const leads=await db.from("leads")
    .select("id,status,city,category,source,created_at")
    .order("created_at",{ascending:false}).limit(12);
   if(!valid(leads))return reply({ok:false,error:"OWNER_CLIENT_READ_UNAVAILABLE"},503);
   view=projectOwnerClientInbox({leads:leads.data??[]});
  }else{
   const [threads,conversations]=await Promise.all([
    db.from("vendor_support_threads").select("id,status,priority")
     .order("updated_at",{ascending:false}).limit(12),
    db.from("communication_conversations")
     .select("id,subject_type,state,human_takeover,service_window_expires_at")
     .eq("state","HUMAN").eq("human_takeover",true)
     .order("updated_at",{ascending:false}).limit(12)
   ]);
   if(!valid(threads)||!valid(conversations))return reply({ok:false,error:"OWNER_DESK_UNAVAILABLE"},503);
   view=projectOwnerDesk({threads:threads.data??[],conversations:conversations.data??[]});
  }
  // Recheck Owner AAL2/profile after asynchronous reads to prevent stale access.
  const fresh=await verifyVoxOwnerBearer(auth);
  if(fresh!==actor)return reply({ok:false,error:"OWNER_AUTH_REVOKED_DURING_READ"},403);
  return reply({ok:true,view},200);
 }catch{return reply({ok:false,error:"OWNER_WORKSPACE_READ_UNAVAILABLE"},503);}
}
export function POST(){return reply({ok:false,error:"READ_ONLY"},405);}
export function PUT(){return reply({ok:false,error:"READ_ONLY"},405);}
export function PATCH(){return reply({ok:false,error:"READ_ONLY"},405);}
export function DELETE(){return reply({ok:false,error:"READ_ONLY"},405);}
