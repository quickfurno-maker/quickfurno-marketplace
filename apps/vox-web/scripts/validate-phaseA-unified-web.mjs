import {strict as assert} from "node:assert";
import {readFileSync} from "node:fs";
const adapter=readFileSync(new URL("../lib/ui04Workspace.ts",import.meta.url),"utf8");
const page=readFileSync(new URL("../app/team/command-center/page.tsx",import.meta.url),"utf8");
const conditions=[
 ["mfa",adapter.includes("verifiedMfaSession()")],
 ["pinned origin",adapter.includes("origin()")],
 ["staging flag",adapter.includes("VOX_UI04_WORKSPACE_UI_ENABLED")],
 ["portal flag",adapter.includes("VOX_STAFF_PORTAL_ENABLED")],
 ["new Core endpoint",adapter.includes("/api/vox/v1/ui04-workspace")],
 ["read-only",adapter.includes("canTransition:false")],
 ["bounded 25",adapter.includes("p.items.length>25")],
 ["owner verified",adapter.includes('p.owner!=="quickfurno-core"')],
 ["failed content type",adapter.includes("INVALID_CORE_MEDIA_TYPE")],
 ["no-store fetch",adapter.includes('cache:"no-store"')],
 ["lane rejection",adapter.includes("CROSS_LANE_UNVERIFIED")],
 ["strict fields",adapter.includes("Object.keys(v).sort()")],
 ["new adapter visible",page.includes("fetchVerifiedUnifiedWorkspace()")],
 ["locked state",page.includes("Combined Core work is not activated")],
 ["client work distinction",page.includes('item.source==="CORE_CLIENT_RIYA"')]
];
for(const [label,passed] of conditions){
 assert.equal(passed,true,label);console.log("PASS",label);
}
console.log("PHASEA_WEB_ADAPTER_SOURCE_CHECKS_PASS "+conditions.length);
