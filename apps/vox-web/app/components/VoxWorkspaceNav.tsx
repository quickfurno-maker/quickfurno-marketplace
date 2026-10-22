"use client";

import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import "./vox-workspace.css";

type NavKey =
  | "mission" | "work" | "attention" | "notices" | "staff"
  | "clients" | "vendors" | "acquisition" | "desk" | "reports"
  | "approvals" | "studio" | "intelligence" | "finance";

type NavigationItem = {id: NavKey; label: string; symbol: string; href: string; adminOnly?: boolean};
const navigation: {heading: string; items: NavigationItem[]}[] = [
  {heading: "COMMAND CENTER", items: [
    {id: "mission", label: "Mission Control", symbol: "◈", href: "/"},
    {id: "work", label: "My Work & Queues", symbol: "▦", href: "/team/work-queue"},
    {id: "attention", label: "Needs Attention", symbol: "!", href: "/team/attention"},
    {id: "notices", label: "Notifications", symbol: "◉", href: "/team/notifications"},
  ]},
  {heading: "OPERATIONS", items: [
    {id: "staff", label: "Team Management", symbol: "▣", href: "/team/admin/staff", adminOnly: true},
    {id: "finance", label: "Finance 360 (HOLD)", symbol: "₹", href: "/finance", adminOnly: true},
    {id: "clients", label: "Client CRM & Riya", symbol: "◇", href: "/team/client-cases"},
    {id: "vendors", label: "Vendor 360 & Anisha", symbol: "▤", href: "/vendor360"},
    {id: "acquisition", label: "Aarohi Acquisition", symbol: "◎", href: "/acquisition"},
    {id: "desk", label: "Chats & Service Desk", symbol: "☰", href: "/service-desk"},
    {id: "reports", label: "Daily Reports", symbol: "▥", href: "/team/daily-report"},
  ]},
  {heading: "ADMIN & INTELLIGENCE", items: [
    {id: "approvals", label: "Approvals & Audit", symbol: "◆", href: "/approvals", adminOnly: true},
    {id: "studio", label: "Automation Studio", symbol: "⌘", href: "/studio"},
    {id: "intelligence", label: "AOS & AGNI Health", symbol: "◌", href: "/intelligence", adminOnly: true},
  ]},
];

export function VoxWorkspaceNav({active, preview = false, admin = false}: {
  active: NavKey; preview?: boolean; admin?: boolean;
}) {
  const [query,setQuery]=useState("");
  const inputRef=useRef<HTMLInputElement>(null);
  useEffect(()=>{
    function shortcut(event:KeyboardEvent){
      const target=event.target;
      const editable=target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT","TEXTAREA","SELECT"].includes(target.tagName));
      if (!editable && !event.metaKey && !event.ctrlKey && !event.altKey && event.key==="/"){
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown",shortcut);
    return ()=>window.removeEventListener("keydown",shortcut);
  },[]);

  const term=query.trim().toLocaleLowerCase();
  const visible=navigation.map(group=>({
    ...group,
    items:group.items.filter(item=>(preview||admin||!item.adminOnly) &&
      (!term || item.label.toLocaleLowerCase().includes(term) || group.heading.toLocaleLowerCase().includes(term))),
  })).filter(group=>group.items.length>0);

  return <aside className="voxWorkspaceSidebar" aria-label="VOX workspace navigation">
    <Link className="voxWorkspaceIdentity" href="/" aria-label="VOX Mission Control">
      <span className="voxWorkspaceLogo">V</span>
      <span><strong>VOX</strong><small>QUICKFURNO OPERATIONS</small></span>
    </Link>
    <label className="voxWorkspaceNavSearch">
      <span className="voxWorkspaceSearchGlyph" aria-hidden="true">⌕</span>
      <input ref={inputRef} type="search" placeholder="Find workspace" aria-label="Find a VOX workspace"
        value={query} onChange={event=>setQuery(event.target.value)} maxLength={65}/>
      <kbd aria-hidden="true">/</kbd>
    </label>
    <div className="voxWorkspaceNavScroll">
      {visible.length===0?<p className="voxWorkspaceNoResults" role="status">No matching workspaces</p>:null}
      {visible.map(group=><nav aria-label={group.heading} className="voxWorkspaceNavGroup" key={group.heading}>
        <p>{group.heading}</p>
        {group.items.map(item=>{
          const href = preview && item.id === "staff" ? "/preview/staff-management" : item.href;
          const classes="voxWorkspaceNavItem"+(active===item.id ? " voxWorkspaceNavActive" : "");
          const contents=<>
            <span className="voxWorkspaceNavIcon" aria-hidden="true">{item.symbol}</span>
            <span>{item.label}</span>
            {preview && item.id !== "mission" && item.id !== "staff"
              ? <span className="voxWorkspaceNavLock" aria-hidden="true">Locked</span> : null}
          </>;
          if (preview && item.id !== "mission" && item.id !== "staff"){
            return <span key={item.id} className={classes+" voxWorkspaceNavUnavailable"}
              aria-disabled="true" title="Protected workflow, not available in local preview">{contents}</span>;
          }
          return <Link href={href} key={item.id} aria-current={active===item.id?"page":undefined}
            className={classes}>{contents}</Link>;
        })}
      </nav>)}
    </div>
    <div className="voxWorkspaceSidebarFoot">
      <span className="voxWorkspaceGreenDot" aria-hidden="true" />
      {preview ? "Local design preview" : "Core-authorized Staff access"}
      <small>{preview ? "No live activity or permissions" : "Current grants control access"}</small>
    </div>
  </aside>;
}

export function VoxWorkspaceFrame({active, title, eyebrow, children, preview = false, admin = false}: {
  active: NavKey; title: string; eyebrow: string; children: React.ReactNode; preview?: boolean; admin?: boolean;
}) {
  return <div className="voxWorkspaceFrame">
    <VoxWorkspaceNav active={active} preview={preview} admin={admin} />
    <div className="voxWorkspaceBody">
      <header className="voxWorkspaceTop">
        <div className="voxWorkspaceTopIdentity"><span>{eyebrow}</span><strong>{title}</strong></div>
        <div className="voxWorkspaceTopRight">
          <span className="voxWorkspaceTopDate">STAFF OPERATIONS</span>
          <span className={"voxWorkspaceMode"+(preview?" voxWorkspaceModePreview":"")}>
            {preview?"LOCAL PREVIEW ONLY":"CORE-VERIFIED WORKSPACE"}
          </span>
        </div>
      </header>
      <div className="voxWorkspaceMain">{children}</div>
    </div>
  </div>;
}
