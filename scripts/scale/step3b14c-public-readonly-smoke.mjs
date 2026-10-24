// Read-only LIVE GET/HEAD request smoke; not a browser, not form submission.
// Opt-in explicit CLI flag, never run this from CI or a webhook.
import assert from "node:assert/strict";
if(process.argv[2]!=="--live-read-only")throw Error("Explicit --live-read-only required. Script never posts anything");
const base="https://quickfurno.in";
const cases=[
{path:"/",title:/QuickFurno/i},
{path:"/enquiry",title:/free quotes|enquiry/i},
{path:"/privacy",title:/Privacy Policy/i},
{path:"/terms",title:/Terms of Service/i},
{path:"/vendors",title:/QuickFurno/i}
];
const getTitle=html=>(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]||"").trim();
for(const c of cases){
 const res=await fetch(base+c.path,{method:"GET",redirect:"manual",signal:AbortSignal.timeout(12000)});
 assert.equal(res.status,200,c.path+" HTTP "+res.status);
 const html=await res.text();
 assert.ok(html.length>500,c.path+" tiny HTML");
 assert.match(getTitle(html),c.title,c.path+" wrong page");
 assert.doesNotMatch(html,/sk_live_[A-Za-z0-9]{16,}/,c.path+" apparent leaked live payment secret");
 console.log("PASS LIVE PUBLIC READ-ONLY GET "+c.path+" 200 title="+getTitle(html).slice(0,65));
}
const pricing=await fetch(base+"/pricing",{method:"GET",redirect:"manual",signal:AbortSignal.timeout(12000)});
assert.ok([301,302,303,307,308].includes(pricing.status),"expected intentional pricing redirect; got "+pricing.status);
assert.ok((pricing.headers.get("location")||"").includes("/vendors"),"pricing should redirect to vendor onboarding");
console.log("PASS GET /pricing redirect="+pricing.status);
const ready=await fetch(base+"/readyz",{method:"GET",redirect:"manual",signal:AbortSignal.timeout(12000)});
assert.equal(ready.status,200);
const obj=await ready.json();
assert.equal(obj.ok,true);
assert.equal(obj.status,"ready");
console.log("PASS GET /readyz web-instance-only (NOT downstream provider health)");
console.log("STEP3B14C_PUBLIC_READ_ONLY_HTTP_SMOKE_7_OF_7_PASS");
