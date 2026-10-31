import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
test("native Core pins original reviewer's identity through final PostgreSQL check",()=>{
 const src=readFileSync(resolve(root,"services/vox/rc8PgVendorConversationOperator.ts"),"utf8");
 const early=src.slice(src.indexOf("const reviewed=await db.query("),src.indexOf("if(reviewed.rowCount!==1)"));
 const late=src.slice(src.indexOf("const currentGrants=await db.query("),src.indexOf("if(currentGrants.rowCount!==1)"));
 for(const s of ["req.decided_by AS reviewer_id","FOR SHARE OF cap,req,d,x,reviewer,reviewer_auth,tl,rt"])
   assert.ok(early.includes(s),s);
 for(const s of ["tl.auth_user_id=$7::uuid","reviewed.rows[0].reviewer_id",
    "m.staff_role='operations_manager'","t.city_id=cap.city_id",
    "tl.team_id=req.team_id","os.id=$5::uuid AND cap.id=$6::uuid"])
   assert.ok(late.includes(s),s);
 assert.match(src,/RC8_CORE_WRITER_INSTALLED=false/);
 assert.match(src,/CORE_WRITER_RELEASE_GATE_CLOSED/);
});
