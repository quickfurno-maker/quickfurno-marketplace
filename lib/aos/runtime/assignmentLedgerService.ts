// ============================================================================
// QuickFurno AOS — Phase 14: Assignment Ledger + Recent Assignments Sync
//
// SERVER-ONLY read service over the Phase 13 preview ledger
// (public.lead_assignment_approvals). Maps raw rows into readable entries for
// the admin Lead Distribution page (Recent / Failed / Distribution Logs).
//
// SAFETY CONTRACT:
//   - READ ONLY. Performs NO writes, NO assignment, NO WhatsApp, NO vendor
//     notification, NO credit deduction, NO n8n calls.
//   - Uses the service-role client; never reaches the browser. Returns no
//     secrets — the stored event_response is a safe, masked summary only.
//   - Never throws: any missing table/column resolves to a safe empty result so
//     the admin page never breaks (e.g. if migration 019 is not applied yet).
// ============================================================================
import { adminClient } from "@/lib/supabase";

export interface LedgerVendorSnapshot {
  id: string;
  businessName: string | null;
  city: string | null;
  packageStatus: string;
  credits: number;
  paidStatus: string | null;
}

export interface LedgerSideEffects {
  whatsappSent: boolean;
  vendorNotified: boolean;
  creditsDeducted: boolean;
  leadAutoAssigned: boolean;
  n8nWebhookCalled: boolean;
}

export interface AssignmentLedgerEntry {
  id: string;
  leadId: string;
  leadName: string | null;
  leadCity: string | null;
  leadCategory: string | null;
  leadBudget: string | null;
  selectedVendorIds: string[];
  selectedVendorCount: number;
  selectedVendorNames: string[];
  vendors: LedgerVendorSnapshot[];
  status: string;
  statusLabel: string;
  mode: string;
  aosEventEmitted: boolean;
  n8nWebhookCalled: boolean;
  n8nLabel: string;
  approvedBy: string | null;
  approvalSource: string;
  approvalNote: string | null;
  failureReason: string | null;
  isFailed: boolean;
  sideEffects: LedgerSideEffects;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AssignmentLedgerDetail extends AssignmentLedgerEntry {
  eventResponse: Record<string, unknown>;
}

export interface AssignmentLogEntry {
  id: string;
  createdAt: string | null;
  leadName: string | null;
  status: string;
  statusLabel: string;
  n8nWebhookCalled: boolean;
  approvedBy: string | null;
  approvalSource: string;
}

export interface VendorCreditLogEntry {
  id: string;
  vendorId: string;
  changeType: string;
  creditsBefore: number;
  creditsDelta: number;
  creditsAfter: number;
  reason: string | null;
  updatedBy: string | null;
  createdAt: string | null;
}

async function fetchApprovalRows(limit: number): Promise<Array<Record<string, unknown>>> {
  try {
    const { data, error } = await adminClient()
      .from("lead_assignment_approvals")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !Array.isArray(data)) return [];
    return data as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}

export async function getRecentAssignments(limit = 25): Promise<AssignmentLedgerEntry[]> {
  const rows = await fetchApprovalRows(limit);
  return rows.map(mapLedgerRow);
}

export async function getFailedAssignments(limit = 50): Promise<AssignmentLedgerEntry[]> {
  // Filter in JS so we never depend on the failure_reason column existing.
  const rows = await fetchApprovalRows(limit);
  return rows.map(mapLedgerRow).filter((entry) => entry.isFailed);
}

export async function getAssignmentById(id: string): Promise<AssignmentLedgerDetail | null> {
  const trimmed = (id ?? "").trim();
  if (!trimmed) return null;
  try {
    const { data, error } = await adminClient()
      .from("lead_assignment_approvals")
      .select("*")
      .eq("id", trimmed)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    return { ...mapLedgerRow(row), eventResponse: asObject(row.event_response) };
  } catch {
    return null;
  }
}

export async function getAssignmentLogs(limit = 50): Promise<{ logs: AssignmentLogEntry[]; creditLogs: VendorCreditLogEntry[] }> {
  const rows = await fetchApprovalRows(limit);
  const logs: AssignmentLogEntry[] = rows.map((row) => {
    const status = asText(row.status) ?? "preview_approved";
    return {
      id: String(row.id ?? ""),
      createdAt: asText(row.created_at),
      leadName: asText(asObject(row.lead_snapshot).name) ?? asText(row.lead_id),
      status,
      statusLabel: statusLabel(status),
      n8nWebhookCalled: row.n8n_webhook_called === true,
      approvedBy: asText(row.approved_by),
      approvalSource: asText(row.approval_source) ?? "admin_preview",
    };
  });

  const creditLogs = await fetchPreviewCreditLogs(limit);
  return { logs, creditLogs };
}

async function fetchPreviewCreditLogs(limit: number): Promise<VendorCreditLogEntry[]> {
  // Read-only context: only preview-related credit log rows (never a deduction).
  try {
    const { data, error } = await adminClient()
      .from("vendor_credit_logs")
      .select("id, vendor_id, change_type, credits_before, credits_delta, credits_after, reason, updated_by, created_at")
      .eq("change_type", "preview_test")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !Array.isArray(data)) return [];
    return (data as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id ?? ""),
      vendorId: String(row.vendor_id ?? ""),
      changeType: asText(row.change_type) ?? "preview_test",
      creditsBefore: asNumber(row.credits_before),
      creditsDelta: asNumber(row.credits_delta),
      creditsAfter: asNumber(row.credits_after),
      reason: asText(row.reason),
      updatedBy: asText(row.updated_by),
      createdAt: asText(row.created_at),
    }));
  } catch {
    return [];
  }
}

// ----------------------------------------------------------------------------
// Mapping
// ----------------------------------------------------------------------------
function mapLedgerRow(row: Record<string, unknown>): AssignmentLedgerEntry {
  const leadSnapshot = asObject(row.lead_snapshot);
  const vendors = asVendorSnapshots(row.vendor_snapshot);
  const status = asText(row.status) ?? "preview_approved";
  const n8nWebhookCalled = row.n8n_webhook_called === true;
  const failureReason = asText(row.failure_reason);
  const aosEventEmitted = row.aos_event_emitted === true;
  const selectedVendorIds = asStringArray(row.selected_vendor_ids);

  return {
    id: String(row.id ?? ""),
    leadId: asText(row.lead_id) ?? "",
    leadName: asText(leadSnapshot.name),
    leadCity: asText(leadSnapshot.city),
    leadCategory: asText(leadSnapshot.category),
    leadBudget: asText(leadSnapshot.budget),
    selectedVendorIds,
    selectedVendorCount: asNumber(row.selected_vendor_count) || selectedVendorIds.length,
    selectedVendorNames: vendors.map((vendor) => vendor.businessName).filter((name): name is string => Boolean(name)),
    vendors,
    status,
    statusLabel: statusLabel(status),
    mode: asText(row.mode) ?? "preview",
    aosEventEmitted,
    n8nWebhookCalled,
    n8nLabel: n8nWebhookCalled ? "n8n preview called" : "safe mock mode",
    approvedBy: asText(row.approved_by),
    approvalSource: asText(row.approval_source) ?? "admin_preview",
    approvalNote: asText(row.approval_note),
    failureReason,
    isFailed: status === "cancelled" || Boolean(failureReason) || !aosEventEmitted,
    sideEffects: mapSideEffects(row.side_effects, n8nWebhookCalled),
    createdAt: asText(row.created_at),
    updatedAt: asText(row.updated_at),
  };
}

function statusLabel(status: string): string {
  switch (status) {
    case "preview_sent_to_aos":
      return "Sent to AOS Preview";
    case "preview_approved":
      return "Preview saved";
    case "cancelled":
      return "Cancelled";
    case "draft":
      return "Draft";
    default:
      return status;
  }
}

function mapSideEffects(value: unknown, n8nWebhookCalled: boolean): LedgerSideEffects {
  // The preview contract hard-disables all real side effects. We surface the
  // stored values but they are always false except n8nWebhookCalled.
  const record = asObject(value);
  return {
    whatsappSent: record.whatsappSent === true,
    vendorNotified: record.vendorNotified === true,
    creditsDeducted: record.creditsDeducted === true,
    leadAutoAssigned: record.leadAutoAssigned === true,
    n8nWebhookCalled: record.n8nWebhookCalled === true || n8nWebhookCalled,
  };
}

function asVendorSnapshots(value: unknown): LedgerVendorSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = asObject(item);
      const id = asText(record.id);
      if (!id) return null;
      return {
        id,
        businessName: asText(record.businessName),
        city: asText(record.city),
        packageStatus: asText(record.packageStatus) ?? "none",
        credits: asNumber(record.credits),
        paidStatus: asText(record.paidStatus),
      } satisfies LedgerVendorSnapshot;
    })
    .filter((item): item is LedgerVendorSnapshot => item !== null);
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}
