/**
 * AB7E internal-only queue advisory, NO active worker/scheduler.
 * It cannot change SQL, send providers or act on a synthetic count.
 */
const allowed=new Set(["PENDING","LEASED","DONE","DEAD_LETTER"]);
const deny=reason=>Object.freeze({ok:false,reason,runAuthorized:false,
 providerMessagesSent:0,autonomousRemediation:false});
export async function inspectAb7InAppOutbox({
 enabled=false,viewer,rows,now=Date.now(),
 verifyCurrentOwner,verifyCurrentSource
}={}){
 if(enabled!==true||!viewer||viewer.role!=="superadmin"||
  viewer.currentAal!=="aal2"||
  !Array.isArray(rows)||rows.length>500||
  !Number.isSafeInteger(now)||now<=0||
  typeof verifyCurrentOwner!=="function"||
  typeof verifyCurrentSource!=="function")
  return deny("REVIEW_ONLY_OWNER_CONTEXT_REQUIRED");
 const states={PENDING:0,LEASED:0,DONE:0,DEAD_LETTER:0};
 let overdue=0,staleLease=0,unexpected=0;
 try{
  if(await verifyCurrentOwner(viewer)!==true)return deny("OWNER_REVOKED");
  const used=new Set();
  for(const row of rows){
   if(!row||typeof row!=="object"||Array.isArray(row)||
    Object.keys(row).sort().join("|")!==
     "attempts|id|leaseUntil|nextAttemptAt|sourceVerified|state"||
    typeof row.id!=="string"||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.id)||
    used.has(row.id)||!allowed.has(row.state)||
    !Number.isSafeInteger(row.attempts)||row.attempts<0||
    row.attempts>5||row.sourceVerified!==true||
    typeof row.nextAttemptAt!=="string"||
    !Number.isFinite(Date.parse(row.nextAttemptAt))||
    (row.leaseUntil!==null&&(typeof row.leaseUntil!=="string"||
     !Number.isFinite(Date.parse(row.leaseUntil))))||
    (row.state==="LEASED"&&row.leaseUntil===null)||
    (row.state!=="LEASED"&&row.leaseUntil!==null)||
    await verifyCurrentSource(row)!==true)
    return deny("STALE_OR_FORGED_QUEUE_SOURCE");
   used.add(row.id);states[row.state]++;
   if(row.state==="PENDING"&&Date.parse(row.nextAttemptAt)<now-60000)
    overdue++;
   if(row.state==="LEASED"&&Date.parse(row.leaseUntil)<now)
    staleLease++;
   if(row.state==="PENDING"&&row.attempts>=5)unexpected++;
  }
  if(await verifyCurrentOwner(viewer)!==true)return deny("OWNER_SCOPE_CHANGED");
  return Object.freeze({ok:true,schema:"qf.vox.ab7e.in-app-outbox-advisory.v1",
   observed:rows.length,states:Object.freeze(states),
   overdue,staleLease,unexpected,
   needsManualReview:states.DEAD_LETTER+staleLease+unexpected>0,
   runAuthorized:false,autonomousRemediation:false,
   providerMessagesSent:0,productionCertified:false,
   timeBasis:"AS_OF_PROVIDED_OBSERVATION"});
 }catch{return deny("INTERNAL_QUEUE_MONITOR_UNAVAILABLE");}
}
