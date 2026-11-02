#!/usr/bin/env node
// AB7K RC3 semantic recovery CLI. Never connects to a database, never opens a network socket,
// never reads credentials. The ONLY file it writes is --out, confined to the OS temp dir
// (override with --allow-nontemp-out for an operator-chosen existing directory).
//
//   node ab7k-semantic-evidence.mjs sql                      # read-only semantic catalog SQL
//   node ab7k-semantic-evidence.mjs probe-sql                # rolled-back behavior probe SQL (DISPOSABLE cluster only)
//   node ab7k-semantic-evidence.mjs parse-probes --in raw.txt --out probes.json
//   node ab7k-semantic-evidence.mjs expect-probes --probes probes.json
//   node ab7k-semantic-evidence.mjs compare-semantic --a s1.json --b s2.json
//   node ab7k-semantic-evidence.mjs adjudicate --raw-a r1.json --raw-b r2.json --sem-a s1.json --sem-b s2.json
//        --probes-a p1.json --probes-b p2.json [--no-constraint-expectations] [--out report.json]
// adjudicate exit: 0 exact local raw parity, 4 candidate-semantic-parity-provisional (RAW_DIVERGENCE kept,
// DBA must interpret), 3 semantic divergence / unexplained / incomplete, 64 usage, 70 error.
import {readFileSync,writeFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {diffPaths} from "./ab7k-evidence-lib.mjs";
import {
  adjudicateRecovery,assertSafeOutFile,behaviorProbeSql,compareSemantic,
  evaluateProbeExpectations,parseProbeOutput,semanticCatalogSql
} from "./ab7k-semantic-lib.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const [cmd,...rest]=process.argv.slice(2);
const opt={},flags=new Set(["no-constraint-expectations","allow-nontemp-out"]);
for(let i=0;i<rest.length;i++){
  if(!rest[i].startsWith("--"))throw new Error("UNEXPECTED_ARGUMENT");
  const k=rest[i].slice(2);
  opt[k]=flags.has(k)?true:rest[++i];
}
const readText=p=>readFileSync(p,"utf8").replace(/^﻿/,"");
const readJson=p=>JSON.parse(readText(p).trim());
const need=k=>{if(!opt[k])throw new Error(`MISSING_--${k}`);return opt[k]};
const print=v=>process.stdout.write(JSON.stringify(v,null,2)+"\n");
const emit=(v)=>{
  if(opt.out){writeFileSync(assertSafeOutFile(opt.out,{allowNonTemp:opt["allow-nontemp-out"]===true}),JSON.stringify(v,null,2)+"\n",{flag:"wx"})}
  print(v);
};
const rawDiff=(a,b)=>diffPaths({...a,identity:undefined},{...b,identity:undefined},"$",[],100000);

try{
  switch(cmd){
    case "sql":process.stdout.write(semanticCatalogSql(root));break;
    case "probe-sql":process.stdout.write(behaviorProbeSql(root));break;
    case "parse-probes":emit(parseProbeOutput(readText(need("in"))));break;
    case "expect-probes":{
      const f=evaluateProbeExpectations(readJson(need("probes")),{expectConstraints:opt["no-constraint-expectations"]!==true});
      print({ok:f.length===0,failures:f});process.exitCode=f.length?3:0;break}
    case "compare-semantic":{
      const f=compareSemantic(readJson(need("a")),readJson(need("b")));
      print({identical:f.length===0,findings:f});process.exitCode=f.length?3:0;break}
    case "adjudicate":{
      const rawA=readJson(need("raw-a")),rawB=readJson(need("raw-b"));
      const r=adjudicateRecovery({
        rawDiffPaths:rawDiff(rawA,rawB),
        semanticSource:readJson(need("sem-a")),semanticRestored:readJson(need("sem-b")),
        probesSource:readJson(need("probes-a")),probesRestored:readJson(need("probes-b")),
        expectConstraints:opt["no-constraint-expectations"]!==true});
      emit(r);process.exitCode=r.exitCode;break}
    default:
      process.stderr.write("usage: sql|probe-sql|parse-probes|expect-probes|compare-semantic|adjudicate (see header)\n");
      process.exitCode=64;
  }
}catch(e){
  process.stderr.write(`AB7K_SEMANTIC_ERROR ${e instanceof Error?e.message:String(e)}\n`);
  process.exitCode=70;
}
