/**
 * Owner-only vendor-review feature gate.
 * Historical VOX_STAFF_PORTAL_ENABLED is the shared host/auth master switch,
 * not permission to activate Team Leader / scoped Staff lanes.
 * Those lanes separately require view mode "scoped" or "dual".
 */
type OwnerVendorFlags=Readonly<Record<string,string|undefined>>;

export function ownerVendorReadGate(flags:OwnerVendorFlags):boolean {
 return flags.VOX_STAFF_PORTAL_ENABLED==="staging"&&
  flags.VOX_STAFF_VIEW_MODE==="owner"&&
  flags.VOX_OWNER_VENDOR_REVIEW_ENABLED==="staging";
}
export function ownerVendorDecisionGate(flags:OwnerVendorFlags):boolean {
 return ownerVendorReadGate(flags)&&
  flags.VOX_OWNER_VENDOR_DECISION_ENABLED==="staging";
}
