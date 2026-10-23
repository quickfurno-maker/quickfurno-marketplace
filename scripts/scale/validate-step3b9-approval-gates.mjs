// Final 3B9 source-only human signature/Owner gate; never enables a managed operation.
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {makeHandoff} from "./step3b9-review-handoff.mjs";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const read=p=>readFileSync(resolve(ROOT,p),"utf8");
const json=p=>JSON.parse(read(p));
const packet=json("ops/vox/certification/STEP3B9-INDEPENDENT-REVIEW-HANDOFF-20261023.json");
const expected=makeHandoff();
const docs=[
 "docs/vox/STEP3B9-DBA-INDEPENDENT-REVIEW-REQUEST-20261023.md",
 "docs/vox/STEP3B9-APPSEC-INDEPENDENT-REVIEW-REQUEST-20261023.md",
 "docs/vox/STEP3B9-OWNER-STAGING-AUTHORIZATION-REQUEST-20261023.md"
];
const [dba,appsec,owner]=docs.map(read);
const checks=[
 ["packet deterministically reproducible",JSON.stringify(packet)===JSON.stringify(expected)],
 ["104 pending DBA decisions",packet.dba.decisions.length===104&&packet.dba.decisions.every(x=>!x.reviewer&&!x.independentSignature)],
 ["72 historical SQL artifacts require recovery",packet.dba.counts.missingRunnableSource===72],
 ["all DBA approvals absent",!packet.dba.independentlyApproved&&!packet.dba.signature],
 ["69 pending AppSec effective decisions",packet.appsec.decisions.length===69&&packet.appsec.decisions.every(x=>!x.reviewer&&!x.independentSignature)],
 ["37 mutating/ALL policy decisions",packet.appsec.counts.writeOrAll===37],
 ["all AppSec approvals absent",!packet.appsec.independentlyApproved&&!packet.appsec.signature],
 ["all Staging Owner approvals absent",!packet.owner.approved&&!packet.owner.requested&&!packet.owner.ownerSigned],
 ["no mutable guessed final release SHA",packet.exactNewReleaseSha===null&&packet.owner.approvedReleaseSha===null],
 ["Staging subject not Production",packet.owner.targetEnvironment==="STAGING"&&!packet.gates.productionAllowed],
 ["managed Staging schema still unauthorized",!packet.gates.protectedStagingDdlAllowed],
 ["privileged auth still unauthorized",!packet.gates.privilegedAuthAllowed],
 ["Razorpay operations remain disabled",!packet.gates.realRazorpayProviderActionsAllowed],
 ["outbound messaging stays disabled",!packet.gates.outboundProviderMessagesAllowed],
 ["public DNS remains disabled",!packet.gates.publicDnsAllowed],
 ["human independent signatures required",dba.includes("Reviewer: NOT ASSIGNED")&&appsec.includes("Reviewer: NOT ASSIGNED")],
 ["Owner request visibly unsigned",owner.includes("NOT SIGNED")&&owner.includes("Current decision: UNAPPROVED")],
 ["source release remains HOLD",packet.releaseStatus==="HOLD"],
 ["no executable 3B9 migrations added",!readdirSync(resolve(ROOT,"supabase/migrations")).some(x=>/step3b9/i.test(x))]
];
for(const [name,value] of checks){assert.ok(value,name);console.log("PASS "+name);}
console.log("STEP3B9_REVIEW_AND_OWNER_HOLD "+checks.length+"/"+checks.length+" PASS");
