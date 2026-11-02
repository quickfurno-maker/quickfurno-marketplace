import {validateTimeCommand} from "./virtualOfficeTimekeeping.mjs";

/**
 * VO1 domain state machine for the future transactional Core SQL writer.
 * Inputs serverNowMs and verifiedWorkItem are from a trusted Core server,
 * NOT browser. No database writes, assignment, payroll or clock-in effects.
 * A durable SQL implementation must serially lock Staff and enforce revision,
 * nonce, timestamp, team/city grants and referenced work ownership.
 */
export const TIME_STATE_SCHEMA="qf.vox.virtual-office.time-state.v1";
export function initialTimeState(){
 return {schema:TIME_STATE_SCHEMA,revision:0,clockedInAt:null,clockedOutAt:null,
  breakStartedAt:null,totalBreakMs:0,activeTask:null,lastTaskId:null,
  taskTimeMs:0,events:[],receipts:[]};
}
const reject=(reason)=>Object.freeze({ok:false,reason,applied:false});
const safeTime=n=>Number.isSafeInteger(n)&&n>=0;
const clone=x=>JSON.parse(JSON.stringify(x));
const sameCommand=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function transitionTimeState(snapshot,raw,{serverNowMs,verifiedWorkItem}={}){
 const parsed=validateTimeCommand(raw);
 if(!parsed.ok)return reject(parsed.reason);
 if(!snapshot||snapshot.schema!==TIME_STATE_SCHEMA||!Array.isArray(snapshot.events)||
  !Array.isArray(snapshot.receipts)||!Number.isSafeInteger(snapshot.revision)||
  snapshot.revision<0||snapshot.revision>2147483646)return reject("STATE_UNVERIFIED");
 const cmd=parsed.command;
 const receipt=snapshot.receipts.find(x=>x.nonce===cmd.nonce);
 if(receipt){
  if(!sameCommand(receipt.command,cmd))return reject("NONCE_CONFLICT");
  return Object.freeze({ok:true,applied:false,replayed:true,
   receipt:clone(receipt),state:clone(snapshot)});
 }
 if(cmd.expectedRevision!==snapshot.revision)return reject("STALE_REVISION");
 if(!safeTime(serverNowMs)||snapshot.events.length>=1000||
    snapshot.receipts.length>=1000)return reject("SERVER_TIME_OR_LEDGER_CAPACITY");
 const previous=snapshot.events.at(-1);
 if(previous&&serverNowMs<previous.atMs)return reject("NON_MONOTONIC_SERVER_TIME");
 const s=clone(snapshot),action=cmd.action;
 const inShift=s.clockedInAt!==null&&s.clockedOutAt===null;
 const onBreak=s.breakStartedAt!==null;
 const completeTask=()=>{
  if(!s.activeTask)return;
  const delta=serverNowMs-s.activeTask.startedAt;
  if(delta<0||!safeTime(s.taskTimeMs+delta))throw Error("TIME_OVERFLOW");
  s.taskTimeMs+=delta;s.lastTaskId=s.activeTask.workItemId;s.activeTask=null;
 };
 try{
  if(action==="CLOCK_IN"){
   if(inShift||s.clockedInAt!==null)return reject("SHIFT_ALREADY_RECORDED");
   s.clockedInAt=serverNowMs;
  }else if(action==="CLOCK_OUT"){
   if(!inShift||onBreak)return reject("ACTIVE_SHIFT_REQUIRED_NO_BREAK");
   completeTask();s.clockedOutAt=serverNowMs;
  }else if(action==="BREAK_START"){
   if(!inShift||onBreak)return reject("ACTIVE_SHIFT_REQUIRED");
   completeTask();s.breakStartedAt=serverNowMs;
  }else if(action==="BREAK_END"){
   if(!inShift||!onBreak)return reject("ACTIVE_BREAK_REQUIRED");
   const delta=serverNowMs-s.breakStartedAt;
   if(delta<0||!safeTime(s.totalBreakMs+delta))return reject("BREAK_OVERFLOW");
   s.totalBreakMs+=delta;s.breakStartedAt=null;
  }else{
   if(!inShift||onBreak||verifiedWorkItem!==true)return reject("CURRENT_ASSIGNED_WORK_REQUIRED");
   if(action==="TASK_START"){
    if(s.activeTask)return reject("TIMER_ALREADY_ACTIVE");
    s.activeTask={workItemId:cmd.workItemId,startedAt:serverNowMs};
   }else if(action==="TASK_RESUME"){
    if(s.activeTask||s.lastTaskId!==cmd.workItemId)return reject("RESUME_NOT_ALLOWED");
    s.activeTask={workItemId:cmd.workItemId,startedAt:serverNowMs};
   }else if(action==="TASK_SWITCH"){
    if(!s.activeTask||s.activeTask.workItemId===cmd.workItemId)
     return reject("TASK_SWITCH_REQUIRES_DIFFERENT_ACTIVE_WORK");
    completeTask();
    s.activeTask={workItemId:cmd.workItemId,startedAt:serverNowMs};
   }else if(action==="TASK_PAUSE"||action==="TASK_STOP"){
    if(!s.activeTask||s.activeTask.workItemId!==cmd.workItemId)
     return reject("ACTIVE_TASK_REQUIRED");
    completeTask();
    if(action==="TASK_STOP")s.lastTaskId=null;
   }
  }
  if(s.clockedInAt!==null&&s.clockedOutAt!==null){
   const available=s.clockedOutAt-s.clockedInAt-s.totalBreakMs;
   if(available<0||s.taskTimeMs>available)return reject("TIME_INTEGRITY_FAILED");
  }
 }catch{return reject("TIME_INTEGRITY_FAILED");}
 s.revision++;
 const event={action,atMs:serverNowMs,workItemId:cmd.workItemId??null,
  revision:s.revision,nonce:cmd.nonce};
 s.events.push(event);
 const r={nonce:cmd.nonce,command:cmd,revision:s.revision,event};
 s.receipts.push(r);
 return Object.freeze({ok:true,applied:true,replayed:false,
  receipt:clone(r),state:s});
}
