import { normalizeLocalities, normalizeLocality } from "../locality";
import {
  getParentCategoryGroup,
  vendorMatchesParentGroup,
} from "../vendors/categoryMatching";
import { evaluateVendorAutomaticLeadEligibility } from "../vendors/vendorAutomaticEligibility";
import type {
  QfjAosMarketCapacityCellV1,
  QfjAosMarketCapacitySnapshotV1,
} from "../jarvis/aosMarketCapacityContract";

export const AOS_MARKET_CAPACITY_MAX_CELLS=500;

export type AosCapacityLeadRow=Readonly<{
  id:string;
  city:string|null;
  area:string|null;
  locality:string|null;
  service_required:string|null;
  category:string|null;
  created_at:string;
}>;
export type AosCapacityVendorRow=Readonly<{
  id:string;
  city:string|null;
  areas_covered:unknown;
  covers_full_city:boolean|null;
  service_categories:unknown;
  selected_category?:unknown;
  selected_subcategories?:unknown;
  status:unknown;
  is_active:unknown;
  accepting_leads?:unknown;
  remaining_credits:unknown;
  assignment_suspended_at?:unknown;
  assignment_suspended_until?:unknown;
  location_verification_status?:unknown;
}>;
export type AosCapacityAssignmentRow=Readonly<{id:string;lead_id:string;assigned_at:string}>;

type CellWork={
  cellRef:string;cityRef:string;localityRef:string;categoryRef:string;
  cityLabel:string;localityLabel:string;categoryLabel:string;
  demand7d:number;demand30d:number;demand90d:number;demand30LeadIds:string[];
};

function text(value:unknown):string{return typeof value==="string"?value.trim():"";}
function refPart(value:string):string{
  const normalized=value.normalize("NFKD").replace(/[\u0300-\u036f]/gu,"").toLowerCase()
    .replace(/[^a-z0-9]+/gu,"-").replace(/^-+|-+$/gu,"").slice(0,32);
  return normalized||"unknown";
}
function cityLabel(value:unknown):string|null{
  const raw=text(value);if(!raw)return null;
  return raw.split(/\s+/u).map((part)=>part.charAt(0).toUpperCase()+part.slice(1).toLowerCase()).join(" ");
}
function cellIdentity(city:string,locality:string,category:string){
  const cityRef=refPart(city),localityRef=refPart(locality),categoryRef=refPart(category);
  return Object.freeze({cellRef:["market",cityRef,localityRef,categoryRef].join("."),cityRef,localityRef,categoryRef});
}
function categoryForLead(row:AosCapacityLeadRow):string|null{
  const group=getParentCategoryGroup([row.service_required,row.category].filter(Boolean));
  return group==="General"?null:group;
}
function vendorGroups(row:AosCapacityVendorRow):readonly string[]{
  const raw=Array.isArray(row.service_categories)?row.service_categories:[];
  const selected=Array.isArray(row.selected_subcategories)?row.selected_subcategories:[];
  const all=[...raw,...selected,row.selected_category].filter((v)=>typeof v==="string"&&v.trim());
  return Object.freeze([...new Set(all.map((v)=>getParentCategoryGroup(v)).filter((g)=>g!=="General"))]);
}
const BAD_LOCATION=new Set(["failed","rejected","unverified","not verified"]);
function locationUsable(row:AosCapacityVendorRow):boolean{
  const status=text(row.location_verification_status).toLowerCase();
  return !status||!BAD_LOCATION.has(status);
}
function vendorCoversCell(row:AosCapacityVendorRow,cell:CellWork):boolean{
  const city=cityLabel(row.city);if(!city||refPart(city)!==cell.cityRef)return false;
  if(!vendorMatchesParentGroup(row,cell.categoryLabel))return false;
  if(row.covers_full_city===true)return true;
  return normalizeLocalities(row.areas_covered).some((area)=>refPart(area)===cell.localityRef);
}
function operationalState(row:AosCapacityVendorRow,nowMs:number){
  const auto=evaluateVendorAutomaticLeadEligibility(row as Record<string,unknown>,{nowMs});
  const active=auto.accountStatus==="approved"&&auto.isActive&&locationUsable(row);
  const eligible=active&&auto.acceptingLeads&&!auto.assignmentSuspended;
  return Object.freeze({active,eligible,creditReady:eligible&&auto.credits>=auto.creditCost});
}
function ratio(n:number,d:number):number{return d<=0?1:Math.max(0,Math.min(1,n/d));}

export function buildAosMarketCapacitySnapshot(input:{
  readonly leads:readonly AosCapacityLeadRow[];
  readonly vendors:readonly AosCapacityVendorRow[];
  readonly assignments:readonly AosCapacityAssignmentRow[];
  readonly now:Date;
}):QfjAosMarketCapacitySnapshotV1{
  const nowMs=input.now.getTime();if(!Number.isFinite(nowMs))throw new TypeError("aos_market_capacity_now_invalid");
  const observedAt=input.now.toISOString();
  const cutoff7=nowMs-7*86_400_000,cutoff30=nowMs-30*86_400_000,cutoff90=nowMs-90*86_400_000;
  const cells=new Map<string,CellWork>();
  let excludedDemandRows=0,excludedVendorRows=0;
  const ensure=(city:string,locality:string,category:string):CellWork=>{
    const identity=cellIdentity(city,locality,category);let cell=cells.get(identity.cellRef);
    if(!cell){cell={...identity,cityLabel:city,localityLabel:locality,categoryLabel:category,demand7d:0,demand30d:0,demand90d:0,demand30LeadIds:[]};cells.set(identity.cellRef,cell);}
    return cell;
  };

  for(const lead of input.leads){
    const created=Date.parse(lead.created_at);
    if(!Number.isFinite(created)||created<cutoff90){excludedDemandRows+=1;continue;}
    const city=cityLabel(lead.city),locality=normalizeLocality(lead.area)||normalizeLocality(lead.locality),category=categoryForLead(lead);
    if(!city||!locality||!category){excludedDemandRows+=1;continue;}
    const cell=ensure(city,locality,category);cell.demand90d+=1;
    if(created>=cutoff30){cell.demand30d+=1;cell.demand30LeadIds.push(lead.id);}
    if(created>=cutoff7)cell.demand7d+=1;
  }

  for(const vendor of input.vendors){
    const city=cityLabel(vendor.city),areas=normalizeLocalities(vendor.areas_covered),groups=vendorGroups(vendor);
    if(!city||groups.length===0){excludedVendorRows+=1;continue;}
    if(areas.length===0){if(vendor.covers_full_city!==true)excludedVendorRows+=1;continue;}
    for(const area of areas)for(const group of groups)ensure(city,area,group);
  }

  const assignmentCount=new Map<string,number>();
  for(const assignment of input.assignments){
    const at=Date.parse(assignment.assigned_at);if(!Number.isFinite(at)||at<cutoff30)continue;
    assignmentCount.set(assignment.lead_id,(assignmentCount.get(assignment.lead_id)??0)+1);
  }

  const ranked=[...cells.values()].sort((a,b)=>b.demand30d-a.demand30d||b.demand90d-a.demand90d||a.cellRef.localeCompare(b.cellRef));
  const output:QfjAosMarketCapacityCellV1[]=[];
  for(const cell of ranked.slice(0,AOS_MARKET_CAPACITY_MAX_CELLS)){
    let registeredSupply=0,activeSupply=0,eligibleSupply=0,creditReadySupply=0;
    for(const vendor of input.vendors){
      if(!vendorCoversCell(vendor,cell))continue;
      registeredSupply+=1;const state=operationalState(vendor,nowMs);
      if(state.active)activeSupply+=1;if(state.eligible)eligibleSupply+=1;if(state.creditReady)creditReadySupply+=1;
    }
    const filled=cell.demand30LeadIds.filter((id)=>(assignmentCount.get(id)??0)>=3).length;
    output.push(Object.freeze({
      cellRef:cell.cellRef,cityRef:cell.cityRef,localityRef:cell.localityRef,categoryRef:cell.categoryRef,
      demand7d:cell.demand7d,demand30d:cell.demand30d,demand90d:cell.demand90d,
      registeredSupply,eligibleSupply,activeSupply,creditReadySupply,
      threeVendorFillRate:ratio(filled,cell.demand30d),
    }));
  }

  return Object.freeze({
    protocol:"qfj.aos.market-capacity.snapshot.v1" as const,observedAt,windowDays:90 as const,
    vendorOpportunityPerLead:3 as const,responseEvidence:"UNAVAILABLE" as const,
    coverage:Object.freeze({
      demandRows:input.leads.length,excludedDemandRows,vendorRows:input.vendors.length,excludedVendorRows,
      assignmentRows:input.assignments.length,cellsTotal:ranked.length,cellsReturned:output.length,
      cellsTruncated:ranked.length>AOS_MARKET_CAPACITY_MAX_CELLS,
    }),
    cells:Object.freeze(output),
  });
}
