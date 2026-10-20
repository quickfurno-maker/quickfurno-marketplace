import { redirect } from "next/navigation";
import { getAdminSession } from "@/app/actions";
import { OwnerMfaSetup } from "@/components/admin/OwnerMfaSetup";

export const dynamic = "force-dynamic";
export const metadata = { title: "Owner MFA setup — QuickFurno Staging" };

export default async function OwnerMfaSecurityPage() {
  // Feature switch is strictly server-side. Source review and CI never turn it on.
  if (process.env.VOX_OWNER_MFA_STAGING_ENABLED !== "true" ||
      process.env.VOX_DEPLOYMENT_ENV !== "staging") {
    redirect("/admin/login");
  }
  const owner = await getAdminSession();
  if (!owner.isSuperadmin || !owner.userId) redirect("/admin/login");
  // AAL1 is intentionally allowed here to enroll a genuine second factor;
  // no privileged VOX mutation is accessible from this page.
  return <OwnerMfaSetup expectedOwnerId={owner.userId} />;
}
