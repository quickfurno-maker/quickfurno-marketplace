#!/usr/bin/env node
// RC18-D non-mutating source recovery gate. This tool is documentation evidence,
// never a database migration tool and never evidence of managed restore parity.
import {readFileSync,readdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const legacyPath="supabase/migrations/20260912010000_qf_vendor_package_razorpay_testmode.sql";
const v2Path="ops/vox/rc17-review-candidates/20261031001000_rc17_razorpay_v2_authority_REVIEW_ONLY.sql";
const legacy=readFileSync(resolve(root,legacyPath),"utf8");
const next=readFileSync(resolve(root,v2Path),"utf8");
const digest=s=>createHash("sha256").update(s,"utf8").digest("hex");
const funcs=["claim_vendor_package_razorpay_order","release_vendor_package_razorpay_order_claim",
 "bind_vendor_package_razorpay_order","activate_vendor_package_order",
 "mark_vendor_package_payment_failed"];
const reasons=[];
if(/\bas \$(?=\r?\n)|^\$;$/m.test(legacy))
 reasons.push("LEGACY_V1_SINGLE_DOLLAR_FUNCTION_DELIMITERS_REQUIRE_REPLAY_ADJUDICATION");
if(legacy.includes("if v_order.provider_order_request_token is distinct from p_request_token then"))
 reasons.push("LEGACY_V1_FIRST_CLAIM_TOKEN_NULL_MISMATCH_REQUIRES_DB_INVENTORY");
if(!next.includes("REVIEW ONLY / UNINSTALLED"))
 throw Error("RC18_V2_CANDIDATE_LOST_HOLD_LABEL");
if(readdirSync(resolve(root,"supabase/migrations")).some(name=>name.includes("rc17_razorpay")||name.includes("rc18_razorpay")))
 throw Error("RC18_REVIEW_ONLY_CANDIDATE_ACCIDENTALLY_DEPLOYABLE");
for(const fn of funcs){
 if(!next.includes("create or replace function public.qf_"+fn+"_v2("))
  throw Error("RC18_MISSING_SOURCE_RPC_"+fn);
}
for(const mandatory of ["MANAGED_SCHEMA_INVENTORY_NOT_AVAILABLE",
 "EXACT_SUPABASE_AUTH_STORAGE_VAULT_ROLE_RESTORE_NOT_CERTIFIED",
 "INDEPENDENT_DBA_APPSEC_NOT_SIGNED","OWNER_MANAGED_STAGING_GO_NOT_RECORDED"])
 reasons.push(mandatory);
const report=Object.freeze({status:"HOLD",go:false,
 observedAt:"SOURCE_ONLY",historicalMigration:legacyPath,
 historicalSha256:digest(legacy),reviewCandidate:v2Path,reviewSha256:digest(next),
 definitionsFound:funcs.length,uninstalled:true,managedDatabaseTouched:false,
 reasons});
console.log("VOX_RC18_RECOVERY_REVIEW_HOLD "+JSON.stringify(report));
