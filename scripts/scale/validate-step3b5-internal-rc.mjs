#!/usr/bin/env node
// SOURCE-ONLY Step3B5 candidate gate. No network, secrets, Supabase clients or payments.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const file=(p)=>readFileSync(resolve(root,p));
const sha=b=>createHash("sha256").update(b).digest("hex").toUpperCase();
const code=file("scripts/grant-superadmin.mjs").toString("utf8");
const source=file("supabase/migrations/20261006113720_phase22_identity_portability.sql");
const candidateAdmin=file("docs/finance/sql-review/20261023010000_step3b4_is_admin_active_guard_REVIEW_ONLY.sql").toString();
const candidateVendor=file("docs/finance/sql-review/20261023020000_step3b5_owns_vendor_status_guard_REVIEW_ONLY.sql").toString();
const transition=file("scripts/owner-superadmin-transition-plan.mjs").toString();
const pinned=JSON.parse(file("ops/vox/certification/STEP3B1-LIVE-MIGRATION-LEDGER-20261022.json").toString());
const verifications=[
 ["exact Phase22 source hash",sha(source)==="6F53E1781E4D2BD277645ED17B2EB635BE70F1D2C4DF7525CD176DFB0C2F28BA"],
 ["review candidate admin guard exists OUTSIDE runnable SQL directories",candidateAdmin.includes("p.is_active IS TRUE")],
 ["review-only vendor guard exists and warns of historical-access impact",candidateVendor.includes("v.status='Approved'")&&candidateVendor.includes("past invoices")],
 ["legacy Superadmin script fails before Auth/data mutations",code.includes('throw new Error("LEGACY_SUPERADMIN_GRANT_DISABLED_PENDING_APPROVED_OWNER_BOOTSTRAP")')&&code.indexOf("throw new Error")<code.indexOf("const envPath =")&&code.indexOf("throw new Error")<code.indexOf("createClient(")],
 ["Owner transition has absolute nonexecution rule",transition.includes("authorizedToExecute:false")&&transition.includes("actualManagedMutation:false")&&transition.includes("crossSystemTransactionCertified:false")],
 ["22-Oct real Staging archive restored in source evidence, never bundled",!readdirSync(resolve(root,"docs/finance")).some(x=>x.endsWith(".dump"))],
 ["canonical VOX pinned SQL candidate count remains 23",readdirSync(resolve(root,"ops/vox/sql-candidates")).filter(x=>x.endsWith(".sql")).length===23],
 ["seven quarantined migration sources stay outside runnable tree",readdirSync(resolve(root,"ops/vox/quarantined-migrations/legacy-20261014")).filter(x=>x.endsWith(".sql")).length===7],
 ["historical divergence not suppressed",pinned.comparison.stagingOnly.length===52&&pinned.comparison.productionOnly.length===52&&pinned.comparison.sharedStagingProduction===34],
 ["review SQL absent from runnable supabase migrations",!readdirSync(resolve(root,"supabase/migrations")).some(x=>x.includes("step3b5")||x.includes("step3b4"))],
 ["no positive Managed Staging authorization claims",pinned.authorizationToApplyMigrations===false],
];
for(const [label,result] of verifications){assert.ok(result,label);console.log("PASS "+label);}
console.log("STEP3B5_INTERNAL_RC_SOURCE_HOLD_PASS "+verifications.length+"/"+verifications.length);
