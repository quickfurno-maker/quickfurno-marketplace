import { redirect } from "next/navigation";
import { getAdminSession } from "@/app/actions";
import { OwnerVendorVerificationDashboard } from "@/components/vox/OwnerVendorVerificationDashboard";

export const dynamic="force-dynamic";
export const metadata={title:"Owner Vendor Verification | QuickFurno"};

/**
 * Owner-only host for the reusable VOX review panel. The admin cookie controls
 * this page only; it is NEVER accepted as authority by the private Core API.
 * Each private read/decision independently requires an MFA AAL2 bearer.
 */
export default async function OwnerVendorVerificationPage(){
 const admin=await getAdminSession();
 if(!admin.isLoggedIn||!admin.isSuperadmin)redirect("/admin/login?error=unauthorized");
 return (
  <main className="mx-auto max-w-5xl space-y-4 px-4 py-8">
   <div>
    <h1 className="text-2xl font-bold">Owner vendor verification</h1>
    <p className="mt-1 text-sm text-slate-600">
     Private Core verification review. A live Owner MFA session is required for every case read and decision.
    </p>
   </div>
   <OwnerVendorVerificationDashboard />
  </main>
 );
}
