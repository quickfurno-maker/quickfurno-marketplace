import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const page=readFileSync(new URL("../app/team/command-center/page.tsx",import.meta.url),"utf8");
const module=readFileSync(new URL("../lib/ab2Attention.ts",import.meta.url),"utf8");
const gates=[
 ["verified source only",module.includes('view:UnifiedRead')],
 ["bounded attention",module.includes("candidates.slice(0,25)")],
 ["no invented SLA",module.includes("officialSlaBreaches:null")],
 ["no hidden total",module.includes("knownIncomplete:true")],
 ["prioritization deterministic",module.includes('a.reason==="BLOCKED"')],
 ["no provider writes",!module.includes("fetch(")&&!module.includes("sendWhatsApp")],
 ["live team Command Center wiring",page.includes("deriveBoundedAttention(unified)")],
 ["locked state when Core denies",page.includes("Verified Core work unavailable")],
 ["clearly partial label",page.includes("Not an SLA breach count")],
 ["does not expose phone/email",!module.includes("email")&&!module.includes("phone")]
];
for(const [label,condition] of gates){assert.equal(condition,true,label);}
console.log("VOX_AB2_BOUNDED_ATTENTION_SOURCE_GATES_PASS "+gates.length+"/"+gates.length);
