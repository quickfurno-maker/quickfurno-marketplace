// VOX-08H source proof for a strictly read-only, current-day Staff EOD preview.
// This PURE module accepts ONLY trusted Core reads performed AFTER AAL2 scope.
// It never creates grants, assumes a city, authorizes external sends or writes.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=x=>typeof x==="string"&&UUID.test(x);
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const KINDS=["prospect","vendor","support_thread"];
const FIELDS={prospect:"prospectIds",vendor:"vendorIds",support_thread:"supportThreadIds"};
const fail=reason=>Object.freeze({ok:false,reason});

export function selectCurrentEodReferences({scope,workItems}={}){
 if(!object(scope)||!id(scope.userId)||!id(scope.teamId)||!id(scope.cityId)||
    scope.canReadContent!==true||scope.canMutate!==false||
    !["operations_manager","acquisition_agent","vendor_success_agent","support_agent"].includes(scope.role)||
    !Array.isArray(workItems)||workItems.length>100)return fail("INVALID_EOD_SCOPE");
 const grants={};
 for(const kind of KINDS){
  const values=scope[FIELDS[kind]];
  if(!Array.isArray(values)||values.length>200||values.some(x=>!id(x))||
     new Set(values).size!==values.length)return fail("INVALID_EOD_GRANTS");
  grants[kind]=new Set(values);
 }
 const seen=new Set();
 const expected={prospect:new Set(),vendor:new Set(),support_thread:new Set()};
 for(const row of workItems){
  if(!object(row)||!id(row.id)||seen.has(row.id)||row.team_id!==scope.teamId||
     row.city_id!==scope.cityId||!KINDS.includes(row.source_kind)||
     !id(row.source_id)||!grants[row.source_kind].has(row.source_id)||
     !Number.isSafeInteger(row.revision)||row.revision<0)return fail("UNVERIFIED_EOD_WORK");
  if(row.source_kind==="support_thread"){
   // One support grant is NOT enough: underlying vendor must also be current.
   if(!id(row.related_vendor_id)||!grants.vendor.has(row.related_vendor_id))
    return fail("EOD_SUPPORT_VENDOR_GRANT_REQUIRED");
   expected.vendor.add(row.related_vendor_id);
  }
  seen.add(row.id);expected[row.source_kind].add(row.source_id);
 }
 return Object.freeze({ok:true,
  prospectIds:Object.freeze([...expected.prospect]),
  vendorIds:Object.freeze([...expected.vendor]),
  supportThreadIds:Object.freeze([...expected.support_thread])});
}

export function verifyCurrentEodCanonicalProof({scope,workItems,references,
 prospects,vendors,zones,threads}={}){
 if(!references?.ok||!Array.isArray(workItems)||!object(scope)||
    !Array.isArray(prospects)||!Array.isArray(vendors)||
    !Array.isArray(zones)||!Array.isArray(threads))
  return fail("INVALID_EOD_CANONICAL_INPUT");
 const expected=selectCurrentEodReferences({scope,workItems});
 if(!expected.ok||KINDS.some(kind=>{
  const field=kind==="support_thread"?"supportThreadIds":kind+"Ids";
  return !Array.isArray(references[field])||
   references[field].length!==expected[field].length||
   new Set(references[field]).size!==expected[field].length||
   references[field].some(v=>!expected[field].includes(v));
 }))return fail("EOD_REFERENCE_CHANGED");
 const unique=(rows,allowed)=>rows.length<=100&&rows.every(row=>
  object(row)&&id(row.id)&&allowed.includes(row.id))&&
  new Set(rows.map(row=>row.id)).size===rows.length;
 if(!unique(prospects,expected.prospectIds)||
    prospects.some(p=>p.city_id!==scope.cityId)||
    prospects.length!==expected.prospectIds.length)return fail("INVALID_EOD_PROSPECT_CITY");
 if(!unique(vendors,expected.vendorIds)||vendors.length!==expected.vendorIds.length||
    !unique(zones,vendors.map(v=>v.service_zone_id))||
    zones.some(z=>z.city_id!==scope.cityId||z.is_active!==true)||
    vendors.some(v=>!id(v.service_zone_id)||!zones.some(z=>z.id===v.service_zone_id)))
  return fail("INVALID_EOD_VENDOR_ZONE");
 if(!unique(threads,expected.supportThreadIds)||
    threads.length!==expected.supportThreadIds.length||
    threads.some(t=>!id(t.vendor_id)||!expected.vendorIds.includes(t.vendor_id))||
    workItems.some(w=>w.source_kind==="support_thread"&&
     !threads.some(t=>t.id===w.source_id&&t.vendor_id===w.related_vendor_id)))
  return fail("INVALID_EOD_SUPPORT_VENDOR");
 return Object.freeze({ok:true,verifiedSourceIds:Object.freeze({
  prospect:Object.freeze([...expected.prospectIds]),
  vendor:Object.freeze([...expected.vendorIds]),
  support_thread:Object.freeze([...expected.supportThreadIds])
 })});
}
