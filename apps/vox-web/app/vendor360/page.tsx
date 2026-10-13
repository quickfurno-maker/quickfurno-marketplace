import Link from "next/link";
import {fetchScopedCrm} from "../../lib/core";
import "../operations/operations.css";
export const dynamic="force-dynamic";
export default async function Vendor360(){
 const r=await fetchScopedCrm("vendor360");
 if(!r.ok||r.kind!=="vendor360")return <main className="hold"><div className="holdCard"><h1>Vendor 360 unavailable</h1><p>Verified staff access and Core vendor scope are required.</p><Link href="/login">Secure staff sign-in</Link></div></main>;
 return <main className="voxOps"><header className="voxTop"><div className="voxLogo">V</div><div><b>VOX / VENDOR 360</b><small>Canonical QuickFurno vendor CRM</small></div><div className="voxSession">READ ONLY · CITY VERIFIED</div></header>
 <div className="voxHero"><p className="kicker">VENDOR RELATIONSHIPS / CANONICAL CORE</p><h1>Every vendor,<br/><span>in the right context.</span></h1>
 <p>Only vendors assigned to your staff identity and verified Core city/service zone. Approval, wallet and vendor-activation controls remain separate.</p></div>
 <div className="voxWorkspace"><section className="voxUnit"><div className="voxUnitTop"><h2>Assigned vendors</h2><strong>{r.view.vendors.length}</strong></div><div className="voxRows">{r.view.vendors.length?r.view.vendors.map((v,i)=>
 <div className="voxRow" key={v.vendorId??i}><div className="voxRowIcon">V</div><div className="voxRowBody"><b>{v.businessName}</b><small>Verification: {v.verificationStatus} · Location: {v.locationVerification}</small></div><span className="voxState">{v.status}</span></div>
 ):<div className="voxBlank">No assigned vendors.</div>}</div><footer>No direct profile or credit changes</footer></section>
 <section className="voxUnit"><div className="voxUnitTop"><h2>CRM relationships</h2><strong>{r.view.crm.length}</strong></div><div className="voxRows">{r.view.crm.length?r.view.crm.map((c,i)=>
 <div className="voxRow" key={c.vendorId??i}><div className="voxRowIcon">C</div><div className="voxRowBody"><b>{c.onboarding}</b><small>{c.vendorId?.slice(0,8)??"Unknown vendor"}</small></div><span className="voxState">{c.relationship}</span></div>
 ):<div className="voxBlank">No assigned CRM records.</div>}</div><footer>Existing Vendor CRM records only</footer></section></div>
 <div className="voxNotice"><b>Core remains authoritative</b><span>Google-verified location, profile edits, Aadhaar/KYC, payment, lead matching and vendor activation require governed Core reviews.</span></div>
 <footer className="voxBottom"><Link href="/operations">← Mission Control</Link> · VOX Vendor 360 · Source-only staging implementation</footer></main>;
}
