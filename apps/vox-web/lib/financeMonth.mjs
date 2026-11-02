// Pure VOX Finance month buckets. Records are bounded Core snapshots only.
const VALID_MONTH=/^20[0-9]{2}-(0[1-9]|1[0-2])$/;
const fmt=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Kolkata",
 year:"numeric",month:"2-digit"});
export function indiaOrderMonth(dateString){
 if(typeof dateString!=="string")return null;
 const parsed=new Date(dateString);
 if(!Number.isFinite(parsed.getTime()))return null;
 const parts=fmt.formatToParts(parsed);
 const year=parts.find(p=>p.type==="year")?.value;
 const month=parts.find(p=>p.type==="month")?.value;
 const result=year+"-"+month;
 return VALID_MONTH.test(result)?result:null;
}
export function selectBoundedFinanceMonth(month,available){
 return typeof month==="string"&&VALID_MONTH.test(month)&&
  Array.isArray(available)&&available.includes(month)?month:null;
}
