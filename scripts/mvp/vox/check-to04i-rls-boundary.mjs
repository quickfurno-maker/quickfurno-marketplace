
import {readFileSync} from "node:fs";
export function inspectVendorBoundary(e){
 if(!e||e.schema!=="qf.vox.to04i.live-core-rls-readonly.v1"||
    e.containsBusinessRows!==false||!e.staging||!e.production||!e.decisions)
  return {ok:false,releaseAllowed:false,reason:"INVALID_EVIDENCE"};
 const problems=[];
 for(const site of ["staging","production"]){
  const x=e[site],a=x.vendor_support_threads,v=x.vendor_public_v;
  if(!a||!v||!a.grants||!x.helperFunctions||
    !["anon","authenticated","service_role"].every(role=>
      a.grants[role]&&["select","insert","update","delete"].every(action=>
        typeof a.grants[role][action]==="boolean")))
   return {ok:false,releaseAllowed:false,reason:"INCOMPLETE_ACL"};
  if(a.rls!==true||a.hasAnonymousPolicy!==false||a.hasOwnerAndAdminPredicates!==true)
   problems.push(site+":RLS_POLICY_UNVERIFIED");
  if(v.selectAnon!==true||v.selectAuthenticated!==true||
     v.publicVisibilityRequired!==true||v.approvedOnly!==true||
     v.activeOnly!==true||v.positiveCreditsRequired!==true)
   problems.push(site+":PUBLIC_VENDOR_DIRECTORY_REGRESSION");
  for(const name of ["is_admin","owns_vendor"]){
   const helper=x.helperFunctions[name];
   if(!helper||helper.anonExecutable!==false||helper.authExecutable!==true||
      helper.securityDefiner!==true||helper.usesAuthUid!==true)
    problems.push(site+":HELPER_PRIVILEGES_"+name);
  }
 }
 for(const role of ["anon","authenticated"]){
  for(const action of ["select","insert","update","delete"]){
   if(e.staging.vendor_support_threads.grants[role][action]!==e.production.vendor_support_threads.grants[role][action])
    problems.push("STAGING_PRODUCTION_ACL_DRIFT:"+role+":"+action);
  }
 }
 const approvals=["securityReviewApproved","dbaApproved","liveAnonymousAuthorizationE2E",
   "publicDirectoryBehaviorRehearsed","vendorOwnerRlsE2E","protectedStagingApproved",
   "productionMutationAuthorized"];
 if(!approvals.every(k=>typeof e.decisions[k]==="boolean"))
  return {ok:false,releaseAllowed:false,reason:"INVALID_APPROVAL_FIELDS"};
 for(const k of approvals)if(!e.decisions[k])problems.push("MISSING_APPROVAL:"+k);
 return {ok:true,releaseAllowed:false,reason:"HUMAN_DB_AND_LIVE_RLS_REVIEW_REQUIRED",
  findings:problems.sort(),tableAclIsNotProofOfRowExposure:true,
  publicDirectoryCompatibilityMustBeVerified:true};
}
const path=new URL("../../../ops/vox/certification/TO04I-LIVE-RLS-BOUNDARY.json",import.meta.url);
const result=inspectVendorBoundary(JSON.parse(readFileSync(path,"utf8")));
if(process.argv[1]&&import.meta.url.endsWith(process.argv[1])){
 console.log(JSON.stringify(result));
 if(process.argv.includes("--release-check"))process.exit(result.releaseAllowed?0:42);
 process.exit(result.ok?0:1);
}
