"use client";
import {useState} from "react";
type Vendor={vendorId:string;businessName:string};
type Review={id:string;requestType:string;status:string;createdAt:string|null;reason:string};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
export function ProfileReviewQueue({vendors}:{vendors:readonly Vendor[]}){
 const options=vendors.filter(x=>UUID.test(x.vendorId)).slice(0,12);
 const [vendorId,setVendorId]=useState(options[0]?.vendorId??"");
 const [items,setItems]=useState<Review[]>([]);
 const [busy,setBusy]=useState(false);
 const [status,setStatus]=useState("Only current assigned vendor requests appear here.");
 async function refresh(){
  if(busy||!options.some(x=>x.vendorId===vendorId))return;
  setBusy(true);setItems([]);
  try{
   const response=await fetch("/api/vendor-profile-review?vendorId="+encodeURIComponent(vendorId),
    {method:"GET",credentials:"same-origin",cache:"no-store"});
   const result:unknown=await response.json();
   if(!response.ok||!result||typeof result!=="object"||!("ok" in result)||result.ok!==true||
     !("requests" in result)||!Array.isArray(result.requests)){
    setStatus("Review queue unavailable or permission denied.");return;
   }
   const rows=result.requests as Review[];
   setItems(rows);setStatus(rows.length+" pending native Core change request(s). Approval cannot be performed here.");
  }catch{setStatus("No confirmation. Try again after staff authentication.");}
  finally{setBusy(false);}
 }
 if(!options.length)return null;
 return <section className="voxUnit" aria-label="Native vendor profile approval review">
  <div className="voxUnitTop"><div><p>CANONICAL CORE APPROVALS</p><h2>Pending vendor-profile review</h2></div></div>
  <p>Read-only request metadata. Google office location changes require verified provider proof; all decisions remain in Core.</p>
  <label>Assigned vendor <select value={vendorId} onChange={e=>{setVendorId(e.target.value);setItems([]);setStatus("Select Refresh to fetch current Core scope.");}}>
   {options.map(v=><option key={v.vendorId} value={v.vendorId}>{v.businessName}</option>)}
  </select></label>
  <button type="button" onClick={refresh} disabled={busy}>{busy?"Checking Core...":"Refresh pending reviews"}</button>
  <p role="status">{status}</p>
  <ul>{items.map(x=><li key={x.id}><strong>{x.requestType==="office_location_change"?"Verified location change":"Profile update"}</strong>
   <span> · Pending · ID {x.id.slice(0,8)} · {x.reason}</span></li>)}</ul>
  <footer>VOX cannot approve, reject or apply profile, KYC, location or wallet changes.</footer>
 </section>;
}
