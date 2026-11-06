import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {
 assessVendorOtpRequestUi,isVendorOtpEntryValid,sanitizeVendorOtpInput,
 validateVendorPrivateEvidenceSelection,confirmedPrivateEvidencePendingAck,
 MAX_VENDOR_EVIDENCE_BYTES
} from "../../../lib/vendors/vendorSignupUi.ts";
const root=resolve(import.meta.dirname,"../../..");
const src=p=>readFileSync(resolve(root,p),"utf8");

test("P2U1 OTP UI accepts only provider-unconfirmed 202 initiation, never claims delivery",()=>{
 const good=assessVendorOtpRequestUi(202,{
  ok:true,code:"OTP_REQUEST_INITIATED",deliveryConfirmed:false
 });
 assert.equal(good.accepted,true);
 assert.match(good.notice,/delivery has not been confirmed/i);
 for(const [status,payload] of [
  [200,{ok:true,code:"OTP_REQUEST_INITIATED",deliveryConfirmed:false}],
  [202,{ok:true,code:"OTP_REQUEST_INITIATED",deliveryConfirmed:true}],
  [202,{ok:true,code:"OTP_REQUEST_INITIATED"}],
  [202,{ok:true,code:"OTP_REQUEST_INITIATED",deliveryConfirmed:false,role:"admin"}],
  [202,{ok:true,code:"OTHER",deliveryConfirmed:false}],
  [202,null],
  [503,{ok:true}],
 ]){
  assert.equal(assessVendorOtpRequestUi(status,payload).accepted,false);
 }
 assert.match(assessVendorOtpRequestUi(503,null).notice,/not yet available/);
});
test("P2U2 OTP entry strips non-ASCII digits and bounds length before request",()=>{
 assert.equal(sanitizeVendorOtpInput(" 12 34-56 78 abc9"),"12345678");
 assert.equal(sanitizeVendorOtpInput("1e2+3.4"),"1234");
 assert.equal(isVendorOtpEntryValid("123456"),true);
 assert.equal(isVendorOtpEntryValid("12345678"),true);
 for(const value of ["12345","123456789","12a345","000000000","１２３４５６",""]){
  assert.equal(isVendorOtpEntryValid(value),false);
 }
});
test("P2U3 document client hint enforces size and three MIME types",()=>{
 for(const type of ["application/pdf","image/png","image/jpeg"]){
  assert.equal(validateVendorPrivateEvidenceSelection({size:8,type}).ok,true);
  assert.equal(validateVendorPrivateEvidenceSelection({size:MAX_VENDOR_EVIDENCE_BYTES,type}).ok,true);
 }
 for(const f of [null,{size:7,type:"application/pdf"},
  {size:MAX_VENDOR_EVIDENCE_BYTES+1,type:"image/jpeg"},
  {size:100,type:"image/svg+xml"},
  {size:100,type:"application/octet-stream"}]){
  assert.equal(validateVendorPrivateEvidenceSelection(f).ok,false);
 }
});
test("P2U4 private evidence success requires exact pending/approval-false contract",()=>{
 const payload={ok:true,status:"pending_scan_and_owner_review",
  approved:false,publicDocumentUrl:null,vendorBusinessStatusUnchanged:true};
 assert.equal(confirmedPrivateEvidencePendingAck(202,payload),true);
 for(const alternative of [
  [200,payload],[202,{...payload,approved:true}],
  [202,{...payload,publicDocumentUrl:"https://example.org/public"}],
  [202,{...payload,vendorBusinessStatusUnchanged:false}],
  [202,{ok:true,status:"approved"}],[202,null]
 ])assert.equal(confirmedPrivateEvidencePendingAck(...alternative),false);
});
test("P2U5 active vendor wizard consumes the fail-closed OTP response and never assumes WhatsApp delivery",()=>{
 const code=src("components/VendorRegisterForm.tsx");
 assert.match(code,/assessVendorOtpRequestUi\(response\.status,payload\)/);
 assert.match(code,/setOtpRequested\(true\)/);
 assert.match(code,/setOtpNotice\(outcome\.notice\)/);
 assert.match(code,/sanitizeVendorOtpInput\(event\.target\.value\)/);
 assert.match(code,/isVendorOtpEntryValid\(otp\)/);
 assert.match(code,/aria-live="polite"/);
 assert.match(code,/VendorPrivateEvidenceForm vendorId=\{enrolledVendorId\}/);
 assert.doesNotMatch(code,/sendSms\(|admin\.createUser\(|sendMessage\(/);
});
test("P2U6 file form resets file on category changes, demands explicit identity and no public link",()=>{
 const code=src("components/vendor/VendorPrivateEvidenceForm.tsx");
 assert.match(code,/useState<IdentityMethod\|""|useState<IdentityMethod\s*\|\s*""/);
 assert.match(code,/confirmedPrivateEvidencePendingAck\(response\.status,payload\)/);
 assert.match(code,/validateVendorPrivateEvidenceSelection\(file\)/);
 assert.match(code,/fileInput\.current\.value=""/);
 assert.match(code,/Do not upload Aadhaar or PAN card images/);
 assert.match(code,/Document received privately and marked pending/);
 assert.doesNotMatch(code,/getPublicUrl\(|createSignedUrl\(|fetch\("https:/);
});
