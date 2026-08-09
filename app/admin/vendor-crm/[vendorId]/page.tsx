import { notFound, redirect } from "next/navigation";
import { getAdminSession } from "@/app/actions";
import { VendorCrmProfile } from "@/components/admin/crm/VendorCrmProfile";
import { ADMIN_EMBEDDED_PANEL_LIMIT } from "@/lib/adminPaging";
import { VENDOR_TASK_STATUSES, type VendorTaskStatus } from "@/lib/crm/vendorCrmContracts";
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
import {
  getVendorCrmProfileSummary,
  listVendorContactsPage,
  listVendorNotesPage,
  listVendorTasksPage,
} from "@/services/vendorCrmProfileReadService";
import {
  getVendorCoreFacts,
  getVendorCrmProfile,
  listVendorTagAssignments,
  listVendorTags,
} from "@/services/vendorCrmService";

export const dynamic = "force-dynamic";

const CRM_PROFILE_LOAD_ERROR =
  "This vendor's CRM profile could not be loaded. Please retry — if this persists, contact engineering.";

const PROFILE_TABS: readonly VendorCrmProfileTab[] = [
  "overview",
  "contacts",
  "tags",
  "notes",
  "tasks",
  "core-context",
];

function logCrmRouteFailure(scope: string, error: unknown) {
  const safe = error as { name?: string; code?: string } | null;
  console.error("[crm-route] load failed", {
    scope,
    name: safe?.name ?? "Error",
    code: safe?.code ?? "UNKNOWN",
  });
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseTab(raw: unknown): VendorCrmProfileTab {
  return typeof raw === "string" && (PROFILE_TABS as readonly string[]).includes(raw)
    ? raw as VendorCrmProfileTab
    : "overview";
}

function parseTaskStatus(raw: unknown): VendorTaskStatus | undefined {
  return typeof raw === "string" && (VENDOR_TASK_STATUSES as readonly string[]).includes(raw)
    ? raw as VendorTaskStatus
    : undefined;
}

export default async function VendorCrmProfilePage({
  params,
  searchParams,
}: {
  params: { vendorId: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await getAdminSession();
  if (!session.isLoggedIn) redirect("/admin/login");
  if (!session.isSuperadmin) redirect("/admin/login?error=unauthorized");

  const vendorId = params.vendorId;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(vendorId)) notFound();

  const activeTab = parseTab(first(searchParams?.tab));
  const page = first(searchParams?.page);
  const taskStatus = parseTaskStatus(first(searchParams?.status));

  let core: VendorCoreFacts | null = null;
  let profile: VendorCrmProfileRecord | null = null;
  let summary: VendorCrmProfileSummary | null = null;
  let contactsPage: PagedResult<VendorContact> | null = null;
  let notesPage: PagedResult<VendorNote> | null = null;
  let tasksPage: PagedResult<VendorTask> | null = null;
  let tagAssignments: VendorTagAssignment[] = [];
  let allTags: VendorTag[] = [];
  let error: string | null = null;

  try {
    const baseReads = Promise.all([
      getVendorCoreFacts(vendorId),
      getVendorCrmProfile(vendorId),
      getVendorCrmProfileSummary(vendorId),
    ]);

    let activeTabRead: Promise<void> = Promise.resolve();
    if (activeTab === "overview") {
      activeTabRead = listVendorTagAssignments(vendorId, ADMIN_EMBEDDED_PANEL_LIMIT).then((rows) => {
        tagAssignments = rows;
      });
    } else if (activeTab === "contacts") {
      activeTabRead = listVendorContactsPage(vendorId, { page }).then((result) => {
        contactsPage = result;
      });
    } else if (activeTab === "tags") {
      activeTabRead = Promise.all([listVendorTagAssignments(vendorId), listVendorTags()]).then(([assignments, tags]) => {
        tagAssignments = assignments;
        allTags = tags;
      });
    } else if (activeTab === "notes") {
      activeTabRead = listVendorNotesPage(vendorId, { page }).then((result) => {
        notesPage = result;
      });
    } else if (activeTab === "tasks") {
      activeTabRead = listVendorTasksPage(vendorId, { page, status: taskStatus }).then((result) => {
        tasksPage = result;
      });
    }

    const [[loadedCore, loadedProfile, loadedSummary]] = await Promise.all([baseReads, activeTabRead]);
    core = loadedCore;
    profile = loadedProfile;
    summary = loadedSummary;
  } catch (caught) {
    logCrmRouteFailure(`vendor-crm/profile/${activeTab}`, caught);
    error = CRM_PROFILE_LOAD_ERROR;
  }

  if (!error && !core) notFound();

  return (
    <VendorCrmProfile
      vendorId={vendorId}
      activeTab={activeTab}
      taskStatus={taskStatus}
      core={core}
      profile={profile}
      summary={summary}
      contactsPage={contactsPage}
      notesPage={notesPage}
      tasksPage={tasksPage}
      tagAssignments={tagAssignments}
      allTags={allTags}
      error={error}
    />
  );
}
