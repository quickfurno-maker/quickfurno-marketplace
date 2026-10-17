import Link from "next/link";
import "./vox-workspace.css";

type NavKey =
  | "mission" | "work" | "attention" | "notices" | "staff"
  | "clients" | "vendors" | "acquisition" | "desk" | "reports"
  | "approvals" | "studio" | "intelligence";

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
  return <aside className="voxWorkspaceSidebar" aria-label="VOX workspace navigation">
    <Link className="voxWorkspaceIdentity" href="/" aria-label="VOX Mission Control">
      <span className="voxWorkspaceLogo">V</span>
      <span><strong>VOX</strong><small>QUICKFURNO OPERATIONS</small></span>
    </Link>
    <div className="voxWorkspaceNavScroll">
      {navigation.map(group => <nav aria-label={group.heading} className="voxWorkspaceNavGroup" key={group.heading}>
        <p>{group.heading}</p>
        {group.items.filter(item => preview || admin || !item.adminOnly).map(item => {
          const href = preview && item.id === "staff" ? "/preview/staff-management" : item.href;
          return <Link href={href} key={item.id} aria-current={active===item.id ? "page" : undefined}
            className={"voxWorkspaceNavItem"+(active===item.id ? " voxWorkspaceNavActive" : "")}
            title={preview && item.id !== "mission" && item.id !== "staff" ? "Protected live workspace; authorization required" : undefined}>
            <span className="voxWorkspaceNavIcon" aria-hidden="true">{item.symbol}</span>
            <span>{item.label}</span>
            {preview && item.id !== "mission" && item.id !== "staff" ? <span className="voxWorkspaceNavLock" aria-hidden="true">·</span> : null}
          </Link>;
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
          <span className={"voxWorkspaceMode"+(preview ? " voxWorkspaceModePreview" : "")}>
            {preview ? "LOCAL PREVIEW ONLY" : "CORE-VERIFIED WORKSPACE"}
          </span>
        </div>
      </header>
      <div className="voxWorkspaceMain">{children}</div>
    </div>
  </div>;
}
