import "server-only";
import { adminClient } from "@/lib/supabase";

// Source-side service readiness, not a claim that every QuickFurno dependency is healthy.
// Called only after an independently verified, signed AGNI M2M request.
const SHA=/^[0-9a-f]{40}$/u;
export async function getAgniQuickFurnoParentHeartbeat(challenge:string,now=new Date()){
  let ready=false;
  try {
    const result=await adminClient().from("cities").select("id",{head:true,count:"exact"}).limit(1);
    ready=!result.error;
  } catch { ready=false; }
  const rev=process.env.QF_RELEASE_SHA;
  const sourceRevision=typeof rev==="string"&&SHA.test(rev)?rev:null;
  return Object.freeze({
    protocol:"qf.agni.parent-heartbeat.v1" as const,
    sourceId:"quickfurno-core" as const,
    authority:"READ_ONLY" as const,
    observedAt:now.toISOString(),
    releaseRevision:sourceRevision,
    challenge,
    status:sourceRevision===null?"UNKNOWN" as const:ready?"HEALTHY" as const:"UNHEALTHY" as const,
    scope:"QUICKFURNO_HTTP_AND_CORE_DATABASE_PROBE" as const,
    executionAuthority:"NONE" as const,
  });
}
