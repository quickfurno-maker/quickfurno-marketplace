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
  | "contacted"
  | "assigned"
  | "site_visit"
  | "quotation"
  | "won"
  | "lost"
  | "spam"
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
  followUp: string | null;
  signals: LeadScoringSignals;
};

export const TABS = [
  "Overview",
  "Lead Inbox",
  "Pipeline Board",
  "Follow-ups",
  "Assignment Queue",
  "Vendor Response",
  "Source Analytics",
  "Nurture",
];

export type QuickFilter =
  | "all"
  | "new_today"
  | "hot"
  | "unassigned"
  | "assigned"
  | "vendor_selected"
  | "site_visit"
  | "won"
  | "lost"
  | "spam_dup";

export const PIPELINE_COLUMNS: Array<{ bucket: CrmStatusBucket; label: string }> = [
  { bucket: "new", label: "New" },
  { bucket: "contacted", label: "Contacted" },
  { bucket: "assigned", label: "Assigned" },
  { bucket: "site_visit", label: "Site Visit" },
  { bucket: "quotation", label: "Quotation" },
  { bucket: "won", label: "Won" },
  { bucket: "lost", label: "Lost" },
  { bucket: "spam", label: "Spam / Duplicate" },
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

export type Kpi = { key: QuickFilter | "follow_ups" | "total"; label: string; value: number; helper: string; tone: Tone };

export const QUICK_FILTER_LABEL: Record<QuickFilter, string> = {
  all: "All leads",
  new_today: "New today",
  hot: "Hot leads",
  unassigned: "Unassigned",
  assigned: "Assigned",
  vendor_selected: "Vendor-selected",
  site_visit: "Site visits",
  won: "Won",
  lost: "Lost",
  spam_dup: "Spam / duplicate",
};


export type DrawerClarificationQuestion = {
  key: string;
  text: string;
  type: string;
  options: Array<{ value: string; label: string }>;
};
