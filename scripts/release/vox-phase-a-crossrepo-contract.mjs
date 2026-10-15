// VOX Phase A cross-repository, READ-ONLY source contract proof.
// Fetches exact frozen PR heads, executes only bounded pure Core/Jarvis modules,
// and checks AGNI owner-only guard shape. Never publishes, deploys, or calls APIs.
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {RELEASE} from './vox-stage-evidence-preflight.mjs';

// These are exact, pinned, non-executable contract snapshots fetched through
// the linked first-party GitHub API from the verified release SHAs. GitHub
// Actions for Core cannot access the PRIVATE Jarvis/AGNI repositories.
// Therefore CI checks Git blob SHA of the frozen files and exercises them
// offline. A separate connector review must re-verify LIVE external heads.
const FILES=Object.freeze([
 ['core_agentSubjectAccess.mjs','ops/vox/review-snapshots/core-vox-agentSubjectAccess.mjs','6b8356d7cc5cb7f443b4839f1ca2c1c0e138c26f'],
 ['core_neutralStaffPrincipal.mjs','ops/vox/review-snapshots/core-vox-neutralStaffPrincipal.mjs','ed7445cb396deece6308b1f3281ff0b7be7ef2f5'],
 ['jarvis_agentView.mjs','ops/vox/review-snapshots/jarvis-vox-agentView.mjs','869208894544a3ee2e09707d43d31421059bb0c4'],
 ['agni_voxOwnerAttestation.ts','ops/vox/review-snapshots/agni-vox-ownerAttestation.ts','2f9f78ca7099460d334ffe6d220a27aca31deb9f']
]);
async function run(){
 let checks=0;
 const content={};
 for(const [label,file,blob] of FILES){
  const bytes=readFileSync(new URL('../../'+file,import.meta.url));
  const actual=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  assert.equal(actual,blob,'FROZEN_SOURCE_SNAPSHOT_TAMPER_'+label);
  content[label]=bytes.toString('utf8');checks++;
 }
 const scratch=mkdtempSync(join(tmpdir(),'vox-phase-a-offline-'));
 try{
  for(const [label] of FILES)writeFileSync(join(scratch,label),content[label],'utf8');
  const read=(name)=>readFileSync(join(scratch,name),'utf8');
  const agni=read('agni_voxOwnerAttestation.ts');
  assert.match(agni,/authorizeCurrentOwner/);
  assert.match(agni,/claimOnce/);
  assert.match(agni,/AGNI_OWNER_SCOPE_DENIED/);
  assert.match(agni,/AGNI_REPLAY_DENIED/);
  assert.match(agni,/actionsEnabled:false/);
  assert.match(agni,/scope:'OWNER_ONLY'/);
  checks+=6;
  const core=await import(pathToFileURL(join(scratch,'core_agentSubjectAccess.mjs')).href);
  const principals=await import(pathToFileURL(join(scratch,'core_neutralStaffPrincipal.mjs')).href);
  const jarvis=await import(pathToFileURL(join(scratch,'jarvis_agentView.mjs')).href);
  const id1=randomUUID(),id2=randomUUID(),id3=randomUUID(),id4=randomUUID();
  assert.equal(principals.isNeutralVoxStaffPrincipal(
    {id:id1,role:null,is_active:true},
    {id:id1,app_metadata:{qf_principal:'vox_staff'}}),true);checks++;
  assert.equal(principals.isNeutralVoxStaffPrincipal(
    {id:id1,role:'admin',is_active:true},
    {id:id1,app_metadata:{qf_principal:'vox_staff'}}),false);checks++;
  const scope={userId:id1,cityId:id3,role:'acquisition_agent',
    canReadContent:true,prospectIds:[id2],vendorIds:[],conversationIds:[id4]};
  const allowed=core.normalizeAgentSubjectAccess(
    {agent:'AAROHI',subjectType:'prospect',subjectId:id2,revision:2},scope);
  assert.equal(allowed?.subjectId,id2);checks++;
  assert.equal(core.normalizeAgentSubjectAccess(
    {agent:'ANISHA',subjectType:'vendor',subjectId:id2,revision:2},scope),null);checks++;
  assert.equal(core.normalizeAgentSubjectAccess(
    {agent:'AAROHI',subjectType:'prospect',subjectId:randomUUID(),revision:2},scope),null);checks++;
  assert.equal(core.normalizeAgentSubjectAccess(
    {agent:'AAROHI',subjectType:'prospect',subjectId:id2,revision:2,override:'yes'},scope),null);checks++;
  const now=Math.floor(Date.now()/1000);
  const e={schema:jarvis.VOX_JARVIS_CONTRACT,iss:'qf-jarvis',aud:'vox-web',
    agent:'AAROHI',channel:'ACQUISITION',subjectType:'prospect',subjectId:id2,
    jti:randomUUID(),revision:2,iat:now-5,exp:now+55,
    memoryStatus:'CONSENTED',humanTakeover:true,lastEvent:'Human takeover requested'};
  const secret='synthetic-vox-phase-a-test-secret-32bytes-minimum';
  const signed=jarvis.signAgentView(e,secret);
  const view=jarvis.verifyAgentView(signed,secret,now);
  assert.equal(view.schema,'qf.vox.agent.view.v1');
  assert.equal(view.replayCheckRequired,true);
  assert.deepEqual([...view.permissions],['READ_ONLY']);
  checks+=3;
  assert.throws(()=>jarvis.verifyAgentView(signed,secret+'corrupt',now));checks++;
  assert.throws(()=>jarvis.verifyAgentView(signed,secret,now+500));checks++;
  assert.throws(()=>jarvis.signAgentView({...e,outboundBody:'private'},secret));checks++;
  assert.throws(()=>jarvis.signAgentView({...e,agent:'ANISHA',channel:'ACQUISITION'},secret));checks++;
  const proof={schema:'qf.vox.phase-a.crossrepo.offline.v1',checks,
    reviewedSnapshotHeads:{...RELEASE},liveRemoteHeadsCheckedByThisTool:false,roles:'OWNER_AND_SCOPED_STAFF_SEPARATE',
    jarvis:'SIGNED_READ_ONLY_REPLAY_REQUIRES_DURABLE_RUNTIME',
    agni:'OWNER_ONLY_AND_DURABLE_REPLAY_REQUIRED',
    managedStagingTested:false,productionAuthorized:false,
    status:'RELEASE_HOLD'};
  console.log(JSON.stringify(proof));
 }finally{rmSync(scratch,{recursive:true,force:true});}
}
try{await run();}
catch(e){console.error('VOX_PHASE_A_CROSS_REPO_HOLD '+String(e));process.exitCode=42;}
