import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
test("both verified Core adapter and native transaction reject int4 revision overflow",()=>{
 const native=read("services/vox/rc8PgVendorConversationOperator.ts");
 const adapter=read("services/vox/rc19VerifiedConversationWriter.ts");
 assert.match(native,/input\.expectedRevision>2147483646/);
 assert.match(adapter,/c\.expectedRevision as number\)<=2147483646/);
 assert.match(native,/input\.expectedRevision\+1/);
 assert.match(adapter,/RC19_VERIFIED_CORE_WRITER_INSTALLED=false/);
 assert.match(native,/RC8_CORE_WRITER_INSTALLED=false/);
});

test("native Core transaction rechecks expiring Staff, review and object grants before commit",()=>{
 const source=read("services/vox/rc8PgVendorConversationOperator.ts");
 const lastCheck=source.lastIndexOf("CORE_GRANT_EXPIRED_DURING_TRANSACTION");
 const commit=source.indexOf('db.query("COMMIT")',lastCheck);
 assert.ok(lastCheck>0&&commit>lastCheck);
 for(const s of ["os.expires_at>clock_timestamp()",
  "m.expires_at>clock_timestamp()","cap.expires_at>clock_timestamp()",
  "req.expires_at>clock_timestamp()","tl.expires_at>clock_timestamp()",
  "CLIENT_PROJECT_BINDING_EXPIRED_DURING_TRANSACTION"])
  assert.ok(source.includes(s),"missing transaction final expiry fence "+s);
 const pg=read("scripts/mvp/vox/validate-vox-rc8-real-pg-vendor-core.mjs");
 assert.match(pg,/IN_FLIGHT_SCOPE_EXPIRY_DENIED/);
 assert.match(pg,/EXPIRED_SCOPE_NO_EVENT/);
 assert.match(pg,/EXPIRED_SCOPE_NO_RECEIPT/);
 assert.match(source,/RC8_CORE_WRITER_INSTALLED=false/);
});

test("client project expiry after write is denied atomically by real PG17",()=>{
 const pg=read("scripts/mvp/vox/validate-vox-rc8-real-pg-vendor-core.mjs");
 assert.match(pg,/IN_FLIGHT_CLIENT_BINDING_EXPIRY/);
 assert.match(pg,/EXPIRED_CLIENT_BINDING_NO_EVENT/);
 assert.match(pg,/EXPIRED_CLIENT_BINDING_NO_RECEIPT/);
 assert.match(pg,/EXPIRED_CLIENT_BINDING_NO_REVISION/);
 assert.match(pg,/await sleep\(2500\)/);
 const core=read("services/vox/rc8PgVendorConversationOperator.ts");
 assert.match(core,/CLIENT_PROJECT_BINDING_EXPIRED_DURING_TRANSACTION/);
});

test("commit-time Core grants bind the original reviewed capability and same-team TL",()=>{
 const source=read("services/vox/rc8PgVendorConversationOperator.ts");
 const final=source.slice(source.indexOf("const currentGrants=await db.query("),
  source.indexOf('if(currentGrants.rowCount!==1)'));
 for(const required of [
  'tl.team_id=req.team_id',
  'os.id=$5::uuid AND cap.id=$6::uuid',
  'req.team_id=m.team_id AND req.city_id=cap.city_id',
  'cap.revision=2 AND req.revision=1 AND t.is_active=true',
  'scope.rows[0].id,reviewed.rows[0].id',
  "tl.expires_at>clock_timestamp()"
 ])assert.ok(final.includes(required),required);
});
test("commit-time client binding also verifies same-team independent reviewer expiry",()=>{
 const source=read("services/vox/rc8PgVendorConversationOperator.ts");
 const final=source.slice(source.indexOf("const currentProject=await db.query("),
   source.indexOf("if(currentProject.rowCount!==1)"));
 for(const required of ["review_m.auth_user_id=b.reviewed_by",
  "review_m.team_id=b.team_id","review_m.staff_role='team_leader'",
  "review_m.expires_at>clock_timestamp()","review_t.city_id=b.approved_city_id"])
  assert.ok(final.includes(required),required);
});
