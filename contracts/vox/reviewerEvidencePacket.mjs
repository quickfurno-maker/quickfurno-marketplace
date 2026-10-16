// VOX-10E: reviewer packet coverage ONLY. Does not attest signatures,
// identity, AAL2, canonical SQL or confer authorization to deploy.
const REQUIRED=Object.freeze([
 "DBA_MIGRATION_PARITY","DBA_POSTGRES_ROLE_ACL_RLS",
 "DBA_RESTORE_ROLLBACK_PITR","APPSEC_REAL_AAL2_IDOR",
 "APPSEC_REVOKE_CROSS_CITY","APPSEC_RIYA_SIGNED_CONSENT",
 "INDEPENDENT_FIRST_TL_HUMAN_SIGNATURE","SIGNED_STAGE_BUILD_CANARY",
 "OWNER_FINAL_GO_NO_GO"
]);
const SHA=/^[a-f0-9]{64}$/i;
const denied=reason=>Object.freeze({ok:false,reason,approved:false,
 protectedStagingPermitted:false,productionPermitted:false});
export function summarizeVox10eReviewerPacket({
 sourceSha,stagingSnapshotSha,observations=[]
}={}){
 if(typeof sourceSha!=="string"||!SHA.test(sourceSha)||
  typeof stagingSnapshotSha!=="string"||!SHA.test(stagingSnapshotSha)||
  !Array.isArray(observations)||observations.length>REQUIRED.length)
  return denied("REVIEW_PACKET_METADATA_REQUIRED");
 const map=new Map();
 for(const row of observations){
  if(!row||typeof row!=="object"||Array.isArray(row)||
   Object.keys(row).sort().join("|")!==["gate","observationStatus","evidenceSha"].sort().join("|")||
   !REQUIRED.includes(row.gate)||map.has(row.gate)||
   !["NOT_STARTED","BLOCKED","SOURCE_TEST_ONLY","HUMAN_ATTESTATION_AWAITED"]
     .includes(row.observationStatus)||
   !(row.evidenceSha===null||(typeof row.evidenceSha==="string"&&SHA.test(row.evidenceSha))))
   return denied("UNVERIFIED_REVIEW_OBSERVATION");
  map.set(row.gate,row);
 }
 const gates=REQUIRED.map(gate=>Object.freeze({gate,
  state:map.get(gate)?.observationStatus??"NOT_STARTED",
  sourceEvidencePresent:typeof map.get(gate)?.evidenceSha==="string"}));
 return Object.freeze({
  ok:true,schema:"qf.vox10e.independent-human-review.packet.v1",
  sourceSha,stagingSnapshotSha,gateCount:REQUIRED.length,
  gates:Object.freeze(gates),humanReviewersEngaged:false,
  humanAttestationsVerified:false,canonicalSqlApproved:false,
  protectedStagingPermitted:false,productionPermitted:false,
  approvalCannotBeGeneratedByThisTool:true
 });
}
export {REQUIRED as REQUIRED_VOX10E_GATES};
