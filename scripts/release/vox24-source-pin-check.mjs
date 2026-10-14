// VOX-24 Phase A: read-only source pin verification, never deployment.
// Requires a checkout with GitHub origin access to the current Core repository.
// Refuses superseded Core PR heads and modified SQL fingerprints.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {RELEASE,VOX_SEVEN_DIGEST} from './vox-stage-evidence-preflight.mjs';

const BRANCH='refs/heads/security/vox-phase-a-isolated-staff-principal';
const FILES=[
 '20261014010000_vox_v1_scoped_staff_authority.sql',
 '20261014020000_vox_v1_staff_review_workflow.sql',
 '20261014030000_vox_v1_approved_grant_finalizer.sql',
 '20261014040000_vox_v1_staff_emergency_revocation.sql',
 '20261014050000_vox_v1_team_leader_review_policy.sql',
 '20261014060000_vox_operational_intent_review.sql',
 '20261014070000_vox_approved_followup_executor.sql'
];
const sha=s=>createHash('sha256').update(s).digest('hex');
const git=(...args)=>execFileSync('git',args,{
 encoding:'utf8',timeout:30000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']
}).trimEnd();
function run(){
 const pinned=RELEASE.core;
 assert.match(pinned,/^[a-f0-9]{40}$/);
 assert.match(VOX_SEVEN_DIGEST,/^[a-f0-9]{64}$/);
 const remote=git('ls-remote','--heads','origin',BRANCH).trim();
 assert.equal(remote,pinned+'\t'+BRANCH,'VOX24_CORE_BRANCH_HEAD_DRIFT');
 // Read-only Git object access. Never checkout or apply database migrations.
 git('fetch','--no-tags','--depth=1','origin',pinned);
 const hashes=FILES.map(filename=>{
  const raw=git('show',pinned+':supabase/migrations/'+filename);
  const normalized=raw.replace(/\r\n/g,'\n').replace(/\r/g,'\n')+'\n';
  return {version:filename.slice(0,14),digest:sha(Buffer.from(normalized,'utf8'))};
 });
 assert.equal(new Set(hashes.map(x=>x.version)).size,7,'VOX24_DUPLICATE_VERSION');
 const combined=sha(Buffer.from(hashes.map(x=>x.version+':'+x.digest).join('|')));
 assert.equal(combined,VOX_SEVEN_DIGEST,'VOX24_SQL_SOURCE_DRIFT');
 console.log(JSON.stringify({schema:'qf.vox24.source-pin-proof.v1',
  release:RELEASE, pinnedCoreHead:pinned,migrationSetSha256:combined,
  checks:FILES.length,status:'RELEASE_HOLD',managedBackupVerified:false,
  stagingMigrationAuthorized:false,productionPromotionAuthorized:false}));
}
try{run();}
catch(e){console.error('VOX24_PIN_CHECK_RELEASE_HOLD '+String(e));process.exitCode=42;}
