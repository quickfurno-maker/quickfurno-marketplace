import "server-only";
import {adminClient} from "@/lib/supabase";
import type {ScopedVoxContext} from "@/contracts/vox/scopedStaff.mjs";
import {projectAarohiWorkspace,projectVendor360} from "@/contracts/vox/crmReuse.mjs";
function check(e:unknown){if(e)throw new Error("VOX_CRM_READ_UNAVAILABLE")}
export async function readScopedAarohi(scope:ScopedVoxContext){
 const db=adminClient();
 if(!scope.prospectIds.length)return projectAarohiWorkspace({scope,prospects:[],tasks:[],conversions:[]});
 const prospects=await db.from("aarohi_prospects")
  .select("id,city_id,business_name,primary_category,prospect_stage,conversation_stage,priority_band,next_action_type,next_action_at,do_not_contact,ai_paused,human_takeover,last_activity_at")
  .eq("city_id",scope.cityId).in("id",[...scope.prospectIds])
  .order("last_activity_at",{ascending:false}).limit(12);
 check(prospects.error);
 const visible=(prospects.data??[]).map(p=>p.id);
 if(!visible.length)return projectAarohiWorkspace({scope,prospects:[],tasks:[],conversions:[]});
 const [tasks,links]=await Promise.all([
  db.from("aarohi_tasks").select("id,prospect_id,task_type,status,priority,due_at")
   .in("prospect_id",visible).order("due_at",{ascending:true}).limit(12),
  db.from("aarohi_vendor_conversion_links").select("prospect_id,vendor_id,status,revoked_at")
   .in("prospect_id",visible).is("revoked_at",null).limit(12)
 ]);
 check(tasks.error);check(links.error);
 return projectAarohiWorkspace({scope,prospects:prospects.data??[],tasks:tasks.data??[],conversions:links.data??[]});
}
export async function readScopedVendor360(scope:ScopedVoxContext){
 const db=adminClient();
 if(!scope.vendorIds.length)return projectVendor360({scope:{vendorIds:[],validatedVendorIds:[]}});
 const zones=await db.from("marketplace_service_zones").select("id")
  .eq("city_id",scope.cityId).eq("is_active",true).limit(201);
 check(zones.error);
 if(!zones.data||zones.data.length>200)throw Error("VOX_ZONE_SCOPE_TOO_WIDE");
 if(!zones.data.length)return projectVendor360({scope:{vendorIds:scope.vendorIds,validatedVendorIds:[]}});
 const vendors=await db.from("vendors")
  .select("id,business_name,status,verification_status,location_verification_status,google_place_id,is_active,accepting_leads,service_zone_id")
  .in("id",[...scope.vendorIds]).in("service_zone_id",zones.data.map(z=>z.id)).limit(12);
 check(vendors.error);
 const verified=(vendors.data??[]).map(v=>v.id);
 if(!verified.length)return projectVendor360({scope:{vendorIds:scope.vendorIds,validatedVendorIds:[]}});
 const [crm,tasks]=await Promise.all([
  db.from("vendor_crm_profiles")
    .select("vendor_id,onboarding_stage,relationship_status,next_follow_up_at,acquisition_source,aarohi_prospect_id")
    .in("vendor_id",verified).order("updated_at",{ascending:false}).limit(12),
  db.from("vendor_tasks")
    .select("id,vendor_id,title,status,priority,due_at").in("vendor_id",verified)
    .order("due_at",{ascending:true}).limit(12)
 ]);
 check(crm.error);check(tasks.error);
 return projectVendor360({scope:{vendorIds:scope.vendorIds,validatedVendorIds:verified},
  vendors:vendors.data??[],crm:crm.data??[],tasks:tasks.data??[]});
}
