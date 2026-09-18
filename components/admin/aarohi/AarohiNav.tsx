"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
const items=[
 ["Overview","/admin/aarohi"],["Prospects","/admin/aarohi/prospects"],["Pipeline","/admin/aarohi/pipeline"],
 ["Aarohi Inbox","/admin/aarohi/inbox"],["Conversations","/admin/aarohi/conversations"],["Tasks","/admin/aarohi/tasks"],
 ["Discovery","/admin/aarohi/discovery"],["Campaigns","/admin/aarohi/campaigns"],["Analytics","/admin/aarohi/analytics"],["Settings","/admin/aarohi/settings"],
] as const;
export function AarohiNav(){const path=usePathname();return <nav className="qf-aarohi-nav" aria-label="Aarohi Acquisition CRM">{items.map(([label,href])=>{const active=href==="/admin/aarohi"?path===href:path.startsWith(href);return <Link key={href} href={href} data-active={active?"true":undefined}>{label}</Link>})}</nav>}
