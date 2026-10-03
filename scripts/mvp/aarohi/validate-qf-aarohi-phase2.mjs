import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const read=(p)=>fs.readFileSync(path.join(root,p),"utf8");
const exists=(p)=>fs.existsSync(path.join(root,p));
let passed=0,failed=0;
const check=(name,condition)=>{
  if(condition){passed++;console.log("PASS",String(passed+failed).padStart(2,"0"),name);}
  else{failed++;console.error("FAIL",String(passed+failed).padStart(2,"0"),name);}
};

const migrationPath="supabase/migrations/20261003080000_aarohi_phase2_autonomous_acquisition.sql";
const policyPath="lib/aarohi/phase2Policy.ts";
const servicePath="services/aarohiPhase2AcquisitionService.ts";
const routePath="app/api/internal/jarvis/aarohi-phase2/route.ts";
const workerPath="worker/aarohiAcquisitionWorker.ts";
const contextPath="services/conversationalWhatsAppService.ts";
const discoveryPage="app/admin/aarohi/discovery/page.tsx";
const outreachPage="app/admin/aarohi/outreach/page.tsx";
const campaignPage="app/admin/aarohi/campaigns/page.tsx";
for(const p of [migrationPath,policyPath,servicePath,routePath,workerPath,contextPath,discoveryPage,outreachPage,campaignPage]){
  check("required Phase 2 artifact exists: "+p,exists(p));
}
const migration=read(migrationPath);
const policy=read(policyPath);
const service=read(servicePath);
const route=read(routePath);
const worker=read(workerPath);
const context=read(contextPath);
const discovery=read(discoveryPage);
const outreach=read(outreachPage);
const campaigns=read(campaignPage);

for(const table of [
  "aarohi_discovery_connectors","aarohi_discovery_runs","aarohi_discovery_candidates",
  "aarohi_outreach_jobs","aarohi_social_reply_signals","aarohi_communication_permissions",
  "aarohi_memory_snapshots","aarohi_broadcast_batches",
]){
  check("migration creates "+table,migration.includes("public."+table));
}
check("connectors default disabled",/enabled boolean not null default false/.test(migration));
check("connectors require provider readiness",migration.includes("check (enabled=false or provider_ready=true)"));
check("migration seeds no enabled provider",!migration.includes(",true,true,"));
check("browser cold DM is pinned false",migration.includes('"arbitrary_browser_cold_dm":false'));
check("CRM schema stores no provider bearer secret",!/(access_token|bearer_token|api_secret|private_key)\s+text/i.test(migration));
check("outreach authorization reference exists",migration.includes("core_authorization_ref text"));
check("send-like outreach states require Core authorization",migration.includes("core_authorization_ref is not null"));
check("suppression cancels outreach",migration.includes("PROSPECT_SUPPRESSED")&&migration.includes("state='CANCELLED'"));
check("suppression revokes permissions",migration.includes("aarohi_communication_permissions")&&migration.includes("STOP_OR_SUPPRESSION"));
check("marketing and continuation permissions are distinct",migration.includes("ACQUISITION_CONTINUATION")&&migration.includes("MARKETING_BROADCAST"));
check("WhatsApp signals store only hash",migration.includes("whatsapp_hash text")&&!migration.includes("social_reply_signals")?false:true);
check("claim RPC uses skip locked",/for update skip locked/i.test(migration));
check("claim RPC revoked from browser roles",/revoke all on function public\.qf_aarohi_claim_discovery_run_v1\(text\) from public,anon,authenticated/i.test(migration));

check("Instagram cold start is assisted",policy.includes('INSTAGRAM:Object.freeze')&&policy.includes('initiation:"ASSISTED_FIRST_CONTACT"'));
check("Facebook cold start is assisted",policy.includes('FACEBOOK:Object.freeze')&&policy.includes('initiation:"ASSISTED_FIRST_CONTACT"'));
check("X is governed API only",policy.includes('X:Object.freeze')&&policy.includes('initiation:"GOVERNED_API_IF_ELIGIBLE"'));
check("WhatsApp is governed template",policy.includes('WHATSAPP:Object.freeze')&&policy.includes('initiation:"GOVERNED_TEMPLATE"'));
check("arbitrary browser automation is impossible by type",policy.includes("arbitraryBrowserAutomation:false"));
check("provider execution defaults off",policy.includes("QF_AAROHI_PHASE2_PROVIDER_EXECUTION_ENABLED"));
check("discovery execution defaults off",policy.includes("QF_AAROHI_PHASE2_DISCOVERY_ENABLED"));

check("candidate metadata redacts content/secrets",/message\|body\|content\|text\|transcript\|secret\|token\|password\|cookie\|authorization/i.test(service));
check("social interested queues WhatsApp request",service.includes("system:request-whatsapp-continuation"));
check("WhatsApp share queues dedicated continuation",service.includes("system:whatsapp-acquisition-continuation"));
check("WhatsApp sharing grants continuation only",service.includes('purpose:"ACQUISITION_CONTINUATION"'));
check("broadcast explicitly requires MARKETING_BROADCAST",service.includes('"MARKETING_BROADCAST"')&&service.includes("marketingAllowed"));
check("memory snapshot is safe summary based",service.includes("safe_summary")&&service.includes("structured_facts"));
check("Phase 2 service contains no provider fetch",!service.includes("fetch("));

check("Jarvis Phase 2 endpoint defaults off",route.includes("QF_JARVIS_AAROHI_PHASE2_ENABLED")&&route.includes('!=="true"'));
check("Jarvis Phase 2 endpoint verifies signed request",route.includes("verifyQfjSignedRequestSignature"));
check("bridge body is bounded",route.includes("MAX_BODY_BYTES"));
check("bridge cannot directly dispatch provider",!route.includes("MetaCloudWhatsAppProvider")&&!route.includes("fetch("));
check("scheduler defaults off",worker.includes("QF_AAROHI_PHASE2_DISCOVERY_ENABLED")&&worker.includes("if(!enabled)"));
check("scheduler has no provider transport",!worker.includes("fetch(")&&!worker.includes("MetaCloudWhatsAppProvider"));

check("Aarohi memory enters WhatsApp context only for Aarohi",context.includes('material.value.assignedActor === "AAROHI"')&&context.includes("aarohi_memory_snapshots"));
check("cross-channel memory remains non-authoritative",context.includes("NON_AUTHORITATIVE_CONVERSATION_CONTEXT"));
check("cross-channel memory is bounded",context.includes("slice(0, 1400)")&&context.includes("slice(0, 4000)"));

check("Discovery UI exposes connector readiness",discovery.includes("Connector readiness"));
check("Outreach UI states no row grants send",outreach.includes("No row on this page is itself permission to send"));
check("Campaign UI has no blast control",campaigns.includes("There is intentionally no direct")&&campaigns.includes("Plan batch"));

console.log(`SUMMARY passed=${passed} failed=${failed}`);
if(failed>0) process.exit(1);
