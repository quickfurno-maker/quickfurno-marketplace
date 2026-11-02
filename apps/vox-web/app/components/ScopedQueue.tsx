"use client";
import {useMemo,useState} from "react";
import {scopedQueuePage} from "./scopedQueuePage.mjs";
export type ScopedQueueRow={id:string;title:string;detail:string;state:string;attention?:boolean};
export function ScopedQueue({title,kicker,rows,emptyLabel}:{title:string;kicker:string;rows:readonly ScopedQueueRow[];emptyLabel:string}){
 const [query,setQuery]=useState("");
 const [state,setState]=useState("ALL");
 const [attentionOnly,setAttentionOnly]=useState(false);
 const [page,setPage]=useState(1);
 const statuses=useMemo(()=>[...new Set(rows.map(r=>r.state))].filter(Boolean).sort(),[rows]);
 const filtered=useMemo(()=>{
  const q=query.toLocaleLowerCase("en-IN").trim();
  return rows.filter(r=>(!q||[r.title,r.detail,r.id,r.state].some(v=>v.toLocaleLowerCase("en-IN").includes(q)))&&
   (state==="ALL"||r.state===state)&&(!attentionOnly||r.attention===true));
 },[rows,query,state,attentionOnly]);
 const view=useMemo(()=>scopedQueuePage(filtered,page),[filtered,page]);
 function reset(){setQuery("");setState("ALL");setAttentionOnly(false);setPage(1);}
 return <section className="voxUnit" aria-label={title}><div className="voxUnitTop"><div><p>{kicker}</p><h2>{title}</h2></div>
  <strong>{filtered.length}<small> / {rows.length}</small></strong></div>
  <div className="voxQueueControls">
   <label htmlFor={"vox-search-"+kicker}><span>Search assigned records</span>
    <input id={"vox-search-"+kicker} type="search" autoComplete="off" value={query}
     maxLength={80} placeholder="Name, ID or status" onChange={e=>{setQuery(e.target.value);setPage(1);}}/></label>
   <label htmlFor={"vox-state-"+kicker}><span>Status</span>
    <select id={"vox-state-"+kicker} value={state} onChange={e=>{setState(e.target.value);setPage(1);}}>
     <option value="ALL">All statuses</option>{statuses.map(s=><option value={s} key={s}>{s}</option>)}
    </select></label>
   <label className="voxQueueCheckbox"><input type="checkbox" checked={attentionOnly}
    onChange={e=>{setAttentionOnly(e.target.checked);setPage(1);}}/>Needs attention</label>
  </div>
  <div className="voxRows" aria-live="polite">{filtered.length?view.rows.map((r,i)=><div className="voxRow" key={r.id||((view.page-1)*20+i)}>
   <div className="voxRowIcon" aria-hidden="true">{r.attention?"!":"•"}</div>
   <div className="voxRowBody"><b>{r.title}</b><small>{r.detail}</small></div>
   <span className="voxState">{r.state}</span>
  </div>):<div className="voxBlank">{rows.length===0?emptyLabel:"No matching assigned records. "}
   {rows.length>0?<button type="button" onClick={reset}>Clear filters</button>:null}
  </div>}</div>
  {filtered.length>20?<nav className="voxQueuePagination" aria-label={title+" pagination"}
   style={{display:"flex",alignItems:"center",gap:12,padding:"14px 18px",flexWrap:"wrap"}}>
   <button type="button" disabled={view.page<=1} onClick={()=>setPage(view.page-1)}>Previous</button>
   <span aria-live="polite">Page {view.page} of {view.pages} · at most 20 assigned records per page</span>
   <button type="button" disabled={view.page>=view.pages} onClick={()=>setPage(view.page+1)}>Next</button>
  </nav>:null}
  <footer>Core-scoped bounded records · No direct mutations · Pages do not fetch additional records</footer>
 </section>;
}
