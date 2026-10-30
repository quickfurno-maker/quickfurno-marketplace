/** RC1 bounded Staff scope equivalence after multi-hop reads.
 * Requires a NEW Auth+Core query. Never replaces current authorization.
 */
const grants=["verifiedDepartments","prospectIds","vendorIds",
 "supportThreadIds","conversationIds"];
const eq=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&
 a.length===b.length&&new Set(a).size===a.length&&
 new Set(b).size===b.length&&
 a.every(x=>typeof x==="string"&&b.includes(x));
export function unchangedAuthorizedStaffScope(before,after){
 if(!before||!after||before.userId!==after.userId||
  before.teamId!==after.teamId||before.cityId!==after.cityId||
  before.role!==after.role||before.canReadContent!==true||
  after.canReadContent!==true||before.canMutate!==after.canMutate||
  before.role==="team_leader"||before.role==="auditor")
  return false;
 return grants.every(k=>eq(before[k],after[k]));
}
export function unchangedNotificationScope(before,after){
 if(!before||!after||before.userId!==after.userId||
 before.teamId!==after.teamId||before.cityId!==after.cityId||
 before.role!==after.role||before.canReadContent!==true||
 after.canReadContent!==true||before.canMutate!==false||
 after.canMutate!==false)return false;
 return grants.every(k=>eq(before[k],after[k]));
}
