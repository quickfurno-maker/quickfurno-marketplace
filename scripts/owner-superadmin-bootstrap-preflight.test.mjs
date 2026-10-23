import test from "node:test";
import assert from "node:assert/strict";
import {inspectOwnerBootstrapReadiness,REQUIRED_PHASE22_TABLES}
 from "./owner-superadmin-bootstrap-preflight.mjs";
const id="11111111-1111-4111-8111-111111111111";
const pid="22222222-2222-4222-8222-222222222222";
const email="quickfurno@gmail.com";
const user={id,email,email_confirmed_at:"2026-10-22T12:00:00Z"};
function mock({missing=[],provider=true,principal=true,role=null,profile={id,role:null,is_active:true}}={}){
 const results={
  identity_principals:{id:pid,status:principal?"active":"disabled"},
  identity_provider_identities:provider?{principal_id:pid,status:"active"}:null,
  identity_business_bindings:null,identity_admin_roles:role,
  profiles:profile
 };
 let calls=0;
 return {get calls(){return calls;},from(table){
  const filters=[];
  return {select(){return this;},eq(k,v){filters.push([k,v]);return this;},
    async limit(){calls++;return missing.includes(table)?
       {data:null,error:{code:"42P01"}}:{data:[],error:null};},
    async maybeSingle(){calls++;return missing.includes(table)?
       {data:null,error:{code:"42P01"}}:{data:results[table],error:null};}
  };
 }};
}
test("Canonical Phase22 has exactly four protected directory tables",()=>{
 assert.deepEqual(REQUIRED_PHASE22_TABLES.map(([t])=>t),
 ["identity_principals","identity_provider_identities","identity_business_bindings","identity_admin_roles"]);
});
test("Real Staging absence of four Phase22 tables always denies readiness",async()=>{
 const db=mock({missing:REQUIRED_PHASE22_TABLES.map(([t])=>t)});
 const r=await inspectOwnerBootstrapReadiness({supabase:db,user,targetEmail:email});
 assert.equal(r.safeToConsiderApproval,false);
 assert.equal(r.failures.filter(x=>x.startsWith("PHASE22_TABLE_UNAVAILABLE:")).length,4);
 assert.equal(r.actualBootstrapApplied,false);
});
test("Partially installed Phase22 is also denied",async()=>{
 const db=mock({missing:["identity_business_bindings"]});
 const r=await inspectOwnerBootstrapReadiness({supabase:db,user,targetEmail:email});
 assert.ok(r.failures.includes("PHASE22_TABLE_UNAVAILABLE:identity_business_bindings"));
 assert.equal(r.safeToConsiderApproval,false);
});
test("No mapped provider principal prevents partial legacy owner grant",async()=>{
 const r=await inspectOwnerBootstrapReadiness({supabase:mock({provider:false}),user,targetEmail:email});
 assert.ok(r.failures.includes("ACTIVE_PROVIDER_PRINCIPAL_MAPPING_MISSING"));
 assert.equal(r.safeToConsiderApproval,false);
});
test("Unknown or unconfirmed email does not pass",async()=>{
 for(const suspect of [{...user,email:"someone@example.com"},{...user,email_confirmed_at:null},null]){
  const r=await inspectOwnerBootstrapReadiness({supabase:mock(),user:suspect,targetEmail:email});
  assert.ok(r.failures.includes("VERIFIED_EXISTING_EMAIL_IDENTITY_REQUIRED"));
 }
});
test("Inactive principal, incompatible existing role and inactive profile denied",async()=>{
 for(const args of [{principal:false},{role:{admin_role:"Finance Admin",status:"active"}},{profile:{id,role:null,is_active:false}}]){
  const r=await inspectOwnerBootstrapReadiness({supabase:mock(args),user,targetEmail:email});
  assert.equal(r.safeToConsiderApproval,false,r.failures.join(","));
 }
});
test("All source preflight checks passing still cannot authorize financial bootstrap",async()=>{
 const db=mock(),r=await inspectOwnerBootstrapReadiness({supabase:db,user,targetEmail:email});
 assert.equal(r.failures.length,0);
 assert.equal(r.safeToConsiderApproval,true);
 assert.equal(r.independentApprovalVerified,false);
 assert.equal(r.atomicTransactionCertified,false);
 assert.equal(r.actualBootstrapApplied,false);
 assert.equal(r.sourceEnvironmentMutation,false);
 assert.ok(db.calls>=8);
});
test("Pre-existing compatible Superadmin catalog state does not automatically authorize apply",async()=>{
 const r=await inspectOwnerBootstrapReadiness({supabase:mock({role:{admin_role:"Superadmin",status:"active"}}),user,targetEmail:email});
 assert.equal(r.alreadyAdmin,true);
 assert.equal(r.actualBootstrapApplied,false);
});

test("Revoked durable Superadmin role never qualifies for preflight",async()=>{
 const r=await inspectOwnerBootstrapReadiness({supabase:mock({role:{admin_role:"Superadmin",status:"revoked"}}),user,targetEmail:email});
 assert.ok(r.failures.includes("EXISTING_ADMIN_ROLE_REVOKED"));
 assert.equal(r.safeToConsiderApproval,false);
 assert.equal(r.actualBootstrapApplied,false);
});
test("Different existing provider-admin claim cannot be silently overwritten",async()=>{
 const r=await inspectOwnerBootstrapReadiness({supabase:mock(),user:{...user,app_metadata:{admin_role:"Finance Admin"}},targetEmail:email});
 assert.ok(r.failures.includes("TARGET_HAS_DIFFERENT_EXISTING_ADMIN_ROLE"));
 assert.equal(r.safeToConsiderApproval,false);
});
