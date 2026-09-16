import { AOS_AGENT_REGISTRY } from "../agents/agentRegistry";

export interface AosV2AgentCapability {
  slug: string;
  name: string;
  purpose: string;
  state: "operational";
  authority: "advisory_only";
  sourceOfTruth: string;
  directExternalExecutor: false;
  businessWrites: false;
  customerConversation: false;
  postDeliveryCommercialManagement: false;
}

const SOURCE_OF_TRUTH: Readonly<Record<string, string>> = Object.freeze({
  "nexus-kernel": "AOS V2 authority guard + recommendation coordinator",
  "furno-memory": "aos_agent_memory structured canonical snapshots",
  "lead-lens": "services/leadQualityService canonical Core quality result",
  "trust-shield": "Core duplicate/quality hard-gate evidence",
  "match-forge": "services/leadMatchingEngine canonical Core outcome",
  "lead-flow": "Core-owned lead routing/matching outcome",
  "ops-brief": "CRM projection enriched with canonical Core quality fields",
});

export const AOS_V2_AGENT_CAPABILITIES: AosV2AgentCapability[] =
  AOS_AGENT_REGISTRY.map((agent) => ({
    slug: agent.slug,
    name: agent.name,
    purpose: agent.purpose,
    state: "operational",
    authority: "advisory_only",
    sourceOfTruth: SOURCE_OF_TRUTH[agent.slug],
    directExternalExecutor: false,
    businessWrites: false,
    customerConversation: false,
    postDeliveryCommercialManagement: false,
  }));

export const AOS_V2_OPERATIONAL_AGENT_COUNT = AOS_V2_AGENT_CAPABILITIES.length;
export const AOS_V2_AGENT_COUNT = AOS_V2_AGENT_CAPABILITIES.length;
