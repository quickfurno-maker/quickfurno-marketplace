"use client";

import { adminModerateVendorReview } from "@/app/actions";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DataTable,
  EmptyState,
  NoteBar,
  SecondaryButton,
  SectionCard,
  StatusBadge,
} from "../AdminPrimitives";
import { Pagination } from "../Pagination";
import {
  formatDate,
  formatNumber,
} from "../adminUtils";
import { AosAutomationControl } from "../AosAutomationControl";
import { AutomationStudio } from "../AutomationStudio";
import { Strong } from "./shared";


/**
 * C-PERF1 (P0-H): truthful AOS readiness page.
 *
 * The previous AOS Control Center rendered a fully fabricated operations
 * surface: sample entity ids, invented run counts, success rates, average
 * confidence, response times, sample memories, cost logs and approvals. None
 * of that data exists anywhere in QuickFurno, so none of it is rendered any
 * more. This page states exactly what is real:
 * AOS V2 is advisory intelligence only. Its real runtime state is shown below,
 * while all execution authority remains in QuickFurno Core and the native automation worker.
 */
export function AosReadinessPage({ notify }: { notify: (message: string, tone?: "success" | "error" | "info") => void }) {
  return (
    <div className="space-y-4">
      <NoteBar>
        AOS V2 is advisory intelligence. It can observe canonical Core facts and persist recommendations, but it cannot authorize messaging, assignment, credits or automation execution.
      </NoteBar>

      <SectionCard
        title="What is real today"
        description="Live AOS V2 advisory runtime and architecture boundary. Execution remains owned by QuickFurno Core and the native worker."
      >
        <AosAutomationControl notify={notify} />
      </SectionCard>

    </div>
  );
}

export function AutomationsPage({ notify: _notify }: { notify: (message: string, tone?: "success" | "error" | "info") => void }) {
  return <AutomationStudio />;
}

/**
 * CMS scope list.
 *
 * Each of these eight blocks used to render a title input, a content textarea
 * and a Save button. None of the fields was bound to state or to any record,
 * and Save only fired a "<section> save placeholder ready." toast — so an
 * operator could type a full homepage rewrite, press Save, see a success
 * message, and lose everything. That is worse than having no editor at all.
 */
export function WebsiteContentPage() {
  const sections = ["Hero Content", "CTA Buttons", "Featured Categories", "Featured Cities", "Testimonials", "FAQs", "Contact Info", "SEO Settings"];
  return (
    <div className="space-y-4">
      <NoteBar tone="warning">
        No content editor is connected. There is no CMS table behind this page, so nothing typed here could be saved.
        Website copy is currently changed in code and deployed.
      </NoteBar>
      <SectionCard title="Planned content blocks" description="Scope only — editing is not available.">
        <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {sections.map((section) => (
            <li key={section} className="flex items-center justify-between gap-2 text-[13px] text-slate-700">
              <span className="min-w-0 truncate">{section}</span>
              <StatusBadge value="Not built" tone="slate" />
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}

export function ReviewsPage({
  data,
  ask,
  runAction,
}: {
  data: any;
  ask: (title: string, message: string, action: () => Promise<{ ok: boolean; error?: string }>) => void;
  runAction: (title: string, action: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const result = data?.result ?? { rows: [], page: 1, pageSize: 20, total: 0 };
  const counts = data?.counts ?? { pending: 0, approved: 0, rejected: 0, hidden: 0 };
  const vendorNames = new Map<string, string>(
    (data?.vendors ?? []).map((vendor: any) => [String(vendor.id), String(vendor.business_name ?? "Vendor")]),
  );
  const currentStatus = searchParams.get("status") || "all";

  function setStatus(status: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (status === "all") next.delete("status");
    else next.set("status", status);
    next.delete("page");
    router.replace(`${pathname}${next.size ? `?${next.toString()}` : ""}`, { scroll: false });
  }

  if (data?.unavailable) {
    return <EmptyState title="Review system not available" message="The vendor_reviews migration has not been applied in this environment yet." />;
  }

  return (
    <div className="space-y-4">
      <NoteBar>
        Reviews are verified against a real QuickFurno lead assignment. Only approved reviews are public and only approved rows affect vendor rating/count.
      </NoteBar>

      <div className="flex flex-wrap gap-2">
        {[
          ["all", "All", result.total],
          ["pending", "Pending", counts.pending],
          ["approved", "Approved", counts.approved],
          ["rejected", "Rejected", counts.rejected],
          ["hidden", "Hidden", counts.hidden],
        ].map(([key, label, count]) => (
          <button
            key={String(key)}
            type="button"
            onClick={() => setStatus(String(key))}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${currentStatus === key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"}`}
          >
            {String(label)} ({formatNumber(Number(count))})
          </button>
        ))}
      </div>

      <DataTable
        rows={result.rows}
        getRowKey={(row: any) => row.id}
        emptyTitle="No reviews found"
        emptyMessage="Verified client reviews will appear here after submission."
        columns={[
          { header: "Vendor", cell: (row: any) => vendorNames.get(String(row.vendor_id)) ?? "Vendor" },
          { header: "Client", cell: (row: any) => <Strong title={row.reviewer_display_name || "QuickFurno client"} subtitle={[row.category, row.city].filter(Boolean).join(" · ")} /> },
          { header: "Rating", cell: (row: any) => <span className="whitespace-nowrap font-semibold">{Number(row.rating).toFixed(0)} ★</span> },
          { header: "Review", cell: (row: any) => <span className="block max-w-[420px] text-xs text-slate-700">{row.review_text}</span> },
          { header: "Status", cell: (row: any) => <StatusBadge value={row.status} /> },
          { header: "Submitted", cell: (row: any) => formatDate(row.created_at) },
          {
            header: "Action",
            cell: (row: any) => (
              <div className="flex flex-wrap gap-1.5">
                {row.status !== "approved" ? (
                  <SecondaryButton onClick={() => ask("Approve review", "Publish this verified review and include it in the public rating?", () => adminModerateVendorReview(row.id, "approved"))} size="sm">
                    Approve
                  </SecondaryButton>
                ) : null}
                {row.status !== "rejected" ? (
                  <SecondaryButton onClick={() => ask("Reject review", "Reject this review? It will not be public or affect rating.", () => adminModerateVendorReview(row.id, "rejected"))} size="sm">
                    Reject
                  </SecondaryButton>
                ) : null}
                {row.status === "approved" ? (
                  <SecondaryButton onClick={() => runAction("Hide review", () => adminModerateVendorReview(row.id, "hidden"))} size="sm">
                    Hide
                  </SecondaryButton>
                ) : null}
                {(row.status === "rejected" || row.status === "hidden") ? (
                  <SecondaryButton onClick={() => runAction("Return review to pending", () => adminModerateVendorReview(row.id, "pending"))} size="sm">
                    Pending
                  </SecondaryButton>
                ) : null}
              </div>
            ),
          },
        ]}
      />
      <UrlPagination result={result} noun="reviews" />
    </div>
  );
}

/**
 * C-PERF2: derived alerts over bounded reads (≤10 recent leads + ≤10
 * low-credit vendors). No notifications table exists, so a paged "directory"
 * here would be fabricated — the note says exactly what this is.
 */
export function NotificationsPage({ data }: { data: { recentLeads: Array<{ id: string; name?: string | null; created_at?: string | null }>; lowCreditVendors: Array<{ id: string; business_name?: string | null; remaining_credits?: number | null; created_at?: string | null }> } | null }) {
  const notifications = [
    ...(data?.recentLeads ?? []).map((lead) => ({ id: `lead-${lead.id}`, title: "New lead", message: `${lead.name || "Client"} submitted a requirement`, type: "New lead", priority: "High", date: lead.created_at })),
    ...(data?.lowCreditVendors ?? []).map((vendor) => ({ id: `vendor-${vendor.id}`, title: "Low balance vendor", message: `${vendor.business_name || "Vendor"} has low lead balance`, type: "Low balance vendor", priority: "Medium", date: vendor.created_at })),
  ].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  return (
    <div className="space-y-3">
      <NoteBar>
        Derived alerts from live data (latest {formatNumber((data?.recentLeads ?? []).length)} leads and{" "}
        {formatNumber((data?.lowCreditVendors ?? []).length)} low-credit vendors). No notification persistence or
        read-state exists yet, so nothing here is markable.
      </NoteBar>
      <DataTable
        rows={notifications}
        getRowKey={(row) => row.id}
        emptyTitle="No notifications"
        emptyMessage="Admin alerts will appear here when notification persistence is connected."
        columns={[
          { header: "Title", cell: (row) => <Strong title={row.title} subtitle={row.message} /> },
          { header: "Type", cell: (row) => row.type },
          { header: "Priority", cell: (row) => <StatusBadge value={row.priority} /> },
          { header: "Date", cell: (row) => formatDate(row.date) },
        ]}
      />
    </div>
  );
}

/** C-PERF2: server-paged admin profiles (narrow fields only — no auth secrets). */
export function AdminUsersPage({ data }: { data: { result: { rows: Array<{ id: string; created_at?: string | null; full_name?: string | null; is_active?: boolean | null }>; page: number; pageSize: number; total: number } } | null }) {
  const result = data?.result ?? { rows: [], page: 1, pageSize: 20, total: 0 };
  return (
    <div className="space-y-3">
      <DataTable
        rows={result.rows}
        getRowKey={(profile) => profile.id}
        emptyTitle="No admin users found"
        emptyMessage="Supabase Auth users with admin profiles will appear here."
        columns={[
          { header: "Name", cell: (profile) => <Strong title={profile.full_name || "Admin user"} subtitle={profile.id} /> },
          { header: "Email", cell: () => "Managed in Supabase Auth" },
          { header: "Role", cell: () => <StatusBadge value="Superadmin" /> },
          { header: "Status", cell: (profile) => <StatusBadge value={profile.is_active === false ? "Disabled" : "Active"} /> },
          { header: "Last Login", cell: () => "Auth dashboard" },
          { header: "Created", cell: (profile) => formatDate(profile.created_at) },
        ]}
      />
      <UrlPagination result={result} noun="admin users" />
    </div>
  );
}

/** C-PERF2: real bounded audit-log viewer (20/page, thin summary rows). */
export function AuditLogsPage({ data }: { data: { result: { rows: Array<{ id: string; created_at?: string | null; action?: string | null; entity_type?: string | null; entity_id?: string | null }>; page: number; pageSize: number; total: number }; unavailable?: boolean } | null }) {
  const result = data?.result ?? { rows: [], page: 1, pageSize: 20, total: 0 };
  if (data?.unavailable) {
    return (
      <EmptyState
        title="Audit log table not available"
        message="The audit_logs table is not present in this environment yet. Rows will appear here once it exists."
      />
    );
  }
  return (
    <div className="space-y-3">
      <DataTable
        rows={result.rows}
        density="compact"
        getRowKey={(row) => row.id}
        emptyTitle="No audit log rows"
        emptyMessage="Sensitive admin actions are recorded here as they happen."
        columns={[
          { header: "When", cell: (row) => <span className="whitespace-nowrap text-[11px] text-slate-500">{formatDate(row.created_at)}</span> },
          { header: "Action", cell: (row) => <StatusBadge value={row.action || "unknown"} tone="slate" /> },
          { header: "Entity", cell: (row) => <Strong title={row.entity_type || "—"} subtitle={row.entity_id || ""} /> },
        ]}
      />
      <UrlPagination result={result} noun="audit log rows" />
    </div>
  );
}

/** Shared URL-driven pager for simple ?page= sections. */
function UrlPagination({ result, noun }: { result: { page: number; pageSize: number; total: number }; noun: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <Pagination
      page={result.page}
      pageSize={result.pageSize}
      total={result.total}
      noun={noun}
      onPageChange={(page) => {
        const next = new URLSearchParams(searchParams.toString());
        if (page <= 1) next.delete("page");
        else next.set("page", String(page));
        router.replace(`${pathname}${next.size ? `?${next.toString()}` : ""}`, { scroll: false });
      }}
    />
  );
}
