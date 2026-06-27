import { noExternalSideEffectsPermission, type AgentConfig } from "../../types";

export const vendorPulseAgentConfig: AgentConfig = {
  id: "vendor-pulse",
  name: "QF-AOS-VendorPulse",
  slug: "vendor-pulse",
  status: "future",
  version: "0.1.0",
  description: "Future vendor health agent placeholder.",
  capabilities: [],
  permissions: noExternalSideEffectsPermission,
};

export default vendorPulseAgentConfig;

