// VOX Phase A cross-repository, READ-ONLY source contract proof.
// Fetches exact frozen PR heads, executes only bounded pure Core/Jarvis modules,
// and checks AGNI owner-only guard shape. Never publishes, deploys, or calls APIs.
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {RELEASE} from './vox-stage-evidence-preflight.mjs';

const TARGETS=[
 {name:'core',repo:'quickfurno-marketplace',
  branch:'security/vox-phase-a-isolated-staff-principal',
  files:['contracts/vox/agentSubjectAccess.mjs','contracts/vox/neutralStaffPrincipal.mjs']},
 {name:'jarvis',repo:'qf-jarvis',
  branch:'release/vox-final-jarvis-aggregate',
  files:['contracts/vox/agentView.mjs']},
 {name:'agni',repo:'qf-agni',
  branch:'feat/vox21-agni-current-main-owner-bridge',
  files:['packages/observability-intelligence/src/voxOwnerAttestation.ts']}
];
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',
 timeout:40000,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']});
async function run(){
 const scratch=mkdtempSync(join(tmpdir(),'vox-phase-a-crossrepo-'));
 let checks=0;
 try{
  for(const target of TARGETS){
   const url='https://github.com/quickfurno-maker/'+target.repo+'.git';
   const ref='refs/heads/'+target.branch;
   const head=git(scratch,'ls-remote','--heads',url,ref).trim();
   assert.equal(head,RELEASE[target.name]+'\t'+ref,'DRIFT_'+target.name);
   const sub=join(scratch,target.name);
   execFileSync('mkdir',['-p',sub]);
   git(sub,'init','--quiet');
   git(sub,'fetch','--no-tags','--depth=1',url,RELEASE[target.name]);
   for(const filename of target.files){
    const body=git(sub,'show','FETCH_HEAD:'+filename);
    writeFileSync(join(scratch,target.name+'_'+filename.split('/').at(-1)),body,'utf8');
    checks++;
   }
   checks++;
  }
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
    checkedHeads:{...RELEASE},roles:'OWNER_AND_SCOPED_STAFF_SEPARATE',
    jarvis:'SIGNED_READ_ONLY_REPLAY_REQUIRES_DURABLE_RUNTIME',
    agni:'OWNER_ONLY_AND_DURABLE_REPLAY_REQUIRED',
    managedStagingTested:false,productionAuthorized:false,
    status:'RELEASE_HOLD'};
  console.log(JSON.stringify(proof));
 }finally{rmSync(scratch,{recursive:true,force:true});}
}
try{await run();}
catch(e){console.error('VOX_PHASE_A_CROSS_REPO_HOLD '+String(e));process.exitCode=42;}
