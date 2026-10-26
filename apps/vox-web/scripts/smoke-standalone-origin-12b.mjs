import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {request} from "node:http";
import {createServer} from "node:net";
import {join,resolve} from "node:path";
import {existsSync} from "node:fs";

const root=resolve(import.meta.dirname,"..");
const cwd=join(root,".next","standalone");
if(!existsSync(join(cwd,"server.js")))throw Error("VOX_STANDALONE_BUILD_REQUIRED");

const findPort=()=>new Promise((ok,fail)=>{
 const s=createServer();s.once("error",fail);
 s.listen(0,"127.0.0.1",()=>{
  const addr=s.address();if(!addr||typeof addr==="string")return fail(Error("BAD_PORT"));
  const port=addr.port;s.close(e=>e?fail(e):ok(port));
 });
});
const port=await findPort();
const expected="http://127.0.0.1:"+port;
const body=JSON.stringify({
 targetId:"00000000-0000-4000-8000-000000000004",
 nonce:"00000000-0000-4000-8000-000000000005",
 rationale:"Internal core followup needs independent owner review"
});
const server=spawn(process.execPath,["server.js"],{
 cwd,windowsHide:true,stdio:["ignore","pipe","pipe"],
 env:{...process.env,NODE_ENV:"production",HOSTNAME:"127.0.0.1",PORT:String(port),
  VOX_STAFF_PORTAL_ENABLED:"disabled",VOX_STAFF_VIEW_MODE:"scoped",
  VOX_FOLLOWUP_PROPOSALS_WEB_ENABLED:"disabled",VOX_EXPECTED_ORIGIN:expected}
});
let output="";
for(const stream of [server.stdout,server.stderr])
 stream.on("data",c=>{output+=c.toString("utf8").slice(0,600);output=output.slice(-4000);});
let exited=false;server.once("exit",()=>{exited=true;});
function http(method,path,headers={},payload=""){
 return new Promise((ok,fail)=>{
  const req=request({
   hostname:"127.0.0.1",port,path,method,
   headers:{"connection":"close",...headers},
   timeout:4000
  },r=>{
   let data="";r.setEncoding("utf8");r.on("data",chunk=>{data+=chunk;if(data.length>20000)r.destroy();});
   r.on("end",()=>ok({status:r.statusCode??0,body:data}));
  });
  req.on("timeout",()=>req.destroy(Error("HTTP_TEST_TIMEOUT")));
  req.once("error",fail);req.end(payload);
 });
}
try{
 let ready=false;
 for(let i=0;i<35;i++){
  if(exited)throw Error("VOX_SERVER_DIED: "+output);
  try{const h=await http("GET","/api/health");if(h.status===200){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,200));
 }
 assert.ok(ready,"NEXT_STANDALONE_NOT_READY: "+output);
 const reqHeaders={"content-type":"application/json",origin:expected,host:"127.0.0.1:"+port};
 const accepted=await http("POST","/api/followup-proposals",reqHeaders,body);
 assert.equal(accepted.status,503,"correct-origin must reach disabled feature flag");
 const foreign=await http("POST","/api/followup-proposals",
  {...reqHeaders,origin:"https://evil.invalid"},body);
 assert.equal(foreign.status,403,"cross-site browser Origin must be blocked");
 const wrongHost=await http("POST","/api/followup-proposals",
  {...reqHeaders,host:"localhost:"+port},body);
 assert.equal(wrongHost.status,403,"Host confusion must be blocked");
 const missingOrigin=await http("POST","/api/followup-proposals",
  {"content-type":"application/json",host:"127.0.0.1:"+port},body);
 assert.equal(missingOrigin.status,403,"missing Origin must be blocked");
 const hold=await http("GET","/acquisition");
 assert.equal(hold.status,200,"locked page should remain available");
 assert.match(hold.body,/Acquisition unavailable/);
 const noGet=await http("GET","/api/followup-proposals");
 assert.equal(noGet.status,405,"proposal must not expose GET");
 // Recovery must remain unavailable while its independent staging flag is OFF.
 const reqRecovery=await http("POST","/api/auth/recovery/request",reqHeaders,JSON.stringify({email:"qa@example.invalid"}));
 assert.equal(reqRecovery.status,503,"recovery mail must not be sent while off");
 const completeRecovery=await http("POST","/api/auth/recovery/complete",reqHeaders,JSON.stringify({password:"example-only-qa"}));
 assert.equal(completeRecovery.status,503,"password update must be disabled");
 const callback=await http("GET","/auth/callback?code=syntheticinvalidrecoverycode");
 assert.equal(callback.status,404,"recovery callback must not be available");
 const recoverPage=await http("GET","/password/recover");
 assert.equal(recoverPage.status,200);
 assert.match(recoverPage.body,/Recovery unavailable/);
 const resetPage=await http("GET","/password/reset");
 assert.equal(resetPage.status,200);
 assert.match(resetPage.body,/Recovery unavailable/);
 console.log("VOX12B_STANDALONE_ORIGIN_HOST_AND_RECOVERY_DISABLED_PASS 11/11");
}finally{
 server.kill("SIGTERM");
}
