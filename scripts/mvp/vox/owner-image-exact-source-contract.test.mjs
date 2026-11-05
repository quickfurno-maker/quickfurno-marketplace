import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const web=read("apps/vox-web/Dockerfile");
const core=read("Dockerfile");
const validate=(source,title)=>{
 assert.match(source,/ARG GIT_SHA=unknown/);
 assert.match(source,/RUN printf '%s' "\$GIT_SHA" \| grep -Eq '\^\[0-9a-f\]\{40\}\$'/);
 assert.match(source,/org\.opencontainers\.image\.revision="\$\{GIT_SHA\}"/);
 assert.match(source,/org\.opencontainers\.image\.source="https:\/\/github\.com\/quickfurno-maker\/quickfurno-marketplace"/);
 assert.match(source,/USER 10001/);
 assert.doesNotMatch(source,/LABEL[^\n]*revision="unknown"/);
};
test("P1-03 Core container rejects unspecified or malformed GIT_SHA, stamps exact provenance",()=>{
 validate(core,"Core");
 assert.ok(core.indexOf("RUN printf '%s' \"$GIT_SHA\"")<core.indexOf("RUN npm run build:automation-worker"));
});
test("P1-03 standalone Owner image rejects unspecified or malformed GIT_SHA, stamps OCI revision",()=>{
 validate(web,"VOX");
 assert.match(web,/VOX_DEMO_PREVIEW=disabled/);
 assert.match(web,/COPY --from=build --chown=10001:10001/);
 assert.match(web,/CMD \["node","server\.js"\]/);
});
test("P1-03 release script sources provide reviewed exact commit to Core image builds",()=>{
 for(const path of [
  ".github/workflows/scale-container-supply-chain.yml",
  ".github/workflows/vox-owner-core-minimal-no-deploy.yml",
  "ops/phase16/build-certification-image.sh"
 ]){
  const s=read(path);
  assert.match(s,/--build-arg (?:["']?)GIT_SHA=/);
 }
});
test("P1-03 source gate never claims real deployed digest, image signing or production GO",()=>{
 const body=read("scripts/mvp/vox/owner-phase3-image-precheck.mjs");
 assert.match(body,/deployedHostVerified:false/);
 assert.match(body,/canDeploy:false/);
 assert.match(body,/releaseDecision:"HOLD"/);
});
