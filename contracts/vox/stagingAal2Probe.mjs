
const errors=(reason)=>Object.freeze({ok:false,releaseAuthorized:false,reason});
const acceptableDenied=new Set([401,403]);
export function evaluateReadOnlyAal2Probe({anonymous,aal1,foreignCity,scoped}={}){
 const all=[anonymous,aal1,foreignCity,scoped];
 if(all.some(x=>!x||!Number.isInteger(x.status)||x.status<100||x.status>599))
  return errors("INCOMPLETE_REAL_HTTP_RESULTS");
 if(all.some(x=>x.status===503))
  return errors("FEATURE_OR_SCHEMA_NOT_ACTIVE");
 if(!acceptableDenied.has(anonymous.status))return errors("ANONYMOUS_STAFF_QUEUE_NOT_DENIED");
 if(aal1.status!==403)return errors("AAL1_STAFF_QUEUE_NOT_DENIED");
 if(foreignCity.status!==403)return errors("FOREIGN_CITY_STAFF_QUEUE_NOT_DENIED");
 if(scoped.status!==200||!scoped.body||scoped.body.ok!==true||
    scoped.body.schema!=="qf.vox.work.queue.preview.v1"||
    scoped.body.mode!=="READ_ONLY"||scoped.body.actionsEnabled!==false||
    scoped.body.boundedWindow!==true||scoped.body.completeness!=="BOUNDED_NOT_TOTAL"||
    !Array.isArray(scoped.body.items)||scoped.body.items.length>25)
  return errors("SCOPED_AAL2_NOT_VERIFIED");
 for(const item of scoped.body.items){
  if(!item||typeof item!=="object"||Array.isArray(item)||
     Object.keys(item).sort().join("|")!==["assignedToMe","canClaim","canTransition","kind","revision","state","updatedAt","workItemId"].sort().join("|")||
     item.canClaim!==false||item.canTransition!==false||
     typeof item.workItemId!=="string"||typeof item.assignedToMe!=="boolean")
   return errors("UNTRUSTED_CORE_QUEUE_RESPONSE");
 }
 return Object.freeze({ok:true,releaseAuthorized:false,
  reason:"READ_ONLY_STAGING_AUTH_SMOKE_NOT_RELEASE_CERTIFICATION",
  observed:{anonymousDenied:true,aal1Denied:true,foreignCityDenied:true,
    scopedAal2ReadOnly:true,numberOfVisibleWorkItems:scoped.body.items.length},
  requiresSignedIndependentHumanReview:true,
  requiresMigrationRestoreAndLiveJarvisConsent:true});
}
