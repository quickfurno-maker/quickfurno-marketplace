// VOX TO-03C Core work-only EOD preview: never portray incomplete data as total.
// This is a pure projection over verified, server-read AAL2 context and canonical
// Core objects. Does NOT submit EOD, schedule messages or fabricate agent totals.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=x=>typeof x==="string"&&UUID.test(x);
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const denied=error=>Object.freeze({ok:false,error,actionsEnabled:false});
const map={CLAIM:"claims",START:"starts",COMPLETE:"completions",
 BLOCK:"blocks",REQUEST_APPROVAL:"approvalRequests",WAIT_EXTERNAL:"externalWaits",RESUME:"resumptions"};
export function projectCurrentCoreWorkEod({scope,workItems,events,verifiedSourceIds,businessDate}={}){
 if(!obj(scope)||!id(scope.userId)||!id(scope.teamId)||!id(scope.cityId)||
    scope.canReadContent!==true||scope.canMutate!==false||
    !["operations_manager","acquisition_agent","vendor_success_agent","support_agent"].includes(scope.role)||
    !Array.isArray(workItems)||workItems.length>100||
    !Array.isArray(events)||events.length>100||
    !obj(verifiedSourceIds)||typeof businessDate!=="string"||
    !/^\d{4}-\d{2}-\d{2}$/.test(businessDate))
  return denied("INVALID_SCOPED_REPORT");
 const dayStart=Date.parse(businessDate+"T00:00:00+05:30");
 const dayEnd=dayStart+86400000;
 if(!Number.isFinite(dayStart)||
    new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Kolkata",
    year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(dayStart))!==businessDate)
  return denied("INVALID_BUSINESS_DATE");
 const verified={};
 for(const [kind,scopeField] of [["prospect","prospectIds"],
  ["vendor","vendorIds"],["support_thread","supportThreadIds"]]){
  const source=verifiedSourceIds[kind],grants=scope[scopeField];
  if(!Array.isArray(source)||!Array.isArray(grants)||source.length>100||
     grants.length>200||source.some(x=>!id(x)||!grants.includes(x))||
     new Set(source).size!==source.length)return denied("INVALID_SOURCE_PROOFS");
  verified[kind]=new Set(source);
 }
 const items=new Map();
 for(const row of workItems){
  if(!obj(row)||!id(row.id)||items.has(row.id)||row.team_id!==scope.teamId||
    row.city_id!==scope.cityId||!Object.hasOwn(verified,row.source_kind)||
    !id(row.source_id)||!Number.isSafeInteger(row.revision)||row.revision<0)
   return denied("INVALID_WORK_SOURCE");
  items.set(row.id,row);
 }
 const counts=Object.fromEntries(Object.values(map).map(k=>[k,0]));
 let included=0;
 const seen=new Set(),revisions=new Set();
 for(const e of events){
  if(!obj(e)||!id(e.id)||seen.has(e.id)||!id(e.work_item_id)||
    e.actor_id!==scope.userId||!Object.hasOwn(map,e.event_type)||
    !Number.isSafeInteger(e.from_revision)||!Number.isSafeInteger(e.to_revision)||
    e.from_revision<0||e.to_revision!==e.from_revision+1||
    typeof e.created_at!=="string"||
    !Number.isFinite(Date.parse(e.created_at)))return denied("INVALID_CORE_EVENT");
  const ms=Date.parse(e.created_at);
  if(ms<dayStart||ms>=dayEnd)return denied("WRONG_BUSINESS_DAY");
  const source=items.get(e.work_item_id);
  if(!source||source.revision<e.to_revision)
   return denied("STALE_OR_UNVERIFIED_WORK_SOURCE");
  const revKey=e.work_item_id+":"+e.to_revision;
  if(revisions.has(revKey))return denied("DUPLICATE_WORK_REVISION");
  revisions.add(revKey);seen.add(e.id);
  // Event source has to be both the current Core object grant and
  // independently verified canonical source city; no unrestricted EOD export.
  if(!verified[source.source_kind].has(source.source_id))continue;
  counts[map[e.event_type]]++;included++;
 }
 return Object.freeze({ok:true,schema:"qf.vox.eod.core-work.partial.v1",
  mode:"READ_ONLY",actionsEnabled:false,businessDate,
  source:"CORE_WORK_LEDGER_ONLY",completeness:"PARTIAL_UNVERIFIED_TOTAL",
  sourceWatermark:"UNAVAILABLE",eventsIncluded:included,
  counts:Object.freeze(counts),canSubmit:false,canAcknowledge:false,
  canExport:false,providerMessagesSent:0});
}
