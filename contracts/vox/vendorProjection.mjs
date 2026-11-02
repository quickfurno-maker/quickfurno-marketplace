// VOX-00 projection boundary: distinct prospect and Core vendor identities.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clip=(x,n)=>typeof x==="string"?x.trim().slice(0,n):"";
export function projectProspectVendor({prospect,vendor=null,coreAttestation=null}) {
  if (!prospect || !UUID.test(String(prospect.id??""))) throw new Error("INVALID_PROSPECT");
  const prospectId=prospect.id;
  let verifiedVendor=null;
  if (vendor!==null || coreAttestation!==null) {
    if (!vendor || !coreAttestation ||
        coreAttestation.source!=="quickfurno-core" ||
        coreAttestation.state!=="ACTIVE" ||
        coreAttestation.prospectId!==prospectId ||
        coreAttestation.vendorId!==vendor.id ||
        coreAttestation.verified!==true ||
        !UUID.test(String(vendor.id??""))) throw new Error("MISSING_CORE_ACTIVE_ATTESTATION");
    verifiedVendor={id:vendor.id, status:"ACTIVE", businessName:clip(vendor.business_name,140)};
  }
  return Object.freeze({
    prospect:{id:prospectId,businessName:clip(prospect.business_name,140),
      stage:clip(prospect.prospect_stage,64),area:clip(prospect.area,100)},
    vendor:verifiedVendor,
    identityLinked:verifiedVendor!==null,
    paymentConfirmed:undefined, credits:undefined, leadAssignments:undefined,
  });
}
