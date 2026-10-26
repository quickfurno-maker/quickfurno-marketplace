// L8: source/metadata-only preflight. A pass NEVER authorizes protected DDL.
// A DBA must independently attest an actual consistent backup, rollback, and ACL.
const SHA=/^[a-f0-9]{64}$/i;
const VER=/^\d{14}$/;
const blocked=(reason,extra={})=>Object.freeze({ok:false,reason,
  sourcePreparationComplete:false,protectedStagingPermitted:false,
  productionPermitted:false,requiresIndependentDBA:true,
  requiresIndependentAppSec:true,requiresIndependentFirstTeamLeader:true,...extra});
function readHistory(rows){
  if(!Array.isArray(rows)||rows.length===0||rows.length>4096)return null;
  const m=new Map();
  for(const r of rows){
    if(!r||Object.keys(r).sort().join("|")!=="digest|version"||
      typeof r.version!=="string"||!VER.test(r.version)||
      typeof r.digest!=="string"||!SHA.test(r.digest)||
      m.has(r.version))return null;
    m.set(r.version,r.digest.toLowerCase());
  }
  return m;
}
export function assessL8Candidate({stagingHistory,productionHistory,candidates,
  staffIdentity}={}){
  const stage=readHistory(stagingHistory),prod=readHistory(productionHistory);
  if(!stage||!prod)return blocked("CANONICAL_HISTORY_EVIDENCE_MISSING");
  const onlyStage=[...stage.keys()].filter(v=>!prod.has(v));
  const onlyProd=[...prod.keys()].filter(v=>!stage.has(v));
  const changed=[...stage.keys()].filter(v=>prod.has(v)&&stage.get(v)!==prod.get(v));
  if(onlyStage.length||onlyProd.length||changed.length)return blocked(
    "HISTORICAL_MIGRATION_DIVERGENCE_REQUIRES_DBA",
    {historicalDrift:Object.freeze({onlyStage:onlyStage.length,
      onlyProduction:onlyProd.length,changedBodies:changed.length})});
  if(!Array.isArray(candidates)||candidates.length===0||candidates.length>30)
    return blocked("CANDIDATE_INVENTORY_REQUIRED");
  const versions=new Set(),names=new Set(),fingerprints=[];
  for(const c of candidates){
    if(!c||Object.keys(c).sort().join("|")!=="digest|path|version"||
      typeof c.path!=="string"||
      !/^ops\/vox\/(?:sql-candidates|quarantined-migrations)\/[a-zA-Z0-9_./-]+\.sql$/.test(c.path)||
      c.path.includes("..")||!VER.test(c.version)||!SHA.test(c.digest)||
      versions.has(c.version)||names.has(c.path)||
      stage.has(c.version)||prod.has(c.version))
      return blocked("CANDIDATE_COLLISION_OR_UNREVIEWED_PATH");
    versions.add(c.version);names.add(c.path);
    fingerprints.push(Object.freeze({path:c.path,version:c.version,
      sha256:c.digest.toLowerCase()}));
  }
  if(!staffIdentity||Object.keys(staffIdentity).sort().join("|")!==
    "coreProfileRole|currentAal|neutralStaff|superadminInherited"||
    staffIdentity.coreProfileRole==="admin"||
    staffIdentity.currentAal!=="aal2"||
    staffIdentity.neutralStaff!==true||staffIdentity.superadminInherited!==false)
    return blocked("STAFF_MUST_REMAIN_NON_ADMIN_AAL2");
  return Object.freeze({ok:true,sourcePreparationComplete:true,
    reviewedHumanSignaturesPresent:false,identityScope:"NEUTRAL_STAFF_ONLY",
    historicalDrift:Object.freeze({onlyStage:0,onlyProduction:0,changedBodies:0}),
    candidateFingerprints:Object.freeze(fingerprints),
    protectedStagingPermitted:false,productionPermitted:false,
    requiresIndependentDBA:true,requiresIndependentAppSec:true,
    requiresIndependentFirstTeamLeader:true});
}