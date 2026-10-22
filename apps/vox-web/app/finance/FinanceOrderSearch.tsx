"use client";
import {useState} from "react";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Order={id:string;createdAt:string;providerMode:string;paymentStatus:string;activationStatus:string};
export function FinanceOrderSearch({enabled}:{enabled:boolean}){
 const [vendor,setVendor]=useState(""),[page,setPage]=useState(0),
  [orders,setOrders]=useState<Order[]>([]),[hasMore,setHasMore]=useState(false),
  [error,setError]=useState(""),[busy,setBusy]=useState(false);
 async function load(p:number){
  if(!enabled||busy||!UUID.test(vendor)||p<0||p>9)return;
  setBusy(true);setError("");
  try{
   const response=await fetch("/api/finance-orders?vendorId="+encodeURIComponent(vendor)+
    "&page="+String(p),{cache:"no-store"});
   const data=await response.json();
   if(!response.ok||data.ok!==true||!Array.isArray(data.orders))
    throw Error("FINANCE_UNAVAILABLE");
   setOrders(data.orders);setPage(p);setHasMore(data.hasMore===true);
  }catch{setOrders([]);setHasMore(false);setError("Finance history unavailable or access denied.");}
  finally{setBusy(false);}
 }
 return <section className="voxNotice">
  <h2>Vendor-scoped finance orders</h2>
  <p>Exact vendor ID only, maximum 20 orders per page and 10 pages.
   No unscoped tenant-wide search or financial actions.</p>
  {!enabled?<p role="status">PAY-4B search is disabled (release HOLD).</p>:null}
  <label>Vendor UUID <input value={vendor} onChange={e=>{setVendor(e.target.value.trim());setOrders([]);}}
    maxLength={36} placeholder="Exact vendor UUID"/></label>
  <button type="button" disabled={!enabled||busy||!UUID.test(vendor)}
   onClick={()=>load(0)}>Find orders</button>
  {error?<p role="alert">{error}</p>:null}
  {orders.length>0?<><ol>{orders.map(o=><li key={o.id}>
   <code>{o.id}</code> · {o.providerMode.toUpperCase()} · {o.paymentStatus} · {o.activationStatus}
   {" · "}{new Date(o.createdAt).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})}
  </li>)}</ol><div>
   <button disabled={busy||page===0} onClick={()=>load(page-1)}>Previous</button>
   <span> Page {page+1} of at most 10 </span>
   <button disabled={busy||!hasMore||page===9} onClick={()=>load(page+1)}>Next</button>
  </div></>:null}
 </section>;
}
