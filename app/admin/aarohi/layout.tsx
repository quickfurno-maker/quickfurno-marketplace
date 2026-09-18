import { redirect } from "next/navigation";
import { getAdminSession } from "@/app/actions";
import { hasAarohiPermission } from "@/lib/aarohi/permissions";
import { AarohiNav } from "@/components/admin/aarohi/AarohiNav";
import "./aarohi.css";
export default async function AarohiLayout({children}:{children:React.ReactNode}){
 const session=await getAdminSession(); if(!session.isLoggedIn)redirect("/admin/login"); if(!session.isAdmin||!hasAarohiPermission(session.adminRole,"aarohi.view"))redirect("/admin/login?error=unauthorized");
 return <section className="qf-aarohi-shell"><div className="qf-aarohi-identity"><div><b>AAROHI</b><span>Acquisition CRM</span></div><p>Pre-activation vendor acquisition · Core authority preserved</p><a href="/admin/vendor-crm">Vendor CRM ↗</a></div><AarohiNav/><div className="qf-aarohi-content">{children}</div></section>
}
