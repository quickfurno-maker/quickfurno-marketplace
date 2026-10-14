import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {normalizeAgentSubjectAccess,hasHumanCoreConversation} from "../../../contracts/vox/agentSubjectAccess.mjs";
const root=resolve(import.meta.dirname,"../../.."),read=p=>readFileSync(resolve(root,p),"utf8");
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const scope={userId:id(1),cityId:id(2),role:"acquisition_agent",canReadContent:true,
 prospectIds:[id(3)],vendorIds:[],conversationIds:[id(4)]};
const q={agent:"AAROHI",subjectType:"prospect",subjectId:id(3),revision:7};
const c={id:id(4),subject_type:"prospect",subject_id:id(3),state:"HUMAN",human_takeover:true,revision:7};
let n=0;function t(name,fn){fn();n++;console.log("PASS "+name);}
t("assigned prospect allowed",()=>assert.ok(normalizeAgentSubjectAccess(q,scope)));
t("wrong prospect denied",()=>assert.equal(normalizeAgentSubjectAccess({...q,subjectId:id(9)},scope),null));
t("cross-role denied",()=>assert.equal(normalizeAgentSubjectAccess(q,{...scope,role:"support_agent"},null),null));
t("mismatched agent kind denied",()=>assert.equal(normalizeAgentSubjectAccess({...q,subjectType:"vendor"},scope),null));
t("zero conversation scope denied",()=>assert.equal(normalizeAgentSubjectAccess(q,{...scope,conversationIds:[]}),null));
t("auditor no read denied",()=>assert.equal(normalizeAgentSubjectAccess(q,{...scope,canReadContent:false}),null));
t("client fake permission denied",()=>assert.equal(normalizeAgentSubjectAccess({...q,aal2Verified:true},scope),null));
t("negative revision denied",()=>assert.equal(normalizeAgentSubjectAccess({...q,revision:-1},scope),null));
t("fractional revision denied",()=>assert.equal(normalizeAgentSubjectAccess({...q,revision:1.2},scope),null));
t("canonical matching HUMAN revision",()=>assert.equal(hasHumanCoreConversation([c],q,scope),true));
t("stale revision denied",()=>assert.equal(hasHumanCoreConversation([c],{...q,revision:6},scope),false));
t("revoked conversation grant denied",()=>assert.equal(hasHumanCoreConversation([c],q,{...scope,conversationIds:[]}),false));
t("AI-owned denied",()=>assert.equal(hasHumanCoreConversation([{...c,state:"AI"}],q,scope),false));
t("no takeover denied",()=>assert.equal(hasHumanCoreConversation([{...c,human_takeover:false}],q,scope),false));
t("ambiguous multiple conversations denied",()=>assert.equal(hasHumanCoreConversation([c,c],q,scope),false));
t("vendor support agent assigned accepted",()=>assert.ok(normalizeAgentSubjectAccess(
 {agent:"ANISHA",subjectType:"vendor",subjectId:id(5),revision:7},
 {...scope,role:"support_agent",vendorIds:[id(5)]})));
const s=read("app/api/vox/v1/agent-subject-access/route.ts");
t("default off",()=>assert.match(s,/VOX_AGENT_SUBJECT_AUTH_ENABLED!=="staging"/));
t("server auth rechecked",()=>assert.match(s,/getVerifiedScopedStaff\(request.headers.get\("authorization"\)\)/));
t("canonical prospect city required",()=>assert.match(s,/\.eq\("city_id",scope.cityId\)/));
t("canonical vendor zone required",()=>assert.match(s,/marketplace_service_zones/));
t("HUMAN & revision server checked",()=>assert.match(s,/\.eq\("revision",query.revision\)/));
t("no provider send wallet mutate",()=>assert.doesNotMatch(s,/sendWhatsApp|wallet\.update|lead_assignments\)\.insert/));
t("request bounded",()=>assert.match(s,/raw.length>256/));
t("GET and writes denied",()=>assert.equal((s.match(/METHOD_NOT_ALLOWED/g)||[]).length,4));
console.log("VOX14_CORE_SUBJECT_AUTH_SOURCE_PASS "+n+"/"+n);
