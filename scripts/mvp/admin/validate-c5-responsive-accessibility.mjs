// ============================================================================
// Admin Dashboard V2 C5 — responsive + accessibility invariant harness.
//
// Offline only: this does not replace authenticated rendered QA. It locks the
// shared semantic/focus/responsive contracts and the C-PERF/C4 architecture so
// later edits cannot quietly undo the C5 corrections.
// ============================================================================
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ADMIN_DIRECTORY_PAGE_SIZE, ADMIN_EMBEDDED_PANEL_LIMIT } from "../../../lib/adminPaging.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const shell = read("components/admin/AdminShell.tsx");
const palette = read("components/admin/AdminCommandPalette.tsx");
const primitives = read("components/admin/AdminPrimitives.tsx");
const modalHook = read("components/admin/useAdminModalFocus.ts");
const pagination = read("components/admin/Pagination.tsx");
const css = read("app/globals.css");
const dashboard = read("components/AdminDashboard.tsx");
const config = read("components/admin/adminConfig.ts");
const crm = read("components/admin/CRMDashboard.tsx");
const distribution = read("components/admin/sections/LeadDistributionSection.tsx");
const analytics = read("components/admin/AnalyticsDashboard.tsx");
const vendorProfile = read("components/admin/crm/VendorCrmProfile.tsx");
const vendorSections = read("components/admin/crm/VendorCrmProfileSections.tsx");
const frequencyRoute = read("app/admin/vendor-crm/frequency-policies/page.tsx");
const packageJson = JSON.parse(read("package.json"));

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

// 1. Dark UI and bounded data architecture remain frozen.
check("dark Admin V2 root remains admin-scoped", /className="admin-surface min-h-screen/.test(shell));
check("dark token remap stays under admin-surface", /\.admin-surface \{[\s\S]*--qfa-page: #07101f/.test(css));
check("mobile dark surface keeps practical 44px control height", /@media \(max-width: 639px\)[\s\S]*\.admin-surface[\s\S]*--qfa-control-h: 44px/.test(css));
check("primary directory page size remains 20", ADMIN_DIRECTORY_PAGE_SIZE === 20);
check("embedded panel limit remains 10", ADMIN_EMBEDDED_PANEL_LIMIT === 10);
check("generic route has no broad snapshot consumer", !/adminSnapshot/.test(read("app/admin/[section]/page.tsx")));
check("dashboard has no broad snapshot consumer", !/adminSnapshot/.test(read("app/admin/dashboard/page.tsx")));
check("CRM active-tab loader remains lazy", /TAB_LOADER\[active\]/.test(crm) && /if \(!loaderKey\)/.test(crm));
check("Lead Distribution active-tab loader remains lazy", /adminDistributionTab\(loaderKey, page\)/.test(distribution) && /if \(!loaderKey\)/.test(distribution));
check("mobile dashboard KPI rail is single-column", /grid grid-cols-1[\s\S]*sm:grid-cols-2[\s\S]*2xl:grid-cols-6/.test(dashboard));

// 2. Shared modal contract + shell/mobile navigation.
for (const token of ["focusableElements", "event.shiftKey", "event.key !== \"Tab\"", "event.key === \"Escape\"", "restoreTo", "lockBodyScroll", "unlockBodyScroll"]) {
  check(`shared modal focus helper contains ${token}`, modalHook.includes(token));
}
check("shared modal scroll lock is nested-safe", /bodyLockCount/.test(modalHook));
check("shared modal trap excludes negative tab order", /element\.tabIndex >= 0/.test(modalHook));
check("mobile sidebar uses the shared modal focus helper", /useAdminModalFocus\(\{ open, containerRef: mobileDialogRef/.test(shell));
check("mobile sidebar is a named modal dialog", /id="admin-mobile-navigation"[\s\S]*role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-labelledby="admin-mobile-navigation-title"/.test(shell));
check("modal background is inert and hidden", /aria-hidden=\{mobileOpen \|\| paletteOpen/.test(shell) && /inert=\{mobileOpen \|\| paletteOpen \? \("" as unknown as boolean\) : undefined\}/.test(shell));
check("mobile sidebar closes on route navigation", /useEffect\(\(\) => \{\s*setMobileOpen\(false\);\s*\}, \[pathname\]\)/.test(shell));
check("mobile sidebar trigger exposes expanded and controls", /aria-expanded=\{mobileOpen\}[\s\S]*aria-controls="admin-mobile-navigation"/.test(shell));
check("collapsed route selection uses longest path match", /filter\(\(section\)[\s\S]*sort\(\(left, right\) => right\.href\.length - left\.href\.length\)/.test(config));
check("desktop collapse control exposes accessible state and name", /aria-expanded=\{!collapsed\}[\s\S]*aria-label=\{collapsed \? "Expand sidebar" : "Collapse sidebar"\}/.test(shell));
check("collapsed navigation retains screen-reader labels", /collapsed \? \([\s\S]*className="sr-only"[\s\S]*section\.label/.test(shell));
check("command shortcut ignores active text controls", /input, textarea, select, \[contenteditable='true'\]/.test(shell));

// 3. Command palette is a contained dialog with a valid listbox model.
check("command palette uses shared focus containment", /useAdminModalFocus\(\{ open, containerRef: dialogRef, initialFocusRef: inputRef/.test(palette));
check("command palette is a named modal", /role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-label="Admin command palette"/.test(palette));
check("command input implements combobox semantics", /role="combobox"[\s\S]*aria-autocomplete="list"[\s\S]*aria-controls="qf-cmdk-results"[\s\S]*aria-activedescendant/.test(palette));
check("command results implement listbox option semantics", /role="listbox"/.test(palette) && /role="option"/.test(palette) && /aria-selected=\{index === active\}/.test(palette));
check("command active result scrolls into view", /scrollIntoView\(\{ block: "nearest" \}\)/.test(palette));
check("command empty result is announced", /role="status"[\s\S]*No admin section matches/.test(palette));
check("command palette has a visible named close control", /aria-label="Close command palette"[\s\S]*qfa-focus/.test(palette));

// 4. Headings, landmarks, tabs, dialogs and menus.
check("AdminShell owns the main landmark", /<main id="admin-main-content"/.test(shell));
check("AdminShell owns one visible h1 pattern", (shell.match(/<h1/g) ?? []).length === 1);
check("frequency policy route no longer duplicates main or h1", !/<main|<h1/.test(frequencyRoute) && /<h2/.test(frequencyRoute));
check("breadcrumb is labelled and current page is identified", /<nav aria-label="Breadcrumb">/.test(shell) && /aria-current="page"/.test(shell));
check("shared tabs implement tablist, tabs and roving tab order", /role="tablist"/.test(primitives) && /role="tab"/.test(primitives) && /aria-selected=\{selected\}/.test(primitives) && /tabIndex=\{selected \? 0 : -1\}/.test(primitives));
check("shared tabs implement arrow, Home and End keys", ["ArrowRight", "ArrowLeft", "Home", "End"].every((key) => primitives.includes(key)));
check("shared tab panel is associated with active tab", /role="tabpanel"[\s\S]*aria-labelledby/.test(primitives));
for (const [name, source, id] of [
  ["Analytics", analytics, "analytics-tabs"],
  ["CRM", crm, "lead-crm-tabs"],
  ["Lead Distribution", distribution, "lead-distribution-tabs"],
  ["Vendor CRM profile", vendorProfile, "vendor-crm-profile-tabs"],
]) check(`${name} tabs own an associated panel`, source.includes(`id="${id}"`) && source.includes(`<TabPanel id="${id}"`));
check("Drawer uses the shared focus helper and modal semantics", /export function Drawer[\s\S]*useAdminModalFocus[\s\S]*role="dialog"[\s\S]*aria-modal="true"/.test(primitives));
check("confirmation uses alertdialog and shared focus helper", /export function ConfirmDialog[\s\S]*useAdminModalFocus[\s\S]*role="alertdialog"/.test(primitives));
check("C4 task completion dialog uses shared focus helper", /function CompletionDialog[\s\S]*useAdminModalFocus[\s\S]*aria-describedby/.test(vendorSections));
check("action menu exposes state and popup type", /aria-haspopup="menu"[\s\S]*aria-expanded=\{open\}/.test(primitives));
check("action menu escapes table clipping through a portal", /createPortal\([\s\S]*className="fixed z-\[80\]/.test(primitives));
check("action menu implements Escape and arrow navigation", /function ActionMenu[\s\S]*Escape/.test(primitives) && /function ActionMenu[\s\S]*ArrowDown[\s\S]*ArrowUp/.test(primitives));

// 5. Forms, focus, tables, pagination and state announcements.
check("C4 required inputs are programmatically required", (vendorSections.match(/\brequired\b/g) ?? []).length >= 5 && /\(required\)/.test(vendorSections));
check("C4 contact fields provide safe autocomplete hints", /autoComplete="name"/.test(vendorSections) && /autoComplete="tel"/.test(vendorSections) && /autoComplete="email"/.test(vendorSections));
check("focus indicator uses outline plus halo", /\.qfa-focus:focus-visible[\s\S]*outline: 2px solid[\s\S]*box-shadow/.test(css));
check("DataTable uses semantic table headers", /<table/.test(primitives) && /<th[\s\S]*scope="col"/.test(primitives));
check("DataTable constrains horizontal overflow", /overflow-x-auto/.test(primitives) && /Scroll horizontally for more columns/.test(primitives));
check("clickable DataTable rows are keyboard operable", /event\.key === "Enter" \|\| event\.key === " "/.test(primitives) && /tabIndex=\{onRowClick \? 0/.test(primitives));
check("selected DataTable rows include non-color text", /Selected row\./.test(primitives));
check("loading state is announced and skeleton is hidden", /role="status" aria-label="Loading admin data"/.test(primitives) && /aria-hidden="true" className="qfa-panel h-24 animate-pulse/.test(primitives));
check("toast uses alert/status live regions", /tone === "error" \? "alert" : "status"/.test(primitives) && /aria-live=\{tone === "error" \? "assertive" : "polite"\}/.test(primitives));
check("pagination identifies current page", /aria-current=\{item === current \? "page"/.test(pagination));
check("pagination Previous and Next have contextual names", /aria-label=\{`Previous page of \$\{noun\}`\}/.test(pagination) && /aria-label=\{`Next page of \$\{noun\}`\}/.test(pagination));
check("pagination exposes true disabled states", /disabled=\{current <= 1 \|\| isPending\}/.test(pagination) && /disabled=\{current >= pageCount \|\| isPending\}/.test(pagination));
check("pagination mobile targets are practical", /h-10 min-w-10/.test(pagination));
check("pagination has no page-size selector or load-all", !/pageSizeOptions|rowsPerPage|Load all|>\s*All\s*</i.test(pagination));

// 6. Motion, contrast and truthfulness.
check("admin reduced-motion rule removes entrance transforms", /prefers-reduced-motion: reduce[\s\S]*\.admin-surface \.qfa-rise[\s\S]*animation: none !important[\s\S]*transform: none !important/.test(css));
check("admin reduced-motion rule removes sidebar transition", /prefers-reduced-motion: reduce[\s\S]*\.admin-surface \.qf-sidebar[\s\S]*transition: none !important/.test(css));

function channel(value) {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function luminance(hex) {
  const raw = hex.replace("#", "");
  const rgb = [0, 2, 4].map((offset) => channel(Number.parseInt(raw.slice(offset, offset + 2), 16)));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
for (const [name, foreground, background, minimum] of [
  ["primary ink / surface", "#f5f8ff", "#0d1a2d", 4.5],
  ["soft ink / surface", "#dbe4f3", "#0d1a2d", 4.5],
  ["muted text / surface", "#a5b4c8", "#0d1a2d", 4.5],
  ["faint text / surface", "#71839d", "#0d1a2d", 4.5],
  ["cyan / surface", "#4fe0ff", "#0d1a2d", 4.5],
  ["success / surface", "#35e6ae", "#0d1a2d", 4.5],
  ["warning / surface", "#ffb454", "#0d1a2d", 4.5],
  ["error / surface", "#ff7a8d", "#0d1a2d", 4.5],
]) {
  const ratio = contrast(foreground, background);
  check(`${name} contrast ${ratio.toFixed(2)}:1 >= ${minimum}:1`, ratio >= minimum);
}
check("status badges always render visible text", /const label = value \|\| "Unknown"[\s\S]*\{label\}/.test(primitives));
check("accepting_leads wording remains exact", vendorSections.includes("Available for new assignments") && vendorSections.includes("Unavailable for new assignments"));
check("no per-lead vendor accept/reject UI", !/(accept|reject|decline)( this)? lead|awaiting lead acceptance/i.test(vendorProfile + vendorSections));
check("no dead click placeholder in active shared UI", !/onClick=\{\(\) => \{\}\}|onClick=\{undefined\}/.test(shell + palette + primitives + crm + distribution + vendorProfile + vendorSections));

// 7. Security, migration and dependency containment.
const browserUi = shell + palette + primitives + dashboard + crm + distribution + analytics + vendorProfile + vendorSections;
check("no browser service-role credential", !/SUPABASE_SERVICE_ROLE_KEY|process\.env\.[A-Z_]*SERVICE_ROLE/.test(browserUi));
// QF-MVP-70.04 RE-PIN: 98 -> 99. This admin phase still adds no migration of its own;
// the new file belongs to QF-MVP-40 (20260814000000_qf_mvp_40_marketing_consent_writer.sql).
// QF-MVP-75.01 RE-PIN: 99 -> 100. This admin phase still adds no migration of its own;
// the new file belongs to QF-MVP-75.01 (20260815000000_qf_mvp_75_01_matchcore_binding_rank_order.sql).
// QF-MVP-75.02 RE-PIN: 100 -> 101. This phase still adds no migration of its own;
// the geo normalization / PostGIS shortlist foundation (20260816000000) is the only
// addition. Exact equality, never loosened.
// QF-MVP-80.03 RE-PIN: 101 -> 102. This phase still adds no migration of its own;
// the audit_logs forward repair (20260817000000) is the only addition. Exact
// equality, never loosened.
check("migration count remains 102", readdirSync(join(root, "supabase", "migrations")).length === 102);
check("C5 added no accessibility/UI dependency", !Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies }).some((name) => /radix|headlessui|framer|focus-trap|axe/i.test(name)));

console.log(`\nchecks: ${passed} passed, ${failed} failed (of ${passed + failed})`);
console.log("offline static harness only: authenticated rendered/keyboard QA remains mandatory");
console.log("offline: no database, no network, no provider call, no auth bypass");
console.log(`RESULT: ${failed === 0 ? "PASS" : "FAIL"}`);
process.exit(failed === 0 ? 0 : 1);
