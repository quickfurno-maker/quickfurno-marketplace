// VOX TO-02G: bounded read-only Core work queue projection.
// Caller MUST pass current Core verified AAL2 staff scope and canonical source IDs.
// A queued item or department pack NEVER grants a new source-object permission.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID=x=>typeof x==="string"&&UUID.test(x);
const RECORD=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const STATES=new Set(["NEW","ASSIGNED","IN_PROGRESS","WAITING_EXTERNAL","WAITING_APPROVAL","BLOCKED","DONE"]);
const fail=error=>Object.freeze({ok:false,error,actionsEnabled:false,items:[]});
export function projectScopedWorkQueue({scope,rows,verifiedProspectIds,verifiedVendorIds,
 verifiedSupportThreadIds}={}){
 if(!RECORD(scope)||!ID(scope.userId)||!ID(scope.teamId)||!ID(scope.cityId)||
  scope.canReadContent!==true||scope.canMutate!==false||
  ["team_leader","auditor"].includes(scope.role)||
  !["operations_manager","acquisition_agent","vendor_success_agent","support_agent"].includes(scope.role)||
  !Array.isArray(rows)||rows.length>25||
  !Array.isArray(verifiedProspectIds)||!Array.isArray(verifiedVendorIds)||
  !Array.isArray(verifiedSupportThreadIds))return fail("INVALID_VERIFIED_SCOPE");
 const permits={prospect:scope.prospectIds,vendor:scope.vendorIds,
  support_thread:scope.supportThreadIds};
 const verified={prospect:verifiedProspectIds,vendor:verifiedVendorIds,
  support_thread:verifiedSupportThreadIds};
 for(const kind of ["prospect","vendor","support_thread"]){
  if(!Array.isArray(permits[kind])||permits[kind].length>200||
   !permits[kind].every(ID)||verified[kind].length>200||
   !verified[kind].every(ID)||new Set(verified[kind]).size!==verified[kind].length||
   verified[kind].some(x=>!permits[kind].includes(x)))return fail("INVALID_CANONICAL_SOURCE_PROOF");
 }
 const seen=new Set(),items=[];
 for(const row of rows){
  if(!RECORD(row)||!ID(row.id)||seen.has(row.id)||row.team_id!==scope.teamId||
   row.city_id!==scope.cityId||!Object.hasOwn(verified,row.source_kind)||
   !ID(row.source_id)||!STATES.has(row.state)||
   !Number.isSafeInteger(row.revision)||row.revision<0||
   !(row.assignee_id===null||ID(row.assignee_id))||
   typeof row.updated_at!=="string"||
   !Number.isFinite(Date.parse(row.updated_at)))return fail("INVALID_CORE_WORK_ROW");
  seen.add(row.id);
  // Exact source grant AND canonical active city verification AND exact
  // assignee (or unassigned NEW) are all necessary; never infer from pack.
  if(!verified[row.source_kind].includes(row.source_id))continue;
  if(row.assignee_id!==scope.userId&&
     !(row.state==="NEW"&&row.assignee_id===null))continue;
  // Only non-sensitive metadata; no customer, vendor, address, contact, chat,
  // agent context, report export, or permission-to-act is exposed here.
  items.push(Object.freeze({workItemId:row.id,kind:row.source_kind,
   state:row.state,revision:row.revision,updatedAt:row.updated_at,
   assignedToMe:row.assignee_id===scope.userId,
   canClaim:false,canTransition:false}));
 }
 return Object.freeze({ok:true,schema:"qf.vox.work.queue.preview.v1",
  mode:"READ_ONLY",actionsEnabled:false,
  boundedWindow:true,completeness:"BOUNDED_NOT_TOTAL",
  items:Object.freeze(items)});
}
