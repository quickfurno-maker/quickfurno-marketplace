// ============================================================================
// QuickFurno AOS — permanently locked canonical operational agent registry.
// No eighth agent may be added without deliberately changing this invariant
// and its certification. New capabilities belong under these seven agents.
// ============================================================================

import type { AgentLifecycleStatus, AgentMode } from "../types";

export const CANONICAL_AOS_AGENT_SLUGS = Object.freeze([
  "nexus-kernel",
  "furno-memory",
  "lead-lens",
  "trust-shield",
  "match-forge",
  "lead-flow",
  "ops-brief",
] as const);

export type CanonicalAosAgentSlug = (typeof CANONICAL_AOS_AGENT_SLUGS)[number];
export const CANONICAL_AOS_AGENT_COUNT = 7 as const;

export interface AgentRegistryEntry {
  num: number;
  slug: CanonicalAosAgentSlug;
  name: string;
  status: AgentLifecycleStatus;
  mode: AgentMode;
  group: "foundation";
  purpose: string;
}
export const AOS_AGENT_REGISTRY: readonly AgentRegistryEntry[] = Object.freeze([
  { num: 1, slug: "nexus-kernel", name: "QF-AOS-NexusKernel", status: "active", mode: "rule_based", group: "foundation", purpose: "Guards AOS authority and coordinates advisory recommendations." },
  { num: 2, slug: "furno-memory", name: "QF-AOS-FurnoMemory", status: "active", mode: "rule_based", group: "foundation", purpose: "Stores scoped structured AOS memory derived from canonical Core facts." },
  { num: 3, slug: "lead-lens", name: "QF-AOS-LeadLens", status: "active", mode: "rule_based", group: "foundation", purpose: "Observes canonical Core lead-quality scoring and qualification." },
  { num: 4, slug: "trust-shield", name: "QF-AOS-TrustShield", status: "active", mode: "rule_based", group: "foundation", purpose: "Observes canonical duplicate and lead-quality hard-gate evidence." },
  { num: 5, slug: "match-forge", name: "QF-AOS-MatchForge", status: "active", mode: "rule_based", group: "foundation", purpose: "Observes canonical Core matching outcomes and vendor recommendations." },
  { num: 6, slug: "lead-flow", name: "QF-AOS-LeadFlow", status: "active", mode: "rule_based", group: "foundation", purpose: "Observes the Core-owned lead lifecycle through verified vendor delivery; does not manage quotation, site visit, negotiation or project execution." },
  { num: 7, slug: "ops-brief", name: "QF-AOS-OpsBrief", status: "active", mode: "rule_based", group: "foundation", purpose: "Produces read-only lead-generation operations summaries through verified vendor delivery, excluding downstream vendor-client commercial execution." },
]);

export function getAgentRegistryEntry(slug: string): AgentRegistryEntry | undefined {
  return AOS_AGENT_REGISTRY.find((entry) => entry.slug === slug);
}

export function getAgentsByStatus(status: AgentLifecycleStatus): AgentRegistryEntry[] {
  return AOS_AGENT_REGISTRY.filter((entry) => entry.status === status);
}

export const AOS_AGENT_COUNT = AOS_AGENT_REGISTRY.length;

if (
  AOS_AGENT_COUNT !== CANONICAL_AOS_AGENT_COUNT ||
  AOS_AGENT_REGISTRY.some((agent, index) => agent.slug !== CANONICAL_AOS_AGENT_SLUGS[index])
) {
  throw new Error("AOS_AGENT_ARCHITECTURE_LOCK_VIOLATION");
}
