#!/usr/bin/env node
/** Source-only emitter. NO staging/production connections or deployment. */
import {execFileSync} from "node:child_process";
import {writeFileSync} from "node:fs";
import {dirname,isAbsolute,relative,resolve,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {buildVoxRC1SourceCandidate} from "../../../contracts/vox/voxRC1ReleaseCandidate.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const [flag,requested]=process.argv.slice(2);
if(flag!=="--output"||!requested||!isAbsolute(requested))
 throw Error("EXPLICIT_EXTERNAL_ABSOLUTE_OUTPUT_PATH_REQUIRED");
const out=resolve(requested);
const rel=relative(root,out);
if(!rel||(!rel.startsWith(".."+sep)&&rel!=="..")||out===root)
 throw Error("OUTPUT_MUST_REMAIN_OUTSIDE_SOURCE_TREE");
const git=(args)=>execFileSync("git",args,{cwd:root,encoding:"utf8",
 stdio:["ignore","pipe","pipe"],timeout:10000}).trim();
if(resolve(git(["rev-parse","--show-toplevel"])).toLowerCase()!==root.toLowerCase())
 throw Error("CHECKOUT_MISMATCH");
const sha=git(["rev-parse","HEAD"]);
const clean=git(["status","--porcelain","--untracked-files=normal"])==="";
const result=buildVoxRC1SourceCandidate({
 repoRoot:root,coreCommit:sha,workingTreeClean:clean});
if(!result.ok||result.canDeploy!==false)throw Error("RELEASE_PACKET_DENIED_"+result.reason);
// Never store keys, encrypted secrets, Auth identities or the private DB archive.
writeFileSync(out,JSON.stringify(result,null,2)+"\n",{encoding:"utf8",flag:"wx"});
process.stdout.write("VOX_RC1_SOURCE_PACKET_WRITTEN "+out+"\n"+
 "CORE_COMMIT "+sha+"\n"+"RELEASE_HOLD "+result.releaseStatus+"\n"+
 "SOURCE_DIGEST "+result.sourceDigest+"\n");
