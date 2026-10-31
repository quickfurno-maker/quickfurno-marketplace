"use client";
import {useMemo,useState} from "react";
export type ScopedQueueRow={id:string;title:string;detail:string;state:string;attention?:boolean};
export function ScopedQueue({title,kicker,rows,emptyLabel}:{title:string;kicker:string;rows:readonly ScopedQueueRow[];emptyLabel:string}){
 const [query,setQuery]=useState("");
 const [state,setState]=useState("ALL");
 const [attentionOnly,setAttentionOnly]=useState(false);
 const statuses=useMemo(()=>[...new Set(rows.map(r=>r.state))].filter(Boolean).sort(),[rows]);
 const visible=useMemo(()=>{
  const q=query.toLocaleLowerCase("en-IN").trim();
  return rows.filter(r=>(!q||[r.title,r.detail,r.id,r.state].some(v=>v.toLocaleLowerCase("en-IN").includes(q)))&&
   (state==="ALL"||r.state===state)&&(!attentionOnly||r.attention===true));
 },[rows,query,state,attentionOnly]);
 return <section className="voxUnit" aria-label={title}><div className="voxUnitTop"><div><p>{kicker}</p><h2>{title}</h2></div>
  <strong>{visible.length}<small> / {rows.length}</small></strong></div>
  <div className="voxQueueControls">
   <label htmlFor={"vox-search-"+kicker}><span>Search assigned records</span>
    <input id={"vox-search-"+kicker} type="search" autoComplete="off" value={query}
     maxLength={80} placeholder="Name, ID or status" onChange={e=>setQuery(e.target.value)}/></label>
   <label htmlFor={"vox-state-"+kicker}><span>Status</span>
    <select id={"vox-state-"+kicker} value={state} onChange={e=>setState(e.target.value)}>
     <option value="ALL">All statuses</option>{statuses.map(s=><option value={s} key={s}>{s}</option>)}
    </select></label>
   <label className="voxQueueCheckbox"><input type="checkbox" checked={attentionOnly} onChange={e=>setAttentionOnly(e.target.checked)}/>Needs attention</label>
  </div>
  <div className="voxRows" aria-live="polite">{visible.length?visible.map((r,i)=><div className="voxRow" key={r.id||i}>
   <div className="voxRowIcon" aria-hidden="true">{r.attention?"!":"•"}</div>
   <div className="voxRowBody"><b>{r.title}</b><small>{r.detail}</small></div>
   <span className="voxState">{r.state}</span>
  </div>):<div className="voxBlank">{rows.length===0?emptyLabel:"No matching assigned records. "}
   {rows.length>0?<button type="button" onClick={()=>{setQuery("");setState("ALL");setAttentionOnly(false)}}>Clear filters</button>:null}
  </div>}</div>
  <footer>CORE-scoped records · No direct mutations</footer>
 </section>;
}
