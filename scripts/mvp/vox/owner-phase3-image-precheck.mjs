#!/usr/bin/env node
/**
 * Phase 3 local release-image handoff. READ ONLY. No remote host, Auth,
 * Staging, Supabase, provider, deployment or Docker build/push/pull/run.
 * Verifies local source identity only: never upgrades to real deployed GO.
 */
import {spawnSync} from "node:child_process";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {inspectLocalImage,verifyLocalImage} from "./owner-vendor-image-provenance.mjs";
export const SHA40=/^[0-9a-f]{40}$/;
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
export function localHead(){
 const r=spawnSync("git",["rev-parse","HEAD"],{
  cwd:root,encoding:"utf8",timeout:10000,maxBuffer:1024,windowsHide:true
 });
 if(r.error||r.status!==0)return null;
 const sha=r.stdout.trim();
 return SHA40.test(sha)?sha:null;
}
export function ownerPhase3LocalImagePrecheck({
 sourceCommit,webImage,coreImage,inspect=inspectLocalImage,
}){
 const blocked=[];
 if(typeof sourceCommit!=="string"||!SHA40.test(sourceCommit))
  blocked.push("EXACT_SOURCE_SHA_NOT_VERIFIED");
 // verifyLocalImage performs only pinned, read-only docker image inspect.
 const web=verifyLocalImage(webImage,sourceCommit,inspect);
 const core=verifyLocalImage(coreImage,sourceCommit,inspect);
 blocked.push(...web.blockedReasons.map(x=>"VOX_WEB:"+x));
 blocked.push(...core.blockedReasons.map(x=>"QF_CORE:"+x));
 blocked.push("DEPLOYED_VOX_WEB_IMAGE_DIGEST_UNOBSERVED");
 blocked.push("DEPLOYED_QF_CORE_IMAGE_DIGEST_UNOBSERVED");
 blocked.push("AUTHENTIC_CLOUDFLARE_ACCESS_TOTP_AAL2_UAT_MISSING");
 blocked.push("PROTECTED_STAGING_SQL_LEDGER_NOT_RECONCILED");
 blocked.push("SIGNED_RECOVERY_AND_ROLLBACK_NOT_PROVEN");
 blocked.push("OWNER_STAGING_AND_PRODUCTION_GO_NOT_GRANTED");
 return {
  schema:"qf.vox.owner.phase3-image-precheck.v1",
  mode:"LOCAL_DOCKER_INSPECT_ONLY",
  sourceCommit:SHA40.test(sourceCommit??"")?sourceCommit:null,
  localWeb:web,localCore:core,
  localPairSourceVerified:web.sourceVerifiedLocally&&core.sourceVerifiedLocally,
  deployedHostVerified:false,realOwnerMfaVerified:false,
  realCoreCaseVerified:false,managedDbInspected:false,
  rollbackVerified:false,providerUsed:false,
  publicRegistrationEnabled:false,decisionsEnabled:false,
  canDeploy:false,canEnableReview:false,canEnableDecisions:false,
  releaseDecision:"HOLD",blockedReasons:blocked,
 };
}
const isMain=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isMain){
 const a=process.argv.slice(2);
 if(a.length!==4||a[0]!=="--web"||a[2]!=="--core"){
  process.stderr.write("USAGE: node owner-phase3-image-precheck.mjs --web LOCAL_IMAGE --core LOCAL_IMAGE\n");
  process.exitCode=2;
 }else{
  const report=ownerPhase3LocalImagePrecheck({
   sourceCommit:localHead(),webImage:a[1],coreImage:a[3],
  });
  process.stdout.write(JSON.stringify(report,null,2)+"\n");
  if(!report.localPairSourceVerified)process.exitCode=2;
 }
}
