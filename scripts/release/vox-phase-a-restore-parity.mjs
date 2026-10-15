// OFFLINE Phase A recovery parity evidence. No DB or backup API access.
// A passing report is only operator packet validation, never live recovery proof.
import {readFileSync,createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const PROJECT='uckafzuochmbvtiodmcl';
const LATEST=86;
const SCOPE=/^[0-9]{14}$/;
const HEX=/^[a-f0-9]{64}$/;
export function validateMigrationParity(baseline,fromBackup,afterRestore){
 const b=baseline?.records, a=fromBackup?.records, r=afterRestore?.records;
 const valid=x=>Array.isArray(x)&&x.length===LATEST&&
  x.every(v=>v&&SCOPE.test(v.version)&&typeof v.name==='string'&&
    v.name.length>2&&v.name.length<180)&&
  (new Set(x.map(v=>v.version))).size===LATEST;
 if(!valid(b)||!valid(a)||!valid(r)||
    baseline.sourceProjectRef!==PROJECT||baseline.exactCount!==LATEST)
   throw Error('VOX_RECOVERY_INVALID_HISTORY');
 for(let i=0;i<LATEST;i++){
  for(const x of [a,r]){
   if(x[i].version!==b[i].version||x[i].name!==b[i].name)
    throw Error('VOX_RECOVERY_HISTORY_DRIFT_INDEX_'+i);
  }
 }
 return {historyCount:LATEST,versionNameParity:true};
}
export function validateRestoreAttestation({baseline,sourceHistory,restoreHistory,backup,restore}){
 const parity=validateMigrationParity(baseline,sourceHistory,restoreHistory);
 if(backup?.sourceProjectRef!==PROJECT||!HEX.test(String(backup.archiveSha256??''))||
    !Number.isFinite(Date.parse(backup.capturedAt))||
    backup.managedBackupPathReviewed!==true)
  throw Error('VOX_RECOVERY_BACKUP_PROVENANCE_MISSING');
 if(!restore||restore.targetRef===PROJECT||!/^[-a-z0-9]{6,80}$/.test(String(restore.targetRef??''))||
    restore.archiveSha256!==backup.archiveSha256||
    restore.historyCount!==LATEST||restore.outboundEffectsDisabled!==true||
    restore.rlsAndGrantsChecked!==true||restore.schemaFingerprintsCompared!==true||
    restore.authAndStorageAssessed!==true||restore.restoreFinished!==true||
    !(Date.parse(restore.completedAt)>=Date.parse(backup.capturedAt)))
  throw Error('VOX_RECOVERY_INDEPENDENT_RESTORE_NOT_ATTESTED');
 // "External evidence" flags alone do not prove actual backup, never authorize SQL.
 return Object.freeze({schema:'qf.vox.phase-a.recovery.review.v1',...parity,
  independentRestoreClaimReviewable:true,actuallyRestoredByThisTool:false,
  archiveBytesInspectedByThisTool:false,signatureVerifiedByThisTool:false,
  stagingMigrationAuthorized:false,productionPromotionAuthorized:false,
  status:'RELEASE_HOLD'});
}
export async function hashActualArchive(path){
 assert.equal(typeof path,'string','ARCHIVE_PATH_REQUIRED');
 // Explicitly no shell, Postgres, copy, DB query or remote access.
 const h=createHash('sha256');
 for await(const chunk of createReadStream(path))h.update(chunk);
 return h.digest('hex');
}
async function selfTest(){
 const baseline=JSON.parse(readFileSync(new URL('../../ops/vox/phase-a-live-staging-migrations-baseline-20261015.json',import.meta.url)));
 const records=()=>JSON.parse(JSON.stringify({records:baseline.records}));
 const backup={sourceProjectRef:PROJECT,archiveSha256:'f'.repeat(64),
  capturedAt:'2026-10-15T01:00:00Z',managedBackupPathReviewed:true};
 const restore={targetRef:'isolated-stage-restore-synthetic',archiveSha256:'f'.repeat(64),
  historyCount:86,outboundEffectsDisabled:true,rlsAndGrantsChecked:true,
  schemaFingerprintsCompared:true,authAndStorageAssessed:true,
  restoreFinished:true,completedAt:'2026-10-15T01:10:00Z'};
 const input={baseline,sourceHistory:records(),restoreHistory:records(),backup,restore};
 const happy=validateRestoreAttestation(input);
 assert.equal(happy.status,'RELEASE_HOLD');
 let denied=0;
 const bad=(mutate)=>{
  const x=JSON.parse(JSON.stringify(input));mutate(x);
  assert.throws(()=>validateRestoreAttestation(x));denied++;
 };
 bad(x=>x.restoreHistory.records.splice(12,1)); // The old 12-of-86 failure
 bad(x=>x.restoreHistory.records[12].name='wrong-synthetic-name');
 bad(x=>x.sourceHistory.records[7].version=x.sourceHistory.records[8].version);
 bad(x=>x.backup.archiveSha256='0'.repeat(64));
 bad(x=>x.restore.archiveSha256='0'.repeat(64));
 bad(x=>x.restore.targetRef=PROJECT);
 bad(x=>x.restore.outboundEffectsDisabled=false);
 bad(x=>x.restore.rlsAndGrantsChecked=false);
 bad(x=>x.restore.authAndStorageAssessed=false);
 bad(x=>x.restore.schemaFingerprintsCompared=false);
 bad(x=>x.restore.historyCount=12);
 bad(x=>x.backup.managedBackupPathReviewed=false);
 bad(x=>x.restore.restoreFinished=false);
 bad(x=>x.baseline.exactCount=12);
 console.log('VOX_PHASE_A_RECOVERY_PARITY_SYNTHETIC_PASS positives=1 negatives='+denied+
  ' liveArchiveRead=false externalRestoreVerified=false productionAuthorized=false');
}
if(process.argv[1]&&import.meta.url.endsWith(process.argv[1].replace(/\\/g,'/'))){
 if(process.argv.includes('--self-test'))await selfTest();
 else if(process.argv.includes('--verify')){
  try{
   const arg=(flag)=>{const i=process.argv.indexOf(flag);return i>=0?process.argv[i+1]:null;};
   const load=flag=>JSON.parse(readFileSync(arg(flag),'utf8'));
   const sourceHistory=load('--source'),restoreHistory=load('--restore-history');
   const evidence=load('--evidence');
   const baseline=JSON.parse(readFileSync(new URL('../../ops/vox/phase-a-live-staging-migrations-baseline-20261015.json',import.meta.url)));
   const actual=await hashActualArchive(arg('--archive'));
   assert.equal(actual,evidence.backup.archiveSha256,'VOX_RECOVERY_ACTUAL_ARCHIVE_HASH_MISMATCH');
   const result=validateRestoreAttestation({...evidence,baseline,sourceHistory,restoreHistory});
   console.log(JSON.stringify({...result,archiveBytesInspectedByThisTool:true}));
  }catch(e){console.error('VOX_RECOVERY_RELEASE_HOLD '+String(e));process.exitCode=42;}
 }else{console.error('VOX_RECOVERY_HOLD: use --self-test or --verify with operator-provided external evidence');process.exitCode=42;}
}
