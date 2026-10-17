import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const src=readFileSync(new URL("../lib/ab5SourceCheckpoint.ts",import.meta.url),"utf8");
const page=readFileSync(new URL("../app/team/daily-report/page.tsx",import.meta.url),"utf8");
const js=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,
 module:ts.ModuleKind.CommonJS}}).outputText;
const module={exports:{}};
new Function("require","module","exports",js)((name)=>{
 if(name==="server-only")return {};
 if(name==="./auth")return {verifiedMfaSession:async()=>null};
 if(name==="./core")return {origin:()=>null};
 throw Error("UNKNOWN_IMPORT_"+name);
},module,module.exports);
const {parseAb5SourceCheckpoints:parse,fetchAb5SourceCheckpoints:fetchView}=module.exports;
const sources=["CORE_WORK_LEDGER","CRM_AAROHI","SUPPORT_DESK","CORE_CONVERSATION"];
const rows=sources.map((source,i)=>({source,recordPresent:true,
 eventCountInSnapshot:i+1,watermarkCryptoVerified:false,officialSourceCertified:false}));
const valid={ok:true,schema:"qf.vox.ab5.source-checkpoint.inventory.v1",
 mode:"READ_ONLY",businessDate:"2026-10-17",
 source:"CORE_CANDIDATE_SQL_SNAPSHOT",
 completeness:"FOUR_SQL_CHECKPOINTS_PRESENT_NOT_CRYPTO_CERTIFIED",
 sources:rows,checkpointRows:4,totalKnown:false,official:false,
 canSubmit:false,canAcknowledge:false,providerMessagesSent:0,
 actionsEnabled:false};
const pass=parse(valid);assert.equal(pass.ok,true);
assert.equal(pass.official,false);assert.equal(pass.cryptoVerified,false);
assert.equal(pass.checkpoints.length,4);
const forged=[
 {...valid,official:true},{...valid,providerMessagesSent:1},
 {...valid,source:"UI_PROVISIONAL"},{...valid,totalKnown:true},
 {...valid,canSubmit:true},{...valid,actionsEnabled:true},
 {...valid,checkpointRows:5},
 {...valid,sources:[rows[0],rows[0],rows[2],rows[3]]},
 {...valid,sources:[{...rows[0],watermarkCryptoVerified:true},...rows.slice(1)]},
 {...valid,sources:[{...rows[0],eventCountInSnapshot:-1},...rows.slice(1)]},
 {...valid,sources:[{...rows[0],name:"private staff"},...rows.slice(1)]},
 {...valid,sources:rows.slice(1)},
 {...valid,sources:rows.map(r=>({...r,recordPresent:false,eventCountInSnapshot:null}))}
];
for(const [i,x] of forged.entries())assert.equal(parse(x).ok,false,"FORGED_"+i);
const disabled=process.env.VOX_AB5_SOURCE_CHECKPOINT_UI_ENABLED;
process.env.VOX_AB5_SOURCE_CHECKPOINT_UI_ENABLED="off";
try{const r=await fetchView();assert.equal(r.ok,false);assert.equal(r.status,503);}
finally{if(disabled===undefined)delete process.env.VOX_AB5_SOURCE_CHECKPOINT_UI_ENABLED;
 else process.env.VOX_AB5_SOURCE_CHECKPOINT_UI_ENABLED=disabled;}
for(const word of ["fetchAb5SourceCheckpoints()",
 "Not cryptographically certified","Not recorded",
 "Previous-day canonical source checkpoints"]){
 assert.ok(page.includes(word),word);
}
console.log("VOX_AB5_WEB_CHECKPOINTS_PASS 18/18");
