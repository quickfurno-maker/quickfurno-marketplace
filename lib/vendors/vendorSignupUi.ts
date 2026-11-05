/**
 * Vendor registration UI: presentation-only safeguards.
 * These helpers do not prove WhatsApp delivery, signed Auth possession,
 * private document identity or enrollment authority. Core remains final.
 */
export const MAX_VENDOR_OTP_DIGITS=8;
export function sanitizeVendorOtpInput(value:string):string {
 return value.replace(/[^0-9]/g,"").slice(0,MAX_VENDOR_OTP_DIGITS);
}
export function isVendorOtpEntryValid(value:string):boolean {
 return /^[0-9]{6,8}$/.test(value);
}
export function assessVendorOtpRequestUi(
 status:number,payload:unknown,
):{accepted:boolean;notice:string}{
 // Supabase Auth initiated does NOT mean a WhatsApp template was delivered.
 if(status===202&&payload&&typeof payload==="object"&&!Array.isArray(payload)){
  const p=payload as Record<string,unknown>;
  if(Object.keys(p).sort().join(",")==="code,deliveryConfirmed,ok"&&
     p.ok===true&&p.code==="OTP_REQUEST_INITIATED"&&p.deliveryConfirmed===false)
   return {accepted:true,notice:
    "Verification was requested. WhatsApp delivery has not been confirmed. Enter the code only if it arrives."};
 }
 if(status===503)return {accepted:false,notice:
  "WhatsApp verification is not yet available. Your application has not been submitted."};
 if(status===409||status===429)return {accepted:false,notice:
  "Verification was not initiated. Please wait before trying again; do not request repeated codes."};
 return {accepted:false,notice:
  "Could not start verification. Your application has not been submitted."};
}

/** Public UI hint only; server also sniffs and verifies private files. */
export const MAX_VENDOR_EVIDENCE_BYTES=5*1024*1024;
export function validateVendorPrivateEvidenceSelection(
 file:{size:number;type:string}|null,
):{ok:boolean;message:string}{
 if(!file)return {ok:false,message:"Choose an office or category document."};
 if(!Number.isSafeInteger(file.size)||file.size<8||file.size>MAX_VENDOR_EVIDENCE_BYTES)
  return {ok:false,message:"Choose a document between 8 bytes and 5 MB."};
 if(!["application/pdf","image/png","image/jpeg"].includes(file.type))
  return {ok:false,message:"Choose a PDF, PNG or JPEG document only."};
 return {ok:true,message:""};
}
export function confirmedPrivateEvidencePendingAck(status:number,payload:unknown):boolean{
 if(status!==202||!payload||typeof payload!=="object"||Array.isArray(payload))return false;
 const p=payload as Record<string,unknown>;
 return p.ok===true&&p.status==="pending_scan_and_owner_review"&&
  p.approved===false&&p.publicDocumentUrl===null&&p.vendorBusinessStatusUnchanged===true;
}
