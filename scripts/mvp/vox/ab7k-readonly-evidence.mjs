#!/usr/bin/env node
// AB7K read-only evidence CLI. Never connects to a database and never reads
// credentials; operators pipe the printed SQL into their own read-only psql session.
//
//   node ab7k-readonly-evidence.mjs manifest
//   node ab7k-readonly-evidence.mjs deps
//   node ab7k-readonly-evidence.mjs sql --part catalog|ledger
//   node ab7k-readonly-evidence.mjs identity --project-ref R --host H --user U
//   node ab7k-readonly-evidence.mjs digest --snapshot f.json
//   node ab7k-readonly-evidence.mjs compare --a a.json --b b.json
//   node ab7k-readonly-evidence.mjs evaluate --snapshot f.json --target local-disposable|managed-staging
//        [--expect pre-install|post-install] [--ledger l.json] [--project-ref R --host H --user U]
//        [--backup-manifest b.json] [--out report.json]
import {readFileSync,writeFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {
  analyzeDependencies,catalogDigest,catalogSql,checkManifest,diffPaths,
  evaluateEvidence,ledgerSql,validateProjectIdentity
} from "./ab7k-evidence-lib.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const [cmd,...rest]=process.argv.slice(2);
const opt={};
for(let i=0;i<rest.length;i++){
  if(!rest[i].startsWith("--"))throw new Error("UNEXPECTED_ARGUMENT");
  opt[rest[i].slice(2)]=rest[++i];
}
const readJson=p=>JSON.parse(readFileSync(p,"utf8").replace(/^﻿/,"").trim());
const need=k=>{if(!opt[k])throw new Error(`MISSING_--${k}`);return opt[k]};
const print=v=>process.stdout.write(JSON.stringify(v,null,2)+"\n");

try{
  switch(cmd){
    case "manifest":{const r=checkManifest(root);print({...r,files:undefined});process.exitCode=r.ok?0:1;break}
    case "deps":print(analyzeDependencies(root));break;
    case "sql":
      if(opt.part==="catalog")process.stdout.write(catalogSql(root));
      else if(opt.part==="ledger")process.stdout.write(ledgerSql());
      else throw new Error("--part must be catalog or ledger");
      break;
    case "identity":{
      const r=validateProjectIdentity({projectRef:need("project-ref"),host:need("host"),user:need("user")});
      print(r);process.exitCode=r.ok?0:1;break}
    case "digest":print({catalogDigest:catalogDigest(readJson(need("snapshot")))});break;
    case "compare":{
      const a=readJson(need("a")),b=readJson(need("b"));
      const da=catalogDigest(a),db=catalogDigest(b);
      print({identical:da===db,digestA:da,digestB:db,
        differingPaths:da===db?[]:diffPaths({...a,identity:undefined},{...b,identity:undefined})});
      process.exitCode=da===db?0:1;break}
    case "evaluate":{
      const report=evaluateEvidence({
        root,snapshot:readJson(need("snapshot")),target:need("target"),expect:opt.expect??"post-install",
        ledger:opt.ledger?readJson(opt.ledger):undefined,
        identity:{projectRef:opt["project-ref"],host:opt.host,user:opt.user},
        backupManifest:opt["backup-manifest"]?readJson(opt["backup-manifest"]):undefined
      });
      if(opt.out)writeFileSync(opt.out,JSON.stringify(report,null,2)+"\n");
      print(report);
      process.exitCode=report.overall==="FAIL"?2:0; // 0 means HOLD (never GO)
      break}
    default:
      process.stderr.write("usage: manifest|deps|sql|identity|digest|compare|evaluate (see header)\n");
      process.exitCode=64;
  }
}catch(e){
  process.stderr.write(`AB7K_EVIDENCE_ERROR ${e instanceof Error?e.message:String(e)}\n`);
  process.exitCode=70;
}
