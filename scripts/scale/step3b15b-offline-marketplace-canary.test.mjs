// Phase 3B15B: sandbox economic/event scenario; production modules only
// supply locked constants. NOT a replacement for the real DB RPC or E2E.
import test from "node:test";
import assert from "node:assert/strict";
import {
 CANONICAL_ACTIVE_ASSIGNMENT_CAP,
 CANONICAL_ASSIGNMENT_CREDIT_COST,
 CANONICAL_ASSIGNMENT_RPC
} from "../../lib/marketplace/canonicalAssignmentContract.ts";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
function mockScenario({consent=true,duplicate=false,mode="auto_suggest",credit=2,
  ids=["a","b","c","d"],replay=false}={}){
 const ledger=new Map(ids.map(x=>[x,credit]));
 const eventIds=new Set();
 const assigned=[];
 const events=[];
 if(!consent||duplicate||mode==="off")
   return {assigned,events,ledger,reason:!consent?"NO_CONSENT":duplicate?"DUPLICATE":"OFF"};
 for(const id of ids){
  if(assigned.length>=CANONICAL_ACTIVE_ASSIGNMENT_CAP)break;
  if((ledger.get(id)??0)<CANONICAL_ASSIGNMENT_CREDIT_COST)continue;
  const eventId="synthetic:lead-1:"+id;
  if(eventIds.has(eventId))continue;
  eventIds.add(eventId);
  ledger.set(id,(ledger.get(id)??0)-CANONICAL_ASSIGNMENT_CREDIT_COST);
  assigned.push(id);events.push(eventId);
 }
 if(replay){
  for(const id of assigned){
   const eventId="synthetic:lead-1:"+id;
   if(eventIds.has(eventId))continue;
   throw Error("duplicate event id must be suppressed");
  }
 }
 return {assigned,events,ledger,reason:"SIMULATED_ONLY"};
}
test("B01 actual Core constants require <=3 active assignments and one credit",()=>{
 assert.equal(CANONICAL_ACTIVE_ASSIGNMENT_CAP,3);
 assert.equal(CANONICAL_ASSIGNMENT_CREDIT_COST,1);
 assert.equal(CANONICAL_ASSIGNMENT_RPC,"qf_assign_lead_vendors_v2");
});
test("B02 an unknown mode defaults to the actual Core nonmutating off",()=>{
 const p=resolve(dirname(fileURLToPath(import.meta.url)),"../../lib/lead-assignment/runtimeSettings.ts");
 const s=readFileSync(p,"utf8");
 assert.match(s,/auto_assignment_mode: "off"/);
});
test("B03 simulated eligible candidate fanout capped at 3; no fourth credit charge",()=>{
 const s=mockScenario();
 assert.deepEqual(s.assigned,["a","b","c"]);
 assert.equal(s.ledger.get("d"),2);
 assert.equal(s.events.length,3);
});
test("B04 missing consent, duplicate and disabled modes never debit or emit",()=>{
 for(const x of [{consent:false},{duplicate:true},{mode:"off"}]){
  const s=mockScenario(x);
  assert.equal(s.assigned.length,0);
  assert.equal(s.events.length,0);
  assert.equal(s.ledger.get("a"),2);
 }
});
test("B05 zero credits cannot be spent even when otherwise matching",()=>{
 const s=mockScenario({credit:0});
 assert.equal(s.assigned.length,0);
 assert.equal(s.events.length,0);
});
test("B06 duplicates in candidate input must not double charge an id",()=>{
 const s=mockScenario({ids:["a","a","b","c"],replay:true});
 assert.deepEqual(s.assigned,["a","b","c"]);
 assert.equal(s.ledger.get("a"),1);
 assert.equal(s.events.length,3);
});
test("B07 simulated event replay is idempotent",()=>{
 const s=mockScenario({replay:true});
 assert.equal(s.events.length,3);
 assert.equal(s.assigned.length,3);
});
