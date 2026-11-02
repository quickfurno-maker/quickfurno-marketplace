/**
 * VOX AB-2: prepares a role-scoped *read-only* domain work window.
 * Existing Core source readers and exact object-grant checks remain the
 * authority. Never infers that a Staff role grants a new department.
 * The returned window is intentionally not a total or a paging grant.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KIND=Object.freeze({
 acquisition:["prospect"],
 vendor_success:["vendor","support_thread"],
 service_support:["support_thread"],
 client_success:["client"]
});
const fail=reason=>Object.freeze({ok:false,reason,items:[],
 totalKnown:false,canChange:false,canSend:false});
export async function projectVerifiedDomainWindow({
 scope,source,department,verifyCurrentScope,verifySource,
 verifyExactObjectGrant,maxItems=25
}={}){
 if(!scope||typeof scope.userId!=="string"||!UUID.test(scope.userId)||
  typeof scope.teamId!=="string"||!UUID.test(scope.teamId)||
  typeof scope.cityId!=="string"||!UUID.test(scope.cityId)||
  scope.currentAal!=="aal2"||scope.canReadContent!==true||
  scope.canMutate!==false||!Array.isArray(scope.verifiedDepartments)||
  !Object.hasOwn(KIND,department)||
  !scope.verifiedDepartments.includes(department)||
  !source||source.ok!==true||source.mode!=="READ_ONLY"||
  source.actionsEnabled!==false||!Array.isArray(source.items)||
  source.items.length>25||!Number.isInteger(maxItems)||
  maxItems<1||maxItems>25||
  typeof verifyCurrentScope!=="function"||
  typeof verifySource!=="function"||
  typeof verifyExactObjectGrant!=="function")
  return fail("CURRENT_DEPARTMENT_CORE_SOURCE_REQUIRED");
 try{
  if(await verifyCurrentScope(scope)!==true||
   await verifySource({source,scope,department})!==true)
   return fail("CORE_SOURCE_OR_STAFF_SCOPE_REVOKED");
  const items=[],seen=new Set();
  for(const item of source.items){
   if(!item||typeof item.id!=="string"||!UUID.test(item.id)||
    seen.has(item.id)||!KIND[department].includes(item.kind)||
    !Number.isSafeInteger(item.revision)||item.revision<0||
    typeof item.state!=="string"||item.state.length>40||
    typeof item.updatedAt!=="string"||
    !Number.isFinite(Date.parse(item.updatedAt))||
    item.canChange!==false||item.canSend!==false)
    return fail("INVALID_OR_CROSS_DEPARTMENT_OBJECT");
   if(await verifyExactObjectGrant({scope,department,
    itemId:item.id,kind:item.kind,
    revision:item.revision,state:item.state})!==true)
    return fail("CURRENT_OBJECT_PERMISSION_REVOKED");
   seen.add(item.id);
   items.push(Object.freeze({id:item.id,kind:item.kind,
    state:item.state,updatedAt:item.updatedAt,
    canChange:false,canSend:false}));
  }
  if(await verifyCurrentScope(scope)!==true)
   return fail("CURRENT_SCOPE_CHANGED_AFTER_READ");
  items.sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)||
   a.id.localeCompare(b.id));
  return Object.freeze({ok:true,
   schema:"qf.vox.ab2.domain-work-window.v1",
   department,mode:"READ_ONLY",items:Object.freeze(items.slice(0,maxItems)),
   completeness:"BOUNDED_NOT_TOTAL",totalKnown:false,
   canChange:false,canSend:false,providerMessagesSent:0,
   nextPageAuthorized:false});
 }catch{return fail("CORE_SOURCE_CHECK_UNAVAILABLE");}
}
