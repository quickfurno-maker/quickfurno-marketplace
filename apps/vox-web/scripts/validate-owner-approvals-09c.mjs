import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const root=resolve(import.meta.dirname,"..");const read=p=>readFileSync(resolve(root,p),"utf8");
const core=read("lib/core.ts"),api=read("app/api/action-intents/route.ts"),
 page=read("app/approvals/page.tsx"),ui=read("app/approvals/OwnerApprovals.tsx"),
 ops=read("app/operations/page.tsx");
let n=0;const t=(name,fn)=>{fn();n++;console.log("PASS "+name);};
t("approvals UI staging disabled default",()=>assert.match(core,/VOX_OPERATIONAL_REVIEW_UI_ENABLED!=="staging"/));
t("owner-only view mode enforced",()=>assert.match(core,/VOX_STAFF_VIEW_MODE!=="owner"/));
t("owner queue requires real AAL2 session",()=>assert.match(core,/fetchOwnerOperationalIntents[\s\S]*verifiedMfaSession\(\)/));
t("review action requires real AAL2 session",()=>assert.match(core,/submitOwnerOperationalDecision[\s\S]*verifiedMfaSession\(\)/));
t("Core backend only, never direct browser bearer",()=>assert.doesNotMatch(ui,/staging-core|SUPABASE_SERVICE_ROLE_KEY|authorization:/i));
t("strict Core schema for queue",()=>assert.match(core,/qf\.vox\.operational\.intents\.v1/));
t("Core read queue bounded",()=>assert.match(core,/payload\.pending\.length>16/));
t("Core accepted decision must not execute",()=>assert.match(core,/x\.execution!=="NOT_AUTHORIZED"/));
t("BFF rejects cross origin POST",()=>assert.match(api,/allowedOrigin\(request\)/));
t("BFF checks max JSON size",()=>assert.match(api,/body.length>180/));
t("BFF rejects unknown approval fields",()=>assert.match(api,/Object.keys\(x\).some/));
t("BFF only expected revision zero",()=>assert.match(api,/x\.expectedRevision!==0/));
t("UI requires explicit second confirmation",()=>assert.match(ui,/Confirm review/));
t("UI only sends to same origin",()=>assert.match(ui,/fetch\("\/api\/action-intents"/));
t("approvals page fail closed",()=>assert.match(page,/Owner approval queue unavailable/));
t("owner queue linked from mission control",()=>assert.match(ops,/href="\/approvals"/));
t("never claims approved action executed",()=>assert.match(ui,/No operational action has been executed/));
t("no WhatsApp send or direct CRM write in page",()=>assert.doesNotMatch(ui+page,/sendWhatsApp\(|createVendorTask\(|updateAarohiWorkflow\(/));
console.log("VOX09C_OWNER_APPROVAL_WEB_PASS "+n+"/18");
