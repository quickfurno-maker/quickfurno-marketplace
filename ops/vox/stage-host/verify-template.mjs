import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const file=fileURLToPath(new URL('./compose.yml', import.meta.url));
const digest=v=>createHash('sha256').update(v).digest('hex');
const stageImage=/^[a-z0-9][a-z0-9_.:/-]*@sha256:[a-f0-9]{64}$/;
const requiredDisabled=[
  'VOX_STAFF_PORTAL_ENABLED','VOX_DEMO_PREVIEW','VOX_STAFF_VIEW_MODE',
  'VOX_STAFF_MFA_ENROLL_ENABLED','VOX_INTELLIGENCE_VIEW_ENABLED',
  'VOX_STAFF_REVIEW_WEB_ENABLED','VOX_VENDOR_TASK_UI_ENABLED',
  'VOX_SUPPORT_TASK_UI_ENABLED','VOX_STUDIO_WEB_ENABLED',
  'VOX_OPERATIONAL_REVIEW_UI_ENABLED','VOX_APPROVED_FOLLOWUP_WEB_ENABLED',
  'VOX_OPERATIONAL_PROPOSAL_UI_ENABLED','VOX_FOLLOWUP_PROPOSALS_WEB_ENABLED'
];
export function auditTemplate(compose,image){
 const failures=[];
 const requireCheck=(ok,reason)=>{if(!ok)failures.push(reason)};
 requireCheck(/name:\s*qf-vox-stage\b/.test(compose),'ISOLATED_PROJECT_NAME_MISSING');
 requireCheck(/profiles:\s*\n\s*- vox-private-review-only\b/.test(compose),'EXPLICIT_DISABLED_PROFILE_MISSING');
 requireCheck(/image:\s*\$\{VOX_STAGE_IMAGE:\?/.test(compose),'IMAGE_DIGEST_REQUIRED');
 requireCheck(/pull_policy:\s*never/.test(compose),'PULL_WOULD_ALLOW_UNREVIEWED_FETCH');
 requireCheck(!/^\s*build:\s*$/m.test(compose),'SOURCE_BUILD_FORBIDDEN_ON_VPS');
 requireCheck(!/^\s*privileged:\s*true/m.test(compose),'PRIVILEGED_CONTAINER_FORBIDDEN');
 requireCheck(/- "127\.0\.0\.1:3107:3000"/.test(compose),'LOCALHOST_BIND_REQUIRED');
 requireCheck(!/^\s*-\s*["']?(?:0\.0\.0\.0|\[::\]):/m.test(compose),'PUBLIC_PORT_BIND_FORBIDDEN');
 requireCheck(/internal:\s*true/.test(compose),'NO_EGRESS_NETWORK_REQUIRED');
 requireCheck(/restart:\s*"no"/.test(compose),'AUTO_RESTART_FORBIDDEN');
 requireCheck(/user:\s*"10001:10001"/.test(compose),'NON_ROOT_USER_REQUIRED');
 requireCheck(/read_only:\s*true/.test(compose),'READ_ONLY_ROOTFS_REQUIRED');
 requireCheck(/- no-new-privileges:true/.test(compose),'NO_NEW_PRIVILEGES_REQUIRED');
 requireCheck(/cap_drop:\s*\n\s*- ALL/.test(compose),'DROP_ALL_CAPABILITIES_REQUIRED');
 requireCheck(/mem_limit:\s*768m/.test(compose),'MEMORY_LIMIT_REQUIRED');
 requireCheck(/cpus:\s*0\.50/.test(compose),'CPU_LIMIT_REQUIRED');
 requireCheck(/VOX_EXPECTED_ORIGIN:\s*https:\/\/vox\.quickfurno\.in/.test(compose),'ORIGIN_PIN_MISSING');
 requireCheck(!/^[ \t]+(?:VOX_SUPABASE_[A-Z_]+|SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|DATABASE_URL):/m.test(compose),'APP_SECRET_BAKED_INTO_TEMPLATE');
 requireCheck(!/traefik\.http\.|traefik\.enable:\s*true/i.test(compose),'PUBLIC_TRAEFIK_ROUTING_FORBIDDEN');
 for(const key of requiredDisabled)requireCheck(new RegExp('^\\s*'+key+': disabled\\s*$','m').test(compose),key+'_IS_NOT_DISABLED');
 if(image!==undefined)requireCheck(stageImage.test(image),'UNPINNED_OR_INVALID_OCI_IMAGE');
 return {schema:'qf.vox.private.host.template.audit.v1',templateSha256:digest(compose),
  allChecksPass:failures.length===0,failures,releaseStatus:'RELEASE_HOLD',
  privateContainerStartAuthorized:false,publicRouteAuthorized:false,managedStagingMigrationAuthorized:false,
  independentReviewerRequired:true, signedReleaseRequired:true};
}
function selfTest(){
 const src=readFileSync(file,'utf8');
 const image='ghcr.io/quickfurno-maker/vox-stage@sha256:'+'a'.repeat(64);
 assert.equal(auditTemplate(src,image).allChecksPass,true);
 assert.equal(auditTemplate(src,image.replace('@sha256:'+ 'a'.repeat(64),':latest')).allChecksPass,false);
 assert.equal(auditTemplate(src.replace('127.0.0.1:3107:3000','0.0.0.0:3107:3000'),image).allChecksPass,false);
 assert.equal(auditTemplate(src.replace('internal: true','internal: false'),image).allChecksPass,false);
 assert.equal(auditTemplate(src.replace('VOX_STAFF_PORTAL_ENABLED: disabled','VOX_STAFF_PORTAL_ENABLED: staging'),image).allChecksPass,false);
 assert.equal(auditTemplate(src.replace('restart: "no"','restart: always'),image).allChecksPass,false);
 assert.equal(auditTemplate(src.replace('read_only: true','read_only: false'),image).allChecksPass,false);
 assert.equal(auditTemplate(src.replace('cap_drop:\n      - ALL','cap_drop:\n      - NET_ADMIN'),image).allChecksPass,false);
 assert.equal(auditTemplate(src,image).privateContainerStartAuthorized,false);
 console.log('VOX_VPS_STAGE_INERT_TEMPLATE_SOURCE_QA_PASS positive=1 negatives=7 no_deploy=true');
}
if(process.argv.includes('--self-test'))selfTest();
else {
 const value=auditTemplate(readFileSync(file,'utf8'),process.env.VOX_STAGE_IMAGE);
 console.log(JSON.stringify(value));
 if(!value.allChecksPass)process.exitCode=3;
}
