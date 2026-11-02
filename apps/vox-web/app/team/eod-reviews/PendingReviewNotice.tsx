"use client";
import {useEffect,useState} from "react";
import {readPendingTlReviews} from "../../../lib/rc70PendingTlReview.mjs";
/** Local-only recovery hint. This never reads, changes or signs a Core EOD
 * decision. Exact nonce stays in sessionStorage for operator reconciliation.
 */
export default function PendingReviewNotice({visibleReportIds}:{visibleReportIds:string[]}){
 const [ready,setReady]=useState(false);
 const [available,setAvailable]=useState(true);
 const [ids,setIds]=useState<string[]>([]);
 useEffect(()=>{
  let store:Storage|null=null;
  try{store=window.sessionStorage;}catch{/* private mode fail closed */}
  const result=readPendingTlReviews(store);
  setAvailable(result.available);
  setIds(result.records.map(x=>x.reportId));
  setReady(true);
 },[]);
 if(!ready)return null;
 if(!available)return <p className="voxFlowError" role="alert">
  Original Team Leader review checkpoint is unavailable or corrupt.
  Do not send another decision before manual Core reconciliation.
 </p>;
 if(ids.length===0)return null;
 const missing=ids.filter(id=>!visibleReportIds.includes(id));
 return <section className="voxFlowCard" aria-label="Unresolved same-tab Team Leader decisions" role="status">
  <h3>Original review decisions require reconciliation</h3>
  <p className="voxFlowMuted">This browser tab has {ids.length} unresolved original review {ids.length===1?"decision":"decisions"}.
   Do not create a different nonce or reverse a decision until a Team Leader verifies the Core receipt.
   Local checkpoints are not proof that Core committed.</p>
  {missing.length>0?<p className="voxFlowMuted">{missing.length} original {missing.length===1?"report is":"reports are"} no longer in the bounded pending queue.
   Ask the independent Team Leader to reconcile the original Core report before any new approval.</p>:null}
 </section>;
}
