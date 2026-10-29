import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {cloneAutomationStudioDefinition,isAutomationStudioWorkflowKey,simulateAutomationStudioDefinition} from "../../../lib/automation/studioContract.ts";
const code=readFileSync(resolve(import.meta.dirname,"../../../app/api/vox/v1/owner-studio-simulate/route.ts"),"utf8");
let count=0;
const check=(name,cb)=>{cb();count++;console.log("PASS "+name);};
check("enabled only explicitly on staging",()=>assert.match(code,/VOX_OWNER_STUDIO_SIMULATION_ENABLED!=="staging"/));
check("requires current Core-verified Owner AAL2",()=>assert.match(code,/await verifyVoxOwnerBearer\(request\.headers\.get\("authorization"\)\)/));
check("rejects missing owner",()=>assert.match(code,/if\(!actor\)return reply\(\{ok:false,error:"OWNER_AAL2_REQUIRED"\},403\)/));
check("only workflowKey query",()=>assert.match(code,/params\.getAll\("workflowKey"\)\.length!==1/));
check("workflowKey whitelist",()=>assert.match(code,/isAutomationStudioWorkflowKey\(key\)/));
check("native simulator no external runner",()=>assert.match(code,/simulateAutomationStudioDefinition\(definition\)/));
check("maximum 50 nodes",()=>assert.match(code,/simulated\.visited\.slice\(0,50\)/));
check("simulator never executes",()=>assert.match(code,/canPublish:false,canExecute:false/));
check("no outbound / credits",()=>assert.match(code,/providerSends:0,creditsChanged:0/));
check("non GET all denied",()=>assert.equal((code.match(/"READ_ONLY"\},405/g)||[]).length,4));
check("no raw private data or service role",()=>assert.doesNotMatch(code,/adminClient|supabase\.from|sendWhatsApp|wallet|processAutomation|worker\.execute/));
const keys=["client_journey","vendor_journey","campaigns","recovery","orphan_cleanup","stale_cleanup"];
for(const k of keys){
 check("real pure native simulation "+k,()=>{
  assert.equal(isAutomationStudioWorkflowKey(k),true);
  const r=simulateAutomationStudioDefinition(cloneAutomationStudioDefinition(k));
  assert.equal(r.ok,true);
  if(r.ok)assert.ok(r.visited.length>0&&r.visited.length<=50);
 });
}
console.log("VOX_OWNER_STUDIO_SOURCE_PASS "+count+"/"+count);
