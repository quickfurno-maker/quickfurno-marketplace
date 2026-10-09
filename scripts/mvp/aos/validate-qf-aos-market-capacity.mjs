import process from "node:process";
import { buildAosMarketCapacitySnapshot } from "../../../lib/aos/marketCapacityAggregation.ts";

let failures=0;
function check(name,condition){
  const ok=Boolean(condition);
  console.log(`${ok?"PASS":"FAIL"} ${name}`);
  if(!ok)failures+=1;
}
const now=new Date("2026-10-09T12:00:00.000Z");

function leads(count,area="Wakad",service="Painting"){
  return Array.from({length:count},(_,i)=>({
    id:`lead-${i+1}`,city:"Pune",area,locality:area,service_required:service,category:service,
    created_at:new Date(now.getTime()-(i%28)*86_400_000).toISOString(),
  }));
}
function vendors(count,credits=10,area="Wakad",category="Painting"){
  return Array.from({length:count},(_,i)=>({
    id:`vendor-${i+1}`,city:"Pune",areas_covered:[area],covers_full_city:false,
    service_categories:[category],selected_category:category,selected_subcategories:[],
    status:"Approved",is_active:true,accepting_leads:true,remaining_credits:credits,
    assignment_suspended_at:null,assignment_suspended_until:null,
    location_verification_status:"verified",
  }));
}
function assignments(leadRows,perLead=3){
  return leadRows.flatMap((lead,i)=>Array.from({length:perLead},(_,j)=>({
    id:`a-${i}-${j}`,lead_id:lead.id,assigned_at:new Date(now.getTime()-86_400_000).toISOString(),
  })));
}

const demand=leads(100);
const over=buildAosMarketCapacitySnapshot({
  leads:demand,vendors:vendors(100),assignments:assignments(demand),now,
});
const cell=over.cells.find((one)=>one.localityRef==="wakad"&&one.categoryRef==="painting");
check("Wakad/Painting cell emitted",Boolean(cell));
check("30-day demand is authoritative window count",cell?.demand30d===100);
check("3-vendor fill is derived from committed assignment rows",cell?.threeVendorFillRate===1);
check("registered supply counted separately",cell?.registeredSupply===100);
check("credit-ready supply counted separately",cell?.creditReadySupply===100);
check("snapshot exposes no names, phone numbers or raw messages",!/(phone|name|message|email)/i.test(JSON.stringify(over)));
check("response evidence is not fabricated",over.responseEvidence==="UNAVAILABLE");

const zeroCredit=buildAosMarketCapacitySnapshot({
  leads:demand,vendors:vendors(20,0),assignments:assignments(demand,1),now,
});
const zeroCell=zeroCredit.cells.find((one)=>one.localityRef==="wakad"&&one.categoryRef==="painting");
check("zero-credit vendors remain registered supply",zeroCell?.registeredSupply===20);
check("zero-credit vendors do not count as credit-ready supply",zeroCell?.creditReadySupply===0);
check("under-filled leads lower the three-vendor fill rate",zeroCell?.threeVendorFillRate===0);

const vendorOnly=buildAosMarketCapacitySnapshot({
  leads:[],vendors:vendors(5,10,"Baner","Painting"),assignments:[],now,
});
const vendorOnlyCell=vendorOnly.cells.find((one)=>one.localityRef==="baner");
check("explicit vendor coverage creates a demand-starvation candidate cell",vendorOnlyCell?.demand30d===0&&vendorOnlyCell.registeredSupply===5);

const badLocation=buildAosMarketCapacitySnapshot({
  leads:demand,
  vendors:[{...vendors(1)[0],location_verification_status:"failed"}],
  assignments:[],
  now,
});
const badCell=badLocation.cells.find((one)=>one.localityRef==="wakad");
check("failed location verification is not operational effective supply",badCell?.activeSupply===0&&badCell?.eligibleSupply===0);

if(failures){
  console.error(`\nAOS market-capacity validation failed: ${failures} check(s).`);
  process.exit(1);
}
console.log("\nAOS market-capacity validation passed.");
