// VOX-24: OFFLINE verification of separately signed operator attestations.
// This file has no database, GitHub, deployment, credential, or provider client.
// Success means "packet structurally reviewable", NEVER permission to apply SQL.
import {readFileSync} from 'node:fs';
import {createPublicKey,generateKeyPairSync,sign,verify} from 'node:crypto';
import assert from 'node:assert/strict';

export const RELEASE=Object.freeze({
  core:'d8c3e1e1b8698873f652a459164214cb665ba235',
  jarvis:'1bbc916ccc095bd656b3bbcf373736a728037177',
  agni:'84c4a0f09d010045c40073824da112855a3ebb18'
});
export const STAGING_PROJECT='uckafzuochmbvtiodmcl';
export const VOX_SEVEN_DIGEST='8fb8d1c4fce97fbac7282f1ad8647b584429f2e58950c4293a7784f4667d1eaa';
const HEX64=/^[a-f0-9]{64}$/;
const HEX40=/^[a-f0-9]{40}$/;
const mandatory=(v,reason)=>{if(!v)throw Error('VOX24_'+reason);};
const keys=(o,expected)=>{
  mandatory(o!==null&&typeof o==='object'&&!Array.isArray(o),'OBJECT_REQUIRED');
  mandatory(Object.keys(o).sort().join('|')===expected.slice().sort().join('|'),'FIELDS_UNEXPECTED');
};
function canonical(v){
  if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
  if(v&&typeof v==='object')
    return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
  mandatory(v!==undefined&&typeof v!=='function'&&typeof v!=='number'||Number.isFinite(v),'VALUE_INVALID');
  return JSON.stringify(v);
}
function stageLink(value){
  try{const url=new URL(value);return url.protocol==='https:'&&!!url.hostname&&!url.username&&!url.password;}
  catch{return false;}
}
function attested(packet,role,key){
  const pub=createPublicKey(key);
  mandatory(pub.asymmetricKeyType==='ed25519','INVALID_'+role.toUpperCase()+'_KEY');
  const sig=packet.signatures[role];
  mandatory(typeof sig==='string'&&/^[A-Za-z0-9+/]+={0,2}$/.test(sig),'SIGNATURE_FORMAT');
  const message=Buffer.from('qf.vox.stage.evidence.v1/'+role+'\n'+canonical(packet.evidence));
  mandatory(verify(null,message,pub,Buffer.from(sig,'base64')),'INVALID_'+role.toUpperCase()+'_SIGNATURE');
  return pub.export({format:'der',type:'spki'}).toString('hex');
}
export function validateStageEvidence(packet,ownerPublicKey,dbaPublicKey,now=new Date()){
  keys(packet,['evidence','signatures']);
  keys(packet.signatures,['owner','dba']);
  const e=packet.evidence;
  keys(e,['schema','stagingProjectRef','historicalMigrations','release','sevenMigrationSetSha256',
    'backup','restore','security','executionFlagsOff','operatorRunbookUrl']);
  mandatory(e.schema==='qf.vox.staging.operator-evidence.v1','SCHEMA');
  mandatory(e.stagingProjectRef===STAGING_PROJECT,'WRONG_PROJECT');
  mandatory(e.historicalMigrations===86,'MIGRATION_HISTORY');
  keys(e.release,['core','jarvis','agni']);
  for(const [name,head] of Object.entries(RELEASE))
    mandatory(HEX40.test(e.release[name])&&e.release[name]===head,'UNREVIEWED_RELEASE_SHA');
  mandatory(e.sevenMigrationSetSha256===VOX_SEVEN_DIGEST,'MIGRATION_SET_DRIFT');
  keys(e.backup,['sourceProjectRef','archiveSha256','capturedAt','managedBackupPathReviewed']);
  mandatory(e.backup.sourceProjectRef===STAGING_PROJECT,'BACKUP_WRONG_SOURCE');
  mandatory(HEX64.test(e.backup.archiveSha256),'BACKUP_DIGEST_MISSING');
  mandatory(e.backup.managedBackupPathReviewed===true,'BACKUP_NOT_REVIEWED');
  keys(e.restore,['targetRef','archiveSha256','completedAt','historyCount',
    'rlsAndGrantsChecked','schemaFingerprintsCompared','authAndStorageAssessed','outboundEffectsDisabled']);
  mandatory(e.restore.targetRef!==STAGING_PROJECT&&typeof e.restore.targetRef==='string'&&
    /^[a-z0-9][a-z0-9-]{4,79}$/.test(e.restore.targetRef),'NOT_INDEPENDENT_RESTORE');
  mandatory(e.restore.archiveSha256===e.backup.archiveSha256,'ARCHIVE_CHECKSUM_MISMATCH');
  mandatory(e.restore.historyCount===86,'RESTORE_NOT_AT_PARITY');
  for(const k of ['rlsAndGrantsChecked','schemaFingerprintsCompared','authAndStorageAssessed','outboundEffectsDisabled'])
    mandatory(e.restore[k]===true,'RESTORE_'+k.toUpperCase()+'_MISSING');
  const captured=Date.parse(e.backup.capturedAt),restored=Date.parse(e.restore.completedAt);
  mandatory(Number.isFinite(captured)&&Number.isFinite(restored)&&restored>=captured&&
    restored<=now.getTime()+300000,'RESTORE_TIMESTAMPS');
  keys(e.security,['ownerDecision','decisionUrl','leakedPasswordProtectionEnabled',
    'rlsPolicyInventoryReviewed','aal2AndCityIdorPlanReviewed']);
  mandatory(['ACCEPT_WITH_SIGNOFF','REMEDIATED_AND_RETESTED'].includes(e.security.ownerDecision),
    'SECURITY_DECISION_NOT_RECORDED');
  mandatory(stageLink(e.security.decisionUrl),'SECURITY_DECISION_REFERENCE_MISSING');
  for(const k of ['leakedPasswordProtectionEnabled','rlsPolicyInventoryReviewed','aal2AndCityIdorPlanReviewed'])
    mandatory(e.security[k]===true,'SECURITY_'+k.toUpperCase()+'_MISSING');
  mandatory(e.executionFlagsOff===true,'EXECUTION_FLAGS_MUST_REMAIN_OFF');
  mandatory(stageLink(e.operatorRunbookUrl),'ROLLBACK_RUNBOOK_MISSING');
  mandatory(ownerPublicKey&&dbaPublicKey,'SEPARATE_TRUST_ROOTS_REQUIRED');
  const owner=attested(packet,'owner',ownerPublicKey);
  const dba=attested(packet,'dba',dbaPublicKey);
  mandatory(owner!==dba,'SAME_SIGNER_FOR_BOTH_ROLES');
  return Object.freeze({
    schema:'qf.vox.stage.review-output.v1',sourceOnly:true,independentAttestationsVerified:true,
    readyForManualEvidenceReview:true,realBackupIndependentlyVerifiedByThisTool:false,
    stagingMigrationAuthorized:false,stagingPromotionAuthorized:false,productionPromotionAuthorized:false,
    status:'RELEASE_HOLD',message:'Check external archive, signed signer trust, and live DB separately'
  });
}
function signedFixture(){
  const owner=generateKeyPairSync('ed25519'),dba=generateKeyPairSync('ed25519');
  const now=new Date();
  const evidence={
    schema:'qf.vox.staging.operator-evidence.v1',stagingProjectRef:STAGING_PROJECT,
    historicalMigrations:86,release:{...RELEASE},sevenMigrationSetSha256:VOX_SEVEN_DIGEST,
    backup:{sourceProjectRef:STAGING_PROJECT,archiveSha256:'a'.repeat(64),
      capturedAt:new Date(now.getTime()-60000).toISOString(),managedBackupPathReviewed:true},
    restore:{targetRef:'isolated-vox24-restore-fixture',archiveSha256:'a'.repeat(64),
      completedAt:now.toISOString(),historyCount:86,rlsAndGrantsChecked:true,
      schemaFingerprintsCompared:true,authAndStorageAssessed:true,outboundEffectsDisabled:true},
    security:{ownerDecision:'ACCEPT_WITH_SIGNOFF',
      decisionUrl:'https://github.com/quickfurno-maker/quickfurno-marketplace/issues/254',
      leakedPasswordProtectionEnabled:true,rlsPolicyInventoryReviewed:true,aal2AndCityIdorPlanReviewed:true},
    executionFlagsOff:true,
    operatorRunbookUrl:'https://github.com/quickfurno-maker/quickfurno-marketplace/issues/246'
  };
  const sig=(role,key)=>sign(null,Buffer.from('qf.vox.stage.evidence.v1/'+role+'\n'+canonical(evidence)),
    key.privateKey).toString('base64');
  const packet={evidence,signatures:{owner:sig('owner',owner),dba:sig('dba',dba)}};
  const pem=(k)=>k.publicKey.export({type:'spki',format:'pem'});
  return {packet,owner:pem(owner),dba:pem(dba)};
}
function selfTest(){
  const f=signedFixture();
  const result=validateStageEvidence(f.packet,f.owner,f.dba);
  assert.equal(result.status,'RELEASE_HOLD');
  assert.equal(result.stagingMigrationAuthorized,false);
  assert.equal(result.productionPromotionAuthorized,false);
  const clone=()=>JSON.parse(JSON.stringify(f.packet));
  let negative=0;
  for(const mutate of [
    p=>p.evidence.stagingProjectRef='prod',
    p=>p.evidence.historicalMigrations=12,
    p=>p.evidence.release.agni='0'.repeat(40),
    p=>p.evidence.sevenMigrationSetSha256='0'.repeat(64),
    p=>p.evidence.backup.archiveSha256='b'.repeat(64),
    p=>p.evidence.restore.targetRef=STAGING_PROJECT,
    p=>p.evidence.restore.historyCount=12,
    p=>p.evidence.restore.outboundEffectsDisabled=false,
    p=>p.evidence.security.leakedPasswordProtectionEnabled=false,
    p=>p.evidence.executionFlagsOff=false,
    p=>p.signatures.owner=p.signatures.dba,
    p=>p.evidence.secretKey='dont-accept-extra-fields'
  ]){
    const x=clone();mutate(x);
    assert.throws(()=>validateStageEvidence(x,f.owner,f.dba));
    negative++;
  }
  assert.throws(()=>validateStageEvidence(f.packet,f.owner,f.owner));
  negative++;
  console.log('VOX24_SIGNED_STAGE_EVIDENCE_OFFLINE_PASS positive=1 negatives='+negative+
    ' liveBackupVerified=false stageAuthorized=false productionAuthorized=false');
}
if(process.argv[1]&&import.meta.url.endsWith(process.argv[1].replace(/\\/g,'/'))){
  if(process.argv.includes('--self-test'))selfTest();
  else if(process.argv.includes('--status')){
    console.log(JSON.stringify({status:'RELEASE_HOLD',releases:RELEASE,
      backupVerified:false,stagingMigrationAuthorized:false,productionPromotionAuthorized:false}));
  }else if(process.argv.includes('--packet')){
    const at=(name)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:null;};
    try{
      mandatory(at('--packet')&&at('--owner-key')&&at('--dba-key'),'EVIDENCE_AND_TRUSTED_KEYS_REQUIRED');
      const packet=JSON.parse(readFileSync(at('--packet'),'utf8'));
      const result=validateStageEvidence(packet,readFileSync(at('--owner-key'),'utf8'),
        readFileSync(at('--dba-key'),'utf8'));
      console.log(JSON.stringify(result));
    }catch(e){console.error('VOX24_RELEASE_HOLD '+String(e));process.exitCode=42;}
  }else{console.error('VOX24_RELEASE_HOLD: use --self-test, --status, or --packet with two independently trusted keys');process.exitCode=42;}
}