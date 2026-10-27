// VOX-05E: After Core-backed per-kind, per-assignee queries, verify ALL
// bounded source rows before truncating a global 25-item preview. Pure and
// non-executable: never expands Core object, department, city or Staff grants.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=v=>typeof v==="string"&&UUID.test(v);
const validDate=v=>typeof v==="string"&&v.length<=40&&Number.isFinite(Date.parse(v));
const KINDS=["prospect","vendor","support_thread"];
const STATES=new Set(["NEW","ASSIGNED","IN_PROGRESS","WAITING_EXTERNAL","WAITING_APPROVAL","BLOCKED","DONE"]);
const deny=reason=>Object.freeze({ok:false,reason,rows:[]});
export function selectScopedWorkCandidates({scope,rows,verifiedProspectIds,verifiedVendorIds,
 verifiedSupportThreadIds}={}){
 if(!scope||!id(scope.userId)||!id(scope.teamId)||!id(scope.cityId)||
    !Array.isArray(rows)||rows.length>150)return deny("INVALID_CANDIDATES");
 const allowed={
  prospect:verifiedProspectIds,vendor:verifiedVendorIds,
  support_thread:verifiedSupportThreadIds
 };
 for(const kind of KINDS)if(!Array.isArray(allowed[kind])||
  allowed[kind].length>200||allowed[kind].some(v=>!id(v))||
  new Set(allowed[kind]).size!==allowed[kind].length)return deny("INVALID_SOURCE_PROOF");
 const seen=new Set();
 for(const row of rows){
  if(!row||typeof row!=="object"||Array.isArray(row)||!id(row.id)||
    seen.has(row.id)||!KINDS.includes(row.source_kind)||
    row.team_id!==scope.teamId||row.city_id!==scope.cityId||
    !id(row.source_id)||!allowed[row.source_kind].includes(row.source_id)||
    !STATES.has(row.state)||!Number.isSafeInteger(row.revision)||
    row.revision<0||!validDate(row.updated_at)||
    !(row.assignee_id===scope.userId||
      (row.assignee_id===null&&row.state==="NEW")))
   return deny("UNVERIFIED_CANDIDATE_ROW");
  seen.add(row.id);
 }
 const selected=[...rows].sort((a,b)=>
  Date.parse(b.updated_at)-Date.parse(a.updated_at)||a.id.localeCompare(b.id)).slice(0,25);
 return Object.freeze({ok:true,rows:Object.freeze(selected)});
}
