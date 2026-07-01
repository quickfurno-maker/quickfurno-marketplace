# Phase 15A — Premium Admin UI-Only Upgrade

Status: **Implemented — UI-only.**

## Purpose

Give the QuickFurno admin panel a premium SaaS look (dark navy sidebar, clean
light workspace, green/teal accent, rounded white cards, soft shadows, better
spacing/typography, consistent badges/buttons/tables) — **without changing any
business logic, data, queries, schema, APIs, AOS, n8n, or the public website.**

## Approach (why so few files changed)

Every admin page renders through two shared layers:

- `components/admin/AdminShell.tsx` — the sidebar + header + workspace frame.
- `components/admin/AdminPrimitives.tsx` — the shared `StatCard`, `SectionCard`,
  `StatusBadge`, `DataTable`, `PageHeader`, buttons, `EmptyState`, `Tabs`,
  `Toolbar`, `InfoGrid`, etc. that all admin pages/components use.

So polishing those two files + a **scoped** CSS block upgrades all seven target
pages consistently, with the smallest possible blast radius. No per-page logic
was touched. All primitive component **props/APIs are unchanged** — only Tailwind
classes and scoped CSS were edited, so every existing call site keeps working.

## Pages visually improved

Via the shared shell + primitives (no page logic changed):

1. `/admin/dashboard`
2. `/admin/crm`
3. `/admin/vendors`
4. `/admin/lead-distribution`
5. `/admin/automations`
6. `/admin/categories`
7. `/admin/cities`

(Every other admin section that uses the shared shell/primitives benefits too.)

## Files changed

- `app/globals.css` — added a premium polish block **scoped entirely to
  `.admin-surface`** (flat premium background `#f4f6fa`, refined webkit
  scrollbars, calm transitions, reusable `qf-card-shadow` / `qf-card-hover`
  shadow helpers, and a deep-navy `qf-sidebar` gradient). The public site never
  has the `.admin-surface` class, so it is unaffected.
- `components/admin/AdminShell.tsx` — deep-navy premium sidebar (`qf-sidebar`),
  refined nav items (rounded pills, emerald active accent bar + icon chip,
  softer hover, tighter group headers), cleaner header (rounded Superadmin chip,
  live-snapshot dot, larger title), refined footer role card. Replaced the
  hardcoded fake "Marketplace health 76%" bar with an honest, non-numeric
  "Preview-safe mode" safety chip (no fake data).
- `components/admin/AdminPrimitives.tsx` — visual-only refinements to
  `PageHeader`, `PrimaryButton`, `SecondaryButton`, `StatCard`, `StatusBadge`,
  `Toolbar`, `SelectFilter`, `DataTable`, `SectionCard`, `EmptyState`, `Tabs`,
  `ActionMenu`, `ConfirmDialog`, `Toast`, `InfoGrid` (consistent `rounded-2xl`
  cards, `qf-card-shadow`, larger metric numbers, softer badges, roomier table
  rows, consistent button radius/focus rings, premium empty states).
- `components/AdminDashboard.tsx` — page-level class polish for the flagship
  `/admin/dashboard` (Today's Priority, Pending Actions, Vendor Health, Recent
  Activity, revenue pills → `rounded-xl`, roomier padding, consistent buttons).
  No metric calculations changed.
- `components/admin/AdminSectionPage.tsx` — class-only polish of the bespoke
  vendor / city / package / category cards (`rounded-xl` + `qf-card-shadow`).
  No page logic, actions, or data sources changed.
- `docs/n8n-workflows/phase-15a-premium-admin-ui-only-upgrade.md` — this file.

## What was intentionally NOT changed

- No business/CRM/scoring/assignment/eligibility/credit logic.
- No Supabase queries, schema, or migrations (none created).
- No API route logic (none added or edited).
- No AOS or n8n logic; no n8n calls; Phase 12 two-lock switch untouched.
- No category/city source-of-truth logic (still admin-managed only).
- No public website UI, no vendor registration, no lead form logic.
- No `.env` / `.env.local`. No secrets touched or exposed.
- No component prop/API signatures changed (pure class/CSS edits).

## Safety confirmation

- ✅ UI-only. No WhatsApp, no vendor notification, no credit deduction, no
  auto-assignment, no n8n call, no AOS behavior change.
- ✅ Cities remain admin-managed (Pune, Mumbai); categories remain admin-managed
  (Interior / Sofa / Painter / Civil Work; Interior subcategories: Interior
  Designers, Carpenters, Modular Factory, Premium Interiors).
- ✅ No fake cities/categories introduced. No fake demo metrics added; the one
  pre-existing fake metric ("76% marketplace health") was removed.
- ✅ Public site untouched (all admin CSS is scoped under `.admin-surface`).

## Test checklist

```
npm run build          # must pass
git status --short .env .env.local     # expect: no output
git diff --stat        # expect: admin shell/primitives + globals.css + this doc
```

Manual (dev server `npm run dev`):

- [ ] http://localhost:3000/admin/dashboard
- [ ] http://localhost:3000/admin/crm
- [ ] http://localhost:3000/admin/vendors
- [ ] http://localhost:3000/admin/lead-distribution
- [ ] http://localhost:3000/admin/automations
- [ ] http://localhost:3000/admin/categories
- [ ] http://localhost:3000/admin/cities
- [ ] http://localhost:3000  (public homepage — unchanged)
- [ ] http://localhost:3000/vendor/register  (unchanged)

Bad-value scan (expected: only pre-existing legacy/public-site matches, none in
the admin shell/primitives/CSS changed here):

```
Get-ChildItem -Path . -Recurse -Include *.ts,*.tsx,*.js,*.jsx -File |
  Select-String -Pattern "Bengaluru|Delhi|Hyderabad|Nagpur|Nashik|Wardrobe|Modular Kitchen|False Ceiling|Custom Furniture|Home Renovation|Full Home Interior|Carpentry"
```

## Rollback steps

A safety tag was created before this phase: `backup-before-admin-ui-only-upgrade-tag`.

To discard this UI attempt:

```
git stash push -u -m "bad phase 15a admin ui attempt"
git reset --hard backup-before-admin-ui-only-upgrade-tag
```

Or revert just the three edited files:

```
git checkout -- app/globals.css components/admin/AdminShell.tsx components/admin/AdminPrimitives.tsx
```

No database or environment rollback is needed (nothing was migrated or changed).
