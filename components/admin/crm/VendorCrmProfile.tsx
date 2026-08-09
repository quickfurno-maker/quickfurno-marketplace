"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  crmArchiveContact,
  crmAssignTag,
  crmCancelTask,
  crmCompleteTask,
  crmCreateContact,
  crmCreateNote,
  crmCreateTag,
  crmCreateTask,
  crmRemoveTag,
  crmUpsertProfile,
} from "@/app/actions/vendorCrmActions";
import type { Result } from "@/lib/errors";
import type {
  PagedResult,
  VendorContact,
  VendorCoreFacts,
  VendorCrmProfileRecord,
  VendorCrmProfileSummary,
  VendorCrmProfileTab,
  VendorNote,
  VendorTag,
  VendorTagAssignment,
  VendorTask,
} from "@/lib/crm/vendorCrmProfileTypes";
import type { VendorTaskStatus } from "@/lib/crm/vendorCrmContracts";
import { EmptyState, ProgressBar, StatusBadge, Tabs, Toast } from "../AdminPrimitives";
import {
  ContactsTab,
  CoreContextTab,
  NotesTab,
  OverviewTab,
  TagsTab,
  TasksTab,
  formatDate,
} from "./VendorCrmProfileSections";

const TAB_LABELS: Record<VendorCrmProfileTab, string> = {
  overview: "Overview",
  contacts: "Contacts",
  tags: "Tags",
  notes: "Notes",
  tasks: "Tasks",
  "core-context": "Core Context",
};

const TAB_BY_LABEL = Object.fromEntries(
  Object.entries(TAB_LABELS).map(([key, label]) => [label, key]),
) as Record<string, VendorCrmProfileTab>;

const PAGED_TABS = new Set<VendorCrmProfileTab>(["contacts", "notes", "tasks"]);

export interface VendorCrmProfileProps {
  vendorId: string;
  activeTab: VendorCrmProfileTab;
  taskStatus?: VendorTaskStatus;
  core: VendorCoreFacts | null;
  profile: VendorCrmProfileRecord | null;
  summary: VendorCrmProfileSummary | null;
  contactsPage: PagedResult<VendorContact> | null;
  notesPage: PagedResult<VendorNote> | null;
  tasksPage: PagedResult<VendorTask> | null;
  tagAssignments: VendorTagAssignment[];
  allTags: VendorTag[];
  error: string | null;
}

type Feedback = { tone: "success" | "error"; message: string };

function profileUrl(vendorId: string, tab: VendorCrmProfileTab, page?: number, status?: VendorTaskStatus) {
  const query = new URLSearchParams({ tab });
  if (PAGED_TABS.has(tab)) query.set("page", String(page ?? 1));
  if (tab === "tasks" && status) query.set("status", status);
  return `/admin/vendor-crm/${vendorId}?${query.toString()}`;
}

export function VendorCrmProfile(props: VendorCrmProfileProps) {
  const router = useRouter();
  const [routePending, startRouteTransition] = useTransition();
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  async function runAction<T>(
    key: string,
    operation: () => Promise<Result<T>>,
    successMessage: string,
    next?: { tab: VendorCrmProfileTab; page?: number; status?: VendorTaskStatus },
  ): Promise<boolean> {
    setActionKey(key);
    setFeedback(null);
    try {
      const result = await operation();
      if (!result.ok) {
        setFeedback({ tone: "error", message: result.error || "The CRM action could not be completed. Please retry." });
        return false;
      }
      setFeedback({ tone: "success", message: successMessage });
      if (next) router.push(profileUrl(props.vendorId, next.tab, next.page, next.status));
      router.refresh();
      return true;
    } catch {
      setFeedback({ tone: "error", message: "The CRM action could not be completed. Please retry." });
      return false;
    } finally {
      setActionKey(null);
    }
  }

  function navigate(tab: VendorCrmProfileTab, page?: number, status?: VendorTaskStatus) {
    startRouteTransition(() => router.push(profileUrl(props.vendorId, tab, page, status)));
  }

  if (props.error || !props.core || !props.summary) {
    return (
      <EmptyState
        title="Could not load vendor"
        message={props.error ?? "This vendor's CRM profile could not be loaded. Please retry."}
      />
    );
  }

  const { core, profile, summary } = props;
  const activeLabel = TAB_LABELS[props.activeTab];
  const pending = Boolean(actionKey);

  return (
    <div className="flex flex-col gap-4" aria-busy={routePending || pending}>
      <RecordHeader core={core} profile={profile} />

      <Tabs
        tabs={Object.values(TAB_LABELS)}
        active={activeLabel}
        label="Vendor CRM profile sections"
        onChange={(label) => navigate(TAB_BY_LABEL[label] ?? "overview", 1)}
      />

      <div className={`qfa-profile-enter ${routePending ? "opacity-60" : "opacity-100"}`}>
        {props.activeTab === "overview" ? (
          <OverviewTab
            core={core}
            profile={profile}
            summary={summary}
            tagAssignments={props.tagAssignments}
            pending={actionKey === "profile"}
            onSave={(input) => runAction("profile", () => crmUpsertProfile(props.vendorId, input), "CRM relationship saved.")}
          />
        ) : null}

        {props.activeTab === "contacts" && props.contactsPage ? (
          <ContactsTab
            page={props.contactsPage}
            pendingKey={actionKey}
            onPageChange={(page) => navigate("contacts", page)}
            onCreate={(input) => runAction(
              "contact-create",
              () => crmCreateContact(props.vendorId, input),
              "Contact added.",
              { tab: "contacts", page: 1 },
            )}
            onArchive={(contactId) => runAction(
              `contact-archive-${contactId}`,
              () => crmArchiveContact(props.vendorId, contactId),
              "Contact archived.",
            )}
          />
        ) : null}

        {props.activeTab === "tags" ? (
          <TagsTab
            assignments={props.tagAssignments}
            allTags={props.allTags}
            pendingKey={actionKey}
            onAssign={(tagId) => runAction("tag-assign", () => crmAssignTag(props.vendorId, tagId), "Tag assigned.")}
            onRemove={(tagId) => runAction(`tag-remove-${tagId}`, () => crmRemoveTag(props.vendorId, tagId), "Tag unassigned.")}
            onCreate={(input) => runAction("tag-create", () => crmCreateTag(input), "Tag created.")}
          />
        ) : null}

        {props.activeTab === "notes" && props.notesPage ? (
          <NotesTab
            page={props.notesPage}
            pending={actionKey === "note-create"}
            onPageChange={(page) => navigate("notes", page)}
            onCreate={(input) => runAction(
              "note-create",
              () => crmCreateNote(props.vendorId, input),
              "Note added to the append-only timeline.",
              { tab: "notes", page: 1 },
            )}
          />
        ) : null}

        {props.activeTab === "tasks" && props.tasksPage ? (
          <TasksTab
            page={props.tasksPage}
            status={props.taskStatus}
            summary={summary}
            pendingKey={actionKey}
            onFilterChange={(status) => navigate("tasks", 1, status)}
            onPageChange={(page) => navigate("tasks", page, props.taskStatus)}
            onCreate={(input) => runAction(
              "task-create",
              () => crmCreateTask(props.vendorId, input),
              "Task created.",
              { tab: "tasks", page: 1, status: props.taskStatus },
            )}
            onComplete={(taskId, result) => runAction(
              `task-complete-${taskId}`,
              () => crmCompleteTask(props.vendorId, taskId, result),
              "Task completed.",
            )}
            onCancel={(taskId) => runAction(
              `task-cancel-${taskId}`,
              () => crmCancelTask(props.vendorId, taskId),
              "Task cancelled.",
            )}
          />
        ) : null}

        {props.activeTab === "core-context" ? <CoreContextTab core={core} /> : null}
      </div>

      {feedback ? <Toast message={feedback.message} tone={feedback.tone} /> : null}
    </div>
  );
}
function RecordHeader({ core, profile }: { core: VendorCoreFacts; profile: VendorCrmProfileRecord | null }) {
  const remaining = Number(core.remaining_credits ?? 0);
  const total = Number(core.total_credits ?? 0);
  const creditProgress = total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0;
  const availability = core.accepting_leads === true
    ? "Available for new assignments"
    : "Unavailable for new assignments";
  const enabled = core.is_active === true ? "Active" : core.is_active === false ? "Disabled" : "Not set";

  return (
    <section className="qfa-panel relative overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/70 to-transparent" />
      <div className="flex flex-col gap-5 p-4 sm:p-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-semibold tracking-tight text-slate-950 sm:text-[28px]">
                {core.business_name || "Unnamed vendor"}
              </h2>
              <p className="mt-1 truncate text-[13px] text-slate-500">
                {[core.owner_name, core.city, core.service_categories?.[0]].filter(Boolean).join(" · ") || "Core identity details not set"}
              </p>
            </div>
            <Link
              href="/admin/vendor-crm"
              className="qfa-focus inline-flex h-9 shrink-0 items-center rounded-[var(--qfa-radius)] border border-[color:var(--qfa-line)] bg-white px-3 text-[13px] font-semibold text-slate-700 transition-colors hover:border-[color:var(--qfa-line-strong)] hover:bg-slate-50"
            >
              ← Back to Vendor CRM
            </Link>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <StatusBadge value={core.status ?? "Verification not set"} />
            <StatusBadge value={enabled} tone={core.is_active === false ? "rose" : core.is_active === true ? "emerald" : "slate"} />
            <StatusBadge value={availability} tone={core.accepting_leads === true ? "cyan" : "amber"} />
          </div>
        </div>

        <div className="grid min-w-0 gap-px overflow-hidden rounded-[var(--qfa-radius)] border border-[color:var(--qfa-line)] bg-[color:var(--qfa-line)] sm:grid-cols-2 xl:w-[600px] xl:grid-cols-4">
          <HeaderFact label="Credits">
            <span className="tabular-nums">{remaining} / {total}</span>
            <span className="mt-1.5 block"><ProgressBar value={creditProgress} tone={remaining <= 3 ? "rose" : "emerald"} /></span>
          </HeaderFact>
          <HeaderFact label="Onboarding stage">{profile?.onboarding_stage ?? "Not set"}</HeaderFact>
          <HeaderFact label="Relationship">{profile?.relationship_status ?? "Not set"}</HeaderFact>
          <HeaderFact label="Next follow-up">{formatDate(profile?.next_follow_up_at ?? null, false)}</HeaderFact>
        </div>
      </div>
    </section>
  );
}

function HeaderFact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 bg-[color:var(--qfa-inset)] px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <div className="mt-1 truncate text-[13px] font-semibold capitalize text-slate-900">{children}</div>
    </div>
  );
}
