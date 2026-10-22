#!/usr/bin/env node
// STEP3B1 read-only certification: verify recorded Supabase migration inventories,
// pinned VOX quarantine integrity and observed version-set asymmetry.
// Does NOT connect to databases, modify migrations or grant release permission.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const readJson=file=>JSON.parse(readFileSync(path.join(root,file),"utf8"));
const manifest=readJson("ops/vox/certification/STEP3B1-LIVE-MIGRATION-LEDGER-20261022.json");
const pins=readJson("supabase/staging-history/qf-post-g1-migration-ledger-20260929.json");
const sha=x=>createHash("sha256").update(x).digest("hex");
const versions=rows=>new Set(rows.map(x=>x.version));
const diff=(a,b)=>[...a].filter(x=>!b.has(x)).sort();
const stages=versions(manifest.stagingHistory);
const production=versions(manifest.productionHistory);
const source=new Set(readdirSync(path.join(root,"supabase/migrations"))
 .filter(x=>/^[0-9]{14}_.+\.sql$/.test(x)).map(x=>x.slice(0,14)));
const check=(label,truth)=>{assert.equal(truth,true,label);process.stdout.write("PASS "+label+"\n");};
check("certification evidence is explicitly read-only and cannot authorize deployment",
 manifest.schema==="qf.vox.step3b1.readonly-migration-inventory.v1"&&
 manifest.readOnly===true&&manifest.authorizationToApplyMigrations===false&&manifest.financeRelease==="HOLD");
check("same 86 migration counts are genuine but histories differ",
 manifest.stagingHistory.length===86&&manifest.productionHistory.length===86&&
 stages.size===86&&production.size===86&&
 diff(stages,production).length===52&&diff(production,stages).length===52);
check("current repository 162 runnable migrations version-set pinned",
 source.size===162&&source.size===manifest.runnableSourceVersions.length&&
 diff(source,new Set(manifest.runnableSourceVersions)).length===0&&
 diff(new Set(manifest.runnableSourceVersions),source).length===0);
const c=manifest.comparison;
check("all three pairwise version diffs exactly pinned",
 JSON.stringify(c.stagingOnly)===JSON.stringify(diff(stages,production))&&
 JSON.stringify(c.productionOnly)===JSON.stringify(diff(production,stages))&&
 JSON.stringify(c.stagingWithoutSource)===JSON.stringify(diff(stages,source))&&
 JSON.stringify(c.sourceWithoutStaging)===JSON.stringify(diff(source,stages))&&
 JSON.stringify(c.productionWithoutSource)===JSON.stringify(diff(production,source))&&
 JSON.stringify(c.sourceWithoutProduction)===JSON.stringify(diff(source,production)));
check("shared version counts remain exact",
 c.sharedStagingProduction===34&&c.sharedStagingSource===55&&c.sharedProductionSource===45);
const quarantined=manifest.quarantineVersions;
check("exactly seven VOX quarantined candidates absent from all runnable and managed version sets",
 quarantined.length===7&&new Set(quarantined).size===7&&
 quarantined.every(v=>!source.has(v)&&!stages.has(v)&&!production.has(v)));
let hashCount=0;
for(const v of quarantined){
 const pin=pins.records.find(x=>x.version===v);
 check("quarantined VOX "+v+" pinned filename/version",
  pin?.filename?.startsWith(v+"_")===true&&typeof pin.canonicalSha256==="string");
 const bytes=readFileSync(path.join(root,"ops/vox/quarantined-migrations/legacy-20261014",pin.filename),"utf8");
 const normalized=Buffer.from(bytes.replace(/\r\n/g,"\n").replace(/\r/g,"\n"),"utf8");
 check("quarantined VOX "+v+" source SHA256",sha(normalized)===pin.canonicalSha256);
 hashCount++;
}
check("Phase22 migration is a source-only unapplied future candidate",
 source.has(manifest.phase22Version)&&
 !stages.has(manifest.phase22Version)&&!production.has(manifest.phase22Version)&&
 manifest.stagingPhase22Applied===false&&manifest.productionPhase22Applied===false);
const report={quarantinedHashesVerified:hashCount,stagingCount:stages.size,
 productionCount:production.size,sharedCount:34,stageOnly:52,prodOnly:52,
 sourceCount:source.size,stageMissingRepo:c.stagingWithoutSource.length,
 sourceNotInStage:c.sourceWithoutStaging.length,productionMissingRepo:c.productionWithoutSource.length,
 sourceNotInProduction:c.sourceWithoutProduction.length,
 phase22Unapplied:true,dbActionsPerformed:false,reconciliationStatus:"REVIEW_REQUIRED",
 releaseStatus:"HOLD",snapshotSha256:sha(Buffer.from(JSON.stringify(manifest)))};
console.log("STEP3B1_READONLY_SOURCE_RECONCILIATION_PASS "+JSON.stringify(report));
