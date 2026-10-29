// Server-side Core read projection: exactly scoped vendors and their active
// canonical city zones. No browser identity and no expansion of grants.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=x=>typeof x==="string"&&UUID.test(x);
const rec=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
export function deriveCanonicalCityVendorIds({cityId,grantedVendorIds,vendors,zones}={}){
 if(!id(cityId)||!Array.isArray(grantedVendorIds)||grantedVendorIds.length>200||
   !Array.isArray(vendors)||vendors.length>200||
   !Array.isArray(zones)||zones.length>200||
   grantedVendorIds.some(v=>!id(v))||
   new Set(grantedVendorIds).size!==grantedVendorIds.length)
  return {ok:false,error:"INVALID_SCOPED_VENDOR_INPUT",ids:[]};
 const granted=new Set(grantedVendorIds),seenZones=new Set(),verifiedZoneIds=new Set();
 for(const z of zones){
  if(!rec(z)||!id(z.id)||seenZones.has(z.id)||!id(z.city_id)||
     z.city_id!==cityId||z.is_active!==true)
   return {ok:false,error:"UNTRUSTED_CITY_ZONE",ids:[]};
  seenZones.add(z.id);verifiedZoneIds.add(z.id);
 }
 const seenVendors=new Set(),allowed=[];
 for(const v of vendors){
  if(!rec(v)||!id(v.id)||!id(v.service_zone_id)||
     !granted.has(v.id)||seenVendors.has(v.id))
   return {ok:false,error:"UNTRUSTED_VENDOR_SOURCE",ids:[]};
  seenVendors.add(v.id);
  if(verifiedZoneIds.has(v.service_zone_id))allowed.push(v.id);
 }
 return {ok:true,ids:allowed};
}
