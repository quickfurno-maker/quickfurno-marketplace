"use client";
import {useEffect,useState} from "react";
import {readPendingWork} from "../../../lib/rc66PendingWorkTransition";
/** Recovery-only view over original local same-tab work nonces. No Core
 * query, no new command, no client-side grant and no provider action.
 */
export default function PendingWorkNotice({visibleWorkItemIds}:{visibleWorkItemIds:string[]}){
 const [ready,setReady]=useState(false);
 const [available,setAvailable]=useState(true);
 const [ids,setIds]=useState<string[]>([]);
 useEffect(()=>{
  let storage:Storage|null=null;
  try{storage=window.sessionStorage;}catch{/* fail closed */}
  const result=readPendingWork(storage);
  setAvailable(result.available);
  setIds(result.records.map(x=>x.itemId));
  setReady(true);
 },[]);
 if(!ready)return null;
 if(!available)return <p role="alert" className="voxQueueCaution">
  Original Staff work command checkpoint is unavailable or corrupt.
  Do not submit a new command without human Core reconciliation.
 </p>;
 if(!ids.length)return null;
 const absent=ids.filter(id=>!visibleWorkItemIds.includes(id));
 return <section role="status" className="voxQueueCaution" aria-label="Original Staff work command reconciliation">
  <p>This tab holds {ids.length} unresolved original work {ids.length===1?"command":"commands"}.
   Original nonces must be reconciled against Core before new action or replacement.
   Local storage does not prove that Core committed.</p>
  {absent.length?<p>{absent.length} original work {absent.length===1?"item is":"items are"} outside this bounded authorized Core queue.
   Ask your Team Leader to reconcile the original command and nonce. No command was sent.</p>:null}
 </section>;
}
