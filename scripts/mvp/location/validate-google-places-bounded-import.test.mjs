import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {boundedPlacesImport} from "../../../lib/google-maps/loadGoogleMaps.ts";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const source=readFileSync(resolve(root,"lib/google-maps/loadGoogleMaps.ts"),"utf8");
const valid={AutocompleteSessionToken:class{},AutocompleteSuggestion:{
 fetchAutocompleteSuggestions:async()=>({suggestions:[]})
}};

test("P2-G1 a genuine Places New library is accepted without rewriting it",async()=>{
 assert.equal(await boundedPlacesImport(async()=>valid,100),valid);
});
test("P2-G2 malformed or legacy library is rejected",async()=>{
 assert.equal(await boundedPlacesImport(async()=>({AutocompleteSuggestion:{}}),100),null);
 assert.equal(await boundedPlacesImport(async()=>null,100),null);
});
test("P2-G3 a rejected Places import is a recoverable null, never an exception",async()=>{
 assert.equal(await boundedPlacesImport(async()=>{throw Error("synthetic blocked SDK");},100),null);
});
test("P2-G4 a permanently stalled preloaded import times out",async()=>{
 const began=Date.now();
 assert.equal(await boundedPlacesImport(()=>new Promise(()=>{}),25),null);
 assert.ok(Date.now()-began<2000,"never leave input spinner unbounded");
});
test("P2-G5 invalid timers fail closed without invoking the Google import",async()=>{
 let invoked=0;
 for(const ms of [0,-1,NaN,8001,1.5]){
  assert.equal(await boundedPlacesImport(async()=>{invoked++;return valid;},ms),null);
 }
 assert.equal(invoked,0);
});
test("P2-G6 both library paths and runtime key fetch use finite deadlines",()=>{
 assert.match(source,/const RUNTIME_KEY_TIMEOUT_MS = 2500/);
 assert.match(source,/signal: AbortSignal\.timeout\(RUNTIME_KEY_TIMEOUT_MS\)/);
 assert.match(source,/return await boundedPlacesImport\(\(\) => window\.google!\.maps!\.importLibrary!\("places"\)\)/);
 assert.match(source,/const lib = await boundedPlacesImport\(\(\) => importLibrary\("places"\)\)/);
 assert.match(source,/PLACES_BOOTSTRAP_TIMEOUT_MS = 8000/);
 assert.match(source,/if \(!places && window\.__qfGooglePlacesPromise === cached\)/);
});
