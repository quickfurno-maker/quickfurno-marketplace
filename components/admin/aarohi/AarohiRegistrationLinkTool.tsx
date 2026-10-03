"use client";

import { useState, useTransition } from "react";
import { createRegistrationLinkAction } from "@/app/admin/aarohi/actions";

const CHANNELS=["WHATSAPP","INSTAGRAM","FACEBOOK","X","WEBSITE","MANUAL"] as const;

export function AarohiRegistrationLinkTool({prospectId}:{prospectId:string}){
  const [channel,setChannel]=useState<(typeof CHANNELS)[number]>("WHATSAPP");
  const [url,setUrl]=useState("");
  const [expiresAt,setExpiresAt]=useState("");
  const [error,setError]=useState("");
  const [pending,startTransition]=useTransition();

  function create(){
    setError("");
    setUrl("");
    startTransition(async()=>{
      const result=await createRegistrationLinkAction(prospectId,channel);
      if(!result.ok){setError(result.error);return;}
      setUrl(window.location.origin+result.relativeUrl);
      setExpiresAt(result.expiresAt);
    });
  }

  async function copy(){
    if(!url)return;
    await navigator.clipboard.writeText(url);
  }

  return <div className="qf-aarohi-formgrid">
    <label>Registration source
      <select className="qf-aarohi-select" value={channel} onChange={(e)=>setChannel(e.target.value as (typeof CHANNELS)[number])}>
        {CHANNELS.map((item)=><option key={item}>{item}</option>)}
      </select>
    </label>
    <button type="button" className="qf-aarohi-btn" data-tone="primary" onClick={create} disabled={pending}>
      {pending?"Creating…":"Create secure registration link"}
    </button>
    {url?<label className="wide">Expiring registration URL
      <input className="qf-aarohi-input" readOnly value={url}/>
      <small>Expires {new Date(expiresAt).toLocaleString()}</small>
      <button type="button" className="qf-aarohi-btn" data-tone="ghost" onClick={copy}>Copy link</button>
    </label>:null}
    {error?<p className="qf-aarohi-danger-note wide">{error}</p>:null}
  </div>;
}
