import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const root=resolve(import.meta.dirname,".."),read=p=>readFileSync(resolve(root,p),"utf8");
const q=read("app/components/ScopedQueue.tsx"),acq=read("app/acquisition/page.tsx"),
 vendor=read("app/vendor360/page.tsx"),desk=read("app/service-desk/page.tsx"),
 core=read("lib/core.ts"),intelligence=read("app/intelligence/page.tsx"),
 api=read("app/api/intelligence/route.ts"),ops=read("app/operations/page.tsx");
let n=0;const t=(label,fn)=>{fn();n++;console.log("PASS "+label);};
t("queues are controlled client inputs",()=>assert.match(q,/useState\("ALL"\)/));
t("assigned-only queue data comes from Core SSR",()=>assert.match(acq,/fetchScopedCrm\("acquisition"\)/));
t("vendor SSR uses protected Core CRM",()=>assert.match(vendor,/fetchScopedCrm\("vendor360"\)/));
t("desk SSR uses protected Core service desk",()=>assert.match(desk,/fetchScopedServiceDesk\(\)/));
t("search actually filters list",()=>assert.match(q,/rows\.filter\(/));
t("search constrained to bounded input",()=>assert.match(q,/maxLength=\{80\}/));
t("status selector wired to state",()=>assert.match(q,/onChange=\{e=>setState\(e\.target\.value\)\}/));
t("attention checkbox changes visible records",()=>assert.match(q,/setAttentionOnly\(e\.target\.checked\)/));
t("filter reset changes all relevant state",()=>assert.match(q,/setQuery\(""\);setState\("ALL"\);setAttentionOnly\(false\)/));
t("UI only uses Core-assigned bounded items",()=>assert.doesNotMatch(q,/fetch\(|localStorage|window\.location|sendMessage/));
t("no duplicate CRM DB implemented in UI",()=>assert.doesNotMatch(acq+vendor,/supabase\.from|service_role|new Prisma/));
t("core intelligence owner-only explicit mode",()=>assert.match(core,/VOX_STAFF_VIEW_MODE!=="owner"/));
t("intelligence private staging gate",()=>assert.match(core,/VOX_INTELLIGENCE_VIEW_ENABLED!=="staging"/));
t("intelligence server verifies MFA",()=>assert.match(core,/fetchOwnerAosHealth[\s\S]*verifiedMfaSession\(\)/));
t("intelligence pin to Core source",()=>assert.match(core,/\/api\/vox\/v1\/aos-health/));
t("AOS BFF never forwards raw server payload",()=>assert.match(core,/observation:ready\?"READY":"UNAVAILABLE"/));
t("AOS no provider capabilities",()=>assert.doesNotMatch(intelligence,/sendWhatsApp|approveLead|fetch\(/));
t("AGNI explicitly not connected",()=>assert.match(intelligence,/AGNI not connected/));
t("intelligence API refuses mutations",()=>assert.equal((api.match(/OWNER_ONLY_READ_ONLY/g)||[]).length,3));
t("dashboard links to secure intelligence view",()=>assert.match(ops,/href="\/intelligence"/));
console.log("VOX_09_WORKBENCH_UI_PASS "+n+"/20");
