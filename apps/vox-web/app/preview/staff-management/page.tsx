import {notFound} from "next/navigation";
import {AdminStaffSetup} from "../../team/admin/staff/setup";
import "../../team/admin/staff/staff.css";

export const dynamic = "force-dynamic";

// These are *illustrative UI labels* only, never Core capabilities or user grants.
// No personnel data or Auth/Core requests occur on this development-only route.
const UI_ONLY_RESPONSIBILITIES = [
  {key:"preview-acquisition",label:"Acquisition & follow-ups"},
  {key:"preview-vendor",label:"Vendor Success"},
  {key:"preview-client",label:"Client Success"},
  {key:"preview-support",label:"Service Desk"},
  {key:"preview-team",label:"Team Operations"},
  {key:"preview-intelligence",label:"Read-only Intelligence"},
] as const;

export default function LocalStaffManagementPreview() {
  const isLocalPreview=process.env.NODE_ENV==="development" && process.env.VOX_DEMO_PREVIEW==="local-only";
  if (!isLocalPreview) notFound();
  return <AdminStaffSetup preview packs={UI_ONLY_RESPONSIBILITIES}
    roster={[]} rosterVerified={false} teams={[]} teamsVerified={false}/>;
}
