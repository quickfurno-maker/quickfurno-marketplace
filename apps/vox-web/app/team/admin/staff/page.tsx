import Link from "next/link";
import {fetchAdminStaffCapabilityCatalog,fetchAdminStaffDirectory} from "../../../../lib/core";
import {AdminStaffSetup} from "./setup";
import "./staff.css";

export const dynamic="force-dynamic";
export default async function StaffSetupPage(){
 const result=await fetchAdminStaffCapabilityCatalog();
 if(!result.ok)return <main className="staffSetupLocked"><section className="staffSetupCard">
  <p className="staffSetupEyebrow">VOX / ADMIN / STAFF</p>
  <h1>Staff setup not available</h1>
  <p>{result.status===401?"Sign in using your verified MFA session.":
      result.status===403?"This workspace is only for the existing verified Core Superadmin.":
      "The private Admin setup requires separate Core and VOX activation and certification."}</p>
  <Link href="/team">Back to Team Operations</Link>
 </section></main>;
 const directory=await fetchAdminStaffDirectory();
 return <AdminStaffSetup packs={result.capabilities} roster={directory.ok?directory.members:[]} rosterVerified={directory.ok}/>;
}
