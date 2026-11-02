// Business Automation Studio stays Core-native; Jarvis Flow Studio stays Jarvis-native.
// VOX has no workflow evaluator, scheduler, Meta sender or deploy-to-prod primitive.
export const CORE_STUDIO_WORKFLOWS=Object.freeze([
  "vendor_journey","client_journey","campaigns","recovery","orphan_cleanup","stale_cleanup",
]);
export const JARVIS_AGENT_FLOWS=Object.freeze(["AAROHI","ANISHA","RIYA"]);
export function describeStudio(engine, key) {
  if (engine==="CORE" && CORE_STUDIO_WORKFLOWS.includes(key)) return Object.freeze({
    owner:"quickfurno-core",key,mode:"PROJECTION_ONLY",execution:"NATIVE_CORE_WORKER",
    approvedOperations:["read","simulate","submit_draft_for_review"],
  });
  if (engine==="JARVIS" && JARVIS_AGENT_FLOWS.includes(key)) return Object.freeze({
    owner:"qf-jarvis",key,mode:"PROJECTION_ONLY",execution:"GOVERNED_JARVIS_RUNTIME",
    approvedOperations:["read","replay","submit_flow_for_review"],
  });
  throw new Error("UNREGISTERED_STUDIO_OR_FLOW");
}
