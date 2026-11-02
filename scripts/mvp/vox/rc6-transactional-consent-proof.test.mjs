// Source-only wrapper: esbuild resolves the real services graph without
// violating the intentionally restricted MVP fallback resolver. No Supabase
// credentials, socket, provider, managed DB or production writer is used.
import test from "node:test";
import assert from "node:assert/strict";
import {buildSync} from "esbuild";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {dirname} from "node:path";
import {fileURLToPath} from "node:url";

test("RC6 canonical D2-C same-session source proof: 7 negative/positive cases",()=>{
 const dir=mkdtempSync(join(tmpdir(),"qf-rc6-source-proof-"));
 try{
  const spec=resolve(dirname(fileURLToPath(import.meta.url)),
   "rc6-transactional-consent-proof.spec.mjs");
  const bundle=join(dir,"rc6-consent.bundle.cjs");
  buildSync({entryPoints:[spec],bundle:true,platform:"node",format:"cjs",
    target:"node24",outfile:bundle,logLevel:"silent"});
  const child=spawnSync(process.execPath,["--test",bundle],{
   encoding:"utf8",shell:false,timeout:30000,
   env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,
    WINDIR:process.env.WINDIR,TMP:process.env.TMP,TEMP:process.env.TEMP}
  });
  const output=(child.stdout||"")+"\n"+(child.stderr||"");
  assert.equal(child.status,0,output.slice(-3200));
  assert.match(output,/\bpass 7\b/);
  assert.match(output,/\bfail 0\b/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
