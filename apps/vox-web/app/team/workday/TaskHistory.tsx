import type {StaffTaskHistory} from "../../../lib/staffTimeHistory";
type Result=StaffTaskHistory|{ok:false;statusCode:number;error:string};
const utc=(value:string)=>new Date(value).toISOString().slice(0,19)+" UTC";
const duration=(ms:number)=>{
 const seconds=Math.floor(ms/1000);
 const h=Math.floor(seconds/3600),m=Math.floor((seconds%3600)/60),s=seconds%60;
 return h?h+"h "+String(m).padStart(2,"0")+"m":
  m?m+"m "+String(s).padStart(2,"0")+"s":s+"s";
};
export default function TaskHistory({history}:{history:Result}){
 if(!history.ok)return <section className="voxWorkdayCard" role="status">
  <h2>Per-task interval history unavailable</h2>
  <p>{history.statusCode===401?"Staff MFA must be renewed.":
    "Core immutable interval history is not independently certified for Staging."}</p>
 </section>;
 return <section className="voxWorkdayCard" aria-labelledby="vox-task-history">
  <div className="voxWorkdayTitle">
   <div><p className="voxWorkdayEyebrow">Core recorded intervals</p>
    <h2 id="vox-task-history">My recent task history</h2></div>
   <span className="voxWorkdayPill">Read-only</span>
  </div>
  <p className="voxWorkdayFine">Latest {history.entries.length} closed intervals
   from your authenticated Staff ledger. Work references contain no client details.
   This is not complete attendance, payroll, activity monitoring or official EOD.</p>
  {history.entries.length===0?<p>No verified task intervals recorded yet.</p>:
   <ul aria-label="Recent closed task intervals">
    {history.entries.map((item)=><li key={item.revision}>
     <strong>Work {item.workItemId.slice(0,8)}</strong>
     {" — "+duration(item.elapsedMs)+" — "+item.closingAction.replaceAll("_"," ").toLowerCase()}
     <p className="voxWorkdayFine">
      <time dateTime={item.startedAt}>{utc(item.startedAt)}</time>
      {" to "}
      <time dateTime={item.endedAt}>{utc(item.endedAt)}</time>
     </p>
    </li>)}
   </ul>}
  {history.hasMore?<p className="voxWorkdayFine">
   More recorded intervals exist. Only the latest 20 are displayed; no full-history claim.</p>:null}
  <p className="voxWorkdayFine">As of
   <time dateTime={history.asOf}> {utc(history.asOf)}</time>.
   No live task timer is estimated here.</p>
 </section>;
}
