/**
 * AB7N independently observed current QuickFurno Staging Core table ACLs.
 * Source: read-only pg_class/has_table_privilege on 20 October 2026.
 * Never apply grants; baseline drift requires fresh DBA review.
 */
const tableNames=Object.freeze([
"aarohi_tasks","communication_conversation_events",
"communication_conversations","jarvis_os_operator_command_receipts","profiles"]);
const deny=reason=>Object.freeze({ok:false,reason,
 canApplyMigrations:false,managedDbChanged:false,releaseAuthorized:false});
export function inspectAb7nCanonicalCoreAcls({
 environment,projectRef,readAtMs,now=Date.now(),rows
}={}){
 if(environment!=="staging"||projectRef!=="uckafzuochmbvtiodmcl"||
  !Number.isSafeInteger(readAtMs)||!Number.isSafeInteger(now)||
  readAtMs>now||now-readAtMs>60000||
  !Array.isArray(rows)||rows.length!==5)
  return deny("FRESH_EXACT_MANAGED_CORE_ACL_EVIDENCE_REQUIRED");
 const seen=new Set();
 for(const row of rows){
  if(!row||typeof row!=="object"||
    !tableNames.includes(row.relname)||seen.has(row.relname)||
    row.owner!=="postgres"||row.rls!==true||row.forceRls!==false||
    row.anonInsert!==false||row.authInsert!==false||
    row.authUpdate!==false||row.authDelete!==false||
    row.anonSelect!==false||
    row.authSelect!==(row.relname==="profiles")||
    row.serviceSelect!==true)return deny("CURRENT_CORE_TABLE_GRANT_OR_RLS_DRIFT");
  seen.add(row.relname);
 }
 if(seen.size!==5)return deny("MISSING_CANONICAL_CORE_TABLE");
 return Object.freeze({ok:true,canonicalCoreAclParity:true,
  observedCoreTableCount:5,
  expectedPublicProfileReadOnly:true,
  forceRlsOnLegacyCoreTables:false,
  canApplyMigrations:false,managedDbChanged:false,releaseAuthorized:false,
  requiresIndependentDbaAclAndVoXPathSignoff:true});
}
export const ab7nCanonicalCoreNames=tableNames;
