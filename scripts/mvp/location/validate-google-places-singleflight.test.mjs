import test from "node:test";
import assert from "node:assert/strict";
import {loadGoogleMaps} from "../../../lib/google-maps/loadGoogleMaps.ts";

const valid={AutocompleteSessionToken:class{},AutocompleteSuggestion:{
 fetchAutocompleteSuggestions:async()=>({suggestions:[]})
}};
async function inFakeWindow(t,fn) {
 const original=globalThis.window;
 t.after(()=>{if(original===undefined)delete globalThis.window;else globalThis.window=original});
 const fake={google:{maps:{importLibrary:()=>Promise.resolve(valid)}},__qfGooglePlacesPromise:undefined};
 globalThis.window=fake;
 await fn(fake);
}
test("P2-SF1 concurrent fields share one actual in-flight Places import",async t=>{
 await inFakeWindow(t,async fake=>{
  let imports=0,resolveImport;
  fake.google.maps.importLibrary=()=>{imports++;return new Promise(resolve=>{resolveImport=resolve})};
  const first=loadGoogleMaps(),second=loadGoogleMaps(),third=loadGoogleMaps();
  assert.strictEqual(first,second);
  assert.strictEqual(first,third);
  assert.equal(imports,0,"import scheduled as microtask");
  await Promise.resolve();
  resolveImport(valid);
  assert.equal(await first,valid);
  assert.equal(await second,valid);
  assert.equal(imports,1);
 });
});
test("P2-SF2 failed import clears cache, later explicit keystroke can retry",async t=>{
 await inFakeWindow(t,async fake=>{
  let imports=0;
  fake.google.maps.importLibrary=async()=>{imports++;throw new Error("provider transient failure")};
  const a=loadGoogleMaps(),b=loadGoogleMaps();
  assert.strictEqual(a,b);
  assert.equal(await a,null);
  assert.equal(fake.__qfGooglePlacesPromise,undefined);
  fake.google.maps.importLibrary=async()=>{imports++;return valid};
  const recovered=await loadGoogleMaps();
  assert.equal(recovered,valid);
  assert.equal(imports,2);
 });
});
test("P2-SF3 a successful import is cached and never re-imports on another field mount",async t=>{
 await inFakeWindow(t,async fake=>{
  let imports=0;
  fake.google.maps.importLibrary=async()=>{imports++;return valid};
  assert.equal(await loadGoogleMaps(),valid);
  assert.equal(await loadGoogleMaps(),valid);
  assert.equal(imports,1);
 });
});
