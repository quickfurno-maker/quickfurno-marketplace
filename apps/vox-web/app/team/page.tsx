import Link from "next/link";
import {fetchStaffOverview,fetchAdminStaffCapabilityCatalog} from "../../lib/core";
import {TeamBoard,type TeamPreview} from "./TeamBoard";
import "./team.css";

export const dynamic="force-dynamic";

function id(value:unknown):string {
 if(typeof value!=="string"||!/^[0-9a-f-]{36}$/i.test(value))return "—";
 return "#"+value.slice(0,8);
}
function state(value:unknown):string{
 return typeof value==="string"&&/^[a-zA-Z0-9 _-]{1,32}$/.test(value)?value:"UNKNOWN";
}
function project(kind:TeamPreview["kind"],values:readonly unknown[],key:string,status:string):TeamPreview[]{
 return values.slice(0,8).map((value)=>{
  const v=value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
  return {kind,reference:id(v[key]),state:state(v[status])};
 });
}
/**
 * TO-01: deliberately small, Core-authorized preview, NOT a work queue.
 * All executable queue/chat/team/report actions remain disabled.
 */
export default async function TeamOperations(){
 if(process.env.VOX_TEAM_WORKSPACE_ENABLED!=="staging"||
    process.env.VOX_STAFF_PORTAL_ENABLED!=="staging")
  return <main className="teamLocked"><section className="teamLockCard">
   <p className="teamEyebrow">VOX / TEAM OPERATIONS</p>
   <h1>Team workspace is not enabled</h1>
   <p>Private staff capabilities remain locked until Core permissions, MFA, migrations and staging certification pass.</p>
   <Link href="/login">Staff sign-in</Link>
  </section></main>;

 const response=await fetchStaffOverview();
 if(!response.ok)return <main className="teamLocked"><section className="teamLockCard">
  <p className="teamEyebrow">VOX / ACCESS VALIDATION</p>
  <h1>Team workspace unavailable</h1>
  <p>{response.status===401?"Verified staff sign-in and MFA are required.":"Core permission or a certified staging connection is unavailable."}</p>
  <Link href="/login">Return to sign-in</Link>
 </section></main>;

 const view=response.view;
 const rows:TeamPreview[]=[
  ...project("Acquisition",view.prospectPreview,"prospectId","stage"),
  ...project("Vendor",view.vendorCrmPreview,"vendorId","onboarding"),
  ...project("Support",view.supportPreview,"threadId","status"),
  ...project("Human desk",view.humanDeskPreview,"conversationId","state")
 ].slice(0,32);
 const adminSetup=await fetchAdminStaffCapabilityCatalog();
 return <TeamBoard rows={rows} adminStaffSetupAvailable={adminSetup.ok}/>;
}
