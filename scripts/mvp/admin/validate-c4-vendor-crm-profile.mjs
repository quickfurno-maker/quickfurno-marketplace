// ============================================================================
// Admin Dashboard V2 C4 — Vendor CRM profile completion harness.
//
// Offline: no database, network, provider, auth, or browser calls. Locks the
// bounded server-read architecture, Core/CRM authority line, real lifecycle
// actions, safe operator errors, exact availability semantics, and dark qfa UI.
// ============================================================================
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ADMIN_DIRECTORY_PAGE_SIZE, ADMIN_EMBEDDED_PANEL_LIMIT } from "../../../lib/adminPaging.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const route = read("app/admin/vendor-crm/[vendorId]/page.tsx");
const shell = read("components/admin/crm/VendorCrmProfile.tsx");
const sections = read("components/admin/crm/VendorCrmProfileSections.tsx");
const foundationService = read("services/vendorCrmService.ts");
const profileReadService = read("services/vendorCrmProfileReadService.ts");
const service = `${foundationService}\n${profileReadService}`;
const actions = read("app/actions/vendorCrmActions.ts");
const types = read("lib/crm/vendorCrmProfileTypes.ts");
const css = read("app/globals.css");
const ui = `${shell}\n${sections}`;

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`   ok    ${name}`);
  } else {
    failed += 1;
    console.log(`   FAIL  ${name}`);
  }
}

// 1. Locked paging policy.
check("primary profile child page size is 20", ADMIN_DIRECTORY_PAGE_SIZE === 20);
check("embedded profile preview maximum is 10", ADMIN_EMBEDDED_PANEL_LIMIT === 10);
check("contacts read is database-paged", /listVendorContactsPage[\s\S]*?\.range\(from, to\)/.test(service));
check("notes read is database-paged", /listVendorNotesPage[\s\S]*?\.range\(from, to\)/.test(service));
check("tasks read is database-paged", /listVendorTasksPage[\s\S]*?\.range\(from, to\)/.test(service));
check("shared Pagination renders contacts, notes and tasks", (sections.match(/<Pagination/g) ?? []).length === 3);
check("no page-size selector or load-all control", !/rowsPerPage|pageSizeOptions|Load all|>\s*(50|100|All)\s*</i.test(ui));

// 2. Initial route and hidden-tab zero-fetch.
check("profile route uses URL tab state", /searchParams[\s\S]*parseTab/.test(route) && /activeTab/.test(route));
check("initial route loads lightweight summary", /getVendorCrmProfileSummary/.test(route));
check("initial route has no legacy eager collection reads", !/listVendorContacts\(|listVendorNotes\(|listVendorTasks\(/.test(route + actions));
check("active tab controls child collection reads", /activeTab === "contacts"[\s\S]*listVendorContactsPage/.test(route)
  && /activeTab === "notes"[\s\S]*listVendorNotesPage/.test(route)
  && /activeTab === "tasks"[\s\S]*listVendorTasksPage/.test(route));
check("Overview tags are bounded to embedded limit", /listVendorTagAssignments\(vendorId, ADMIN_EMBEDDED_PANEL_LIMIT\)/.test(route));
check("summary rows are bounded", /\.limit\(ADMIN_EMBEDDED_PANEL_LIMIT\)/.test(service) && /\.limit\(1\)/.test(service));

// 3. Deterministic order and exact totals.
check("contacts order primary then created then id", /listVendorContactsPage[\s\S]*order\("is_primary"[\s\S]*order\("created_at"[\s\S]*order\("id"/.test(service));
check("notes order created then stable id", /listVendorNotesPage[\s\S]*order\("created_at"[\s\S]*order\("id"/.test(service));
check("tasks use deterministic stable id tie-breaker", /listVendorTasksPage[\s\S]*order\("id"/.test(service));
check("child totals come from exact database counts", (service.match(/count: "exact"/g) ?? []).length >= 7 && /total: count \?\? 0/.test(service));
check("note authors use one current-page IN lookup", /authorIds[\s\S]*\.in\("id", authorIds\)/.test(service));

// 4. accepting_leads exact semantics and read-only authority.
check("available wording is exact", ui.includes("Available for new assignments"));
check("unavailable wording is exact", ui.includes("Unavailable for new assignments"));
check("accepting_leads is read-only", /select\("[^"]*accepting_leads/.test(service)
  && !/update\([^)]*accepting_leads|insert\([^)]*accepting_leads|upsert\([^)]*accepting_leads/.test(service));
check("no per-lead vendor accept/reject UI", !/(accept|reject|decline)( this)? lead|awaiting lead acceptance/i.test(ui));

// 5. Real mutations and lifecycle rules.
for (const action of [
  "crmUpsertProfile", "crmCreateContact", "crmArchiveContact", "crmCreateTag", "crmAssignTag",
  "crmRemoveTag", "crmCreateNote", "crmCreateTask", "crmCompleteTask", "crmCancelTask",
]) check(`${action} remains wired`, shell.includes(action) && actions.includes(`function ${action}`));
check("notes remain append-only", /Append-only history/.test(sections)
  && !/crm(Update|Delete)Note|updateVendorNote|deleteVendorNote/.test(actions + service + ui));
check("contacts archive without hard delete", /archiveVendorContact[\s\S]*update\(\{ is_active: false/.test(service)
  && !/deleteVendorContact|\.delete\(\)[\s\S]*CRM_CONTACTS/.test(service));
check("task completion requires a result", /requireCompletionResult/.test(service) && /Completion result/.test(sections));
check("task cancel preserves lifecycle status", /cancelVendorTask[\s\S]*status: "cancelled"/.test(service));
check("server actor never comes from browser input", /requireCrmAdmin\(\)/.test(actions)
  && !/actor(Id)?:\s*(string|unknown)|created_by|updated_by/.test(ui));

// 6. Authority, types, errors and dark containment.
check("no Core write was added", !/from\("vendors"\)[\s\S]{0,160}\.(update|insert|upsert|delete)\(/.test(service));
check("profile has explicit C4 contracts", [
  "VendorCoreFacts", "VendorCrmProfileRecord", "VendorContact", "VendorTag", "VendorTagAssignment",
  "VendorNote", "VendorTask", "VendorCrmProfileSummary", "PagedResult",
].every((name) => types.includes(` ${name}`)));
check("profile route and components contain no any", !/\bany\b/.test(`${route}\n${shell}\n${sections}\n${types}`));
check("fixed safe route error is rendered", /CRM_PROFILE_LOAD_ERROR/.test(route) && !/caught\.message|error\.message/.test(route + ui));
check("dark qfa profile styling is present", /qfa-panel|var\(--qfa-/.test(ui) && /qfa-profile-enter/.test(css));
check("dark styles remain admin-scoped", /\.admin-surface \.qfa-profile-enter/.test(css));
check("no browser Supabase or service role in profile UI", !/supabaseBrowser|browserClient|service_role|adminClient/.test(ui + route));

// 7. Fake-functionality audit.
for (const marker of [
  "Math.random", "relationship score", "conversion probability", "response rate", "AI score",
  "package renewal", "credit action", "Send message", "Send WhatsApp",
]) check(`no fake marker: ${marker}`, !ui.toLowerCase().includes(marker.toLowerCase()));
check("no dead click placeholder", !/onClick=\{\(\) => \{\}\}|onClick=\{undefined\}/.test(ui));
check("no Activity tab without a real event stream", !/activity:\s*"Activity"|>Activity</.test(shell));

// 8. No migration mutation in the C4 change set (the harness itself is offline).
const migrationFiles = readdirSync(join(root, "supabase", "migrations"));
// QF-MVP-70.04 RE-PIN: 98 -> 99. This admin phase still adds no migration of its own;
// the new file belongs to QF-MVP-40 (20260814000000_qf_mvp_40_marketing_consent_writer.sql).
// QF-MVP-75.01 RE-PIN: 99 -> 100. This admin phase still adds no migration of its own;
// the new file belongs to QF-MVP-75.01 (20260815000000_qf_mvp_75_01_matchcore_binding_rank_order.sql).
// QF-MVP-75.02 RE-PIN: 100 -> 101. This phase still adds no migration of its own;
// the geo normalization / PostGIS shortlist foundation (20260816000000) is the only
// addition. Exact equality, never loosened.
check("migration count remains 101", migrationFiles.length === 101);

console.log(`\nchecks: ${passed} passed, ${failed} failed (of ${passed + failed})`);
console.log("offline: no database, no network, no provider, no auth bypass");
console.log(`RESULT: ${failed === 0 ? "PASS" : "FAIL"}`);
process.exit(failed === 0 ? 0 : 1);
