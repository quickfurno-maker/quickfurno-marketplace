// The Owner staging console links to the existing canonical Core Admin.
// Never send a private Staging operator to Production by implicit fallback.
const PATHS=new Set([
 "/admin/dashboard","/admin/leads","/admin/vendors","/admin/vendor-approvals",
 "/admin/vendor-crm","/admin/aarohi","/admin/operations","/admin/lead-distribution",
 "/admin/whatsapp/human-desk","/admin/payments","/admin/reports"
]);
export function ownerAdminHref(path:string):string|null{
 if(process.env.VOX_STAFF_VIEW_MODE!=="owner"||!PATHS.has(path))return null;
 try{
  const core=new URL(process.env.VOX_CORE_ORIGIN??"");
  if(core.origin!=="https://staging-core.quickfurno.in"||core.pathname!=="/"||
     core.search||core.hash||core.username||core.password)return null;
  return core.origin+path;
 }catch{return null;}
}
