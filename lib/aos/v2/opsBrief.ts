import type { CRMLead } from "@/lib/crm/types";

export interface OpsBriefReport {
  agent: "QF-AOS-OpsBrief";
  mode: "rule_based";
  agent_status: string;
  total_leads: number;
  hot: number;
  warm: number;
  cold: number;
  weak: number;
  assigned: number;
  unassigned: number;
  nurture: number;
  follow_ups_due: number;
  top_service: string;
  top_area: string;
  agent_health: Array<{ agent: string; status: string }>;
  recommended_actions: string[];
  generated_label: string;
  error?: string | null;
}

export function runOpsBrief(leads: CRMLead[], vendorCount = 0): OpsBriefReport {
  const quality = { hot: 0, warm: 0, cold: 0, weak: 0 };
  let assigned = 0;
  let nurture = 0;
  let followUpsDue = 0;
  const serviceCounts = new Map<string, number>();
  const areaCounts = new Map<string, number>();
  const now = Date.now();

  for (const lead of leads) {
    quality[mapCoreQualityClass(readMetaString(lead, "core_quality_class"))] += 1;
    if ((lead.assigned_vendor_count ?? 0) > 0 || lead.status === "assigned") assigned += 1;
    if (lead.status === "nurture_later") nurture += 1;
    if (lead.next_follow_up_date) {
      const due = new Date(lead.next_follow_up_date).getTime();
      if (!Number.isNaN(due) && due <= now) followUpsDue += 1;
    }
    count(serviceCounts, lead.service);
    count(areaCounts, lead.area);
  }

  const unassigned = Math.max(0, leads.length - assigned);
  const recommendedActions: string[] = [];
  if (quality.hot > 0) recommendedActions.push(`Prioritize ${quality.hot} Core-qualified high-intent lead(s).`);
  if (followUpsDue > 0) recommendedActions.push(`${followUpsDue} follow-up(s) are due in CRM.`);
  if (unassigned > 0) recommendedActions.push(`${unassigned} lead(s) are currently unassigned; inspect Core matching/hold reasons.`);
  if (vendorCount === 0 && leads.length > 0) recommendedActions.push("No active-vendor count was supplied to this read-only brief.");
  if (!recommendedActions.length) recommendedActions.push("No urgent action detected from canonical Core state.");

  return {
    agent: "QF-AOS-OpsBrief",
    mode: "rule_based",
    agent_status: "Active (canonical Core read-only)",
    total_leads: leads.length,
    ...quality,
    assigned,
    unassigned,
    nurture,
    follow_ups_due: followUpsDue,
    top_service: topOf(serviceCounts),
    top_area: topOf(areaCounts),
    agent_health: [
      { agent: "QF-AOS-NexusKernel", status: "operational/advisory" },
      { agent: "QF-AOS-FurnoMemory", status: "operational/structured-memory" },
      { agent: "QF-AOS-LeadLens", status: "canonical-core-adapter" },
      { agent: "QF-AOS-TrustShield", status: "canonical-core-adapter" },
      { agent: "QF-AOS-MatchForge", status: "canonical-core-observer" },
      { agent: "QF-AOS-LeadFlow", status: "canonical-core-observer" },
      { agent: "QF-AOS-OpsBrief", status: "operational/read-only" },
    ],
    recommended_actions: recommendedActions,
    generated_label: "AOS V2 · canonical Core state · read-only",
    error: null,
  };
}

function mapCoreQualityClass(value: string | null): "hot" | "warm" | "cold" | "weak" {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "A+" || normalized === "A") return "hot";
  if (normalized === "B") return "warm";
  if (normalized === "C") return "cold";
  return "weak";
}

function readMetaString(lead: CRMLead, key: string): string | null {
  const value = lead.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function count(map: Map<string, number>, value?: string | null): void {
  const key = String(value ?? "").trim();
  if (!key || key === "Not set") return;
  map.set(key, (map.get(key) ?? 0) + 1);
}

function topOf(map: Map<string, number>): string {
  return [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Not enough data";
}
