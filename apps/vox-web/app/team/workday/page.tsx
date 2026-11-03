import Link from "next/link";
import {fetchCurrentStaffTime} from "../../../lib/staffTime";
import {fetchStaffWorkQueuePreview} from "../../../lib/core";
import {StaffSignInLink} from "../../components/StaffSignInLink";
import WorkdayControls from "./WorkdayControls";
import TaskHistory from "./TaskHistory";
import {fetchMyTaskIntervals} from "../../../lib/staffTimeHistory";
import "./workday.css";
export const dynamic="force-dynamic";
export default async function StaffWorkday(){
 const [shift,work,history]=await Promise.all([
  fetchCurrentStaffTime(),fetchStaffWorkQueuePreview(),fetchMyTaskIntervals()
 ]);
 const workIds=work.ok?work.items.filter(x=>x.assignedToMe&&
   x.state==="IN_PROGRESS").map(x=>x.workItemId):[];
 return <main className="voxWorkday">
  <nav className="voxWorkdayNav" aria-label="Breadcrumb">
   <Link href="/team">Team Operations</Link><span aria-hidden="true">/</span>
   <span>Workday</span>
  </nav>
  <header className="voxWorkdayHero">
   <p className="voxWorkdayEyebrow">QuickFurno · Verified Staff workspace</p>
   <h1>My Workday</h1>
   <p>One accurate place for clock-in, breaks and task timing. Only records
    from your authenticated Core Staff ledger are shown. No webcam monitoring,
    activity scoring, simulated counters or location tracking.</p>
  </header>
  {!shift.ok?<section className="voxWorkdayCard" role="status">
   <h2>Attendance and task timing are locked</h2>
   <p>{shift.statusCode===401?"Sign in with your existing verified Staff MFA.":
     shift.statusCode===403?"Current Core Staff permissions no longer allow this shift.":
     "The managed Core time ledger and Workday UI are not independently certified for Staging."}</p>
   <StaffSignInLink status={shift.statusCode} returnTo="/team/workday"/>
   <Link href="/team/work-queue">Review permitted work</Link>
  </section>:<>
   <WorkdayControls snapshot={shift} assignedWorkIds={workIds}/>
   <TaskHistory history={history}/>
   {!work.ok?<section className="voxWorkdayCard" role="status">
    <h2>Task selection unavailable</h2>
    <p>The verified Core work queue is not available, so no new task timers
     can be started from this view. Attendance controls do not invent work.</p>
   </section>:null}
  </>}
  <footer className="voxWorkdayFine">Source of truth: Core PostgreSQL.
   All time commands are protected by current Staff authorization, original nonce
   and server-side revision. Official EOD and payroll remain separate.</footer>
 </main>;
}
