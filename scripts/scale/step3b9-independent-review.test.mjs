import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {makeHandoff} from "./step3b9-review-handoff.mjs";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const read=p=>JSON.parse(readFileSync(resolve(ROOT,p),"utf8"));
const src=read("ops/vox/certification/STEP3B8-REVIEW-QUEUE-20261023.json");
const ledger=read("ops/vox/certification/STEP3B6-DIVERGENCE-20261023.json");
const policy=read("ops/vox/certification/STEP3B7-POLICY-DECISION-MATRIX-20261023.json");
test("DBA handoff has all 104 records, 72 absent runnable source versions, no signoffs",()=>{
 const p=makeHandoff(); assert.equal(p.dba.decisions.length,104);
 assert.equal(p.dba.counts.missingRunnableSource,72);assert.equal(p.dba.independentlyApproved,false);
 assert.ok(p.dba.decisions.every(x=>x.independentSignature===null));
});
test("AppSec handoff has all 69 records, 37 write/all policy reviews, no signoffs",()=>{
 const p=makeHandoff();assert.equal(p.appsec.decisions.length,69);
 assert.equal(p.appsec.counts.writeOrAll,37);assert.ok(p.appsec.decisions.every(x=>x.measuredEffectiveRls===null));
 assert.equal(p.appsec.independentlyApproved,false);
});
test("Owner exact-SHA Staging intent is NOT approval or effective release access",()=>{
 const p=makeHandoff();assert.equal(p.owner.approved,false);
 assert.equal(p.owner.ownerSigned,null);assert.equal(p.owner.approvedReleaseSha,null);
 assert.ok(Object.entries(p.gates).filter(([x])=>x.endsWith("Allowed")).every(([,v])=>v===false));
 assert.equal(p.releaseStatus,"HOLD");
});
test("fake DBA, AppSec or Owner approval flags from source queue fail closed",()=>{
 for(const [field,value] of [["independentDbaSigned",true],["independentAppsecSigned",true],
 ["ownerApprovedManagedStaging",true],["sourceCiPassed",true],["privilegedAuthAuthorized",true]]){
  const t=structuredClone(src);t[field]=value;assert.throws(()=>makeHandoff(t,ledger,policy),field);
 }
});
test("altering preserved ledger or policy snapshots is detected, not automatically accepted",()=>{
 const d=structuredClone(ledger);d.records.pop();assert.throws(()=>makeHandoff(src,d,policy));
 const a=structuredClone(policy);a.policies.pop();assert.throws(()=>makeHandoff(src,ledger,a));
});
test("tampered reviewer or decision cannot be silently presented as pending",()=>{
 const d=structuredClone(src);d.reviewerQueues.DBA[0].reviewer="fake";assert.throws(()=>makeHandoff(d,ledger,policy));
 const a=structuredClone(src);a.reviewerQueues.AppSec[0].policyDecision="APPROVED";assert.throws(()=>makeHandoff(a,ledger,policy));
});
