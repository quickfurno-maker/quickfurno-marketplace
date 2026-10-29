import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const root=resolve(import.meta.dirname,"..");
const source=(path)=>readFileSync(resolve(root,path),"utf8");
const operations=source("app/operations/page.tsx");
const owner=source("app/components/OwnerPreview.tsx");
const css=source("app/operations/operations.css");
let checks=0;
const check=(name,fn)=>{fn(); checks++; console.log("PASS "+name)};
for(const [route,kind,fetcher] of [
 ["acquisition","acquisition","fetchScopedCrm"],
 ["vendor360","vendor360","fetchScopedCrm"],
 ["service-desk","service-desk","fetchScopedServiceDesk"]
]){
 const page=source("app/"+route+"/page.tsx");
 check("Owner "+route+" uses only certified preview",()=>{
  assert.match(page,new RegExp('VOX_STAFF_VIEW_MODE==="owner"\\)return <OwnerPreview kind="'+kind+'"'));
  assert.match(page,new RegExp("await "+fetcher+"\\("));
  assert.ok(page.indexOf("<OwnerPreview")<page.indexOf("await "+fetcher+"("));
 });
}
check("Owner preview source is sole verified Owner Core projection",()=>{
 assert.match(owner,/await fetchStaffOverview\(\)/);
 assert.doesNotMatch(owner,/fetch\(|service_role|supabase\.from\(|localStorage|window\.location|sendMessage|updateVendor|onClick=/);
 assert.match(owner,/if\(!result\.ok\)return <Restricted\/>/);
});
check("Owner preview is bounded and read only",()=>{
 assert.match(owner,/slice\(0,8\)/);
 assert.match(owner,/not the full staff workspace/i);
 assert.match(owner,/does not grant staff access/i);
 assert.doesNotMatch(owner,/Bearer |credentials:|method:"POST"/);
});
check("Owner navigation locks uncertified modules",()=>{
 assert.match(operations,/const owner=process\.env\.VOX_STAFF_VIEW_MODE==="owner"/);
 assert.match(operations,/locked=owner&&/);
 assert.match(operations,/opsNavLocked/);
 assert.match(operations,/VOX_INTELLIGENCE_VIEW_ENABLED==="staging"/);
 assert.match(operations,/LOCKED/);
});
check("Owner shortcuts point only to preview pages",()=>{
 const block=operations.split('process.env.VOX_STAFF_VIEW_MODE==="owner"?<>')[1].split("</>:<>")[0];
 assert.match(block,/href="\/vendor360"/);
 assert.match(block,/href="\/acquisition"/);
 assert.match(block,/href="\/service-desk"/);
 assert.doesNotMatch(block,/href="\/(approvals|studio|staff-reviews)"/);
 assert.match(block,/VOX_INTELLIGENCE_VIEW_ENABLED==="staging"\?<Link href="\/intelligence"/);
});
check("Staff-specific Core checks stay in original source",()=>{
 for(const page of ["acquisition","vendor360","service-desk"]){
  const src=source("app/"+page+"/page.tsx");
  assert.match(src,/if\(!r\.ok/);
 }
});
check("Old scoped workspace styles preserved",()=>{
 for(const cls of [".voxOps{",".voxUnit{",".voxRow{",".voxHero{",".voxNotice{",".hold .holdCard{"])assert.ok(css.includes(cls),cls);
});
check("Mobile navigation remains accessible",()=>{
 assert.match(css,/@media\(max-width:820px\)\{\.opsRail nav\{display:flex/);
});
console.log("VOX_OWNER_NAVIGATION_CONTRACT_PASS "+checks+"/"+checks);
