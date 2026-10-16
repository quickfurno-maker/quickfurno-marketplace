// VOX-09. Read-only evidence classifier, NEVER an authorization, deployer,
// signing service, MFA bootstrap or substitute for independent human reviewers.
// Latest real staging facts observed 2026-10-16: 0 VOX tables, 0 verified MFA.
export const REQUIRED_GATES=Object.freeze([
 "DBA_INDEPENDENT_REVIEW","APPSEC_INDEPENDENT_REVIEW",
 "FIRST_TEAM_LEADER_INDEPENDENT_ATTESTATION","CANONICAL_MIGRATION_PARITY",
 "STAGING_BACKUP_RESTORE_REHEARSAL","Genuine_STAFF_AAL2",
 "CORE_IDOR_CROSS_TEAM_CITY","DEPARTMENT_REVOCATION_RACE",
 "CLIENT_RIYA_SIGNED_JARVIS_HANDOVER","AGENT_CONSENT_NO_PROVIDER_LEAK",
 "AGNI_OUTBOX_OPERATIONAL_TELEMETRY","EOD_WATERMARK_SOURCE_AUDIT",
 "IMMUTABLE_STAGE_CANARY_AND_ROLLBACK","OWNER_RELEASE_GO_NO_GO"
]);
const record=v=>v&&typeof v==="object"&&!Array.isArray(v);
const label=v=>typeof v==="string"&&/^[A-Z][A-Z0-9_]{2,80}$/.test(v);
const forbid=e=>Object.freeze({ok:false,error:e,releasePermitted:false,
 stagingActivationPermitted:false,humanReviewBypassed:false});
export function evaluateVox09Evidence({environment,observations=[]}={}){
 if(!record(environment)||environment.name!=="STAGING"||
  !Number.isSafeInteger(environment.installedVoxTables)||
  environment.installedVoxTables<0||environment.installedVoxTables>100||
  !Number.isSafeInteger(environment.verifiedMfaFactors)||
  environment.verifiedMfaFactors<0||environment.verifiedMfaFactors>500||
  !Number.isSafeInteger(environment.migrationHistoryRows)||
  environment.migrationHistoryRows<0||environment.migrationHistoryRows>10000||
  !Array.isArray(observations)||observations.length>REQUIRED_GATES.length)
  return forbid("INVALID_RELEASE_EVIDENCE");
 const seen=new Set(),items=new Map();
 for(const row of observations){
  if(!record(row)||Object.keys(row).sort().join("|")!==
    ["gate","status","evidenceRef","reviewerClass"].sort().join("|")||
    !REQUIRED_GATES.includes(row.gate)||seen.has(row.gate)||
    !["PENDING","FAILED","OBSERVED"].includes(row.status)||
    (row.evidenceRef!==null&&(!label(row.evidenceRef)||row.evidenceRef.length>80))||
    !["DBA","APPSEC","INDEPENDENT_HUMAN","CORE_QA","AGNI_QA","OWNER"].includes(row.reviewerClass))
   return forbid("INVALID_GATE_EVIDENCE");
  seen.add(row.gate);items.set(row.gate,row);
 }
 const stages=REQUIRED_GATES.map(gate=>{
  const r=items.get(gate);
  const observed=r?.status==="OBSERVED"&&typeof r.evidenceRef==="string";
  return Object.freeze({gate,status:observed?"OBSERVED_UNATTESTED":
   r?.status==="FAILED"?"FAILED":"PENDING"});
 });
 const missing=stages.filter(s=>s.status!=="OBSERVED_UNATTESTED");
 const preconditions=environment.installedVoxTables>0&&
  environment.verifiedMfaFactors>0;
 return Object.freeze({
  ok:true,schema:"qf.vox09.staging.evidence-review.v1",
  environment:"STAGING",mode:"READ_ONLY",
  migrationHistoryRows:environment.migrationHistoryRows,
  currentVoxTableCount:environment.installedVoxTables,
  verifiedMfaFactors:environment.verifiedMfaFactors,
  sourceEvidenceItems:stages,
  evidenceObservedCount:stages.length-missing.length,
  unobservedGates:missing.map(s=>s.gate),
  observedDataReadiness:preconditions,
  // Even when all observations are marked OBSERVED, a mutable JSON report
  // is NOT a signed independent reviewer decision or deploy token.
  independentSignaturesVerified:false,
  canonicalMigrationApproved:false,
  stagingActivationPermitted:false,releasePermitted:false,
  humanReviewBypassed:false
 });
}
