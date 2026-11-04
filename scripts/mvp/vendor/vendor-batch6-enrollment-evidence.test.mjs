import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=p=>readFileSync(p,"utf8");
const request=src("app/api/vendor/onboarding/request-otp/route.ts");
const complete=src("app/api/vendor/onboarding/complete/route.ts");
const upload=src("app/api/vendor/private-evidence/route.ts");
const wizard=src("components/VendorRegisterForm.tsx");
const owner=src("components/vox/OwnerVendorVerificationDashboard.tsx");
const privateUi=src("components/vendor/VendorPrivateEvidenceForm.tsx");
const sql=src("supabase/migrations/20261104163000_vendor_private_document_intake.sql");
const strip=s=>s.replace(/\/\*[\s\S]*?\*\//g," ").replace(/^\s*\/\/.*$/gm,"");

test("B6 01 vendor OTP can be initiated only after THREE independent Staging gates",()=>{
 for(const flag of [
 "QF_VENDOR_OTP_REQUEST_MODE",
 "QF_VENDOR_SHARED_SIGNED_HOOK_CERTIFIED",
 "QF_VENDOR_WHATSAPP_PROVIDER_CERTIFIED"
 ])assert.ok(request.includes(flag),flag);
 assert.match(request,/coordinateVendorOtpRequest\(phone,/);
 assert.match(request,/reserveAuthOtpPurpose\(value,purpose\)/);
 assert.match(request,/allowPublicMutation\(/);
 assert.match(request,/\.auth\.signInWithOtp\(/);
 assert.match(request,/shouldCreateUser:true/);
 assert.doesNotMatch(strip(request),/channel:"sms"|\.sendSms\(|\.sendMessage\(|\.auth\.admin\.createUser/);
 assert.match(request,/sameOrigin\(request\)/);
});
test("B6 02 post-OTP completion is bound to private evidence and atomic Pending authority",()=>{
 for(const flag of [
 "QF_VENDOR_ATOMIC_SIGNUP_MODE","QF_VENDOR_OTP_VERIFY_MODE",
 "QF_VENDOR_OTP_EVIDENCE_READ_ENABLED",
 "QF_VENDOR_WHATSAPP_PROVIDER_CERTIFIED",
 "QF_VENDOR_SHARED_SIGNED_HOOK_CERTIFIED"
 ]) assert.ok(complete.includes(flag),flag);
 assert.match(complete,/enrollPendingVendorAfterWhatsappOtp\(/);
 assert.match(complete,/raw\.phone!==body\.mobile/);
 assert.match(complete,/hasVendorRegistrationConsent\(/);
 assert.match(complete,/isValidOptionalGstin\(/);
 assert.match(complete,/status:"Pending"/);
 assert.match(complete,/isActive:false,acceptingLeads:false,creditsGranted:false/);
 assert.doesNotMatch(strip(complete),/auth\.admin\.|\.insert\(|\.update\(|\.delete\(/);
});
test("B6 03 active wizard has no new password signup and email is optional",()=>{
 assert.doesNotMatch(wizard,/submitVendorAccountRegistration|f\.password|confirmPassword|fieldKey: "password"|type: "password"/);
 assert.match(wizard,/!emailStr \|\| isEmail\(emailStr\)/);
 assert.match(wizard,/label: "Business email \(optional\)"/);
 assert.match(wizard,/\/api\/vendor\/onboarding\/request-otp/);
 assert.match(wizard,/\/api\/vendor\/onboarding\/complete/);
 assert.match(wizard,/Send WhatsApp verification code/);
 assert.match(wizard,/Verify WhatsApp & Submit/);
 assert.match(wizard,/VendorPrivateEvidenceForm vendorId=\{enrolledVendorId\}/);
 assert.match(wizard,/registration_consent_accepted: f\.registrationConsent/);
 assert.match(wizard,/GooglePlaceAutocomplete/);
 assert.match(wizard,/isValidOptionalGstin/);
});
test("B6 04 Owner panel requires signed AAL2 bearer, exact caseVersion and no raw docs",()=>{
 assert.match(owner,/createBrowserClient/);
 assert.match(owner,/Authorization:`Bearer \$\{bearer\}`/);
 assert.match(owner,/caseVersion:caseData\.caseVersion/);
 assert.match(owner,/qf\.vox|vendor-verification-case/);
 assert.match(owner,/canViewPrivateDocuments|No private documents/);
 assert.doesNotMatch(strip(owner),/NEXT_PUBLIC_SERVICE_ROLE_KEY|\.storage\.|sessionStorage|localStorage/);
 const page=src("app/admin/vendor-verification/page.tsx");
 assert.match(page,/getAdminSession\(/);
 assert.match(page,/!admin\.isLoggedIn\|\|!admin\.isSuperadmin/);
});
test("B6 05 private proof route is opt-in and never includes Aadhaar/PAN scans",()=>{
 assert.match(upload,/QF_VENDOR_PRIVATE_EVIDENCE_MODE==="staging"/);
 assert.match(upload,/QF_VENDOR_PRIVATE_BUCKET_CERTIFIED==="staging"/);
 assert.match(upload,/qf-vendor-verification-private/);
 assert.match(upload,/await sb\.auth\.getUser\(\)/);
 assert.match(upload,/file\.size>MAX_SIZE/);
 assert.match(upload,/Buffer\.from\(await file\.arrayBuffer\(\)\)/);
 assert.match(upload,/qf_vendor_begin_private_verification_case/);
 assert.match(upload,/qf_vendor_attach_private_evidence/);
 assert.match(upload,/scan_status|pending_scan_and_owner_review/);
 assert.match(upload,/upsert:false/);
 assert.doesNotMatch(strip(upload),/\.getPublicUrl\(|\.createSignedUrl\(|\.createSignedUploadUrl\(|\.from\("vendors"\)\.update/);
});
test("B6 06 no front-end Aadhaar card, no PAN file, opt-in consent",()=>{
 assert.match(privateUi,/consent/);
 assert.match(privateUi,/office_proof/);
 assert.match(privateUi,/category_proof/);
 assert.match(privateUi,/Do not upload Aadhaar or PAN card images/);
 assert.doesNotMatch(privateUi,/input.*aadhaar_number|input.*pan_number/i);
});
test("B6 07 DB case is owner-only, idempotent and does not auto-approve",()=>{
 assert.match(sql,/qf_vendor_begin_private_verification_case/);
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/v\.status='Pending'/);
 assert.match(sql,/m\.role='owner' and m\.status='active'/);
 assert.match(sql,/p\.role='vendor'/);
 assert.match(sql,/u\.phone_confirmed_at is not null/);
 assert.match(sql,/consent\.revoked_at is null/);
 assert.match(sql,/insert into qf_vendor_private\.verification_cases/);
 assert.match(sql,/insert into qf_vendor_private\.verification_consents/);
 assert.match(sql,/return v_case_id/);
});
test("B6 08 evidence is private pending, guarded against rogue paths and foreign owners",()=>{
 assert.match(sql,/p_evidence_type not in \('office_proof','category_proof'\)/);
 assert.match(sql,/p_storage_key !~ /);
 assert.match(sql,/c\.case_version=\(select max\(n\.case_version\)/);
 assert.match(sql,/scan_status,evidence_state,uploaded_by/);
 assert.match(sql,/'pending','pending',p_auth_user_id/);
 assert.doesNotMatch(sql,/update public\.vendors|insert into public\.lead_assignments/);
});
test("B6 09 no public access to private case or evidence RPCs",()=>{
 assert.match(sql,/revoke all on function public\.qf_vendor_begin_private_verification_case\(uuid,uuid,text,text\)/);
 assert.match(sql,/revoke all on function public\.qf_vendor_attach_private_evidence\(uuid,uuid,uuid,text,text,text\)/);
 assert.match(sql,/grant execute on function public\.qf_vendor_attach_private_evidence\(uuid,uuid,uuid,text,text,text\)\s+to service_role/);
});
