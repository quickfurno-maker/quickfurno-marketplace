#!/usr/bin/env node
// No network clients. Fails closed if canonical baseline, safety files or approvals drift.
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {createHash} from "node:crypto";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {buildLedgerRegister,RC1} from "./step3b6-ledger-register.mjs";
import {buildStep3b6HashBill} from "./step3b6-release-bill.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const get=p=>readFileSync(resolve(root,p),"utf8");
const sha=x=>createHash("sha256").update(x).digest("hex").toUpperCase();
const ledger=JSON.parse(get("ops/vox/certification/STEP3B1-LIVE-MIGRATION-LEDGER-20261022.json"));
const register=JSON.parse(get("ops/vox/certification/STEP3B6-DIVERGENCE-20261023.json"));
const releaseBill=JSON.parse(get("ops/vox/certification/STEP3B6-UNSIGNED-SOURCE-BILL-20261023.json"));
const source=JSON.parse(get("ops/vox/certification/STEP3B5-INTERNAL-RC-20261023.json"));
const baseline=buildLedgerRegister(ledger);
const files=["A-DBA-MIGRATION-DECISIONS","B-APPSEC-RLS-DECISION-MATRIX","C-OWNER-IDENTITY-ACCEPTANCE","D-RELEASE-ROLLBACK-PACKAGE","E-CONTINUOUS-QA","F-PAYMENTS-TEST-ACCEPTANCE"].map(x=>"docs/finance/STEP3B6-"+x+"-20261023.md");
const check=[
 ["exact pinned RC1 ancestry",register.rc1Commit===RC1&&source.source.phase22Sha256==="6F53E1781E4D2BD277645ED17B2EB635BE70F1D2C4DF7525CD176DFB0C2F28BA"],
 ["104-row 52/52 unreviewed divergence",JSON.stringify(register)===JSON.stringify(baseline)&&register.records.every(x=>x.decision==="PENDING_INDEPENDENT_DBA")],
 ["no imaginary DBA authorization",register.independentDbaApproved===false&&register.stagingMigrationAuthorized===false&&register.managedLedgerRepairAuthorized===false],
 ["only intended Staging Phase22 source SHA",sha(readFileSync(resolve(root,"supabase/migrations/20261006113720_phase22_identity_portability.sql")))==="6F53E1781E4D2BD277645ED17B2EB635BE70F1D2C4DF7525CD176DFB0C2F28BA"],
 ["six track evidence documents",files.every(f=>get(f).startsWith("# Step 3B-6"))],
 ["DBA clarifies restore limits",/global roles\/ownership\/ACL/.test(get(files[0]))],
 ["AppSec no blanket RLS change",/No blanket helper swap/.test(get(files[1]))],
 ["Owner grant fail-closed",get("scripts/grant-superadmin.mjs").includes("LEGACY_SUPERADMIN_GRANT_DISABLED_PENDING_APPROVED_OWNER_BOOTSTRAP")],
 ["Owner plan not executable",get("scripts/owner-superadmin-transition-plan.mjs").includes("authorizedToExecute:false")],
 ["release rollback distinct review",/distinct real DBA and AppSec decisions/.test(get(files[3]))],
 ["QA source vs managed separation",/does not assert managed authorization/.test(get(files[4]))],
 ["payment TEST/LIVE separation",/TEST and LIVE identifiers\/records must not be intermixed/.test(get(files[5]))],
 ["no managed money exercised",/No provider network call, TEST capture, LIVE charge/.test(get(files[5]))],
 ["review SQL solely read-only SELECT",(()=>{const sql=get("docs/finance/sql-review/STEP3B6-POLICY-MATRIX-READONLY.sql").replace(/^--.*$/gm,"").trim();return /^SELECT\b/i.test(sql)&&! /\b(UPDATE|INSERT|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|COPY|CALL|DO)\b/i.test(sql);})()],
 ["VOX pinned 23 candidate SQL intact",readdirSync(resolve(root,"ops/vox/sql-candidates")).filter(x=>x.endsWith(".sql")).length===23],
 ["seven quarantined sources untouched",readdirSync(resolve(root,"ops/vox/quarantined-migrations/legacy-20261014")).filter(x=>x.endsWith(".sql")).length===7],
 ["no Step3B6 runnable migration",!readdirSync(resolve(root,"supabase/migrations")).some(x=>/step3b6/i.test(x))],
 ["release bill byte hashes match files",JSON.stringify(releaseBill)===JSON.stringify(buildStep3b6HashBill())],
 ["no manufactured reviewer or release signatures",releaseBill.independentDbaApproved===false&&releaseBill.independentAppsecApproved===false&&releaseBill.ownerAuthorizedStaging===false&&releaseBill.signatureValid===false],
 ["release still HOLD",source.releaseAuthorized===false&&register.releaseStatus==="HOLD"&&releaseBill.releaseStatus==="HOLD"],
 ["all synthetic evidence flags deny managed actions",!register.productionMigrationAuthorized&&!register.stagingMigrationAuthorized]
];
for(const [name,ok] of check){assert.ok(ok,name);console.log("PASS "+name);}
console.log("STEP3B6_SOURCE_HOLD "+check.length+"/"+check.length+" PASS");
