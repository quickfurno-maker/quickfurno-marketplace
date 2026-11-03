"use client";
import {useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import Link from "next/link";
import type {StaffTimeSnapshot} from "../../../lib/staffTime";
import {readPendingTimeCommand,savePendingTimeCommand,
 clearPendingTimeCommand} from "../../../lib/vo03PendingStaffTime.mjs";
import type {PendingStaffTimeCommand} from "../../../lib/vo03PendingStaffTime.mjs";

const TASK=new Set(["TASK_START","TASK_PAUSE","TASK_RESUME","TASK_STOP","TASK_SWITCH"]);
type Action=PendingStaffTimeCommand["action"];
type Props={snapshot:StaffTimeSnapshot;assignedWorkIds:string[]};
const storage=()=>{try{return window.sessionStorage;}catch{return null;}};
const format=(ms:number)=>{
 const whole=Math.floor(ms/60000);
 return Math.floor(whole/60)+"h "+String(whole%60).padStart(2,"0")+"m";
};
export default function WorkdayControls({snapshot,assignedWorkIds}:Props){
 const router=useRouter();
 const [ready,setReady]=useState(false);
 const [available,setAvailable]=useState(false);
 const [pending,setPending]=useState<PendingStaffTimeCommand|null>(null);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState("");
 const active=snapshot.activeWorkItemId;
 const allowed:Action[]=snapshot.status==="NOT_STARTED"||
   snapshot.status==="CLOCKED_OUT"?["CLOCK_IN"]:
  snapshot.status==="ON_BREAK"?["BREAK_END"]:
  snapshot.status==="TRACKING_TASK"?
   ["TASK_PAUSE","TASK_STOP","TASK_SWITCH","BREAK_START","CLOCK_OUT"]:
  ["TASK_START","BREAK_START","CLOCK_OUT"];
 const [action,setAction]=useState<Action>(allowed[0]);
 const [workId,setWorkId]=useState(assignedWorkIds[0]??"");
 useEffect(()=>{
  const state=readPendingTimeCommand(storage());
  setAvailable(state.available);setPending(state.pending);
  setReady(true);
  if(!state.available)setNotice("Recovery storage is unavailable or invalid. No time command can be submitted.");
  else if(state.pending)setNotice("Unresolved original time command restored. It may already be committed. Retry only that exact nonce, or reconcile with a Team Leader.");
 },[]);
 const selected=TASK.has(action)?
  (action==="TASK_PAUSE"||action==="TASK_STOP"?active:workId):null;
 const eligible=!!selected&&(
  action==="TASK_PAUSE"||action==="TASK_STOP"||
  (assignedWorkIds.includes(selected)&&
    (action!=="TASK_SWITCH"||selected!==active)));
 const canIssue=ready&&available&&!busy&&
  allowed.includes(action)&&(!TASK.has(action)||eligible);
 async function submit(){
  if(!ready||!available||busy)return;
  let cmd:PendingStaffTimeCommand;
  if(pending)cmd=pending;
  else{
   if(!canIssue)return;
   try{
    cmd={action,nonce:crypto.randomUUID(),expectedRevision:snapshot.revision,
     ...(TASK.has(action)?{workItemId:selected!}:{})};
   }catch{
    setNotice("Browser cannot generate a unique original nonce. No request was sent.");
    return;
   }
  }
  // Original command is persisted and independently read back before HTTP.
  if(!savePendingTimeCommand(storage(),cmd)){
   setNotice("Original time command checkpoint could not be verified. No request was sent.");
   return;
  }
  setPending(cmd);setBusy(true);
  setNotice("Checking exact original command with Core. Do not close this tab.");
  try{
   const r=await fetch("/api/staff-time",{
    method:"POST",credentials:"same-origin",cache:"no-store",
    headers:{"content-type":"application/json"},body:JSON.stringify(cmd)
   });
   if(r.status===401){
    setNotice("Verified MFA expired. Keep original nonce and sign in again.");
    return;
   }
   const payload:unknown=await r.json();
   if(!r.ok||!payload||typeof payload!=="object"||Array.isArray(payload)||
     !clearPendingTimeCommand(storage(),cmd,payload as
       Parameters<typeof clearPendingTimeCommand>[2])){
    setNotice("Core outcome remains unconfirmed. Original command is locked; use the same nonce for reconciliation.");
    return;
   }
   setPending(null);
   setNotice("Core receipt verified. Refreshing the authoritative shift state.");
   router.refresh();
  }catch{
   setNotice("Transport outcome unknown. Preserve original nonce; do not create another action.");
  }finally{setBusy(false);}
 }
 const display=action.replaceAll("_"," ");
 return <section className="voxWorkdayCard" aria-labelledby="workday-current">
  <div className="voxWorkdayTitle">
   <div><p className="voxWorkdayEyebrow">Current verified Core shift</p>
    <h2 id="workday-current">{snapshot.status.replaceAll("_"," ")}</h2></div>
   <span className="voxWorkdayPill">Current shift only · not payroll</span>
  </div>
  <div className="voxWorkdayMetrics">
   <div><span>Elapsed attendance</span><strong>{format(snapshot.attendanceMs)}</strong></div>
   <div><span>Breaks</span><strong>{format(snapshot.breakMs)}</strong></div>
   <div><span>Task time</span><strong>{format(snapshot.taskMs)}</strong></div>
   <div><span>Unattributed shift time</span><strong>{format(snapshot.unattributedMs)}</strong></div>
  </div>
  <p className="voxWorkdayFine">Values are frozen at verified Core snapshot
   <time dateTime={snapshot.asOf}> {snapshot.asOf.slice(0,19)} UTC</time>.
   These are not live counters, full-day totals, productivity judgments or an official EOD.</p>
  {active?<p className="voxWorkdayFine">Active assigned work:
   <code> {active.slice(0,8)}</code></p>:null}
  {pending?<div className="voxWorkdayPending" role="status">
   <strong>Original command awaiting reconciliation</strong>
   <p>{pending.action.replaceAll("_"," ")} · expected revision {pending.expectedRevision}.
    Its original nonce is preserved in this tab; no alternate command can be submitted.</p>
   <button type="button" disabled={busy||!ready||!available} onClick={submit}>
    {busy?"Core checking…":"Retry the exact original command"}</button>
  </div>:<>
   <div className="voxWorkdayForm">
    <label htmlFor="voxWorkdayAction">Timekeeping action</label>
    <select id="voxWorkdayAction" value={action} disabled={busy||!ready||!available}
     onChange={e=>setAction(e.target.value as Action)}>
     {allowed.map(a=><option key={a} value={a}>{a.replaceAll("_"," ")}</option>)}
    </select>
    {TASK.has(action)&&action!=="TASK_PAUSE"&&action!=="TASK_STOP"?<>
     <label htmlFor="voxWorkdayTask">Assigned Core work item</label>
     <select id="voxWorkdayTask" value={workId} disabled={busy||!ready||!available}
      onChange={e=>setWorkId(e.target.value)}>
      {assignedWorkIds.map(id=><option key={id} value={id}>Work {id.slice(0,8)}</option>)}
     </select>
     {assignedWorkIds.length===0?<p>No authorized active work available. Task-time actions are locked.</p>:null}
    </>:null}
    <button type="button" disabled={!canIssue} onClick={submit}>
     {busy?"Core checking…":"Request "+display.toLowerCase()}</button>
   </div>
  </>}
  {notice?<p className="voxWorkdayNotice" role="status">{notice}</p>:null}
  <p className="voxWorkdayFine">Only Core can authorize Staff, record time and select
   canonical server timestamps. <Link href="/team/work-queue">Review My Work</Link>.</p>
 </section>;
}
