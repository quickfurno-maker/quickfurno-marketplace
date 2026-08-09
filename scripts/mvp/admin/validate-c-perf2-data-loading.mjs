// ============================================================================
// C-PERF2 — Final admin data-loading cleanup harness.
//
// Offline: no database, no network, no provider call. Locks:
//   * section-first route loading (no broad snapshot on normal Admin V2 routes)
//   * per-section bounded loaders (20/page, ≤10 embedded)
//   * Lead Distribution + CRM active-tab lazy loading
//   * related IN-lookups instead of full-directory fetches
//   * truthfulness containment stays (no mock/placeholder data reintroduced)
//   * dark command-center UI classes preserved
// ============================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ADMIN_DIRECTORY_PAGE_SIZE, ADMIN_EMBEDDED_PANEL_LIMIT } from "../../../lib/adminPaging.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");

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

// ── 1. Policy constants unchanged ──────────────────────────────────────────
check("primary directory page size is still 20", ADMIN_DIRECTORY_PAGE_SIZE === 20);
check("embedded panel limit is still 10", ADMIN_EMBEDDED_PANEL_LIMIT === 10);

// ── 2. Broad snapshot: zero active Admin V2 consumers ──────────────────────
const sectionRoute = read("app/admin/[section]/page.tsx");
const dashboardRoute = read("app/admin/dashboard/page.tsx");
const adminSectionPage = read("components/admin/AdminSectionPage.tsx");
check("generic section route never calls adminSnapshot", !/adminSnapshot/.test(sectionRoute));
check("dashboard route never calls adminSnapshot", !/adminSnapshot/.test(dashboardRoute));
check("AdminSectionPage no longer receives a snapshot", !/snapshot:/.test(adminSectionPage) && /payload/.test(adminSectionPage));
check("generic route resolves the section loader FIRST", /loadSectionPayload\(section\.key/.test(sectionRoute));

// ── 3. Section service uses shared bounds + IN lookups ─────────────────────
const sectionService = read("services/adminSectionService.ts");
check("section service imports the locked constants", /ADMIN_DIRECTORY_PAGE_SIZE/.test(sectionService) && /ADMIN_EMBEDDED_PANEL_LIMIT/.test(sectionService));
check("section service pages with pageRange", /pageRange\(/.test(sectionService));
check("section service never uses the legacy snapshot limits", !/DEFAULT_ADMIN_ROW_LIMIT|LOG_ROW_LIMIT/.test(sectionService));
check("related names resolve via IN(current ids) helpers", /vendorIdentities\(/.test(sectionService) && /leadIdentities\(/.test(sectionService) && /\.in\("id", unique\)/.test(sectionService));
check("no full vendor/lead directory fetch for name resolution", !/from\("vendors"\)\.select\("\*"\)\.order\("created_at", \{ ascending: false \}\)\s*$/m.test(sectionService));

// ── 4. Paged sections ──────────────────────────────────────────────────────
check("Payments is server-paged", /getAdminPaymentsPage/.test(sectionService) && /applyPaymentFilters/.test(sectionService));
check("Subscriptions + order audit are server-paged", /getAdminSubscriptionsPage/.test(sectionService) && /ordersPage/.test(sectionService));
check("Admin Users is server-paged with narrow fields", /getAdminUsersPage/.test(sectionService) && /select\("id, created_at, full_name, role, is_active"\)/.test(sectionService));
check("Audit Logs is server-paged with thin summary rows", /getAdminAuditLogsPage/.test(sectionService) && /select\("id, created_at, action, entity_type, entity_id"\)/.test(sectionService));
check("Admin Users fetches no auth secrets", !/password|encrypted|secret|token/i.test(sectionService.slice(sectionService.indexOf("getAdminUsersPage"), sectionService.indexOf("getAdminAuditLogsPage"))));

// ── 5. Lead Distribution: active-tab lazy loading ──────────────────────────
const distribution = read("components/admin/sections/LeadDistributionSection.tsx");
check("Lead Distribution uses URL ?tab= state", /searchParams\.get\("tab"\)/.test(distribution));
check("Lead Distribution fetches only the active tab", /adminDistributionTab\(loaderKey, page\)/.test(distribution) && /if \(!loaderKey\)/.test(distribution));
check("Lead Distribution queue is paged with the shared pager", /Pagination page=\{queue\.page\}/.test(distribution.replace(/\s+/g, " ")) || /<Pagination page=\{queue\.page\}/.test(distribution.replace(/\s+/g, " ")));
check("Eligibility checker fetches vendors per city (bounded)", /adminVendorsForEligibility\(city\)/.test(distribution));
check("Lead Distribution never receives a Snapshot prop", !/data:\s*Snapshot(?![a-zA-Z])/.test(distribution.split("function AutoMatchingQueuePanel")[0].split("export function LeadDistributionPage")[1] ?? ""));

// ── 6. CRM: active-tab loaders, hidden tabs not fetched ────────────────────
const crm = read("components/admin/CRMDashboard.tsx");
check("CRM receives only base vocabularies, not a snapshot", /base: CrmBaseData \| null/.test(crm) && !/data: Snapshot/.test(crm));
check("CRM fetches per active tab", /adminCrmTabData\(loaderKey, activePage\)/.test(crm));
check("hidden CRM tabs are not eagerly fetched", /if \(!loaderKey\)/.test(crm) && /TAB_LOADER\[active\]/.test(crm));
check("CRM Overview uses live counts", /live count/.test(crm));
check("CRM drawer context + vendor identities load on demand", /adminLeadContext\(selected\.id\)/.test(crm) && /knownVendors/.test(crm));
check("unassigned/assigned counts omit tiles instead of false zeros", /counts\.unassigned === null \? null/.test(crm));

// ── 7. Old-lead vendor resolution (bounded IN, no N+1) ─────────────────────
const dirService = read("services/adminDirectoryService.ts");
check("lead context resolves assignment vendor identities via IN", /lead\.context\.vendors/.test(dirService) && /\.in\("id", vendorIds\)/.test(dirService));

// ── 8. Fail-closed unassigned count preserved ──────────────────────────────
check("leads unassigned count still fails closed (null, never 0)", /return null;/.test(dirService.slice(dirService.indexOf("countUnassignedLeads"), dirService.indexOf("getAdminLeadsDirectory"))));

// ── 9. Truthfulness containment preserved ──────────────────────────────────
const activeSources = [
  sectionRoute, adminSectionPage, crm, distribution,
  read("components/admin/sections/PaymentsSection.tsx"),
  read("components/admin/sections/SubscriptionsSection.tsx"),
  read("components/admin/sections/MiscSections.tsx"),
  read("components/admin/sections/ReportsSection.tsx"),
  read("components/admin/sections/CitiesSection.tsx"),
  read("components/admin/AnalyticsDashboard.tsx"),
].join("\n");
check("no mock entity ids in active admin surfaces", !/lead_mock_|report_mock_|vendor_mock_|message_mock_/.test(activeSources));
check("no placeholder metrics reintroduced", !/cost_placeholder|cpl_placeholder|spend_placeholder|conversion_placeholder|response_rate_placeholder/.test(activeSources));
check("mock AOS Control Center still not rendered", !/AOSControlCenter/.test(adminSectionPage));
check("Reports no longer renders dead Export buttons", !/>Export</.test(read("components/admin/sections/ReportsSection.tsx")));
check("subset counts no longer claim 'Complete lead database'", !/Complete lead database/.test(activeSources) && !/Complete lead database/.test(read("components/admin/ManualLeadAssignmentPanel.tsx")));

// ── 10. Dark UI preserved ──────────────────────────────────────────────────
check("qfa token layer untouched in new sections", /qfa-panel|qfa-quiet|var\(--qfa-/.test(activeSources));
check("shared dark Pagination reused (no second pager built)", /from "\.\.\/Pagination"|from "\.\/Pagination"|from "\.\.\/\.\.\/Pagination"/.test(activeSources + read("components/admin/crm/lead/LeadCrmAssignmentQueue.tsx")));

// ── 11. No page-size selectors / load-all anywhere new ─────────────────────
for (const file of [
  "components/admin/sections/PaymentsSection.tssx".replace(".tssx", ".tsx"),
  "components/admin/sections/SubscriptionsSection.tsx",
  "components/admin/sections/MiscSections.tsx",
  "components/admin/sections/LeadDistributionSection.tsx",
  "components/admin/CRMDashboard.tsx",
]) {
  const src = read(file);
  check(`${file.split("/").pop()} offers no page-size/load-all control`, !/option[^>]*>\s*(50|100|All)\s*</.test(src) && !/pageSizeOptions|rowsPerPage|Load all/i.test(src));
}

console.log(`\nchecks: ${passed} passed, ${failed} failed (of ${passed + failed})`);
console.log("offline: no database, no network, no provider call");
console.log(`RESULT: ${failed === 0 ? "PASS" : "FAIL"}`);
process.exit(failed === 0 ? 0 : 1);
