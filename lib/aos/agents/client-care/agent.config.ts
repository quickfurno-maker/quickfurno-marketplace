import { noExternalSideEffectsPermission, type AgentConfig } from "../../types";

export const clientCareAgentConfig: AgentConfig = {
  id: "client-care",
  name: "QF-AOS-ClientCare",
  slug: "client-care",
  status: "future",
  version: "0.1.0",
  description: "Future client support agent placeholder.",
  capabilities: [],
  permissions: noExternalSideEffectsPermission,
};

export default clientCareAgentConfig;

