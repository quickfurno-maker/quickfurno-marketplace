// ============================================================================
// QuickFurno AOS ? canonical operational agent registry
//
// AOS V2 deliberately contains only agents with certified adapters to canonical
// QuickFurno Core truth. Placeholder/future agents were permanently removed.
// ============================================================================

import type { AgentLifecycleStatus, AgentMode } from "../types";

export interface AgentRegistryEntry {
  num: number;
  slug: string;
  name: string;
  status: AgentLifecycleStatus;
  mode: AgentMode;
  group: "foundation";
  purpose: string;
}

export const AOS_AGENT_REGISTRY: AgentRegistryEntry[] = [
  { num: 1, slug: "nexus-kernel", name: "QF-AOS-NexusKernel", status: "active", mode: "rule_based", group: "foundation", purpose: "Guards AOS authority and coordinates advisory recommendations." },
  { num: 2, slug: "furno-memory", name: "QF-AOS-FurnoMemory", status: "active", mode: "rule_based", group: "foundation", purpose: "Stores scoped structured AOS memory derived from canonical Core facts." },
  { num: 3, slug: "lead-lens", name: "QF-AOS-LeadLens", status: "active", mode: "rule_based", group: "foundation", purpose: "Observes canonical Core lead-quality scoring and qualification." },
  { num: 4, slug: "trust-shield", name: "QF-AOS-TrustShield", status: "active", mode: "rule_based", group: "foundation", purpose: "Observes canonical duplicate and lead-quality hard-gate evidence." },
  { num: 5, slug: "match-forge", name: "QF-AOS-MatchForge", status: "active", mode: "rule_based", group: "foundation", purpose: "Observes canonical Core matching outcomes and vendor recommendations." },
  { num: 6, slug: "lead-flow", name: "QF-AOS-LeadFlow", status: "active", mode: "rule_based", group: "foundation", purpose: "Observes Core-owned lead routing and matching outcomes without side effects." },
  { num: 7, slug: "ops-brief", name: "QF-AOS-OpsBrief", status: "active", mode: "rule_based", group: "foundation", purpose: "Produces read-only operations summaries from canonical CRM/Core facts." },
];

export function getAgentRegistryEntry(slug: string): AgentRegistryEntry | undefined {
  return AOS_AGENT_REGISTRY.find((entry) => entry.slug === slug);
}

export function getAgentsByStatus(status: AgentLifecycleStatus): AgentRegistryEntry[] {
  return AOS_AGENT_REGISTRY.filter((entry) => entry.status === status);
}

export const AOS_AGENT_COUNT = AOS_AGENT_REGISTRY.length; // canonical total: 7
