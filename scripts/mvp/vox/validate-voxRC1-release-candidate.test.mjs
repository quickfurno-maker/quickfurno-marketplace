import test from "node:test";import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";import {resolve,dirname} from "node:path";
import {buildVoxRC1SourceCandidate as build,rc1ExternalSources as sources}
 from "../../../contracts/vox/voxRC1ReleaseCandidate.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const spec=()=>({repoRoot:root,coreCommit:"a".repeat(40),workingTreeClean:true,
 jarvisCommit:sources.jarvis.commit,agniCommit:sources.agni.commit});
test("VOX RC1 complete 30-file and critical code digest is deterministic, locked and NEVER deployable",()=>{
 const a=build(spec()),b=build(spec());
 assert.equal(a.ok,true,a.reason);
 assert.equal(a.ddl.sourceCount,30);assert.equal(a.reviewedCode.length,12);
 assert.equal(a.sourceDigest,b.sourceDigest);
 assert.equal(a.releaseStatus,"HOLD");assert.equal(a.canInstallDatabase,false);
 assert.equal(a.canDeploy,false);assert.equal(a.canEnableProvider,false);
 assert.equal(a.configuration.outboundWhatsApp,"disabled");
 assert.equal(a.firstTeamLeaderGenuineMfaVerified,false);
});
test("VOX RC1 dirty checkout, moved Jarvis/AGNI commits, bad Core hash fail closed",()=>{
 for(const change of [
  {workingTreeClean:false},{coreCommit:"bad"},{jarvisCommit:"b".repeat(40)},
  {agniCommit:"c".repeat(40)},{repoRoot:"/not-present-repo"}
 ]){const r=build({...spec(),...change});assert.equal(r.ok,false,r.reason);
 assert.equal(r.canDeploy,false);}
});
