// ============================================================================
// QuickFurno — components/admin/sections/vendorLoginActivationCopy.ts
//
// QF-MVP-80.03 — the truthful operator copy for one "Create / repair vendor
// login" outcome.
//
// PURE by design: no React, no imports, no I/O. The previous copy lived inline
// in VendorsSection.tsx, branched on `alreadyActive` alone, and told the
// operator "Nothing was created or changed" while the replay had in fact
// restored the vendor's dashboard access role. Keeping the decision here means
// every state can be EXECUTED in the harness rather than pattern-matched in
// source text.
// ============================================================================

export type VendorLoginActivationSummary = {
  vendorName: string;
  alreadyActive: boolean;
  repaired: boolean;
  profileRoleOutcome: string | null;
  recoveryLink: string | null;
  mappingLinked: boolean;
  mappingCreated: boolean;
  recoveryLinkIssued: boolean;
};

/**
 * QF-MVP-80.03 — the truthful title/body for one activation outcome.
 *
 * Exported so the harness can assert every branch without rendering React. The
 * previous version branched on `alreadyActive` alone and told the operator
 * "Nothing was created or changed" while the replay had in fact restored the
 * dashboard access role — the single most misleading sentence in the console.
 */
export function vendorLoginActivationCopy(result: VendorLoginActivationSummary): {
  title: string;
  body: string;
} {
  const roleRepaired = result.profileRoleOutcome === "ROLE_ASSIGNED";
  const mappingRepaired = result.mappingCreated;
  const linkLine = result.recoveryLinkIssued
    ? " A new single-use sign-in link has been issued. Any earlier sign-in link no longer works."
    : " No new sign-in link could be issued; use the vendor password-reset flow instead.";

  if (!result.alreadyActive) {
    return {
      title: "Vendor login created",
      body:
        "This existing vendor record now owns a sign-in account. Approval, package and credits are unchanged, and no new vendor record was created."
        + linkLine,
    };
  }

  if (result.repaired || roleRepaired || mappingRepaired) {
    const fixed = roleRepaired && mappingRepaired
      ? "dashboard access role and membership record"
      : roleRepaired
        ? "dashboard access role"
        : mappingRepaired
          ? "dashboard membership record"
          : "vendor login state";
    return { title: "Vendor login repaired", body: `Repaired: ${fixed}.` + linkLine };
  }

  return {
    title: "Vendor login already active",
    body: "This vendor already had a working login. Nothing was repaired." + linkLine,
  };
}
