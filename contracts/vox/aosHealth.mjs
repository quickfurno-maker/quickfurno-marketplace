// VOX-10 allowlisted AOS V2 platform-wide health; owner ONLY.
// Deliberately drops entity IDs, recommendations, prompts, traces and memory.
const boundedCount=n=>Number.isSafeInteger(n)&&n>=0&&n<=1e9?n:null;
export function projectOwnerAosHealth(snapshot){
 if(!snapshot||typeof snapshot!=="object"||!snapshot.runtime||!snapshot.counts)throw Error("AOS_SNAPSHOT_UNAVAILABLE");
 const runtime=snapshot.runtime,counts=snapshot.counts;
 const persistenceReady=snapshot.persistenceReady===true;
 const mode=runtime.mode==="shadow"?"SHADOW":runtime.mode==="off"?"OFF":"UNKNOWN";
 const count=k=>persistenceReady?boundedCount(counts[k]):null;
 return Object.freeze({
  schema:"qf.vox.aos.health.v1",owner:"quickfurno-core",scope:"PLATFORM_OWNER_ONLY",
  source:"aosV2AdminService",mode:"READ_ONLY",
  observation:persistenceReady?"READY":"UNAVAILABLE",
  runtime:mode,
  advisoryOnly:true,actionsEnabled:false,
  intelligenceEnabled:runtime.intelligenceEnabled===true&&mode==="SHADOW",
  proposalSwitchObserved:runtime.actionProposalsEnabled===true,
  agentCount:boundedCount(counts.totalAgents),
  operationalAgentCount:boundedCount(counts.operationalAgents),
  runs24h:count("runs24h"),completed24h:count("completed24h"),
  failed24h:count("failed24h"),recommendations24h:count("recommendations24h"),
  // Avoid falsely implying AGNI / Jarvis automation connectivity.
  linkedSystems:Object.freeze({jarvis:"NOT_VERIFIED",agni:"NOT_CONNECTED"}),
 });
}
