import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotEnv } from "dotenv";

function loadEnvironment(){
  const explicit=process.env.QF_ENV_FILE?.trim();
  const candidates=[explicit,".env.local",".env.production",".env"].filter(Boolean) as string[];
  for(const candidate of candidates){
    const path=resolve(process.cwd(),candidate);
    if(!existsSync(path)) continue;
    loadDotEnv({path,override:false});
    if(explicit) break;
  }
}
loadEnvironment();

const sleep=(ms:number)=>new Promise<void>((resolveSleep)=>setTimeout(resolveSleep,ms));

async function main(){
  const {
    scheduleAarohiDiscoveryRuns,
    promoteReadyAarohiDiscoveryCandidates,
    authorizePendingAarohiOutreach,
    scheduleAarohiFollowups,
  }=await import("@/services/aarohiPhase2AcquisitionService");
  const {executeAarohiWhatsAppOutreachBatch}=await import("@/services/aarohiWhatsAppExecutionService");
  const enabled=process.env.QF_AAROHI_PHASE2_DISCOVERY_ENABLED?.trim().toLowerCase()==="true";
  const intervalRaw=Number(process.env.QF_AAROHI_PHASE2_SCHEDULER_INTERVAL_MS??300_000);
  const interval=Number.isInteger(intervalRaw)&&intervalRaw>=60_000&&intervalRaw<=3_600_000
    ?intervalRaw:300_000;
  console.info("[qf-aarohi-phase2] scheduler starting",{enabled,intervalMs:interval});
  if(!enabled){
    console.info("[qf-aarohi-phase2] scheduler disabled by configuration");
    return;
  }
  let stopping=false;
  process.once("SIGTERM",()=>{stopping=true;});
  process.once("SIGINT",()=>{stopping=true;});
  while(!stopping){
    try{
      const result=await scheduleAarohiDiscoveryRuns();
      const promotion=await promoteReadyAarohiDiscoveryCandidates(50);
      const followups=await scheduleAarohiFollowups(new Date(),100);
      const authorization=await authorizePendingAarohiOutreach(100);
      const whatsappExecution=await executeAarohiWhatsAppOutreachBatch(20);
      console.info("[qf-aarohi-phase2] acquisition cycle",{
        queued:result.queued,
        promoted:promotion.promoted,
        excluded:promotion.excluded,
        review:promotion.review,
        followupsQueued:followups.queued,
        authorized:authorization.authorized,
        authorizationBlocked:authorization.blocked,
        whatsappExecution,
      });
    }catch(error){
      console.error("[qf-aarohi-phase2] discovery schedule cycle failed",{
        code:error instanceof Error?error.message.slice(0,160):"AAROHI_PHASE2_SCHEDULER_ERROR",
      });
    }
    if(!stopping) await sleep(interval);
  }
}
main().catch((error)=>{
  console.error("[qf-aarohi-phase2] fatal",{
    code:error instanceof Error?error.message.slice(0,160):"AAROHI_PHASE2_FATAL",
  });
  process.exitCode=1;
});
