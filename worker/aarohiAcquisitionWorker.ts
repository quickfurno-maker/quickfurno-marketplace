import {
  assertQfRuntimeIdentity,
  loadQfRuntimeEnvironment,
} from "@/lib/runtime/deploymentConfig";
import {
  addMetric,
  recordMetric,
  startQfObservability,
} from "@/lib/observability/runtime";

loadQfRuntimeEnvironment();
const runtimeIdentity=assertQfRuntimeIdentity("quickfurno.aarohi-acquisition");
const observability=startQfObservability(runtimeIdentity);

const sleep=(ms:number)=>new Promise<void>((resolveSleep)=>setTimeout(resolveSleep,ms));

function boundedInt(raw:string|undefined,fallback:number,min:number,max:number){
  const parsed=Number(raw);
  if(!Number.isFinite(parsed)) return fallback;
  return Math.max(min,Math.min(max,Math.floor(parsed)));
}

async function main(){
  const {
    scheduleAarohiDiscoveryRuns,
    promoteReadyAarohiDiscoveryCandidates,
    authorizePendingAarohiOutreach,
    scheduleAarohiFollowups,
  }=await import("@/services/aarohiPhase2AcquisitionService");
  const {executeAarohiWhatsAppOutreachBatch}=await import("@/services/aarohiWhatsAppExecutionService");
  const scale=await import("@/services/scaleWorkerRuntimeService");

  const enabled=process.env.QF_AAROHI_PHASE2_DISCOVERY_ENABLED?.trim().toLowerCase()==="true";
  const intervalRaw=Number(process.env.QF_AAROHI_PHASE2_SCHEDULER_INTERVAL_MS??300_000);
  const interval=Number.isInteger(intervalRaw)&&intervalRaw>=60_000&&intervalRaw<=3_600_000
    ?intervalRaw:300_000;
  const heartbeatMs=boundedInt(
    process.env.QF_AAROHI_PHASE2_HEARTBEAT_MS,
    15_000,
    5_000,
    60_000,
  );
  const leaseSeconds=boundedInt(
    process.env.QF_AAROHI_PHASE2_SCHEDULER_LEASE_SECONDS,
    Math.min(1800,Math.max(120,Math.ceil(interval/1000*2))),
    30,
    3600,
  );
  const role="aarohi-acquisition";
  const workerId=scale.scaleWorkerId(role,process.env.QF_AAROHI_PHASE2_WORKER_ID);
  const schedulerKey="aarohi-phase2-cycle";
  const startedAt=new Date().toISOString();
  let stopping=false;
  let drainStartedAt:string|null=null;
  let lastHeartbeatAt=0;

  const heartbeat=async(
    state:"starting"|"running"|"idle"|"degraded"|"draining"|"stopped",
    acceptingWork:boolean,
    force=false,
    safeCode?:string,
  )=>{
    const now=Date.now();
    if(!force&&now-lastHeartbeatAt<heartbeatMs) return;
    await scale.writeScaleWorkerHeartbeat({
      role,
      workerId,
      state,
      acceptingWork,
      inFlight:0,
      startedAt,
      drainStartedAt,
      lastSafeCode:safeCode,
    });
    lastHeartbeatAt=now;
  };

  const stop=()=>{
    stopping=true;
    drainStartedAt??=new Date().toISOString();
  };
  process.once("SIGTERM",stop);
  process.once("SIGINT",stop);

  console.info("[qf-aarohi-phase2] scheduler starting",{
    enabled,
    intervalMs:interval,
    leaseSeconds,
    workerId,
  });
  await heartbeat("starting",enabled,true).catch(()=>undefined);

  if(!enabled){
    await heartbeat("stopped",false,true,"SCHEDULER_DISABLED").catch(()=>undefined);
    console.info("[qf-aarohi-phase2] scheduler disabled by configuration");
    return;
  }

  while(!stopping){
    const now=new Date();
    const occurrenceKey=String(Math.floor(now.getTime()/interval));
    try{
      const claim=await scale.claimScaleSchedulerOccurrence({
        schedulerKey,
        occurrenceKey,
        workerId,
        leaseSeconds,
      });
      if(claim.status!=="acquired"){
        addMetric("qf.scheduled.refusals",1,{
          worker_role:"aarohi-acquisition",
          result:claim.status,
        });
        await heartbeat("idle",true).catch(()=>undefined);
        if(!stopping) await sleep(interval);
        continue;
      }

      await heartbeat("running",true,true).catch(()=>undefined);
      const cycleStarted=performance.now();
      const result=await scheduleAarohiDiscoveryRuns(now);
      const promotion=await promoteReadyAarohiDiscoveryCandidates(50);
      const followups=await scheduleAarohiFollowups(now,100);
      const authorization=await authorizePendingAarohiOutreach(100);
      const whatsappExecution=await executeAarohiWhatsAppOutreachBatch(20);

      const completed=await scale.completeScaleSchedulerOccurrence({
        schedulerKey,
        occurrenceKey,
        workerId,
        leaseToken:claim.leaseToken,
        fence:claim.fence,
        safeCode:"AAROHI_CYCLE_COMPLETED",
      });
      if(!completed){
        throw new Error("AAROHI_SCHEDULER_COMPLETION_OWNERSHIP_LOST");
      }

      addMetric("qf.worker.jobs",1,{
        worker_role:"aarohi-acquisition",
        result:"completed",
      });
      recordMetric("qf.worker.duration",performance.now()-cycleStarted,{
        worker_role:"aarohi-acquisition",
        result:"completed",
      });
      console.info("[qf-aarohi-phase2] acquisition cycle",{
        occurrenceKey,
        fence:claim.fence,
        queued:result.queued,
        promoted:promotion.promoted,
        excluded:promotion.excluded,
        review:promotion.review,
        followupsQueued:followups.queued,
        authorized:authorization.authorized,
        authorizationBlocked:authorization.blocked,
        whatsappExecution,
      });
      await heartbeat("idle",true).catch(()=>undefined);
    }catch(error){
      const code=error instanceof Error?error.message.slice(0,160):"AAROHI_PHASE2_SCHEDULER_ERROR";
      console.error("[qf-aarohi-phase2] discovery schedule cycle failed",{code});
      await heartbeat("degraded",true,true,code).catch(()=>undefined);
      // The occurrence is intentionally not released on error. Its durable lease must
      // expire before another replica may reclaim it; every downstream job also has
      // its own database idempotency/claim fence.
    }
    if(!stopping) await sleep(interval);
  }

  drainStartedAt??=new Date().toISOString();
  await heartbeat("draining",false,true,"GRACEFUL_DRAIN").catch(()=>undefined);
  await heartbeat("stopped",false,true,"GRACEFUL_DRAIN_COMPLETE").catch(()=>undefined);
}
main()
  .catch((error)=>{
    console.error("[qf-aarohi-phase2] fatal",{
      code:error instanceof Error?error.message.slice(0,160):"AAROHI_PHASE2_FATAL",
    });
    process.exitCode=1;
  })
  .finally(()=>observability.shutdown().catch(()=>undefined));
