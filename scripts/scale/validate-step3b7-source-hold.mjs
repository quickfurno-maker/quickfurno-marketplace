#!/usr/bin/env node
// CI source-only. NEVER reads secrets, uses network, invokes Supabase/Auth or Razorpay.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {auditPolicyEvidence} from "./step3b7-policy-inventory-audit.mjs";
import {buildStep3b7Manifest} from "./step3b7-source-manifest.mjs";
import {buildLedgerRegister} from "./step3b6-ledger-register.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const file=p=>readFileSync(resolve(root,p),"utf8");
const sha=p=>createHash("sha256").update(readFileSync(resolve(root,p))).digest("hex").toUpperCase();
const inventory=JSON.parse(file("ops/vox/certification/STEP3B7-STAGING-RLS-READONLY-20261023.json"));
const matrix=JSON.parse(file("ops/vox/certification/STEP3B7-POLICY-DECISION-MATRIX-20261023.json"));
const bill=JSON.parse(file("ops/vox/certification/STEP3B7-UNSIGNED-REVIEW-MANIFEST-20261023.json"));
const ledger=JSON.parse(file("ops/vox/certification/STEP3B1-LIVE-MIGRATION-LEDGER-20261022.json"));
const expected=buildStep3b7Manifest(), expectedMatrix=auditPolicyEvidence(inventory);
const checks=[
 ["fresh Staging metadata digest pinned",sha("ops/vox/certification/STEP3B7-STAGING-RLS-READONLY-20261023.json")==="39AB07FB84BCE75FAA84B472D608FEAB262F43F05FD27AF60FEE6EE12A5CE5FC"],
 ["69 reviewed-target policy names actually inventoried",inventory.policies.length===69],
 ["59 Admin-helper dependent policies",inventory.policies.filter(x=>x.has_admin).length===59],
 ["22 vendor-helper dependent policies",inventory.policies.filter(x=>x.has_vendor).length===22],
 ["12 overlapping helper-dependent policies",inventory.policies.filter(x=>x.has_admin&&x.has_vendor).length===12],
 ["policy matrix matches captured source, no fabricated findings",JSON.stringify(matrix)===JSON.stringify(expectedMatrix)],
 ["all 69 policy dispositions pending",matrix.policies.every(x=>x.policyDecision==="PENDING_INDEPENDENT_APPSEC_AND_DOMAIN_OWNER")],
 ["RLS effective-role authorization unverified",matrix.actualManagedRlsCertified===false&&matrix.signedIndependentAppsec===false],
 ["policy review model always returns no authority",file("contracts/vox/step3b7PolicyReview.mjs").includes("actualRlsAuthorized:false")],
 ["Finance uses existing Core scoped read grant",file("lib/payments/step3b7FinanceHistoryPreview.mjs").includes("evaluateFinanceReadGrant")],
 ["Finance forbids payment/refund/credit activation",file("lib/payments/step3b7FinanceHistoryPreview.mjs").includes("walletCreditAuthorized:false")],
 ["Owner old grant remains hard disabled",file("scripts/grant-superadmin.mjs").includes("LEGACY_SUPERADMIN_GRANT_DISABLED_PENDING_APPROVED_OWNER_BOOTSTRAP")],
 ["Owner new transition remains non-authorizing",file("scripts/owner-superadmin-transition-plan.mjs").includes("authorizedToExecute:false")],
 ["pinned VOX 23 SQL candidates",readdirSync(resolve(root,"ops/vox/sql-candidates")).filter(x=>x.endsWith(".sql")).length===23],
 ["seven quarantined VOX candidates still isolated",readdirSync(resolve(root,"ops/vox/quarantined-migrations/legacy-20261014")).filter(x=>x.endsWith(".sql")).length===7],
 ["52/52 migration semantic divergence not waived",buildLedgerRegister(ledger).allReviewed===false],
 ["Phase22 unchanged",sha("supabase/migrations/20261006113720_phase22_identity_portability.sql")==="6F53E1781E4D2BD277645ED17B2EB635BE70F1D2C4DF7525CD176DFB0C2F28BA"],
 ["no runnable Step3B7 migration",!readdirSync(resolve(root,"supabase/migrations")).some(x=>x.toLowerCase().includes("step3b7"))],
 ["review source SHA manifests byte-accurate",JSON.stringify(bill)===JSON.stringify(expected)],
 ["no manufactured independent DBA/AppSec approval",!bill.independentDbaSigned&&!bill.independentAppsecSigned],
 ["no manufactured Owner, AAL2, Razorpay or signing approval",!bill.ownerApprovedManagedStaging&&!bill.realAal2Certified&&!bill.razorpayProviderTestCertified&&!bill.releaseSignatureValid],
 ["all deployment and money actions hard HOLD",!bill.stagingExecutionAuthorized&&!bill.productionExecutionAuthorized&&!bill.providerMoneyExecutionAuthorized&&bill.status==="HOLD"]
];
for(const [name,ok] of checks){assert.ok(ok,name);console.log("PASS "+name);}
console.log("STEP3B7_SOURCE_HOLD "+checks.length+"/"+checks.length+" PASS");
