import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {projectOwnerAosHealth} from "../../../contracts/vox/aosHealth.mjs";
const root=resolve(import.meta.dirname,"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const fixture={runtime:{mode:"shadow",intelligenceEnabled:true,actionProposalsEnabled:false},
 persistenceReady:true,counts:{totalAgents:7,operationalAgents:4,runs24h:10,completed24h:7,failed24h:3,recommendations24h:2},
 latestRuns:[{entity_id:"SECRET-VENDOR-ID",message:"secret phone"}],
 latestRecommendations:[{rationale:"private model memory",payload:"9876543210"}]};
let n=0;const t=(name,fn)=>{fn();console.log("PASS "+name);n++;};
t("canonical V2 snapshot mapped to owner only",()=>assert.equal(projectOwnerAosHealth(fixture).scope,"PLATFORM_OWNER_ONLY"));
t("shadow runtime is observation not permissions",()=>assert.equal(projectOwnerAosHealth(fixture).advisoryOnly,true));
t("no action authorization",()=>assert.equal(projectOwnerAosHealth(fixture).actionsEnabled,false));
t("real run count retained",()=>assert.equal(projectOwnerAosHealth(fixture).runs24h,10));
t("sensitive entity IDs withheld",()=>assert.doesNotMatch(JSON.stringify(projectOwnerAosHealth(fixture)),/SECRET-VENDOR-ID|private model|9876543210/));
t("unhealthy persistence is explicit unavailable",()=>assert.equal(projectOwnerAosHealth({...fixture,persistenceReady:false}).observation,"UNAVAILABLE"));
t("unavailable counts not false zero",()=>assert.equal(projectOwnerAosHealth({...fixture,persistenceReady:false}).runs24h,null));
t("invalid count not shown",()=>assert.equal(projectOwnerAosHealth({...fixture,counts:{...fixture.counts,failed24h:-100}}).failed24h,null));
t("outlier count not shown",()=>assert.equal(projectOwnerAosHealth({...fixture,counts:{...fixture.counts,runs24h:1e19}}).runs24h,null));
t("AGNI connection not falsely asserted",()=>assert.equal(projectOwnerAosHealth(fixture).linkedSystems.agni,"NOT_CONNECTED"));
t("missing snapshot fails closed",()=>assert.throws(()=>projectOwnerAosHealth(null),/AOS_SNAPSHOT_UNAVAILABLE/));
const route=read("app/api/vox/v1/aos-health/route.ts");
t("source reads existing AOS admin service",()=>assert.match(route,/getAosV2AdminSnapshot/));
t("owner verified by real Core AAL2",()=>assert.match(route,/verifyVoxOwnerBearer\(request\.headers\.get\("authorization"\)\)/));
t("feature disabled by default",()=>assert.match(route,/VOX_AOS_HEALTH_ENABLED!=="staging"/));
t("all mutation methods refused",()=>assert.equal((route.match(/READ_ONLY"\},405/g)||[]).length,4));
t("no leaking raw admin snapshot",()=>assert.doesNotMatch(route,/view:snapshot|return reply\(\{ok:true,snapshot/));
t("no direct provider/AOS mutation",()=>assert.doesNotMatch(route,/setAosV2IntelligenceEnabled|forceAosV2ActionProposalsOff|sendWhatsApp/));
console.log("VOX10_OWNER_AOS_READ_PASS "+n+"/17");
