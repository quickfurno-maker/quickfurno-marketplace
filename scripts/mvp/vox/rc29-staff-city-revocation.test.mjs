import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
mkdirSync(resolve(root,"test-results"),{recursive:true});
const output=resolve(root,"test-results/rc29-staff-city-revocation-bundle.mjs");
await build({entryPoints:[resolve(root,"services/vox/verifiedStaffBearer.ts")],
 bundle:true,platform:"node",target:"node20",format:"esm",logLevel:"silent",outfile:output,
 plugins:[{name:"verified-auth-and-db-mock",setup(build){
  build.onResolve({filter:/^server-only$/},()=>({path:"noop",namespace:"rc29mock"}));
  build.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:"supabase",namespace:"rc29mock"}));
  build.onLoad({filter:/.*/,namespace:"rc29mock"},args=>({
   loader:"js",contents:args.path==="noop"?"":`
export async function verifySupabaseBearerUser(){return globalThis.__rc29AuthUser}
export function adminClient(){return {from:(name)=>({
 select(){return this},eq(){return this},
 async maybeSingle(){
  globalThis.__rc29Reads.push(name);
  return globalThis.__rc29Rows[name] ?? {data:null,error:{message:"unavailable"}};
 }
})}}
`}));
 }}]});
const {verifyVoxOperationsStaffBearer:operations,verifyVoxTeamLeaderBearer:leader}=
 await import(pathToFileURL(output).href);
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=()=>Math.floor(Date.now()/1000);
const jwt=(aal="aal2")=>"header."+
 Buffer.from(JSON.stringify({sub:id(1),aal,iat:now()-30,exp:now()+600,
  is_anonymous:false,padding:"x".repeat(120)})).toString("base64url")+
 ".signature";
function setup(role){
 globalThis.__rc29AuthUser={id:id(1),app_metadata:{
  qf_principal:"vox_staff",vox_role:role,admin_role:null}};
 globalThis.__rc29Reads=[];
 globalThis.__rc29Rows={
  profiles:{data:{role:null,is_active:true},error:null},
  vox_staff_memberships_v1:{data:{auth_user_id:id(1),team_id:id(2),staff_role:role,
   is_active:true,revoked_at:null,expires_at:new Date(Date.now()+600000).toISOString()},error:null},
  vox_staff_teams_v1:{data:{id:id(2),city_id:id(3),is_active:true},error:null},
  cities:{data:{id:id(3),is_active:true},error:null},
 };
}
test("current active city is required for genuine Staff operations preflight",async()=>{
 setup("operations_manager");
 const actor=await operations("Bearer "+jwt());
 assert.equal(actor?.userId,id(1));
 assert.equal(actor?.aal,"aal2");
 assert.equal(actor?.teamId,id(2));
 assert.equal(actor?.cityId,id(3));
 assert.ok(actor?.expiresAtMs>Date.now());
 assert.ok(globalThis.__rc29Reads.includes("cities"));
});
test("disabled city immediately denies both operations and independent TL AAL2 sessions",async()=>{
 for(const [role,check] of [["operations_manager",operations],["team_leader",leader]]){
  setup(role);
  globalThis.__rc29Rows.cities.data.is_active=false;
  assert.equal(await check("Bearer "+jwt()),null);
  assert.ok(globalThis.__rc29Reads.includes("cities"));
 }
});
test("unavailable or wrong city identity fails closed, no Staging/Production writes",async()=>{
 for(const row of [{data:null,error:{message:"DB_ERROR"}},{data:{id:id(4),is_active:true},error:null}]){
  setup("operations_manager");globalThis.__rc29Rows.cities=row;
  assert.equal(await operations("Bearer "+jwt()),null);
 }
});
test("AAL1 bearer is rejected before membership/city lookup",async()=>{
 setup("team_leader");
 assert.equal(await leader("Bearer "+jwt("aal1")),null);
 assert.deepEqual(globalThis.__rc29Reads,[]);
});
