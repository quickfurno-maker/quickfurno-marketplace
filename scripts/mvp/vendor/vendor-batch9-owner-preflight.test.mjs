import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const src=path=>readFileSync(path,"utf8");
const api=src("app/api/vox/v1/owner-vendor-verification-case/route.ts");
const panel=src("components/vox/OwnerVendorVerificationDashboard.tsx");
const before=src("ops/vendor/vendor-before-migration-readonly-preflight-20261105.sql");
const after=src("ops/vendor/vendor-launch-readonly-preflight-20261104.sql");
const stripComments=s=>s.replace(/\/\*[\s\S]*?\*\//g," ").replace(/^\s*--.*$/gm," ").replace(/^\s*\/\/.*$/gm," ");

test("B9-01 Owner case mutation is AAL2 + bounded actual streamed JSON bytes",()=>{
 assert.match(api,/VOX_OWNER_VENDOR_CASE_REVIEW_ENABLED === "staging"/);
 assert.match(api,/verifyVoxOwnerBearer\(request\.headers\.get\("authorization"\)\)/);
 assert.match(api,/MAX_REVIEW_BODY_BYTES = 2048/);
 assert.match(api,/rawLength !== null/);
 assert.match(api,/Number\(rawLength\) > MAX_REVIEW_BODY_BYTES/);
 assert.match(api,/request\.body\?\.getReader\(\)/);
 assert.match(api,/size \+= value\.byteLength/);
 assert.match(api,/if \(size > MAX_REVIEW_BODY_BYTES\)/);
 assert.match(api,/reader\.cancel\(\)/);
 assert.match(api,/reader\.releaseLock\(\)/);
 assert.match(api,/const raw: unknown = await readBoundedOwnerJson\(request\)/);
 assert.doesNotMatch(stripComments(api),/await request\.json\(\)/);
});

test("B9-02 Owner mutations check cross-origin, reject oversized headers and revalidate MFA",()=>{
 assert.match(api,/new URL\(origin\)\.origin !== new URL\(request\.url\)\.origin/);
 assert.match(api,/code:"ORIGIN_MISMATCH"/);
 assert.match(api,/code:"OWNER_REVIEW_TOO_LARGE"/);
 assert.match(api,/headerLength!==null/);
 assert.match(api,/p_reviewer_user_id:owner/);
 assert.match(api,/OWNER_SESSION_REVOKED/);
 assert.match(api,/private, no-store, max-age=0/);
 assert.doesNotMatch(stripComments(api),/\.storage\.from\(|getPublicUrl|\.insert\(|\.update\(/);
});

test("B9-03 Owner UI warns before approval without all independently verified evidence",()=>{
 assert.match(panel,/const approvalEvidenceReady=caseData\?\.casePresent===true/);
 for(const field of ["contactStatus","identityStatus","officeStatus","categoryStatus","zoneStatus"])
  assert.ok(panel.includes(`caseData.${field}==="verified"`),field);
 for(const field of ["consentValid","identityEvidenceVerified","officeEvidenceVerified"])
  assert.ok(panel.includes(`caseData.${field}===true`),field);
 assert.match(panel,/if\(action==="approve"&&!approvalEvidenceReady\)/);
 assert.match(panel,/disabled=\{item\.action==="approve"&&!approvalEvidenceReady\}/);
 assert.match(panel,/disabled=\{busy\|\|!REASON\.test\(reason\)\|\|\(action==="approve"&&!approvalEvidenceReady\)\}/);
 assert.match(panel,/A malware scan alone does not verify a document/);
 assert.match(panel,/request documents, request corrections, or reject/i);
 assert.doesNotMatch(panel,/canActivateLeads:true|automaticVendorApproval|\.storage\.from\(/);
});

test("B9-04 before-migration SQL needs only preexisting Core tables and never writes",()=>{
 const plain=stripComments(before);
 assert.match(plain,/begin transaction isolation level repeatable read read only/);
 assert.match(plain,/set local statement_timeout='20s'/);
 assert.match(plain,/rollback;/);
 for(const table of ["public.vendors","public.vendor_dashboard_users","public.client_accounts","public.lead_assignments"])
  assert.ok(plain.includes(table),table);
 for(const marker of [
  "duplicate_canonical_vendor_phone_groups",
  "legacy_active_or_lead_eligible_vendors",
  "pending_vendors_with_live_flags",
  "historical_assignment_vendor_population",
  "active_vendor_owner_membership_mismatches",
  "vendor_and_client_shared_auth_principals"
 ])assert.ok(plain.includes(marker),marker);
 assert.doesNotMatch(plain,/\b(?:from|join)\s+qf_vendor_private\./i);
 assert.doesNotMatch(plain,/\b(?:insert|update|delete|truncate|alter|drop|create|grant|revoke)\s+(?:into|from|table|view|function|schema|policy|on|role)\b/i);
 assert.doesNotMatch(plain,/select\s+\*\s+from\s+public\.vendors/i);
});

test("B9-05 post-migration review explicitly requires private receipt tables",()=>{
 assert.match(after,/POST-MIGRATION/);
 assert.match(after,/vendor-before-migration-readonly-preflight-20261105\.sql/);
 assert.match(after,/qf_vendor_private\.verification_scan_receipts/);
 assert.match(after,/clean_office_category_without_scan_receipt/);
 assert.match(after,/infected_receipt_not_quarantined/);
 assert.match(after,/private_queue_browser_execute/);
 assert.match(after,/scanner_rpc_browser_execute/);
 assert.match(after,/rollback;/);
});
