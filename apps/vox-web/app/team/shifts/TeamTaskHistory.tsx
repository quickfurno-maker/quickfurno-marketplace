import Link from "next/link";
import type {TlTaskHistory} from "../../../lib/teamTaskHistory";
type Result=TlTaskHistory|{ok:false;status:number;error:string};
const duration=(ms:number)=>{const n=Math.floor(ms/60000);
 return Math.floor(n/60)+"h "+String(n%60).padStart(2,"0")+"m";};
const utc=(v:string)=>new Date(v).toISOString().slice(0,19)+" UTC";
export default function TeamTaskHistory({result,cursor}:{result:Result;cursor:string|null}){
 if(!result.ok)return <section className="voxFlowCard" role="status">
   <h2>Team task history unavailable</h2>
   <p className="voxFlowMuted">{result.status===401?
      "Verified Team Leader MFA required.":
      result.status===403?"Current Team Leader grant was denied.":
      "Immutable team task history is not independently certified for Staging."}</p>
  </section>;
 return <section className="voxFlowCard" aria-labelledby="team-task-history">
  <h2 id="team-task-history">Recently closed team tasks</h2>
  <p className="voxFlowMuted">Verified original Staff and work references only.
   Latest {result.entries.length} immutable task intervals in the current bounded
   team window. No client details, productivity inference or official EOD.</p>
  {result.entries.length===0?<p role="status">No verified intervals in this window.</p>:
   <ul className="voxFlowList">{result.entries.map(item=>
    <li className="voxFlowRow" key={item.staffRef+":"+item.revision}>
     <div><strong>{item.staffRef}</strong>
      <p>{item.workRef} • {item.closingAction.replaceAll("_"," ").toLowerCase()}</p></div>
     <div><p>{duration(item.elapsedMs)}</p>
      <p className="voxFlowMuted">
       <time dateTime={item.startedAt}>{utc(item.startedAt)}</time>
       {" to "}<time dateTime={item.endedAt}>{utc(item.endedAt)}</time></p></div>
    </li>)}</ul>}
  <p className="voxFlowMuted">
   {cursor?<Link href="/team/shifts">Return to newest team intervals</Link>:null}
   {result.hasMore&&result.nextCursor?<Link
    href={"/team/shifts?cursor="+encodeURIComponent(result.nextCursor)}>
    Older verified team intervals</Link>:null}
  </p>
  {result.hasMore?<p className="voxFlowMuted">
   More intervals exist. This page shows at most 20, not a complete history.</p>:null}
  <p className="voxFlowMuted">Core snapshot
   <time dateTime={result.asOf}> {utc(result.asOf)}</time>.
   No live presence or full attendance claimed.</p>
 </section>;
}
