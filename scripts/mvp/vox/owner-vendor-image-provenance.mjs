#!/usr/bin/env node
/**
 * Local-only OCI image provenance PRECHECK for the VOX Owner ↔ Core vendor bridge.
 * docker image inspect ONLY; never builds, pulls, runs, deploys or changes config.
 * A local match cannot establish what vox.quickfurno.in actually serves.
 */
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
export const EXPECTED_CANDIDATE="49cf169eb84be743e6db30b23ee9d9cd57089976";
const SHA40=/^[a-f0-9]{40}$/;
const SHA256=/^sha256:[a-f0-9]{64}$/;
const VALID_IMAGE=/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,190}$/;
const BLOCKERS=Object.freeze([
  "NO_AUTHENTICATED_DEPLOYED_VOX_IMAGE_DIGEST",
  "NO_AUTHENTICATED_DEPLOYED_CORE_IMAGE_DIGEST",
  "NO_CLOUDFLARE_OWNER_TOTP_AAL2_BROWSER_UAT",
  "NO_SIGNED_VOX_CORE_ROLLBACK_ATTESTATION",
  "SEVEN_VENDOR_SQL_NOT_IN_VOX_SOURCE_CANDIDATE",
]);
export function inspectLocalImage(ref){
 if(typeof ref!=="string"||!VALID_IMAGE.test(ref))return null;
 const result=spawnSync("docker",["image","inspect",ref,"--format","{{json .}}"],{
   encoding:"utf8",timeout:10000,maxBuffer:1024*1024,windowsHide:true
 });
 if(result.error||result.status!==0||!result.stdout)return null;
 try{return JSON.parse(result.stdout);}catch{return null;}
}
export function verifyLocalImage(ref,expectedCommit,inspect){
 const reasons=[];
 if(typeof ref!=="string"||!VALID_IMAGE.test(ref))reasons.push("IMAGE_REFERENCE_INVALID");
 if(typeof expectedCommit!=="string"||!SHA40.test(expectedCommit))reasons.push("EXPECTED_COMMIT_INVALID");
 const o=reasons.length?null:inspect(ref);
 if(!o||typeof o!=="object"||Array.isArray(o)){
  reasons.push("LOCAL_IMAGE_NOT_AVAILABLE");
  return {imageRef:ref??null,localImageId:null,localRepoDigest:null,
   localRevision:null,sourceVerifiedLocally:false,blockedReasons:reasons};
 }
 if(!SHA256.test(o.Id??""))reasons.push("LOCAL_IMAGE_ID_UNVERIFIED");
 const revision=o.Config?.Labels?.["org.opencontainers.image.revision"]??null;
 if(revision!==expectedCommit)reasons.push("OCI_SOURCE_REVISION_MISMATCH");
 const digests=Array.isArray(o.RepoDigests)?o.RepoDigests:[];
 const digest=digests.find(d=>typeof d==="string"&&/@sha256:[a-f0-9]{64}$/.test(d))??null;
 if(!digest)reasons.push("NO_CONTENT_ADDRESSABLE_REPOSITORY_DIGEST");
 const refs=Array.isArray(o.RepoTags)?o.RepoTags:[];
 if(!(refs.includes(ref)||digests.includes(ref)))reasons.push("REQUESTED_IMAGE_REF_NOT_IN_INSPECTED_ARTIFACT");
 return {imageRef:ref,localImageId:o.Id??null,localRepoDigest:digest,
  localRevision:revision,sourceVerifiedLocally:reasons.length===0,blockedReasons:reasons};
}
export function evaluateLocalOwnerImagePair({webRef,coreRef,expectedCommit=EXPECTED_CANDIDATE,inspect=inspectLocalImage}){
 const web=verifyLocalImage(webRef,expectedCommit,inspect);
 const core=verifyLocalImage(coreRef,expectedCommit,inspect);
 const blockers=[...BLOCKERS,...web.blockedReasons.map(x=>"VOX_WEB:"+x),
   ...core.blockedReasons.map(x=>"QUICKFURNO_CORE:"+x)];
 return {
  schema:"qf.vox.owner.vendor-image-source-review.v1",expectedCommit,
  mode:"READ_ONLY_LOCAL_DOCKER_INSPECT",
  web,core,sourcePairMatchesLocally:web.sourceVerifiedLocally&&core.sourceVerifiedLocally,
  deployedHostVerified:false,ownerAal2Verified:false,rollbackVerified:false,
  canEnableReview:false,canEnableDecisions:false,releaseDecision:"HOLD",
  commandsExecuted:["docker image inspect"],networkCalls:false,deploys:false,
  blockers
 };
}
const isMain=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isMain){
 const args=process.argv.slice(2);
 if(args.length!==4||args[0]!=="--web"||args[2]!=="--core"){
  process.stderr.write("USAGE: node owner-vendor-image-provenance.mjs --web LOCAL_IMAGE --core LOCAL_IMAGE\n");
  process.exitCode=2;
 }else{
  const output=evaluateLocalOwnerImagePair({webRef:args[1],coreRef:args[3]});
  process.stdout.write(JSON.stringify(output,null,2)+"\n");
  if(!output.sourcePairMatchesLocally)process.exitCode=2;
 }
}
