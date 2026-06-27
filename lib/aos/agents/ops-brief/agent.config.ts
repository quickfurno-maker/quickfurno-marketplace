import { noExternalSideEffectsPermission, type AgentConfig } from "../../types";

export const opsBriefAgentConfig: AgentConfig = {
  id: "ops-brief",
  name: "QF-AOS-OpsBrief",
  slug: "ops-brief",
  status: "active",
  version: "0.1.0",
  description: "Produces mock operations summaries for future admin briefings.",
  capabilities: ["ops summary placeholder", "admin brief placeholder", "daily digest placeholder"],
  permissions: noExternalSideEffectsPermission,
};

export default opsBriefAgentConfig;

