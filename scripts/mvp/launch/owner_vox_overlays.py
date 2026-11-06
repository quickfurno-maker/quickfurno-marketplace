"""Minimal Owner-only route navigation overlay for extracted VOX source.

This is applied to two pages and their read BFF routes, leaving the full
Staff virtual office source untouched on its separate engineering branch.
"""
from pathlib import Path

def restrict_owner_surface(rel: Path, text: str) -> str:
    name = rel.as_posix()
    if name == "app/api/overview/route.ts":
        original = 'export async function GET(){const result=await fetchStaffOverview();return safeJson(result,result.status);}'
        assert text.count(original) == 1, "unexpected overview handler"
        return text.replace(original,
            'export async function GET(){'
            'if(process.env.VOX_STAFF_VIEW_MODE!=="owner")'
            'return safeJson({ok:false,error:"OWNER_MODE_REQUIRED"},503);'
            'const result=await fetchStaffOverview();return safeJson(result,result.status);}')
    if name == "app/api/vendor360/route.ts":
        original = 'export async function GET(){const r=await fetchScopedCrm("vendor360");return safeJson(r,r.status);}'
        assert text.count(original) == 1, "unexpected Vendor 360 handler"
        return text.replace(original,
            'export async function GET(){'
            'if(process.env.VOX_STAFF_VIEW_MODE!=="owner")'
            'return safeJson({ok:false,error:"OWNER_MODE_REQUIRED"},503);'
            'const r=await fetchScopedCrm("vendor360");return safeJson(r,r.status);}')
    if name == "app/operations/page.tsx":
        anchor = ' const result=await fetchStaffOverview();'
        assert text.count(anchor) == 1, "unexpected operations authorization source"
        text = text.replace(anchor,
            ' if(!ownerMode)return <main className="hold"><section className="holdCard">'
            '<h1>Staff workspaces are not enabled</h1>'
            '<p>This is an Owner-only release candidate. Staff requires its separate release gate.</p>'
            '</section></main>;\n' + anchor)
        start = '{ownerMode?<nav aria-label="Owner operations workspaces"'
        assert text.count(start) == 1, "Owner navigation marker changed"
        left = text.index(start)
        right = text.index('</nav>}', left) + len('</nav>}')
        # There are two adjacent navs in this expression; the second is Staff.
        assert text[left:right].count('<nav ') == 2, "unexpected workspace navigation layout"
        owner_nav = (
            '<nav aria-label="Owner operations workspaces" '
            'style={{display:"flex",gap:12,flexWrap:"wrap",paddingBottom:20}}>'
            '<Link href="/vendor360">Vendor 360</Link>'
            '{ownerVerificationVisible?<Link href="/owner/vendors/verification">Vendor Verification</Link>:null}'
            '{ownerAdminHref("/admin/dashboard")?<a href={ownerAdminHref("/admin/dashboard")!}>Core Dashboard</a>:null}'
            '{ownerAdminHref("/admin/leads")?<a href={ownerAdminHref("/admin/leads")!}>Manage Leads</a>:null}'
            '{ownerAdminHref("/admin/vendors")?<a href={ownerAdminHref("/admin/vendors")!}>Manage Vendors</a>:null}'
            '</nav>'
        )
        return (text[:left] + owner_nav + text[right:])\
            .replace('Staff session or MFA is required.', 'Owner session or MFA is required.')\
            .replace('Staff sign-in', 'Owner sign-in')\
            .replace('Staff Operations', 'Owner Operations')
    if name == "app/vendor360/page.tsx":
        for import_line in (
            'import {TaskCreator} from "./components/TaskCreator";\n',
            'import {ProfileReviewQueue} from "./components/ProfileReviewQueue";\n',
            'import {StaffProposalForm} from "../components/StaffProposalForm";\n',
        ):
            assert text.count(import_line) == 1, "unexpected Staff UI source import"
            text = text.replace(import_line, "")
        anchor = ' const ownerVerificationVisible=ownerMode&&'
        assert text.count(anchor) == 1
        text = text.replace(anchor,
            ' if(!ownerMode)return <main className="hold"><section className="holdCard">'
            '<h1>Staff Vendor 360 is not enabled</h1>'
            '<p>Staff activation requires a separate release approval.</p>'
            '</section></main>;\n' + anchor)
        lines = text.splitlines(keepends=True)
        removed = [x for x in lines if x.lstrip().startswith('{!ownerMode&&process.env.VOX_')]
        assert len(removed) == 3, "unexpected Staff action surface count"
        text = "".join(x for x in lines if x not in removed)
        start = '<nav aria-label="Staff workspaces">'
        assert text.count(start) == 1
        left = text.index(start)
        right = text.index('</nav>', left) + len('</nav>')
        text = (text[:left] +
                '<nav aria-label="Owner workspaces">'
                '<Link href="/operations" style={{color:"#9decc8"}}>Owner Operations</Link>'
                '</nav>' + text[right:])
        return text.replace('Staff sign-in', 'Owner sign-in').replace('Staff Vendor 360', 'Owner Vendor 360')
    return text
