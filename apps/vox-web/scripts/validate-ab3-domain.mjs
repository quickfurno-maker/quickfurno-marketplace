import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const src=readFileSync(new URL("../lib/ab3Domain.ts",import.meta.url),"utf8");
const page=readFileSync(new URL("../app/team/work-queue/page.tsx",import.meta.url),"utf8");
const js=ts.transpileModule(src,{compilerOptions:{
 target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const module={exports:{}};
const stub=name=>{
 if(name==="server-only")return {};
 if(name==="./auth")return {verifiedMfaSession:async()=>null};
 if(name==="./core")return {origin:()=>null};
 throw Error("UNEXPECTED_IMPORT:"+name);
};
new Function("require","module","exports",js)(stub,module,module.exports);
const {parseAb3DomainWindow:parse,fetchAb3DomainWindow:fetchView}=module.exports;
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const valid={ok:true,schema:"qf.vox.ab2.domain-work-window.v1",
 department:"acquisition",mode:"READ_ONLY",
 items:[{id:id(4),kind:"prospect",state:"ASSIGNED",
  updatedAt:"2026-10-17T11:00:00Z",canChange:false,canSend:false}],
 completeness:"BOUNDED_NOT_TOTAL",totalKnown:false,
 canChange:false,canSend:false,providerMessagesSent:0,
 nextPageAuthorized:false,status:200,
 source:"EXISTING_AUTHENTICATED_CORE_WORK_QUEUE",
 stageCertified:false,officialTotal:null,actionsEnabled:false};
const good=parse(valid);
assert.equal(good.ok,true);assert.equal(good.items.length,1);
console.log("PASS exact protected Core metadata");
const forged=[
 {...valid,department:"client_success"},
 {...valid,totalKnown:true},
 {...valid,nextPageAuthorized:true},
 {...valid,items:[{...valid.items[0],kind:"client"}]},
 {...valid,items:[{...valid.items[0],email:"hidden@provider.invalid"}]},
 {...valid,actionsEnabled:true},
 {...valid,providerMessagesSent:1},
 {...valid,items:[valid.items[0],valid.items[0]]},
 {...valid,source:"BROWSER_SYNTHETIC"},
 {...valid,stageCertified:true},
 {...valid,officialTotal:5}
];
for(const [i,value] of forged.entries()){
 assert.equal(parse(value).ok,false,"FORGED_CASE_"+i);
 console.log("PASS denied forged Core response",i+1);
}
for(const marker of ["fetchAb3DomainWindow()",
 "Department-only Core work is not activated",
 "My verified department lane"]){
 assert.ok(page.includes(marker),marker);
}
assert.ok(!page.includes("fakeStaffTotal"));
const old=process.env.VOX_AB3_DOMAIN_WEB_ENABLED;
process.env.VOX_AB3_DOMAIN_WEB_ENABLED="off";
try{
 const r=await fetchView();
 assert.equal(r.ok,false);assert.equal(r.status,503);
}finally{
 if(old===undefined)delete process.env.VOX_AB3_DOMAIN_WEB_ENABLED;
 else process.env.VOX_AB3_DOMAIN_WEB_ENABLED=old;
}
console.log("VOX_AB3_WEB_PROJECTION_QA_PASS total=16");
