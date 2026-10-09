import "server-only";

import { adminClient } from "@/lib/supabase";
import {
  buildAosMarketCapacitySnapshot,
  type AosCapacityAssignmentRow,
  type AosCapacityLeadRow,
  type AosCapacityVendorRow,
} from "@/lib/aos/marketCapacityAggregation";
import type { QfjAosMarketCapacitySnapshotV1 } from "@/lib/jarvis/aosMarketCapacityContract";

const PAGE_SIZE=1_000;
const MAX_LEADS=50_000;
const MAX_VENDORS=25_000;
const MAX_ASSIGNMENTS=150_000;

export interface AosMarketCapacitySource {
  readLeads(cutoff90d:string):Promise<readonly AosCapacityLeadRow[]>;
  readVendors():Promise<readonly AosCapacityVendorRow[]>;
  readAssignments(cutoff30d:string):Promise<readonly AosCapacityAssignmentRow[]>;
}

async function readPaged<T>(
  maxRows:number,
  load:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:unknown}>,
):Promise<readonly T[]>{
  const rows:T[]=[];
  for(let from=0;from<maxRows;from+=PAGE_SIZE){
    const page=await load(from,Math.min(from+PAGE_SIZE-1,maxRows-1));
    if(page.error)throw page.error;
    const data=page.data??[];
    rows.push(...data);
    if(data.length<PAGE_SIZE)return Object.freeze(rows);
  }
  throw new Error("aos_market_capacity_source_limit_exceeded");
}

export function productionAosMarketCapacitySource():AosMarketCapacitySource{
  const db=adminClient();
  return Object.freeze({
    readLeads(cutoff90d:string){
      return readPaged<AosCapacityLeadRow>(MAX_LEADS,(from,to)=>
        db.from("leads")
          .select("id,city,area,locality,service_required,category,created_at")
          .gte("created_at",cutoff90d)
          .order("created_at",{ascending:true})
          .order("id",{ascending:true})
          .range(from,to) as unknown as PromiseLike<{data:AosCapacityLeadRow[]|null;error:unknown}>
      );
    },
    readVendors(){
      return readPaged<AosCapacityVendorRow>(MAX_VENDORS,(from,to)=>
        db.from("vendors")
          .select("id,city,areas_covered,covers_full_city,service_categories,selected_category,selected_subcategories,status,is_active,accepting_leads,remaining_credits,assignment_suspended_at,assignment_suspended_until,location_verification_status")
          .order("id",{ascending:true})
          .range(from,to) as unknown as PromiseLike<{data:AosCapacityVendorRow[]|null;error:unknown}>
      );
    },
    readAssignments(cutoff30d:string){
      return readPaged<AosCapacityAssignmentRow>(MAX_ASSIGNMENTS,(from,to)=>
        db.from("lead_assignments")
          .select("id,lead_id,assigned_at")
          .gte("assigned_at",cutoff30d)
          .order("assigned_at",{ascending:true})
          .order("id",{ascending:true})
          .range(from,to) as unknown as PromiseLike<{data:AosCapacityAssignmentRow[]|null;error:unknown}>
      );
    },
  });
}

export async function readAosMarketCapacitySnapshot(
  now=new Date(),
  source:AosMarketCapacitySource=productionAosMarketCapacitySource(),
):Promise<QfjAosMarketCapacitySnapshotV1>{
  const nowMs=now.getTime();
  if(!Number.isFinite(nowMs))throw new TypeError("aos_market_capacity_now_invalid");
  const cutoff90=new Date(nowMs-90*86_400_000).toISOString();
  const cutoff30=new Date(nowMs-30*86_400_000).toISOString();
  const [leads,vendors,assignments]=await Promise.all([
    source.readLeads(cutoff90),
    source.readVendors(),
    source.readAssignments(cutoff30),
  ]);
  return buildAosMarketCapacitySnapshot({leads,vendors,assignments,now});
}
