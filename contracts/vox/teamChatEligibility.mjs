/**
 * Phase A chat authority: dedicated, independent in-team message privilege.
 * Core getVerifiedScopedStaff must have already verified remote Supabase AAL2,
 * existing active neutral membership and team/city. It gives no client/vendor
 * content grants, and requires a separate explicit TL-only stage flag.
 */
const uuid=x=>typeof x==="string"&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const agents=new Set(["operations_manager","acquisition_agent",
 "vendor_success_agent","support_agent"]);
export function canReadWriteTeamInternalChat({scope,teamLeaderEnabled=false}={}){
 if(!scope||!uuid(scope.userId)||!uuid(scope.teamId)||!uuid(scope.cityId)||
   scope.canMutate!==false||!Array.isArray(scope.verifiedDepartments))
  return false;
 if(scope.role==="team_leader")
  return teamLeaderEnabled===true && scope.canReadContent===false;
 return scope.canReadContent===true&&agents.has(scope.role);
}
