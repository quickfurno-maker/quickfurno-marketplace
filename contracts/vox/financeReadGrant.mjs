/** PAY-3A pure Finance Staff scope intersection; no browser financial authority. */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=x=>typeof x==="string"&&UUID.test(x);
export function evaluateFinanceReadGrant({scope,grant,revoked,vendorId,now=Date.now()}={}){
 if(!scope||!grant||!id(vendorId)||!Number.isSafeInteger(now)||
    !id(scope.userId)||!id(scope.teamId)||!id(scope.cityId)||
    !["operations_manager","vendor_success_agent"].includes(scope.role)||
    !Array.isArray(scope.vendorIds)||!scope.vendorIds.includes(vendorId)||
    !Array.isArray(scope.verifiedDepartments)||!scope.verifiedDepartments.includes("vendor_success")||
    scope.canReadContent!==true||revoked!==false)return false;
 if(!id(grant.id)||grant.staff_user_id!==scope.userId||grant.team_id!==scope.teamId||
    grant.city_id!==scope.cityId||grant.vendor_id!==vendorId||
    !id(grant.requested_by)||!id(grant.approved_by)||!id(grant.approval_reference)||
    grant.requested_by===grant.approved_by||grant.requested_by===scope.userId||
    grant.approved_by===scope.userId||typeof grant.expires_at!=="string"||
    !Number.isFinite(Date.parse(grant.expires_at))||Date.parse(grant.expires_at)<=now)
   return false;
 return true;
}
