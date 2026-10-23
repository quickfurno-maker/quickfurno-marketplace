import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const read=x=>readFileSync(resolve(ROOT,x),"utf8");
const workflow=read(".github/workflows/finance-v2-pay3-hold.yml");
const review=read("docs/vox/STEP3B10-GEMINI-SECOND-PASS-VERIFIED-TRIAGE-20261023.md");
const vmSpec=read("apps/vox-web/scripts/validate-eod-attention-08i.spec.mjs");
const stage=read("ops/vox/certification/STEP3B9F-UNSIGNED-RELEASE-PREFLIGHT-20261023.json");
test("Finance-specific VOX Web job runs npm test before TS and build",()=>{
 const section=workflow.split("  pay3-vox-web-source:")[1]?.split("  pay3-offline-pg17:")[0];
 assert.ok(section,"Web CI job must exist");
 const a=section.indexOf("run: npm test");
 const b=section.indexOf("run: npm run typecheck");
 const c=section.indexOf("run: npm run build");
 assert.ok(a>=0 && b>a && c>b,"regression tests must gate TS and build");
 assert.match(section,/working-directory: apps\/vox-web/);
});
test("Finance PR path filters cover 3B10 audit updates",()=>{
 assert.match(workflow,/scripts\/scale\/\*step3b10\*/);
 assert.match(workflow,/docs\/vox\/\*STEP3B10\*/);
});
test("VM module tests still explicitly require VM import pipeline; do not remove flag blindly",()=>{
 assert.match(vmSpec,/vm\.SourceTextModule/);
 assert.match(vmSpec,/vm\.SyntheticModule/);
 assert.match(read("apps/vox-web/package.json"),/--experimental-vm-modules/);
});
test("Gemini second-pass report documents qualified rather than fabricated approval",()=>{
 assert.match(review,/\*\*Release verdict:\*\* \*\*HOLD\*\*/);
 const r=JSON.parse(stage);
 assert.equal(r.releaseStatus,"HOLD");
 assert.equal(r.independentAppsecApproval,false);
 assert.equal(r.independentDbaApproval,false);
 assert.equal(r.ownerStagingApproval,false);
 assert.equal(r.productionAuthorized,false);
});
