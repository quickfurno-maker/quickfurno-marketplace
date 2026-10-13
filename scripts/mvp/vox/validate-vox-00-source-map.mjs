// VOX-00 read-only source-map smoke test. No network, credentials or DB writes.
// This validates the architectural reuse anchors; it does not certify runtime behavior.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const ROOT = resolve(import.meta.dirname, "../../..");
const REQUIRED_ANCHORS = Object.freeze([
  ["Aarohi CRM pipeline", "app/admin/aarohi/pipeline/page.tsx", "listAarohiProspects"],
  ["Aarohi conversations", "app/admin/aarohi/conversations/page.tsx", "listAarohiConversations"],
  ["Aarohi attention queue", "app/admin/aarohi/inbox/page.tsx", "not a provider message inbox"],
  ["Aarohi scoped layout", "app/admin/aarohi/layout.tsx", "hasAarohiPermission"],
  ["Aarohi CRM service", "services/aarohiCrmService.ts", "aarohi_prospects"],
  ["Vendor CRM directory", "app/admin/vendor-crm/page.tsx", "isSuperadmin"],
  ["Vendor CRM data authority", "services/vendorCrmService.ts", "vendor_internal_notes"],
  ["Vendor admin panel", "components/admin/crm/VendorCrmDirectory.tsx", "VendorCrmDirectory"],
  ["Core governed WhatsApp desk", "app/admin/whatsapp/human-desk/page.tsx", "humanWhatsAppReplyFromForm"],
  ["WhatsApp read service", "services/whatsAppHumanDeskService.ts", "communication_conversations"],
  ["Core Automation Studio", "components/admin/AutomationStudio.tsx", "vendor_journey"],
  ["Automation Studio API", "app/api/admin/automation-studio/route.ts", "requireSuperadmin"],
  ["Automation Studio definitions", "lib/automation/studioContract.ts", "locked_core"],
  ["Profile request executor", "services/vendorProfileChangeService.ts", "vendor_profile_change_requests"],
  ["Vendor approval inbox", "app/admin/vendor-approvals/page.tsx", "isSuperadmin"],
  ["Vendor support UI", "app/vendor/dashboard/support/page.tsx", "VendorSupport"],
]);
let passed = 0;
for (const [label, relative, needle] of REQUIRED_ANCHORS) {
  const target = resolve(ROOT, relative);
  assert.ok(existsSync(target), `Missing source path for ${label}: ${relative}`);
  const source = readFileSync(target, "utf8");
  assert.ok(source.toLowerCase().includes(needle.toLowerCase()), `Architecture anchor drift: ${label} no longer contains ${needle}`);
  console.log(`PASS: ${label}`);
  passed += 1;
}
const audit = readFileSync(resolve(ROOT, "docs/vox/VOX-00-REUSE-AUDIT.md"), "utf8");
for (const required of ["SOURCE AUDIT", "STAGING", "Superadmin", "Core", "Jarvis", "Native Core Worker", "G0 acceptance"]) {
  assert.ok(audit.includes(required), `Missing VOX-00 audit boundary: ${required}`);
}
console.log(`VOX_00_REUSE_ANCHORS_PASS ${passed}/${REQUIRED_ANCHORS.length}`);
