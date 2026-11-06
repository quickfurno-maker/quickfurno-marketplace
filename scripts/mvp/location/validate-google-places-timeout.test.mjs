import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {loadGoogleMaps} from "../../../lib/google-maps/loadGoogleMaps.ts";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const usable={AutocompleteSessionToken:class{},AutocompleteSuggestion:{fetchAutocompleteSuggestions:async()=>({suggestions:[]})}};
const withFakeBrowser=async(fn)=>{
 const oldWindow=globalThis.window, oldDocument=globalThis.document;
 const originalKey=process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
 const timers=new Map(),scripts=[];
 let nextId=1,removed=0;
 const makeScript=()=>({
  id:"qf-google-maps-js",async:false,defer:false,src:"",
  callbacks:{},
  addEventListener(name,callback){this.callbacks[name]=callback;},
  remove(){removed++;}
 });
 let active=makeScript();
 globalThis.window={
  google:undefined,__qfGooglePlacesPromise:undefined,
  setTimeout(fn){const id=nextId++;timers.set(id,fn);return id;},
  clearTimeout(id){timers.delete(id);}
 };
 globalThis.document={
  getElementById(){return active;},
  createElement(){const s=makeScript();scripts.push(s);active=s;return s;},
  head:{appendChild(){}}
 };
 process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY="synthetic-browser-key-never-sent";
 try{await fn({timers,scripts,getScript:()=>active,removed:()=>removed,clearExisting:()=>{active=null;}});}
 finally{
  if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;
  if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;
  if(originalKey===undefined)delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
  else process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=originalKey;
 }
};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test("P5-PLACES1 previously loaded but broken script times out, manual path settles and retry succeeds",async()=>{
 await withFakeBrowser(async({timers,removed})=>{
  const first=loadGoogleMaps();
  await tick();
  assert.equal(timers.size,1);
  for(const fire of [...timers.values()])fire();
  assert.equal(await first,null);
  await tick();
  assert.equal(removed(),1);
  assert.equal(globalThis.window.__qfGooglePlacesPromise,undefined);
  globalThis.window.google={maps:{importLibrary:async()=>usable}};
  assert.equal(await loadGoogleMaps(),usable);
 });
});
test("P5-PLACES2 new script error settles and removes only broken script",async()=>{
 await withFakeBrowser(async({timers,clearExisting,getScript,removed})=>{
  clearExisting();
  const first=loadGoogleMaps();
  await tick();
  assert.equal(timers.size,1);
  const script=getScript();
  assert.match(script.src,/maps\.googleapis\.com\/maps\/api\/js/);
  script.callbacks.error();
  assert.equal(await first,null);
  assert.equal(timers.size,0);
  assert.equal(removed(),1);
 });
});
test("P5-PLACES3 healthy Google Places script load succeeds and cancels fallback timer",async()=>{
 await withFakeBrowser(async({timers,clearExisting,getScript})=>{
  clearExisting();
  const first=loadGoogleMaps();
  await tick();
  assert.equal(timers.size,1);
  globalThis.window.google={maps:{importLibrary:async()=>usable}};
  getScript().callbacks.load();
  assert.equal(await first,usable);
  assert.equal(timers.size,0);
 });
});
test("P5-PLACES4 loader failure does not synthesize Google place, city or geofence proof",()=>{
 const loader=readFileSync(resolve(root,"lib/google-maps/loadGoogleMaps.ts"),"utf8");
 const ui=readFileSync(resolve(root,"components/location/GooglePlaceAutocomplete.tsx"),"utf8");
 assert.match(loader,/PLACES_BOOTSTRAP_TIMEOUT_MS\s*=\s*8000/);
 assert.match(loader,/setTimeout\(\(\) =>/);
 assert.match(loader,/settle\(null\)/);
 assert.match(ui,/onManualChange\(raw\)/);
 assert.match(ui,/includedRegionCodes:\s*\["in"\]/);
 assert.doesNotMatch(loader,/fakePlaceId|approvedVendor|verificationStatus="verified"/);
});
