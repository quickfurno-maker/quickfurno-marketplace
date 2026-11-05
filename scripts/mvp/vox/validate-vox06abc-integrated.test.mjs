import test from "node:test";
import assert from "node:assert/strict";
import {existsSync,readFileSync,readdirSync} from "node:fs";
import {resolve} from "node:path";
import {checkVoxPr300MigrationHold,MANIFEST} from "./verify-pr300-managed-migration-hold.mjs";
import {validatePinnedVendorPendingFiles} from "./rc-launch-vendor-pending-source-addendum.mjs";
const root=resolve(import.meta.dirname,"../../..");const read=p=>readFileSync(resolve(root,p),"utf8");
test("VOX-06A migration quarantine and VOX-06B Staff desk/source gate share one source tree",()=>{
 const m=JSON.parse(read(MANIFEST));
 const quarantine=checkVoxPr300MigrationHold(m);
 assert.equal(quarantine.ok,true);assert.equal(quarantine.releaseAllowed,false);
 assert.equal(quarantine.managedMigrationCount,0);
 assert.equal(quarantine.quarantinedLegacyCount,7);
 const files=readdirSync(resolve(root,"supabase/migrations"))
   .filter(x=>/^\d{14}_.+\.sql$/.test(x));
 const pending=validatePinnedVendorPendingFiles({
  names:files,sourceDir:resolve(root,"supabase/migrations")
 });
 assert.equal(pending.count,7);
 assert.equal(pending.applied,false);
 assert.equal(pending.releaseGo,false);
 assert.deepEqual(files.filter(x=>/vox.*\.sql$/i.test(x)),
   ["20261104170000_vox_owner_vendor_review_queue.sql"]);
 for(const path of ["app/api/vox/v1/desk/route.ts","app/api/vox/v1/my-work/route.ts"]){
  const s=read(path);assert.match(s,/deriveCanonicalCityVendorIds\(/);
  assert.match(s,/\.in\("id",\[\.\.\.scope\.vendorIds\]\)/);
 }
 assert.match(read("scripts/mvp/vox/validate-vox-03-scope.mjs"),/quarantined-migrations/);
});
test("VOX-06C protected stage test cannot send provider messages or authorize release",()=>{
 const s=read("scripts/mvp/vox/run-vox06c-protected-staging.mjs");
 assert.match(s,/https:\/\/staging-core\.quickfurno\.in/);
 assert.match(s,/method:"GET"/);
 assert.doesNotMatch(s,/method:"POST"|method:"PATCH"|inviteUserByEmail|sendWhatsApp|service_role/);
 assert.equal(existsSync(resolve(root,"contracts/vox/protectedStageReadOnly.mjs")),true);
});
