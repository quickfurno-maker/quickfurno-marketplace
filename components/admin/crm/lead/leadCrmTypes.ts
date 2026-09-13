import {
  type Assignment,
  type Lead,
  type LeadClarificationRequest,
  type Snapshot,
  type Vendor,
} from "../../adminTypes";
import {
  type LeadScoringSignals,
} from "@/lib/crm/types";
import {
  preferredBadge,
} from "./leadCrmUtils";

export type Tone = "emerald" | "indigo" | "amber" | "rose" | "slate";
export type BadgeTone = "emerald" | "blue" | "amber" | "rose" | "slate" | "violet" | "cyan";

export type CRMDashboardProps = {
  data: Snapshot;
  notify: (message: string, tone?: "success" | "error" | "info") => void;
  error?: string | null;
};

export type CrmPriority = "hot" | "warm" | "cold" | "weak" | "spam" | "duplicate";
export type CrmStatusBucket =
  | "new"
  | "clarification"
  | "quality_ready"
  | "assigned"
  | "nurture"
  | "invalid"
  | "duplicate";

export type PreferredBadge =
  | { label: string; tone: BadgeTone }
  | null;

export type QualityBadge =
  | { label: string; tone: BadgeTone }
  | null;

export type CrmRow = {
  lead: Lead;
  id: string;
  name: string;
  phone: string;
  phoneDigits: string;
  city: string;
  area: string;
  service: string;
  budget: string;
  timeline: string;
  source: string;
  intent: string;
  isPreferred: boolean;
  preferredBadge: PreferredBadge;
  qualityBadge: QualityBadge;
  latestClarification: LeadClarificationRequest | null;
  assignedCount: number;
  assignments: Assignment[];
  priority: CrmPriority;
  bucket: CrmStatusBucket;
  statusLabel: string;
  createdAt: string | null;
  signals: LeadScoringSignals;
};

export const TABS = [
  "Overview",
  "Lead Inbox",
  "Lead Flow",
  "Assignment Queue",
  "Delivery Evidence",
  "Source Analytics",
  "Nurture",
];

export type QuickFilter =
  | "all"
  | "new_today"
  | "quality_ready"
  | "clarification"
  | "unassigned"
  | "assigned"
  | "vendor_selected"
  | "nurture"
  | "invalid_dup";

export const PIPELINE_COLUMNS: Array<{ bucket: CrmStatusBucket; label: string }> = [
  { bucket: "new", label: "New" },
  { bucket: "clarification", label: "Needs clarification" },
  { bucket: "quality_ready", label: "Quality ready" },
  { bucket: "assigned", label: "Assigned / delivery" },
  { bucket: "nurture", label: "Nurture" },
  { bucket: "invalid", label: "Invalid / low quality" },
  { bucket: "duplicate", label: "Duplicate" },
];

export const PRIORITY_TONE: Record<CrmPriority, BadgeTone> = {
  hot: "rose",
  warm: "amber",
  cold: "slate",
  weak: "slate",
  spam: "rose",
  duplicate: "violet",
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export type Kpi = { key: QuickFilter | "total"; label: string; value: number; helper: string; tone: Tone };

export const QUICK_FILTER_LABEL: Record<QuickFilter, string> = {
  all: "All leads",
  new_today: "New today",
  quality_ready: "Quality ready",
  clarification: "Needs clarification",
  unassigned: "Unassigned",
  assigned: "Assigned",
  vendor_selected: "Vendor-selected",
  nurture: "Nurture",
  invalid_dup: "Invalid / duplicate",
};


export type DrawerClarificationQuestion = {
  key: string;
  text: string;
  type: string;
  options: Array<{ value: string; label: string }>;
};
