import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const root=resolve(import.meta.dirname,"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const manifest=JSON.parse(read("docs/vox/VOX-11-RELEASE-MANIFEST.json"));
const intent=read("app/api/vox/v1/action-intents/route.ts"),
 task=read("app/api/vox/v1/vendor-task/route.ts"),
 studio=read("app/api/vox/v1/studio-simulate/route.ts"),
 sql=read("ops/vox/quarantined-migrations/legacy-20261014/20261014060000_vox_operational_intent_review.sql");
let n=0;function check(name,fn){fn();console.log("PASS "+name);n++;}
check("global release stays hold",()=>assert.equal(manifest.releaseStatus,"HOLD"));
check("no launch gate silently certified",()=>assert.ok(Object.values(manifest.criticalGates).every(v=>v===false)));
check("reviewed operation still no action executor",()=>assert.doesNotMatch(intent,/createAdminSupportReply|updateAarohiWorkflow|sendWhatsApp/));
check("approved operational intent cannot execute",()=>assert.match(intent,/execution:"NOT_AUTHORIZED"/));
check("real staging operational route feature gated",()=>assert.match(intent,/VOX_OPERATIONAL_INTENTS_ENABLED!=="staging"/));
check("review requires remote Supabase owner auth",()=>assert.match(intent,/verifyVoxOwnerBearer\(request.headers.get\("authorization"\)\)/));
check("staff proposer requires Core active staff scope",()=>assert.match(intent,/getVerifiedScopedStaff\(request.headers.get\("authorization"\)\)/));
check("canonical vendor zone checked on proposal",()=>assert.match(intent,/\.eq\("is_active",true\)\.maybeSingle\(\)/));
check("approval rechecks revoked staff",()=>assert.match(sql,/m.revoked_at IS NULL AND m.expires_at>now\(\)/));
check("approval rechecks scope expiration",()=>assert.match(sql,/s.revoked_at IS NULL AND s.expires_at>now\(\)/));
check("support thread requires vendor grant at decision",()=>assert.match(sql,/vs.scope_kind='vendor'/));
check("support approved only with active city zone",()=>assert.match(sql,/z.is_active=true/));
check("write task still defaults off",()=>assert.match(task,/VOX_VENDOR_CRM_TASKS_ENABLED!=="staging"/));
check("simulation cannot publish",()=>assert.match(studio,/canPublish:false,canExecute:false/));
check("provider send source not exposed",()=>assert.doesNotMatch(task+studio+intent,/fetch\(.*graph.facebook.com|metaSend|client\.messages\.create/));
console.log("VOX11C_LAUNCH_HOLD_SOURCE_PASS "+n+"/15");
