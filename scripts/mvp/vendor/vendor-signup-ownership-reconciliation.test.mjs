import test from "node:test";
import assert from "node:assert/strict";
import { reconcileVerifiedVendorOwnership } from "../../../lib/vendors/vendorSignupOwnershipReconciliation.ts";

const U = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const V = "10000000-0000-4000-8000-000000000001";
const V2 = "10000000-0000-4000-8000-000000000002";
const PHONE = "9876543210";
const proof = (overrides = {}) => ({
  authUserId: U, authPhoneE164: "+91" + PHONE,
  submittedMobile: PHONE, phoneConfirmedAt: "2026-11-04T12:00:00.000Z",
  serverOtpAdmission: "admitted", existingClientAccount: false,
  existingProfileRole: "vendor", existingVendorLink: null, ...overrides,
});
const vendor = (overrides = {}) => ({ id: V, user_id: U, phone: PHONE, ...overrides });
const member = (overrides = {}) => ({vendor_id: V, user_id: U, role: "owner", status: "active", ...overrides});
const empty = () => ({ vendorsByAuthUser: [], vendorsByMobile: [], dashboardByAuthUser: [] });
const existing = () => ({ vendorsByAuthUser: [vendor()], vendorsByMobile: [vendor()], dashboardByAuthUser: [member()] });
const linked = (overrides = {}) => proof({existingVendorLink: {vendorId: V, authUserId: U, phone: PHONE}, ...overrides});

test("O1 fresh verified signup creates exactly one Pending *decision* but no mutation", () => {
  assert.deepEqual(reconcileVerifiedVendorOwnership(proof(), empty()), {kind:"create_pending",authUserId:U,mobile10:PHONE});
});
test("O2 matching existing links result in resume, never a second create", () => {
  assert.deepEqual(reconcileVerifiedVendorOwnership(linked(),existing()), {kind:"resume_existing",vendorId:V});
});
test("O3 missing dashboard membership is Owner repair only, never auto-adopted", () => {
  const s=existing();s.dashboardByAuthUser=[];
  assert.deepEqual(reconcileVerifiedVendorOwnership(linked(),s), {kind:"owner_repair_required",vendorId:V,reason:"missing_membership"});
});
test("O4 inactive dashboard membership is not reactivated by retries", () => {
  const s=existing();s.dashboardByAuthUser=[member({status:"suspended"})];
  assert.deepEqual(reconcileVerifiedVendorOwnership(linked(),s), {kind:"owner_repair_required",vendorId:V,reason:"inactive_membership"});
});
test("O5 foreign-owned or ownerless phone cannot be stolen", () => {
  for(const uid of [OTHER,null]) {
    const s=empty();s.vendorsByMobile=[vendor({user_id:uid})];
    assert.deepEqual(reconcileVerifiedVendorOwnership(proof(),s),{kind:"deny",reason:"phone_owned_elsewhere"});
  }
});
test("O6 stale signup decision cannot ignore a newly created vendor or membership", () => {
  const snapshots=[
    {...empty(),vendorsByAuthUser:[vendor()],vendorsByMobile:[vendor()]},
    {...empty(),dashboardByAuthUser:[member()]},
  ];
  for(const s of snapshots) assert.equal(reconcileVerifiedVendorOwnership(proof(),s).kind,"deny");
});
test("O7 incomplete/failed lookups fail closed (never treated as empty)", () => {
  for(const field of ["vendorsByAuthUser","vendorsByMobile","dashboardByAuthUser"]){
    assert.deepEqual(reconcileVerifiedVendorOwnership(proof(),{...empty(),[field]:null}),{kind:"deny",reason:"lookup_unavailable"});
  }
});
test("O8 duplicate vendors or mappings fail closed regardless of ordering", () => {
  for(const field of ["vendorsByAuthUser","vendorsByMobile","dashboardByAuthUser"]){
    const s=empty();s[field]=field==="dashboardByAuthUser"?[member(),member({vendor_id:V2})]:[vendor(),vendor({id:V2})];
    assert.deepEqual(reconcileVerifiedVendorOwnership(proof(),s),{kind:"deny",reason:"ambiguous_rows"});
  }
});
test("O9 cross-vendor mapping, phone drift or unmapped vendor cannot resume", () => {
  for(const snapshot of [
    {...existing(),dashboardByAuthUser:[member({vendor_id:V2})]},
    {...existing(),vendorsByAuthUser:[vendor({phone:"9999999999"})]},
    {...existing(),vendorsByAuthUser:[]},
  ]) assert.equal(reconcileVerifiedVendorOwnership(linked(),snapshot).kind,"deny");
});
test("O10 client/admin/unknown OTP proof is rejected even with matching database rows", () => {
  for(const p of [
    linked({serverOtpAdmission:null}),
    linked({serverOtpAdmission:"denied"}),
    linked({existingClientAccount:true}),
    linked({existingClientAccount:null}),
    linked({existingProfileRole:"admin"}),
    linked({authPhoneE164:"+919999999999"}),
  ]) assert.deepEqual(reconcileVerifiedVendorOwnership(p,existing()),{kind:"deny",reason:"unverified"});
});
test("O11 membership ownership or role conflict blocks returning signup", () => {
  for(const snapshot of [
    {...existing(),dashboardByAuthUser:[member({user_id:OTHER})]},
    {...existing(),dashboardByAuthUser:[member({role:"admin"})]},
  ]) assert.deepEqual(reconcileVerifiedVendorOwnership(linked(),snapshot),{kind:"deny",reason:"ownership_conflict"});
});
test("O12 verified phone row disagreement is never resolved by selecting first", () => {
  const snapshot=existing();snapshot.vendorsByMobile=[vendor({id:V2})];
  assert.equal(reconcileVerifiedVendorOwnership(linked(),snapshot).kind,"deny");
});
