// VOX RC4 Track C CLI. Offline only: builds the preflight packet / read-only SQL and evaluates operator-captured
// evidence JSON. Opens no database or network connection. The only write is --out (temp-confined, create-only).
// No approval verifier is injected here, so this CLI can never print GO.
import {readFileSync,statSync,writeFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {assertSafeOutFile} from "./ab7k-semantic-lib.mjs";
import {SQL_CATALOG,bindingDigest,buildPreflightPacket,evaluateRecoveryEvidence} from "./rc4-recovery-lib.mjs";

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,"../../..");
const MAX_IN_BYTES=8*1024*1024;

function parse(argv){
  const [cmd,...rest]=argv;
  const o={cmd,args:[],in:undefined,out:undefined,now:undefined};
  for(let i=0;i<rest.length;i++){
    const a=rest[i];
    if(a==="--in"||a==="--out"||a==="--now"){if(i+1>=rest.length)throw new Error(`ARG_VALUE_MISSING:${a}`);o[a.slice(2)]=rest[++i]}
    else if(a.startsWith("--"))throw new Error(`ARG_UNKNOWN:${a}`);
    else o.args.push(a);
  }
  return o;
}
function readEvidence(file){
  if(!file)throw new Error("IN_REQUIRED");
  const abs=resolve(file);
  if(statSync(abs).size>MAX_IN_BYTES)throw new Error("IN_TOO_LARGE");
  return JSON.parse(readFileSync(abs,"utf8"));
}
function emit(text,out){
  if(out)writeFileSync(assertSafeOutFile(out),text+"\n",{flag:"wx"});
  else process.stdout.write(text+"\n");
}

try{
  const o=parse(process.argv.slice(2));
  switch(o.cmd){
    case "packet":
      emit(JSON.stringify(buildPreflightPacket(root),null,2),o.out);
      break;
    case "sql":{
      const name=o.args[0];
      if(!name||!Object.prototype.hasOwnProperty.call(SQL_CATALOG,name))
        throw new Error(`SQL_NAME_UNKNOWN: choose one of ${Object.keys(SQL_CATALOG).sort().join(", ")}`);
      emit(SQL_CATALOG[name].build(root),o.out);
      break;
    }
    case "binding":
      emit(bindingDigest(readEvidence(o.in)),o.out);
      break;
    case "evaluate":{
      const now=o.now===undefined?undefined:Date.parse(o.now);
      if(o.now!==undefined&&!Number.isFinite(now))throw new Error("NOW_INVALID");
      const r=evaluateRecoveryEvidence(readEvidence(o.in),{root,now});
      emit(JSON.stringify(r,null,2),o.out);
      process.exitCode=r.exitCode;
      break;
    }
    default:
      throw new Error("USAGE: rc4-recovery-evidence.mjs packet|sql <name>|binding --in f|evaluate --in f [--now ISO] [--out tempfile]");
  }
}catch(e){
  process.stderr.write(`RC4_RECOVERY_ERROR ${e.message}\n`);
  process.exitCode=2;
}
