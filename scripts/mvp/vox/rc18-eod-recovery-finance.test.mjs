import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
test("recovery preflight records immutable source and deliberately cannot grant GO",()=>{
 const executable=resolve(root,"scripts/mvp/vox/rc18-finance-release-recovery-preflight.mjs");
 const run=spawnSync(process.execPath,[executable],{cwd:root,encoding:"utf8",timeout:12000,
  env:{PATH:process.env.PATH,HOME:process.env.HOME}});
 assert.equal(run.status,0,run.stderr);
 assert.match(run.stdout,/^VOX_RC18_RECOVERY_REVIEW_HOLD /);
 const report=JSON.parse(run.stdout.replace("VOX_RC18_RECOVERY_REVIEW_HOLD ",""));
 assert.equal(report.status,"HOLD");assert.equal(report.go,false);
 assert.equal(report.uninstalled,true);assert.equal(report.managedDatabaseTouched,false);
 assert.equal(report.definitionsFound,5);
 assert.match(report.historicalSha256,/^[a-f0-9]{64}$/);
 assert.match(report.reviewSha256,/^[a-f0-9]{64}$/);
 assert.ok(report.reasons.includes("INDEPENDENT_DBA_APPSEC_NOT_SIGNED"));
 assert.ok(report.reasons.includes("EXACT_SUPABASE_AUTH_STORAGE_VAULT_ROLE_RESTORE_NOT_CERTIFIED"));
});
test("human Team Leader verification checks real Auth and current team scope, no signer activation",()=>{
 const bearer=read("services/vox/verifiedStaffBearer.ts");
 const signed=read("scripts/mvp/vox/rc8-pg-signed-intent-writer.mjs");
 const registry=read("contracts/vox/rc4ApprovalPipeline.mjs");
 assert.match(bearer,/export async function verifyVoxTeamLeaderBearer/);
 assert.match(bearer,/user\.app_metadata\?\.vox_role!=="team_leader"/);
 assert.match(bearer,/verifySupabaseBearerUser\(token\)/);
 assert.match(bearer,/\.eq\("staff_role","team_leader"\)/);
 assert.match(bearer,/m\.revoked_at!==null/);
 assert.match(signed,/RC8_APPROVAL_WRITER_INSTALLED=false/);
 assert.match(signed,/humanKeyCeremonyComplete:false/);
 assert.match(registry,/RC4_HUMAN_APPROVED_REGISTRY_FINGERPRINTS=Object\.freeze\(\[\]\)/);
});
test("Finance attention indicator uses only bounded Core status and cannot send money",()=>{
 const ui=read("apps/vox-web/app/finance/page.tsx");
 assert.match(ui,/const monthScoped=result\.orders\.filter/);
 assert.match(ui,/indiaOrderMonth\(o\.createdAt\)===selectedMonth/);
 assert.match(ui,/const attention=monthScoped\.reduce/);
 assert.match(ui,/\["pending","failed"\]\.includes/);
 assert.match(ui,/reconciliation needs separate verified provider evidence/);
 assert.match(ui,/Filters apply only to the bounded Core preview/);
 assert.match(ui,/This page cannot refund, capture, reconcile, grant credits or activate packages/);
});
