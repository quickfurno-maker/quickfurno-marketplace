export type VerifiedQueueRow={workItemId:string;kind:string;state:string;
 revision:number;updatedAt:string;assignedToMe:boolean};
export type AttentionResult={ok:true;mode:"READ_ONLY";completeness:"BOUNDED_NOT_TOTAL";
 totalKnown:false;deliveredNotifications:0;
 items:ReadonlyArray<VerifiedQueueRow & {attentionType:string}>}|
 {ok:false;error:"INVALID_WORK_QUEUE"};
const types:Record<string,string>={
 BLOCKED:"Blocked work",WAITING_APPROVAL:"Waiting for approval",
 WAITING_EXTERNAL:"Waiting for external response",NEW:"Unassigned eligible work"
};
const priority=(state:string)=>Object.keys(types).indexOf(state);
/** VOX attention is derived only from already validated Core queue items.
 * It does NOT represent push notifications, delivery guarantees or totals. */
export function projectStaffAttention(rows:ReadonlyArray<VerifiedQueueRow>){
 if(!Array.isArray(rows)||rows.length>25)return {ok:false,error:"INVALID_WORK_QUEUE"} as const;
 const seen=new Set<string>(),eligible: Array<VerifiedQueueRow & {attentionType:string}>=[];
 for(const row of rows){
  if(!row||typeof row!=="object"||typeof row.workItemId!=="string"||
     !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.workItemId)||
     seen.has(row.workItemId)||!["prospect","vendor","support_thread"].includes(row.kind)||
     !["NEW","ASSIGNED","IN_PROGRESS","WAITING_EXTERNAL",
       "WAITING_APPROVAL","BLOCKED","DONE"].includes(row.state)||
     !Number.isSafeInteger(row.revision)||row.revision<0||
     typeof row.assignedToMe!=="boolean"||
     typeof row.updatedAt!=="string"||!Number.isFinite(Date.parse(row.updatedAt))||
     (row.state==="NEW"&&row.assignedToMe))
   return {ok:false,error:"INVALID_WORK_QUEUE"} as const;
  seen.add(row.workItemId);
  if(row.state in types){
   eligible.push({...row,attentionType:types[row.state]});
  }
 }
 eligible.sort((a,b)=>priority(a.state)-priority(b.state)||
  Date.parse(b.updatedAt)-Date.parse(a.updatedAt)||a.workItemId.localeCompare(b.workItemId));
 return {ok:true,mode:"READ_ONLY",completeness:"BOUNDED_NOT_TOTAL",
  totalKnown:false,deliveredNotifications:0,items:eligible} as const;
}
