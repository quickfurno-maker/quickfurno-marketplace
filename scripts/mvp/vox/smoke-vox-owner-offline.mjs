// Offline, credential-free code-only smoke for the Owner Core endpoint.
// Invoked ONLY against a local image via --entrypoint node; does NOT validate
// production entrypoint, staging secret injection, real Owner AAL2 or release GO.
import {spawn} from "node:child_process";
import {setTimeout as sleep} from "node:timers/promises";

const port=Number(process.env.VOX_QA_PORT||3919);
const origin=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,["server.js"],{
  cwd:"/app",
  env:{...process.env,HOSTNAME:"127.0.0.1",PORT:String(port)},
  stdio:["ignore","pipe","pipe"]
});
let log="";
for(const stream of [child.stdout,child.stderr]) stream.on("data",c=>{log=(log+String(c)).slice(-4096)});
async function probe(route,options){
  const r=await fetch(origin+route,{...options,redirect:"manual",signal:AbortSignal.timeout(3500)});
  await r.arrayBuffer();
  return r;
}
let failed=false;
try {
  let ready=false;
  for(let attempt=0;attempt<60;attempt++){
    if(child.exitCode!==null) throw Error("APP_EXITED_BEFORE_HEALTH");
    try{const r=await probe("/livez");if(r.status===200){ready=true;break}}catch{}
    await sleep(250);
  }
  if(!ready)throw Error("HEALTH_NOT_READY");
  const cases=[
    ["HEALTH", "/livez",undefined,200],
    ["ANONYMOUS", "/api/vox/v1/overview",undefined,401],
    ["BOGUS_BEARER", "/api/vox/v1/overview",{headers:{authorization:"Bearer invalid.invalid.invalid"}},401],
    ["POST_READ_ONLY", "/api/vox/v1/overview",{method:"POST"},405],
    ["PUT_READ_ONLY", "/api/vox/v1/overview",{method:"PUT"},405],
    ["DELETE_READ_ONLY", "/api/vox/v1/overview",{method:"DELETE"},405]
  ];
  for(const [name,route,options,expected] of cases){
    const r=await probe(route,options);
    if(r.status!==expected) throw Error(name+"_EXPECTED_"+expected+"_ACTUAL_"+r.status);
    if(route.includes("overview") && r.headers.get("cache-control")?.includes("no-store")!==true)throw Error(name+"_NO_STORE_REQUIRED");
    if(route.includes("overview") && r.headers.get("x-content-type-options")!=="nosniff")throw Error(name+"_NO_SNIFF_REQUIRED");
    console.log("VOX_QA_"+name+"_PASS "+r.status);
  }
  console.log("VOX_OWNER_OFFLINE_HTTP_PASS 6/6 (NO AUTHENTICATED POSITIVE, NO DEPLOY)");
}catch(err){
  failed=true;
  console.error("VOX_OWNER_OFFLINE_HTTP_FAIL",err.message);
  console.error("CHILD_OUTPUT_TAIL",log.slice(-1024));
}finally{
  child.kill("SIGTERM");
  await Promise.race([new Promise(res=>child.once("exit",res)),sleep(5000)]);
  if(child.exitCode===null)child.kill("SIGKILL");
}
if(failed)process.exitCode=1;
