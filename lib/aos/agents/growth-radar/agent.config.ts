import { noExternalSideEffectsPermission, type AgentConfig } from "../../types";

export const growthRadarAgentConfig: AgentConfig = {
  id: "growth-radar",
  name: "QF-AOS-GrowthRadar",
  slug: "growth-radar",
  status: "future",
  version: "0.1.0",
  description: "Future marketplace growth agent placeholder.",
  capabilities: [],
  permissions: noExternalSideEffectsPermission,
};

export default growthRadarAgentConfig;

