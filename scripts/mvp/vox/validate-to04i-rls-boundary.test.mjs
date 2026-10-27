
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inspectVendorBoundary} from "./check-to04i-rls-boundary.mjs";
const e=JSON.parse(readFileSync(new URL("../../../ops/vox/certification/TO04I-LIVE-RLS-BOUNDARY.json",import.meta.url),"utf8"));
test("live production has broader table ACL but row policies still gate vendor support",()=>{
 const r=inspectVendorBoundary(e);assert.equal(r.ok,true);
 assert.equal(r.releaseAllowed,false);
 assert.equal(r.tableAclIsNotProofOfRowExposure,true);
 assert.ok(r.findings.includes("STAGING_PRODUCTION_ACL_DRIFT:anon:select"));
 assert.ok(r.findings.includes("STAGING_PRODUCTION_ACL_DRIFT:authenticated:update"));
 assert.equal(e.production.vendor_support_threads.rls,true);
 assert.equal(e.production.vendor_support_threads.hasAnonymousPolicy,false);
});
test("existing anonymous public vendor directory must not be silently broken",()=>{
 const r=inspectVendorBoundary(e);
 assert.equal(r.publicDirectoryCompatibilityMustBeVerified,true);
 for(const env of ["staging","production"]){
  assert.equal(e[env].vendor_public_v.selectAnon,true);
  assert.equal(e[env].vendor_public_v.securityInvoker,false);
 }
});
test("authenticated security-definer helpers check Auth user and are not anon executable",()=>{
 for(const env of ["staging","production"])
  for(const name of ["is_admin","owns_vendor"]){
   const x=e[env].helperFunctions[name];
   assert.equal(x.securityDefiner,true);
   assert.equal(x.anonExecutable,false);
   assert.equal(x.authExecutable,true);
   assert.equal(x.usesAuthUid,true);
  }
});
test("cannot self-authorize a live ACL rewrite or invent incomplete evidence",()=>{
 const forged=structuredClone(e);
 for(const k of Object.keys(forged.decisions))forged.decisions[k]=true;
 assert.equal(inspectVendorBoundary(forged).releaseAllowed,false);
 const missing=structuredClone(e);delete missing.production.vendor_support_threads.grants.anon.select;
 assert.equal(inspectVendorBoundary(missing).ok,false);
 const compromised=structuredClone(e);compromised.production.helperFunctions.is_admin.anonExecutable=true;
 assert.ok(inspectVendorBoundary(compromised).findings.some(x=>x.includes("HELPER_PRIVILEGES")));
});
