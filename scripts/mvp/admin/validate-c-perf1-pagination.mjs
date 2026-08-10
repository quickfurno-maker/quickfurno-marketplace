// ============================================================================
// C-PERF1 — Admin pagination foundation harness.
//
// Offline: no database, no network, no provider call. Verifies the LOCKED
// pagination policy (20 primary / 10 embedded / no load-all), the paging
// contract behavior, and the truthfulness containment (no mock AOS surface,
// no placeholder analytics metrics) as static + behavioral checks.
// ============================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  ADMIN_DIRECTORY_PAGE_SIZE,
  ADMIN_EMBEDDED_PANEL_LIMIT,
  boundPage,
  pageRange,
  pageWindow,
  sanitizeSearchTerm,
  sanitizeFilterValue,
} from "../../../lib/adminPaging.ts";

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

// ── 1. Locked policy constants ─────────────────────────────────────────────
check("primary directory page size is locked at 20", ADMIN_DIRECTORY_PAGE_SIZE === 20);
check("embedded panel limit is locked at 10", ADMIN_EMBEDDED_PANEL_LIMIT === 10);

// ── 2. Paging contract behavior ────────────────────────────────────────────
check("boundPage floors invalid input to 1", boundPage("x") === 1 && boundPage(-4) === 1 && boundPage(0) === 1);
check("boundPage keeps valid pages", boundPage(3) === 3 && boundPage("7") === 7);
check("boundPage caps hostile offsets", boundPage(1e9) === 10_000);
check("page 1 range is 0..19", (() => { const r = pageRange(1); return r.from === 0 && r.to === 19; })());
check("page 2 range is 20..39", (() => { const r = pageRange(2); return r.from === 20 && r.to === 39; })());
check("pageWindow reports 1-20 of 257 on page 1", (() => {
  const w = pageWindow(257, 1, 20);
  return w.start === 1 && w.end === 20 && w.pageCount === 13;
})());
check("pageWindow reports 21-40 on page 2", (() => {
  const w = pageWindow(257, 2, 20);
  return w.start === 21 && w.end === 40;
})());
check("pageWindow clamps past-the-end pages", (() => {
  const w = pageWindow(30, 9, 20);
  return w.page === 2 && w.start === 21 && w.end === 30;
})());
check("pageWindow handles empty result sets", (() => {
  const w = pageWindow(0, 1, 20);
  return w.start === 0 && w.end === 0 && w.pageCount === 1;
})());
check("total count is independent of loaded rows (contract shape)", (() => {
  // The DirectoryPage contract carries total separately from rows; the window
  // math never derives the total from rows.length.
  const w = pageWindow(500, 1, 20);
  return w.end === 20 && w.pageCount === 25;
})());

// ── 3. Search sanitization (PostgREST grammar can never be injected) ───────
check("search term strips filter grammar", sanitizeSearchTerm('x,is_active.eq.true') === "x is active eq true");
check("search term strips wildcards and quotes", sanitizeSearchTerm(`a%b_c*"d'e(f)g`) === "a b c d e f g");
check("search term is length-capped", sanitizeSearchTerm("a".repeat(500)).length <= 80);
check("filter value strips quotes/backslashes", sanitizeFilterValue('Pu"ne\\') === "Pune");

// ── 4. Directory service uses the shared bounds ────────────────────────────
const dirService = read("services/adminDirectoryService.ts");
check("directory service imports the locked constants", /ADMIN_DIRECTORY_PAGE_SIZE/.test(dirService) && /ADMIN_EMBEDDED_PANEL_LIMIT/.test(dirService));
check("directory service pages with pageRange, not raw offsets", /pageRange\(/.test(dirService));
check("directory service never uses the legacy 50-row snapshot limit", !/DEFAULT_ADMIN_ROW_LIMIT/.test(dirService));
check("leads/vendors directories order deterministically (created_at + id tiebreak)",
  (dirService.match(/\.order\("created_at", \{ ascending: false \}\)\s*\.order\("id", \{ ascending: true \}\)/g) ?? []).length >= 3);
check("dashboard loader bounds previews to the embedded limit", /limit\(ADMIN_EMBEDDED_PANEL_LIMIT\)/.test(dirService));

// ── 5. No load-all / no page-size selector in admin UI ─────────────────────
const paginationUi = read("components/admin/Pagination.tsx");
check("shared Pagination has no page-size selector", !/pageSize.*select|option/i.test(paginationUi.replace(/aria-[a-z]+/g, "")));
const leadsUi = read("components/admin/sections/LeadsDirectory.tsx");
const vendorsUi = read("components/admin/sections/VendorsSection.tsx");
const inboxUi = read("components/admin/crm/lead/LeadCrmInbox.tsx");
for (const [label, src] of [["LeadsDirectory", leadsUi], ["VendorsSection", vendorsUi], ["LeadCrmInbox", inboxUi]]) {
  check(`${label} never requests a custom page size`, !/pageSize:\s*(?!20)\d+/.test(src));
  // A page-size CONTROL would render 50/100/All as select options or pass a
  // page-size list — prose comments do not count.
  check(`${label} offers no 50/100/All page-size option`, !/option[^>]*>\s*(50|100|All)\s*</.test(src) && !/pageSizeOptions|rowsPerPage/i.test(src));
}

// ── 6. Existing paged directories normalized to 20 ─────────────────────────
check("vendor CRM directory default page size is 20", /CRM_DIRECTORY_DEFAULT_PAGE_SIZE = 20/.test(read("lib/crm/vendorCrmValidation.ts")));
check("vendor segments list default page size is 20", /LIST_DEFAULT_PAGE_SIZE = 20/.test(read("services/vendorSegmentService.ts")));
check("vendor campaigns list default page size is 20", /LIST_DEFAULT_PAGE_SIZE = 20/.test(read("services/vendorCampaignService.ts")));
// The preview FALLBACK default stays 25 (byte-pinned by the frozen 30-3c
// harness; it only applies to malformed input) — what matters is that every
// admin preview caller explicitly requests 20.
check("segment editor preview requests 20", /pageSize: 20/.test(read("components/admin/crm/segments/VendorSegmentEditor.tsx")));
check("campaign audience preview requests 20", /pageSize: 20/.test(read("services/vendorCampaignService.ts")));

// ── 7. Route wiring: directories use bounded loaders ───────────────────────
const sectionRoute = read("app/admin/[section]/page.tsx");
check("leads route uses the server-paged loader", /adminLeadsDirectory/.test(sectionRoute));
check("vendors route uses the server-paged loader", /adminVendorsDirectory/.test(sectionRoute));
const dashboardRoute = read("app/admin/dashboard/page.tsx");
check("dashboard route uses the dashboard-specific loader", /adminCommandCenterData/.test(dashboardRoute) && !/adminSnapshot/.test(dashboardRoute));

// ── 8. Truthfulness containment (P0-H) ─────────────────────────────────────
const sectionPage = read("components/admin/AdminSectionPage.tsx");
check("mock AOS Control Center is not rendered by any admin section", !/AOSControlCenter/.test(sectionPage));
const analytics = read("components/admin/AnalyticsDashboard.tsx");
for (const marker of ["cost_placeholder", "cpl_placeholder", "spend_placeholder", "conversion_placeholder", "response_rate_placeholder", "revenue_estimate", "avg_confidence", "success_rate", "AOS Agent Analytics", "Campaign Analytics"]) {
  check(`analytics no longer renders "${marker}"`, !analytics.includes(marker));
}
// The one adapter field kept is a REAL stored value (remaining_credits) that
// was merely misnamed by the adapter; it must be labelled truthfully.
check("credits column is truthfully labelled", /Credits remaining/.test(analytics));
const activeAdminSources = [sectionPage, analytics, leadsUi, vendorsUi, inboxUi, read("components/AdminDashboard.tsx")].join("\n");
check("no mock entity ids in active admin surfaces", !/lead_mock_|report_mock_|vendor_mock_|message_mock_/.test(activeAdminSources));

// ── 9. Search reaches beyond page 1 by construction ────────────────────────
// Server-side search is applied BEFORE range() in the directory service; the
// harness asserts the order of operations in source.
check("filters are applied before the page range (leads)", (() => {
  const fn = dirService.slice(dirService.indexOf("getAdminLeadsDirectory"));
  return fn.indexOf("applyLeadFilters") < fn.indexOf(".range(");
})());
check("filters are applied before the page range (vendors)", (() => {
  const fn = dirService.slice(dirService.indexOf("getAdminVendorsDirectory"));
  return fn.indexOf("applyVendorFilters") < fn.indexOf(".range(");
})());
check("filters are applied before the page range (crm inbox)", (() => {
  const fn = dirService.slice(dirService.indexOf("getCrmInboxPage"));
  return fn.indexOf("applyCrmInboxFilters") < fn.indexOf(".range(");
})());

// ── 10. Filter changes reset paging in the URL/state layer ─────────────────
check("LeadsDirectory resets page on filter change", /page:\s*null/.test(leadsUi));
check("VendorsSection resets page on filter change", /page:\s*null/.test(vendorsUi));
check("LeadCrmInbox resets page on filter change", /setPage\(1\)/.test(inboxUi));

console.log(`\nchecks: ${passed} passed, ${failed} failed (of ${passed + failed})`);
console.log("offline: no database, no network, no provider call");
console.log(`RESULT: ${failed === 0 ? "PASS" : "FAIL"}`);
process.exit(failed === 0 ? 0 : 1);
