// VOX-00 pure scope-enforcement contract. The gateway MUST supply authenticated,
// signed, fresh staff claims from Core. Never populate principal from request JSON.
export const STAFF_ROLES = Object.freeze([
  "owner_admin", "operations_manager", "acquisition_agent",
  "vendor_success_agent", "support_agent", "auditor",
]);
export const ACTIONS = Object.freeze([
  "acquisition.read", "vendor.read", "inbox.read", "cases.read",
  "cases.manage", "automation.read", "automation.propose",
  "approvals.review", "finance.read",
]);
const ROLE_ACTIONS = Object.freeze({
  owner_admin: ACTIONS,
  operations_manager: ["acquisition.read","vendor.read","inbox.read","cases.read","cases.manage","automation.read","automation.propose","approvals.review"],
  acquisition_agent: ["acquisition.read","cases.read","cases.manage"],
  vendor_success_agent: ["vendor.read","inbox.read","cases.read","cases.manage"],
  support_agent: ["inbox.read","cases.read","cases.manage"],
  auditor: ["acquisition.read","vendor.read","cases.read","automation.read"],
});
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_SCOPE = /^[a-z0-9][a-z0-9-_]{0,63}$/;
export function authorizeStaff(principal, request, now=Date.now()) {
  const deny=(reason)=>Object.freeze({allowed:false,reason});
  if (!principal || principal.verifiedByCore !== true || principal.isActive !== true ||
      !ID.test(String(principal.staffId ?? "")) || !STAFF_ROLES.includes(principal.role)) return deny("UNVERIFIED_STAFF");
  if (!Number.isFinite(principal.expiresAtMs) || principal.expiresAtMs <= now ||
      principal.expiresAtMs > now + 60*60*1000) return deny("EXPIRED_OR_EXCESSIVE_LEASE");
  if (!request || !ACTIONS.includes(request.action)) return deny("UNREGISTERED_ACTION");
  if (request.action === "finance.approve" || request.action === "automation.publish" ||
      request.action === "approval.execute" || request.action === "whatsapp.send") return deny("CORE_APPROVAL_REQUIRED");
  if (!ROLE_ACTIONS[principal.role].includes(request.action)) return deny("ROLE_DENIED");
  const global = principal.role === "owner_admin";
  if (!global) {
    if (!SAFE_SCOPE.test(String(request.cityId ?? "")) ||
        !Array.isArray(principal.cityIds) || !principal.cityIds.includes(request.cityId)) return deny("CITY_SCOPE_DENIED");
    if (request.vendorId &&
        (!ID.test(request.vendorId) || !Array.isArray(principal.vendorIds) || !principal.vendorIds.includes(request.vendorId)) &&
        principal.role !== "operations_manager") return deny("VENDOR_SCOPE_DENIED");
    if (request.prospectId &&
        (!ID.test(request.prospectId) || !Array.isArray(principal.prospectIds) || !principal.prospectIds.includes(request.prospectId)) &&
        principal.role !== "operations_manager") return deny("PROSPECT_SCOPE_DENIED");
  }
  if ((request.vendorId && !ID.test(request.vendorId)) ||
      (request.prospectId && !ID.test(request.prospectId))) return deny("INVALID_RESOURCE_ID");
  if (request.action === "approvals.review" && principal.role !== "owner_admin" &&
      principal.role !== "operations_manager") return deny("REVIEW_ROLE_REQUIRED");
  return Object.freeze({allowed:true,reason:"AUTHORIZED_SCOPED_READ_OR_REQUEST"});
}
