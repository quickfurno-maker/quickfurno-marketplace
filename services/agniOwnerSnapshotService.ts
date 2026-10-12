import "server-only";

import { adminClient } from "@/lib/supabase";
import { getOperationsOverview } from "@/services/adminOperationsService";

type CountFact=Readonly<{status:"AVAILABLE";value:number}>|Readonly<{status:"UNAVAILABLE";value:null}>;

async function exactCount(query:PromiseLike<{count:number|null;error:unknown}>):Promise<CountFact>{
  try{
    const result=await query;
    if(result.error||typeof result.count!=="number"){
      return Object.freeze({status:"UNAVAILABLE" as const,value:null});
    }
    return Object.freeze({status:"AVAILABLE" as const,value:result.count});
  }catch{
    return Object.freeze({status:"UNAVAILABLE" as const,value:null});
  }
}

function startOfDayIso(now:Date):string{
  const value=new Date(now);
  value.setHours(0,0,0,0);
  return value.toISOString();
}

function startOfWeekIso(now:Date):string{
  const value=new Date(now);
  const day=value.getDay();
  const offset=day===0?6:day-1;
  value.setDate(value.getDate()-offset);
  value.setHours(0,0,0,0);
  return value.toISOString();
}

export interface AgniOwnerQuickFurnoSnapshot{
  readonly protocol:"qf.agni.owner-snapshot.response.v1";
  readonly observedAt:string;
  readonly metrics:Readonly<Record<string,CountFact>>;
  readonly operations:Readonly<{
    overallHealth:"HEALTHY"|"ATTENTION"|"UNAVAILABLE";
    unavailableSubsystems:number;
    subsystems:readonly Readonly<{
      subsystem:string;
      health:string;
      openIncidents:number|null;
    }>[];
    attention:readonly Readonly<{
      id:string;
      class:string;
      severity:string;
      subsystem:string;
      openedAt:string|null;
      ageSeconds:number|null;
      currentStatus:string;
      safeCode:string|null;
    }>[];
  }>;
}

export async function getAgniOwnerQuickFurnoSnapshot(now=new Date()):Promise<AgniOwnerQuickFurnoSnapshot>{
  const db=adminClient();
  const today=startOfDayIso(now);
  const week=startOfWeekIso(now);
  const [
    leadsToday,
    leadsWeek,
    vendorsTotal,
    vendorsApproved,
    vendorsActive,
    vendorsLowCredits,
    vendorsZeroCredits,
    paymentsPending,
    citiesActive,
    assignmentsTotal,
    vendorsApprovedWithoutLogin,
    vendorsApprovedWithoutZone,
    vendorsAcceptingWithoutZone,
    googleOfficesVerified,
    googleOfficesProvisional,
    officeReviewsPending,
    activeZonesWithoutBoundary,
    paidVendorOrdersWithoutActivation,
    operations,
  ]=await Promise.all([
    exactCount(db.from("leads").select("id",{count:"exact",head:true}).gte("created_at",today)),
    exactCount(db.from("leads").select("id",{count:"exact",head:true}).gte("created_at",week)),
    exactCount(db.from("vendors").select("id",{count:"exact",head:true})),
    exactCount(db.from("vendors").select("id",{count:"exact",head:true}).eq("status","Approved")),
    exactCount(db.from("vendors").select("id",{count:"exact",head:true}).eq("is_active",true).in("status",["Approved","Active"])),
    exactCount(db.from("vendors").select("id",{count:"exact",head:true}).lte("remaining_credits",3)),
    exactCount(db.from("vendors").select("id",{count:"exact",head:true}).lte("remaining_credits",0)),
    exactCount(db.from("payments").select("id",{count:"exact",head:true}).eq("payment_status","Pending")),
    exactCount(db.from("cities").select("id",{count:"exact",head:true}).eq("is_active",true)),
    exactCount(db.from("lead_assignments").select("id",{count:"exact",head:true})),
    // VL-03 owner-safe vendor launch evidence. No rows, phone/email, Place ID,
    // wallet identifiers or provider payloads cross the signed AGNI boundary.
    exactCount(db.from("vendors").select("id",{count:"exact",head:true}).eq("status","Approved").is("user_id",null)),
    exactCount(db.from("vendors").select("id",{count:"exact",head:true}).eq("status","Approved").is("service_zone_id",null)),
    exactCount(db.from("vendors").select("id",{count:"exact",head:true}).eq("accepting_leads",true).is("service_zone_id",null)),
    exactCount(db.from("vendors").select("id",{count:"exact",head:true}).eq("location_verification_status","verified")),
    exactCount(db.from("vendors").select("id",{count:"exact",head:true}).eq("location_verification_status","provisional")),
    exactCount(db.from("vendor_profile_change_requests").select("id",{count:"exact",head:true}).eq("request_type","office_location_change").eq("status","pending")),
    exactCount(db.from("marketplace_service_zones").select("id",{count:"exact",head:true}).eq("is_active",true).eq("matching_enabled",true).is("boundary",null)),
    exactCount(db.from("vendor_package_orders").select("id",{count:"exact",head:true}).not("paid_at","is",null).is("activated_at",null)),
    getOperationsOverview(),
  ]);

  const metrics=Object.freeze({
    leads_today:leadsToday,
    leads_week:leadsWeek,
    vendors_total:vendorsTotal,
    vendors_approved:vendorsApproved,
    vendors_active:vendorsActive,
    vendors_low_credits:vendorsLowCredits,
    vendors_zero_credits:vendorsZeroCredits,
    payments_pending:paymentsPending,
    cities_active:citiesActive,
    assignments_total:assignmentsTotal,
    vendors_approved_without_login:vendorsApprovedWithoutLogin,
    vendors_approved_without_service_zone:vendorsApprovedWithoutZone,
    vendors_accepting_leads_without_service_zone:vendorsAcceptingWithoutZone,
    vendor_google_offices_verified:googleOfficesVerified,
    vendor_google_offices_provisional:googleOfficesProvisional,
    vendor_office_change_reviews_pending:officeReviewsPending,
    active_matching_zones_missing_polygon:activeZonesWithoutBoundary,
    vendor_paid_orders_not_activated:paidVendorOrdersWithoutActivation,
  });

  return Object.freeze({
    protocol:"qf.agni.owner-snapshot.response.v1" as const,
    observedAt:now.toISOString(),
    metrics,
    operations:Object.freeze({
      overallHealth:operations.overallHealth,
      unavailableSubsystems:operations.unavailableSubsystems,
      subsystems:Object.freeze(operations.subsystems.map((item)=>Object.freeze({
        subsystem:item.subsystem,
        health:item.health,
        openIncidents:item.incidentCount,
      }))),
      attention:Object.freeze(operations.attentionIncidents.slice(0,12).map((item)=>Object.freeze({
        id:item.id,
        class:item.class,
        severity:item.severity,
        subsystem:item.subsystem,
        openedAt:item.openedAt,
        ageSeconds:item.ageSeconds,
        currentStatus:item.currentStatus,
        safeCode:item.safeCode,
      }))),
    }),
  });
}
