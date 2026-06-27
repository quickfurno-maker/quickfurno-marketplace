// ============================================================================
// QuickFurno AOS — Agent Registry (Phase 1D)
// Single source of truth listing all 30 AOS agents and their lifecycle status.
// This is METADATA ONLY. It imports no service files and executes nothing, so it
// is safe to import anywhere (including UI) without side effects.
//
// Groups:
//   - foundation (1–7):  first agents, testing/foundation mode
//   - future-core (8–15): existing future/inactive agents
//   - future-ext (16–30): Phase 1D future/inactive agents
// ============================================================================

import type { AgentLifecycleStatus, AgentMode } from "../types";

export interface AgentRegistryEntry {
  num: number;
  slug: string;
  name: string;
  status: AgentLifecycleStatus;
  mode: AgentMode;
  group: "foundation" | "future-core" | "future-ext";
  purpose: string;
}

export const AOS_AGENT_REGISTRY: AgentRegistryEntry[] = [
  // --- Foundation agents (1–7): testing / rule-based ---
  { num: 1, slug: "nexus-kernel", name: "QF-AOS-NexusKernel", status: "testing", mode: "rule_based", group: "foundation", purpose: "Routes AOS tasks, checks permission gates, coordinates safe orchestration." },
  { num: 2, slug: "furno-memory", name: "QF-AOS-FurnoMemory", status: "testing", mode: "rule_based", group: "foundation", purpose: "Stores shared lead, vendor, client, and agent context memory." },
  { num: 3, slug: "lead-lens", name: "QF-AOS-LeadLens", status: "testing", mode: "rule_based", group: "foundation", purpose: "Rule-based lead quality scoring and qualification." },
  { num: 4, slug: "trust-shield", name: "QF-AOS-TrustShield", status: "testing", mode: "rule_based", group: "foundation", purpose: "Rule-based spam/duplicate risk review (never blocks)." },
  { num: 5, slug: "match-forge", name: "QF-AOS-MatchForge", status: "testing", mode: "rule_based", group: "foundation", purpose: "Vendor suggestions only, max 3, excludes disabled vendors." },
  { num: 6, slug: "lead-flow", name: "QF-AOS-LeadFlow", status: "testing", mode: "rule_based", group: "foundation", purpose: "Assignment/notification preview only, no side effects." },
  { num: 7, slug: "ops-brief", name: "QF-AOS-OpsBrief", status: "testing", mode: "rule_based", group: "foundation", purpose: "Read-only operations summary and daily report." },

  // --- Future core agents (8–15): future / inactive ---
  { num: 8, slug: "client-care", name: "QF-AOS-ClientCare", status: "future", mode: "placeholder", group: "future-core", purpose: "Future client follow-up, support, and nurture assistant." },
  { num: 9, slug: "vendor-pulse", name: "QF-AOS-VendorPulse", status: "future", mode: "placeholder", group: "future-core", purpose: "Future vendor health, response, renewal, and capacity assistant." },
  { num: 10, slug: "revenue-vault", name: "QF-AOS-RevenueVault", status: "future", mode: "placeholder", group: "future-core", purpose: "Future package, payment, revenue, and credit intelligence assistant." },
  { num: 11, slug: "review-shield", name: "QF-AOS-ReviewShield", status: "future", mode: "placeholder", group: "future-core", purpose: "Future review moderation and public trust assistant." },
  { num: 12, slug: "growth-radar", name: "QF-AOS-GrowthRadar", status: "future", mode: "placeholder", group: "future-core", purpose: "Future city, category, SEO, and demand growth assistant." },
  { num: 13, slug: "content-craft", name: "QF-AOS-ContentCraft", status: "future", mode: "placeholder", group: "future-core", purpose: "Future SEO page, content, and marketplace copy assistant." },
  { num: 14, slug: "admin-copilot", name: "QF-AOS-AdminCopilot", status: "future", mode: "placeholder", group: "future-core", purpose: "Future superadmin helper for summaries, drafts, and safe recommendations." },
  { num: 15, slug: "vault-guard", name: "QF-AOS-VaultGuard", status: "future", mode: "placeholder", group: "future-core", purpose: "Future secret, permission, audit, and rollback guardian." },

  // --- Future extended agents (16–30): Phase 1D future / inactive ---
  { num: 16, slug: "lead-nurture", name: "QF-AOS-LeadNurture", status: "future", mode: "placeholder", group: "future-ext", purpose: "Long-term lead nurturing, follow-up scheduling, custom nurture dates, future reactivation." },
  { num: 17, slug: "calendar-sync", name: "QF-AOS-CalendarSync", status: "future", mode: "placeholder", group: "future-ext", purpose: "CRM calendar, follow-up reminders, site visit reminders, future Google Calendar sync." },
  { num: 18, slug: "source-tracker", name: "QF-AOS-SourceTracker", status: "future", mode: "placeholder", group: "future-ext", purpose: "Track lead source, UTM, campaign, GCLID, FBCLID, referrer, landing page." },
  { num: 19, slug: "ad-brain", name: "QF-AOS-AdBrain", status: "future", mode: "placeholder", group: "future-ext", purpose: "Analyze Google/Meta campaign performance and suggest marketing actions later." },
  { num: 20, slug: "city-scout", name: "QF-AOS-CityScout", status: "future", mode: "placeholder", group: "future-ext", purpose: "Analyze area/city demand and suggest city/category expansion." },
  { num: 21, slug: "vendor-onboard", name: "QF-AOS-VendorOnboard", status: "future", mode: "placeholder", group: "future-ext", purpose: "Vendor onboarding, profile completeness, service area checks, verification readiness." },
  { num: 22, slug: "deal-tracker", name: "QF-AOS-DealTracker", status: "future", mode: "placeholder", group: "future-ext", purpose: "Track lead outcome, site visit, quotation, won/lost, vendor conversion." },
  { num: 23, slug: "quality-audit", name: "QF-AOS-QualityAudit", status: "future", mode: "placeholder", group: "future-ext", purpose: "Audit lead quality, vendor quality, bad matching, repeated complaints, poor source quality." },
  { num: 24, slug: "package-advisor", name: "QF-AOS-PackageAdvisor", status: "future", mode: "placeholder", group: "future-ext", purpose: "Recommend vendor packages based on category, demand, city, performance, and budget." },
  { num: 25, slug: "whatsapp-pilot", name: "QF-AOS-WhatsAppPilot", status: "future", mode: "placeholder", group: "future-ext", purpose: "Future WhatsApp automation controller for clients, vendors, admin alerts, reminders." },
  { num: 26, slug: "replacement-desk", name: "QF-AOS-ReplacementDesk", status: "future", mode: "placeholder", group: "future-ext", purpose: "Handle invalid lead replacement requests and recommend approval/rejection." },
  { num: 27, slug: "fraud-radar", name: "QF-AOS-FraudRadar", status: "future", mode: "placeholder", group: "future-ext", purpose: "Advanced fraud, competitor testing, vendor spying, fake client and suspicious activity detection." },
  { num: 28, slug: "seo-scout", name: "QF-AOS-SEOScout", status: "future", mode: "placeholder", group: "future-ext", purpose: "Find SEO page opportunities from lead demand, service, city, and area data." },
  { num: 29, slug: "sales-coach", name: "QF-AOS-SalesCoach", status: "future", mode: "placeholder", group: "future-ext", purpose: "Help sales/admin team with follow-up suggestions, objection handling, and next best action." },
  { num: 30, slug: "executive-brief", name: "QF-AOS-ExecutiveBrief", status: "future", mode: "placeholder", group: "future-ext", purpose: "Founder-level daily/weekly business summary, revenue projection, urgent actions, growth suggestions." },
];

export function getAgentRegistryEntry(slug: string): AgentRegistryEntry | undefined {
  return AOS_AGENT_REGISTRY.find((entry) => entry.slug === slug);
}

export function getAgentsByStatus(status: AgentLifecycleStatus): AgentRegistryEntry[] {
  return AOS_AGENT_REGISTRY.filter((entry) => entry.status === status);
}

export const AOS_AGENT_COUNT = AOS_AGENT_REGISTRY.length; // 30
